/**
 * Конфигурация и определение путей.
 * Кроссплатформенно: macOS / Linux / Windows.
 */
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** Каталог данных приложения по правилам ОС */
function appDataDir(appName) {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library/Application Support", appName);
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData/Roaming"), appName);
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local/share"), appName);
}

/**
 * Профиль notebooklm-mcp — нужен только для разовой миграции тем, кто
 * пришёл с него. Своя авторизация (nlm_setup_auth) делает эту зависимость
 * необязательной.
 */
function legacyProfile() {
  const home = os.homedir();
  const candidates = [
    path.join(appDataDir("notebooklm-mcp"), "chrome_profile"),
    path.join(home, ".config/notebooklm-mcp/chrome_profile"),
    path.join(process.env.LOCALAPPDATA || path.join(home, "AppData/Local"),
              "notebooklm-mcp-nodejs/Data/chrome_profile"),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

export const CONFIG = {
  /**
   * Свой профиль с куками Google — сюда пишет nlm_setup_auth.
   * Лежит в каталоге данных ОС, а не в папке проекта: репозиторий можно
   * удалить или переустановить, не потеряв авторизацию.
   */
  sourceProfile:
    process.env.NLM_SOURCE_PROFILE ||
    path.join(appDataDir("notebooklm-extra"), "chrome_profile"),

  /** Профиль notebooklm-mcp — импортируется один раз, если свой пуст */
  legacyProfile: legacyProfile(),


  /** Куда складывать выгрузки */
  outDir: process.env.NLM_OUT_DIR || path.join(ROOT, "downloads"),

  /** Показывать окно браузера (для отладки) */
  headless: process.env.NLM_HEADLESS !== "false",

  /**
   * Размер окна в headless. Ниже ~1300px NotebookLM схлопывает колонки
   * в табы, и список источников перестаёт существовать в DOM.
   */
  windowWidth: Number(process.env.NLM_WINDOW_WIDTH || 1600),
  windowHeight: Number(process.env.NLM_WINDOW_HEIGHT || 1000),

  /** Таймауты, мс */
  navTimeout: Number(process.env.NLM_NAV_TIMEOUT || 60000),
  settleDelay: Number(process.env.NLM_SETTLE_DELAY || 5500),
  readDelay: Number(process.env.NLM_READ_DELAY || 3500),
};

/** CSS-селекторы NotebookLM (Angular Material). При редизайне — обновить. */
export const SEL = {
  sourceRow: ".single-source-container",
  artifactItem: "artifact-library-item",
  /** Название артефакта — отдельный узел внутри карточки */
  artifactTitle: ".title-container",
  docViewer: "labs-tailwind-doc-viewer",
  /** Кнопки создания артефактов в Студии — это div с aria-label, НЕ <button> */
  createArtifactBtn: ".create-artifact-button-container",
  /** Поле вопроса в чате. Первое такое поле — поиск источников в интернете */
  chatInput: "textarea.query-box-input",
  chatMessage: "chat-message",
  /** Поле «Вставьте ссылку» в диалоге добавления источника */
  urlInput: 'input[type="url"], input[formcontrolname="url"]',
};

/** Типы артефактов панели «Студия» */
export const STUDIO_TYPES = [
  "Ментальная карта",
  "Отчеты",
  "Карточки",
  "Тест",
  "Инфографика",
  "Таблица данных",
  "Презентация",
  "Аудиопересказ",
  "Видеопересказ",
];

/** Английские синонимы — интерфейс может быть на другом языке */
export const STUDIO_TYPES_EN = {
  "Ментальная карта": "Mind map",
  "Отчеты": "Reports",
  "Карточки": "Flashcards",
  "Тест": "Quiz",
  "Инфографика": "Infographic",
  "Таблица данных": "Data table",
  "Презентация": "Presentation",
  "Аудиопересказ": "Audio Overview",
  "Видеопересказ": "Video Overview",
};
