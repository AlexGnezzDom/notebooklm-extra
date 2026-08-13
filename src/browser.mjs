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

/** Синхронизирует куки из профиля notebooklm-mcp в рабочую копию */
export async function syncProfile() {
  const { sourceProfile, workProfile } = CONFIG;
  if (!existsSync(sourceProfile)) {
    throw new Error(
      `Профиль notebooklm-mcp не найден: ${sourceProfile}\n` +
        `Сначала установи и авторизуй базовый сервер:\n` +
        `  npm i -g notebooklm-mcp   → затем вызови его инструмент setup_auth\n` +
        `Либо укажи путь вручную: NLM_SOURCE_PROFILE=/путь/к/chrome_profile`
    );
  }
  await copyProfile(sourceProfile, workProfile);
  // подчищаем локи, оставшиеся от источника
  for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    await fs.rm(path.join(workProfile, f), { force: true }).catch(() => {});
  }
  return workProfile;
}

/** Открывает контекст на рабочей копии профиля и отдаёт страницу в колбэк */
export async function withPage(fn, { headless = CONFIG.headless } = {}) {
  await syncProfile();
  // Ширина окна решает всё: на узком экране NotebookLM схлопывает три
  // колонки в табы «Источники | Чат | Студия», и панель источников просто
  // не отрисовывается — все инструменты возвращают ноль. В headless окно
  // по умолчанию 800×600, а --start-maximized там не действует, поэтому
  // размер задаём явно.
  const ctx = await chromium.launchPersistentContext(CONFIG.workProfile, {
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
  // вместо честной ошибки.
  const at = page.url();
  if (at.includes("accounts.google.com") || /\/login\b/.test(at)) {
    throw new Error(
      "Не авторизован. Запусти setup_auth в notebooklm-mcp и войди в Google-аккаунт."
    );
  }
}
