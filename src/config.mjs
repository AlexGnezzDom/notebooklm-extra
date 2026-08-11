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

/**
 * Где notebooklm-mcp хранит свой Chrome-профиль.
 * Пакет использует env-paths, поэтому пути различаются по ОС.
 */
function defaultSourceProfile() {
  const home = os.homedir();
  const candidates =
    process.platform === "darwin"
      ? [path.join(home, "Library/Application Support/notebooklm-mcp/chrome_profile")]
      : process.platform === "win32"
      ? [
          path.join(process.env.APPDATA || path.join(home, "AppData/Roaming"),
                    "notebooklm-mcp/chrome_profile"),
          path.join(process.env.LOCALAPPDATA || path.join(home, "AppData/Local"),
                    "notebooklm-mcp-nodejs/Data/chrome_profile"),
        ]
      : [
          path.join(process.env.XDG_DATA_HOME || path.join(home, ".local/share"),
                    "notebooklm-mcp/chrome_profile"),
          path.join(home, ".config/notebooklm-mcp/chrome_profile"),
        ];

  return candidates.find((p) => existsSync(p)) || candidates[0];
}

export const CONFIG = {
  /** Профиль-источник (создаётся пакетом notebooklm-mcp при setup_auth) */
  sourceProfile: process.env.NLM_SOURCE_PROFILE || defaultSourceProfile(),

  /** Рабочая копия профиля — чтобы не драться за SingletonLock */
  workProfile: process.env.NLM_WORK_PROFILE || path.join(ROOT, "profile"),

  /** Куда складывать выгрузки */
  outDir: process.env.NLM_OUT_DIR || path.join(ROOT, "downloads"),

  /** Показывать окно браузера (для отладки) */
  headless: process.env.NLM_HEADLESS !== "false",

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
