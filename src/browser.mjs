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
  const ctx = await chromium.launchPersistentContext(CONFIG.workProfile, {
    channel: "chrome",
    headless,
    viewport: null, // окно = вьюпорт, иначе интерфейс «съезжает»
    args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
  });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    return await fn(page);
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** Переходит в блокнот и проверяет, что не выкинуло на логин */
export async function openNotebook(page, url) {
  if (!/^https:\/\/notebooklm\.google\.com\/notebook\//.test(url)) {
    throw new Error(
      "Ожидается ссылка вида https://notebooklm.google.com/notebook/<uuid>"
    );
  }
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: CONFIG.navTimeout,
  });
  await page.waitForTimeout(CONFIG.settleDelay);
  if (page.url().includes("accounts.google.com")) {
    throw new Error(
      "Не авторизован. Запусти setup_auth в notebooklm-mcp и войди в Google-аккаунт."
    );
  }
}
