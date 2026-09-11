/**
 * Teste comportamental de hidratação — não depende de inspecionar chaves
 * internas do React, e sim de um efeito observável: clicar numa aba troca o
 * conteúdo do painel?
 *
 * Também confirma se o servidor é de produção (o endpoint de HMR deve dar 404).
 */
import { chromium } from "playwright";

const BASE = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : "http://localhost:3000";
const ROUTE = process.argv.includes("--route")
  ? process.argv[process.argv.indexOf("--route") + 1]
  : "/";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const scripts = [];
page.on("response", (res) => {
  const u = res.url();
  if (u.includes("/_next/") && u.includes(".js")) {
    scripts.push(`${res.status()} ${u.replace(BASE, "").slice(0, 70)}`);
  }
});

// É produção? O endpoint de HMR não existe em produção.
const hmr = await fetch(`${BASE}/_next/webpack-hmr`).then((r) => r.status).catch(() => "erro");
console.log(`/${ROUTE} | /_next/webpack-hmr responde: ${hmr}  ${hmr === 404 ? "(producao)" : "(NAO parece producao)"}`);

await page.goto(`${BASE}${ROUTE}`, { waitUntil: "networkidle", timeout: 90_000 });
await page.waitForTimeout(5000);

const antes = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300));
console.log(`texto inicial: ${antes.slice(0, 160)}`);

// Ação observável: clicar na aba "Visão Geral".
const aba = page.locator('[role="tab"]', { hasText: "Visão Geral" }).first();
console.log(`aba Visao Geral encontrada: ${await aba.count()}`);
await aba.click();
await page.waitForTimeout(4000);

const depois = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300));
const mudou = antes !== depois;
console.log(`\ntexto apos clique:    ${depois.slice(200, 300)}`);
console.log(`\n>>> CONTEUDO MUDOU APOS CLIQUE: ${mudou}`);
console.log(`>>> HIDRATACAO FUNCIONA: ${mudou}`);

const estado = await page.evaluate(() => {
  const t = document.body.innerText;
  return {
    pacoteAusente: t.includes("Pacote do conectoma ausente"),
    erro: t.includes("Não foi possível carregar o cérebro"),
    skeleton: document.querySelectorAll('[class*="animate-pulse"]').length,
    temUsuarioInformou: t.includes("Usuario informou") || t.includes("Usuário informou"),
  };
});
console.log(`>>> estado dos paineis: ${JSON.stringify(estado)}`);

console.log(`\nscripts _next carregados: ${scripts.length}`);
for (const s of scripts.slice(0, 12)) console.log("   " + s);

await browser.close();
