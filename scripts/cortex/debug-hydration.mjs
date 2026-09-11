/**
 * Diagnóstico 4: a hidratação falha em /cortex, em /flow, ou em ambas?
 *
 * Se falhar nas duas, é ambiente de dev — a validação precisa rodar contra o
 * build de produção, que é o que o produto entrega de fato.
 */
import { chromium } from "playwright";

const BASE = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : "http://127.0.0.1:3000";

const browser = await chromium.launch();

for (const route of ["/cortex", "/flow"]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  let chunks = 0;
  page.on("response", (res) => {
    if (res.url().includes("/_next/") && res.url().endsWith(".js")) chunks++;
  });

  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(4000);

  const probe = await page.evaluate(() => {
    // Nó gerenciado pelo React carrega __reactFiber$<random> / __reactProps$<random>.
    const countReact = (el) =>
      el ? Object.keys(el).filter((k) => k.startsWith("__react")).length : -1;
    const tab = document.querySelector('[role="tab"]');
    const btn = document.querySelector("button");
    const anchor = document.querySelector("a[href]");
    return {
      tab: countReact(tab),
      button: countReact(btn),
      anchor: countReact(anchor),
      reactRoot: Boolean(
        document.querySelector('[data-reactroot], #__next, body > div[id]')
      ),
      scripts: document.querySelectorAll("script[src]").length,
    };
  });

  console.log(
    `${route}: chunks=${chunks} | reactKeys(tab/button/a)=${probe.tab}/${probe.button}/${probe.anchor}` +
      ` | scriptSrcs=${probe.scripts}`
  );
  await context.close();
}

await browser.close();
