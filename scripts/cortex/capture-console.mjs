/**
 * Captura TODA saída de console e erros de página em produção, sem filtro.
 * É o caminho direto para o erro que impede a hidratação.
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3000";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const msgs = [];
page.on("console", (m) => msgs.push(`[${m.type()}] ${m.text().slice(0, 400)}`));
page.on("pageerror", (e) => msgs.push(`[PAGEERROR] ${e.message.slice(0, 400)}`));
page.on("requestfailed", (r) =>
  msgs.push(`[REQFAIL] ${r.method()} ${r.url().replace(BASE, "").slice(0, 90)} :: ${r.failure()?.errorText}`)
);

await page.goto(`${BASE}/cortex`, { waitUntil: "networkidle", timeout: 90_000 });
await page.waitForTimeout(6000);

// Bolha: qualquer mensagem que mencione hidratação ou erro de render.
console.log(`total de mensagens: ${msgs.length}\n`);
const unicas = new Map();
for (const m of msgs) {
  const chave = m.replace(/id=[A-Za-z0-9]+/g, "id=X").slice(0, 150);
  unicas.set(chave, (unicas.get(chave) ?? 0) + 1);
}
for (const [k, v] of unicas) console.log(`x${v}  ${k}`);

await browser.close();
