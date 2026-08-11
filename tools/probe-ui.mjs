#!/usr/bin/env node
/**
 * Разведка DOM NotebookLM — для починки селекторов после редизайна.
 *
 * Запуск:
 *   NLM_HEADLESS=false node tools/probe-ui.mjs "https://notebooklm.google.com/notebook/<uuid>"
 *
 * Печатает: кандидатов на селекторы, кастомные Angular-теги, кнопки Студии.
 * Ничего не сохраняет на диск — только вывод в консоль.
 */
import { withPage, openNotebook } from "../src/browser.mjs";
import { SEL } from "../src/config.mjs";

const url = process.argv[2] || process.env.NLM_NOTEBOOK_URL;
if (!url) {
  console.error(
    "Укажите URL блокнота:\n" +
      '  node tools/probe-ui.mjs "https://notebooklm.google.com/notebook/<uuid>"'
  );
  process.exit(1);
}

await withPage(async (page) => {
  await openNotebook(page, url);

  // 1. Проверяем текущие селекторы
  console.log("=== Текущие селекторы ===");
  for (const [key, sel] of Object.entries(SEL)) {
    const n = await page.locator(sel).count();
    console.log(`  ${n > 0 ? "✅" : "❌"} ${key.padEnd(13)} ${sel}  → ${n}`);
  }

  // 2. Кастомные Angular-компоненты (кандидаты на строки/карточки)
  const tags = await page.evaluate(() => {
    const t = {};
    document.querySelectorAll("*").forEach((el) => {
      const n = el.tagName.toLowerCase();
      if (n.includes("-")) t[n] = (t[n] || 0) + 1;
    });
    return Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 20);
  });
  console.log("\n=== Кастомные теги (топ-20) ===");
  tags.forEach(([t, n]) => console.log(`  ${String(n).padStart(4)} × <${t}>`));

  // 3. Классы контейнеров, похожих на список источников
  const classes = await page.evaluate(() => {
    const out = {};
    document.querySelectorAll("div[class]").forEach((el) => {
      (el.className || "")
        .toString()
        .split(/\s+/)
        .filter((c) => /source|artifact|note|item|row|card/i.test(c) && !c.startsWith("ng-"))
        .forEach((c) => (out[c] = (out[c] || 0) + 1));
    });
    return Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 15);
  });
  console.log("\n=== Классы-кандидаты ===");
  classes.forEach(([c, n]) => console.log(`  ${String(n).padStart(4)} × .${c}`));

  // 4. Кнопки Студии
  const buttons = await page.evaluate(() => {
    const out = new Set();
    document.querySelectorAll('button,[role="button"]').forEach((b) => {
      const t = (b.innerText || "").replace(/\s+/g, " ").trim();
      if (t && t.length < 40) out.add(t);
    });
    return [...out];
  });
  console.log("\n=== Кнопки на странице ===");
  buttons.slice(0, 40).forEach((b) => console.log(`  • ${b}`));

  console.log(
    "\n💡 Обновите блок SEL в src/config.mjs, если текущие селекторы дают 0."
  );
});
