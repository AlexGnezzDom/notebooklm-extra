/**
 * Работа с браузером: синхронизация профиля и запуск контекста.
 *
 * Почему копия профиля: оригинальный notebooklm-mcp держит свой профиль
 * занятым (Chrome SingletonLock). Два процесса на одном профиле = падение.
 * Поэтому копируем и работаем с копией; куки синхронизируем перед стартом.
 */
import { chromium } from "patchright";
import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { CONFIG } from "./config.mjs";

const SKIP = new Set([
  "Cache", "Code Cache", "GPUCache", "ShaderCache", "GrShaderCache",
  "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache", "component_crx_cache",
]);

/** Рекурсивное копирование без кэшей и локов (кроссплатформенно, без rsync) */
async function copyProfile(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith("Singleton") || SKIP.has(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    try {
      if (e.isDirectory()) await copyProfile(s, d);
      else if (e.isFile()) await fs.copyFile(s, d);
    } catch {
      /* файл может быть занят — пропускаем, не критично */
    }
  }
}

/**
 * Готовит профиль к работе и отдаёт путь к нему.
 *
 * Работаем с ОРИГИНАЛОМ, а не с копией. Google ротирует куки сессии: копия
 * получает свежие, оригинал остаётся со старыми — и те становятся
 * недействительными. Итог: каждый второй запуск требовал повторного входа.
 */
export async function prepareProfile() {
  const { sourceProfile, legacyProfile } = CONFIG;

  // Разовый импорт для тех, кто пришёл с notebooklm-mcp: там уже есть
  // авторизованный профиль, повторно логиниться незачем.
  if (!existsSync(sourceProfile) && legacyProfile) {
    await copyProfile(legacyProfile, sourceProfile);
  }

  if (!existsSync(sourceProfile)) {
    throw new Error(
      `Нет авторизации. Вызови инструмент nlm_setup_auth — откроется окно ` +
        `Chrome, войди в Google-аккаунт, и профиль сохранится здесь:\n` +
        `  ${sourceProfile}`
    );
  }
  // локи от процессов, убитых не по-хорошему
  for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    await fs.rm(path.join(sourceProfile, f), { force: true }).catch(() => {});
  }
  return sourceProfile;
}

/**
 * Один профиль — один Chrome за раз. Инструменты вызываются последовательно,
 * но клиент вправе прислать два запроса разом; без очереди второй упал бы на
 * ProcessSingleton.
 */
let queue = Promise.resolve();

/** Открывает контекст на профиле и отдаёт страницу в колбэк */
export async function withPage(fn, opts = {}) {
  const run = queue.then(() => withPageNow(fn, opts));
  queue = run.catch(() => {}); // ошибка одного вызова не рвёт очередь
  return run;
}

async function withPageNow(fn, { headless = CONFIG.headless } = {}) {
  const profile = await prepareProfile();
  // Ширина окна решает всё: на узком экране NotebookLM схлопывает три
  // колонки в табы «Источники | Чат | Студия», и панель источников просто
  // не отрисовывается — все инструменты возвращают ноль. В headless окно
  // по умолчанию 800×600, а --start-maximized там не действует, поэтому
  // размер задаём явно.
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: "chrome",
    headless,
    viewport: null, // окно = вьюпорт, иначе интерфейс «съезжает»
    args: [
      headless ? `--window-size=${CONFIG.windowWidth},${CONFIG.windowHeight}` : "--start-maximized",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    return await fn(page);
  } finally {
    await ctx.close().catch(() => {});
  }
}

/**
 * Разовый вход в Google: открывает видимое окно на СВОЁМ профиле и ждёт,
 * пока пользователь залогинится. Профиль остаётся в каталоге данных ОС,
 * поэтому переустановка репозитория авторизацию не сбрасывает.
 */
export async function setupAuth({ timeoutMs = 300000 } = {}) {
  const { sourceProfile } = CONFIG;
  await fs.mkdir(sourceProfile, { recursive: true });
  for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    await fs.rm(path.join(sourceProfile, f), { force: true }).catch(() => {});
  }

  const ctx = await chromium.launchPersistentContext(sourceProfile, {
    channel: "chrome",
    headless: false,
    viewport: null,
    args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
  });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto("https://notebook.google.com/", { waitUntil: "domcontentloaded" });

    // Ждём, пока адрес перестанет быть страницей входа.
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const at = page.url();
      const onLogin =
        at.includes("accounts.google.com") || /notebook\.google\.com\/login/.test(at);
      if (!onLogin && at.includes("notebook.google.com")) {
        await page.waitForTimeout(3000); // дать кукам осесть на диск
        return { authenticated: true, profile: sourceProfile };
      }
      await page.waitForTimeout(2000);
    }
    throw new Error(
      `Вход не завершён за ${Math.round(timeoutMs / 1000)} сек. ` +
        `Запусти nlm_setup_auth заново и войди в аккаунт.`
    );
  } finally {
    await ctx.close().catch(() => {});
  }
}

/**
 * Google переименовал продукт в Gemini Notebook и перевёл его на домен
 * notebook.google.com; старый notebooklm.google.com отдаёт 301. Принимаем
 * оба написания и ходим сразу на новый адрес, чтобы не гонять редирект.
 */
const NOTEBOOK_URL_RE =
  /^https:\/\/notebook(lm)?\.google\.com\/notebook\/[\w-]+/;

export function normalizeNotebookUrl(url) {
  if (!NOTEBOOK_URL_RE.test(url)) {
    throw new Error(
      "Ожидается ссылка вида https://notebook.google.com/notebook/<uuid> " +
        "(старый домен notebooklm.google.com тоже принимается)"
    );
  }
  return url.replace("://notebooklm.google.com", "://notebook.google.com");
}

/** Переходит в блокнот и проверяет, что не выкинуло на логин */
export async function openNotebook(page, url) {
  url = normalizeNotebookUrl(url);
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: CONFIG.navTimeout,
  });
  await page.waitForTimeout(CONFIG.settleDelay);
  // Логин живёт и на accounts.google.com, и на notebook.google.com/login —
  // без второй проверки протухшие куки вернут содержимое страницы входа
  // вместо честной ошибки. Но Google умеет уходить на логин на пару секунд
  // и возвращаться сам, поэтому сразу не сдаёмся: объявлять «сессия истекла»
  // на таком редиректе — значит гонять пользователя логиниться впустую.
  const onLogin = () => {
    const at = page.url();
    return at.includes("accounts.google.com") || /\/login\b/.test(at);
  };
  for (let i = 0; onLogin() && i < 6; i++) {
    await page.waitForTimeout(2500);
  }
  if (onLogin()) {
    throw new Error(
      "Сессия Google истекла. Вызови инструмент nlm_setup_auth и войди в аккаунт — " +
        "откроется окно браузера."
    );
  }
}
