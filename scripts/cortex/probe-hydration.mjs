/**
 * Sonda de hidratação independente de rota.
 *
 * Varre o documento inteiro procurando QUALQUER nó com interno do React
 * (`__reactFiber$`, `__reactProps$`, `__reactContainer$`). Se nada no documento
 * tem esses campos, o React não assumiu a página — não importa qual seja.
 *
 * Uso: node scripts/cortex/probe-hydration.mjs [--base URL] [rota ...]
 */
import { chromium } from "playwright";

const argv = process.argv.slice(2);
const BASE = argv.includes("--base")
  ? argv[argv.indexOf("--base") + 1]
  : "http://localhost:3000";
const routes = argv.filter((a) => a.startsWith("/") && !a.startsWith("//"));
if (!routes.length) routes.push("/", "/cortex", "/flow");

const browser = await chromium.launch();

for (const route of routes) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const erros = [];
  page.on("pageerror", (e) => erros.push(e.message.slice(0, 160)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/DevTools|webpack-hmr/.test(t)) return;
    erros.push(`[console] ${t.slice(0, 160)}`);
  });

  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(5000);

  const probe = await page.evaluate(() => {
    const all = document.querySelectorAll("*");
    let comReact = 0;
    let amostra = null;
    for (const el of all) {
      const keys = Object.keys(el).filter((k) => k.startsWith("__react"));
      if (keys.length) {
        comReact++;
        if (!amostra) amostra = { tag: el.tagName.toLowerCase(), keys };
      }
    }
    return {
      totalElementos: all.length,
      comInternoReact: comReact,
      amostra,
      texto: document.body.innerText.replace(/\s+/g, " ").slice(0, 110),
    };
  });

  const hidratado = probe.comInternoReact > 0;
  console.log(
    `${route}  ->  hidratado=${hidratado}  (nos com React: ${probe.comInternoReact}/${probe.totalElementos})`
  );
  console.log(`    amostra: ${JSON.stringify(probe.amostra)}`);
  console.log(`    texto: ${probe.texto}`);
  if (erros.length) {
    console.log(`    erros (${erros.length}):`);
    for (const e of [...new Set(erros)].slice(0, 4)) console.log(`      ${e}`);
  }
  await context.close();
}

await browser.close();
