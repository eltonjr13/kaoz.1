/**
 * Renderiza o cérebro com o pacote REAL presente e reporta o que aparece.
 *
 * Antes deste pacote existir no diretório de runtime, a aba Cérebro só mostrava
 * "Pacote do conectoma ausente". Este script confirma que a anatomia de fato
 * desenha e que a interface informa modo, licença e procedência.
 */
import { chromium } from "playwright";
import path from "node:path";

const BASE = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : "http://localhost:3001";
const OUT = path.resolve("tests/fixtures/cortex-engine/browser-evidence");

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const erros = [];
page.on("pageerror", (e) => erros.push(e.message.slice(0, 200)));
page.on("console", (m) => {
  if (m.type() === "error" && !/DevTools/.test(m.text())) erros.push(m.text().slice(0, 200));
});

const requisicoes = [];
page.on("response", (r) => {
  if (r.url().includes("/api/cortex/engine/")) {
    requisicoes.push(`${r.status()} ${r.url().replace(BASE, "").split("?")[0]}`);
  }
});

await page.goto(`${BASE}/cortex`, { waitUntil: "networkidle", timeout: 120_000 });
await page.waitForTimeout(8000);

const estado = await page.evaluate(() => {
  const t = document.body.innerText;
  const canvas = document.querySelector("canvas");
  const svg = document.querySelector("svg");
  return {
    pacoteAusente: t.includes("Pacote do conectoma ausente"),
    erro: t.includes("Não foi possível carregar o cérebro"),
    skeleton: document.querySelectorAll('[class*="animate-pulse"]').length,
    temCanvas: Boolean(canvas),
    canvasW: canvas?.width ?? 0,
    canvasH: canvas?.height ?? 0,
    temSvg: Boolean(svg),
    // A interface deve declarar o escopo e a procedência.
    mencionaRecorte: /recorte de \d+ neur[oô]nios/i.test(t),
    mencionaCCBY: /CC BY 4\.0/i.test(t),
    mencionaBerg: /Berg et al/i.test(t),
    mencionaLegacy: /legacy/i.test(t),
    // Anatomia COMPLETA (camada de referência) versus o recorte do motor.
    rotuloAnatomiaCns: t.includes("Anatomia do CNS"),
    declaraDuasCamadas: /neur[oô]nios de referência\s+anatômica/i.test(t),
    mencionaCnsCompleto: /CNS completo/i.test(t),
    erroAnatomia: /Anatomia completa indisponível/i.test(t),
    ariaCanvas: canvas?.getAttribute("aria-label")?.slice(0, 200) ?? "",
    trecho: t.replace(/\s+/g, " ").slice(200, 1100),
  };
});

console.log("=== ESTADO DO CEREBRO (com pacote real) ===");
for (const [k, v] of Object.entries(estado)) {
  if (k !== "trecho") console.log(`  ${k}: ${v}`);
}
console.log(`\n  trecho visivel: ${estado.trecho}`);

console.log("\n=== requisicoes do motor ===");
for (const r of [...new Set(requisicoes)]) console.log("  " + r);

await page.screenshot({ path: path.join(OUT, "cerebro-real-1440.png") });
console.log(`\n  captura: ${path.join(OUT, "cerebro-real-1440.png")}`);
if (erros.length) {
  console.log(`\n=== erros (${erros.length}) ===`);
  for (const e of [...new Set(erros)].slice(0, 5)) console.log("  " + e);
}
await browser.close();
