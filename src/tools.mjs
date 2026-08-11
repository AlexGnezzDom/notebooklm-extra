/**
 * Реализация инструментов MCP.
 */
import fs from "fs/promises";
import path from "path";
import { withPage, openNotebook } from "./browser.mjs";
import { CONFIG, SEL, STUDIO_TYPES, STUDIO_TYPES_EN } from "./config.mjs";

// ── Вспомогательные ───────────────────────────────────────────

/**
 * Первая строка карточки — это лигатура Material Symbols (имя иконки),
 * например `video_youtube`, `markdown`, `picture_as_pdf`. Такие строки
 * состоят только из латиницы в нижнем регистре и подчёркиваний, поэтому
 * распознаём их эвристикой, а не фиксированным списком: иконок десятки,
 * и в другом блокноте всплывёт та, которой в списке нет.
 */
const ICON_RE = /^[a-z][a-z0-9_]{2,29}$/;

async function listSources(page) {
  return page.evaluate(
    ({ sel, iconSrc }) => {
      const ICON = new RegExp(iconSrc);
      return [...document.querySelectorAll(sel)]
        .map((row, i) => {
          const lines = (row.innerText || "")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
          // берём первую строку, не похожую на имя иконки
          const title = lines.find((l) => !ICON.test(l)) || lines[0] || "";
          // тип источника — если первая строка всё-таки иконка
          const kind = ICON.test(lines[0] || "") ? lines[0] : "";
          return { index: i, title: title.slice(0, 200), kind };
        })
        .filter((x) => x.title);
    },
    { sel: SEL.sourceRow, iconSrc: ICON_RE.source }
  );
}

/**
 * Открытый источник ЗАМЕНЯЕТ собой список в панели, а кнопки «назад» в
 * интерфейсе нет. Поэтому перед каждым чтением восстанавливаем список
 * перезаходом на страницу блокнота — иначе всё после первого источника
 * падает с «не найден (всего 0)».
 */
async function ensureSourceList(page, url) {
  if ((await page.locator(SEL.sourceRow).count()) === 0) {
    await openNotebook(page, url);
  }
}

async function readSource(page, index) {
  const rows = page.locator(SEL.sourceRow);
  const total = await rows.count();
  if (index < 0 || index >= total) {
    throw new Error(`Источник ${index} не найден (всего ${total})`);
  }
  await rows.nth(index).click();
  await page.waitForTimeout(CONFIG.readDelay);

  return page.evaluate((sel) => {
    const viewer = document.querySelector(sel);
    if (viewer?.innerText?.trim()) return viewer.innerText.trim();
    // запасной путь: самый «текстовый» блок на странице
    let best = "";
    document.querySelectorAll("div").forEach((d) => {
      const t = d.innerText || "";
      if (t.length > best.length && t.length < 200000) best = t;
    });
    return best.trim();
  }, SEL.docViewer);
}

function safeFileName(title, i) {
  const base =
    title.replace(/[^\p{L}\p{N}._ -]/gu, "").trim().slice(0, 80) || `source_${i}`;
  return `${String(i).padStart(3, "0")}_${base.replace(/\s+/g, "_")}.md`;
}

// ── Описания инструментов ─────────────────────────────────────

export const TOOLS = [
  {
    name: "nlm_health",
    description:
      "Проверить реальный доступ к блокноту NotebookLM: открывает страницу и убеждается, что не редиректит на логин. Возвращает число источников.",
    inputSchema: {
      type: "object",
      properties: {
        notebook_url: { type: "string", description: "https://notebooklm.google.com/notebook/<uuid>" },
      },
      required: ["notebook_url"],
    },
  },
  {
    name: "nlm_list_sources",
    description:
      "Список всех источников блокнота с порядковыми номерами. Номер используется в nlm_read_source.",
    inputSchema: {
      type: "object",
      properties: { notebook_url: { type: "string" } },
      required: ["notebook_url"],
    },
  },
  {
    name: "nlm_read_source",
    description: "Прочитать полный текст одного источника по его номеру.",
    inputSchema: {
      type: "object",
      properties: {
        notebook_url: { type: "string" },
        index: { type: "number", description: "Номер источника (с 0)" },
        max_chars: { type: "number", description: "Ограничение длины ответа (по умолчанию 60000)" },
      },
      required: ["notebook_url", "index"],
    },
  },
  {
    name: "nlm_download_notebook",
    description:
      "Выгрузить содержимое всех источников блокнота в .md-файлы на диск. Долгая операция: ~5–10 сек на источник.",
    inputSchema: {
      type: "object",
      properties: {
        notebook_url: { type: "string" },
        limit: { type: "number", description: "Ограничить число источников (для пробы)" },
        out_dir: { type: "string", description: "Куда сохранять (по умолчанию ./downloads)" },
      },
      required: ["notebook_url"],
    },
  },
  {
    name: "nlm_list_artifacts",
    description:
      "Список артефактов в панели «Студия» (ментальные карты, отчёты, заметки и пр.).",
    inputSchema: {
      type: "object",
      properties: { notebook_url: { type: "string" } },
      required: ["notebook_url"],
    },
  },
  {
    name: "nlm_create_artifact",
    description:
      "Запустить создание артефакта в Студии. Генерация асинхронная (1–10 мин) — результат проверять через nlm_list_artifacts.",
    inputSchema: {
      type: "object",
      properties: {
        notebook_url: { type: "string" },
        type: { type: "string", enum: STUDIO_TYPES, description: "Тип артефакта" },
      },
      required: ["notebook_url", "type"],
    },
  },
];

// ── Обработчики ───────────────────────────────────────────────

export const handlers = {
  async nlm_health({ notebook_url }) {
    return withPage(async (page) => {
      await openNotebook(page, notebook_url);
      const sources = await listSources(page);
      return {
        authenticated: true,
        page_title: await page.title(),
        sources_count: sources.length,
      };
    });
  },

  async nlm_list_sources({ notebook_url }) {
    return withPage(async (page) => {
      await openNotebook(page, notebook_url);
      const sources = await listSources(page);
      return { count: sources.length, sources };
    });
  },

  async nlm_read_source({ notebook_url, index, max_chars = 60000 }) {
    return withPage(async (page) => {
      await openNotebook(page, notebook_url);
      const text = await readSource(page, index);
      return { index, length: text.length, text: text.slice(0, max_chars) };
    });
  },

  async nlm_download_notebook({ notebook_url, limit, out_dir }) {
    return withPage(async (page) => {
      await openNotebook(page, notebook_url);
      const all = await listSources(page);
      const take = limit ? all.slice(0, limit) : all;

      const stamp = new Date().toISOString().slice(0, 10);
      const dir = path.join(out_dir || CONFIG.outDir, `notebook_${stamp}`);
      await fs.mkdir(dir, { recursive: true });

      const saved = [];
      for (const s of take) {
        try {
          await ensureSourceList(page, notebook_url);
          const text = await readSource(page, s.index);
          const file = safeFileName(s.title, s.index);
          await fs.writeFile(path.join(dir, file), `# ${s.title}\n\n${text}\n`, "utf-8");
          saved.push({ file, chars: text.length });
        } catch (e) {
          saved.push({
            file: safeFileName(s.title, s.index),
            error: String(e?.message || e).slice(0, 160),
          });
        }
      }

      const ok = saved.filter((s) => s.chars);
      await fs.writeFile(
        path.join(dir, "_index.md"),
        [
          "# Выгрузка блокнота NotebookLM",
          "",
          `Дата: ${stamp}`,
          `Файлов: ${saved.length} (успешно: ${ok.length})`,
          "",
          ...saved.map(
            (s) => `- ${s.file}${s.chars ? ` — ${s.chars} симв.` : ` — ОШИБКА: ${s.error}`}`
          ),
        ].join("\n"),
        "utf-8"
      );

      return { dir, total: take.length, succeeded: ok.length, files: saved };
    });
  },

  async nlm_list_artifacts({ notebook_url }) {
    return withPage(async (page) => {
      await openNotebook(page, notebook_url);
      const artifacts = await page.evaluate(
        ({ sel, titleSel, iconSrc }) => {
          const ICON = new RegExp(iconSrc);
          return [...document.querySelectorAll(sel)]
            .map((el) => {
              const lines = (el.innerText || "")
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean);
              // Название лежит в отдельном узле. Без него первой не-иконкой
              // окажется бейдж «Не прочитано», а не имя артефакта.
              const title =
                el.querySelector(titleSel)?.innerText?.trim() ||
                lines.find((l) => !ICON.test(l)) ||
                "";
              const kind = ICON.test(lines[0] || "") ? lines[0] : "";
              // строка с числом источников и временем создания
              const meta = lines.find((l) => /·/.test(l)) || "";
              return { title, kind, meta };
            })
            .filter((x) => x.title);
        },
        { sel: SEL.artifactItem, titleSel: SEL.artifactTitle, iconSrc: ICON_RE.source }
      );
      return { count: artifacts.length, artifacts };
    });
  },

  async nlm_create_artifact({ notebook_url, type }) {
    return withPage(async (page) => {
      await openNotebook(page, notebook_url);

      const before = await page.evaluate(
        (sel) => document.querySelectorAll(sel).length,
        SEL.artifactItem
      );

      // Кнопки Студии — div.create-artifact-button-container с aria-label.
      // Пробуем русское название, затем английское, затем текст внутри.
      const names = [type, STUDIO_TYPES_EN[type]].filter(Boolean);
      let clicked = false;
      for (const n of names) {
        const byAria = page.locator(`${SEL.createArtifactBtn}[aria-label="${n}"]`).first();
        if (await byAria.count()) {
          await byAria.click();
          clicked = true;
          break;
        }
        const byText = page.locator(`${SEL.createArtifactBtn}:has-text("${n}")`).first();
        if (await byText.count()) {
          await byText.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) {
        const available = await page.evaluate(
          (sel) =>
            [...document.querySelectorAll(sel)]
              .map((e) => e.getAttribute("aria-label"))
              .filter(Boolean),
          SEL.createArtifactBtn
        );
        throw new Error(
          `Кнопка «${type}» не найдена. Доступно в Студии: ${available.join(", ") || "(ничего)"}`
        );
      }

      await page.waitForTimeout(4000);

      // Клик открывает панель настроек (у кнопок стрелка chevron_forward),
      // а не запускает генерацию — её надо подтвердить отдельно.
      //
      // Совпадение ТОЛЬКО точное: has-text("Создать") цепляет «Создать
      // блокнот» в шапке, и вместо карты создаётся новый блокнот.
      let confirmed = false;
      for (const name of ["Сгенерировать", "Generate", "Создать", "Create"]) {
        const btn = page.getByRole("button", { name, exact: true }).first();
        if (await btn.count()) {
          await btn.click().catch(() => {});
          confirmed = true;
          break;
        }
      }
      if (!confirmed) {
        throw new Error(
          `Панель «${type}» открылась, но кнопка подтверждения не найдена — ` +
            `генерация не запущена. Похоже, изменилась вёрстка Студии.`
        );
      }
      await page.waitForTimeout(8000);

      const after = await page.evaluate(
        (sel) => document.querySelectorAll(sel).length,
        SEL.artifactItem
      );

      return {
        type,
        started: true,
        artifacts_before: before,
        artifacts_after: after,
        note: "Генерация асинхронная (1–10 мин). Проверь через nlm_list_artifacts.",
      };
    });
  },
};
