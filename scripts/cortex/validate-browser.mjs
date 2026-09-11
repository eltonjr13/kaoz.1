/**
 * Validação de navegador da Fase 5 (plano, seção 16 "Verificação real
 * obrigatória").
 *
 * Mede, para /cortex e /flow, em três larguras:
 *   - overflow horizontal da página e do elemento mais largo;
 *   - alvos de ação alcançáveis (não cobertos, não desabilitados por overlay);
 *   - altura de alvo mínimo (WCAG 2.5.8, 24x24 CSS px);
 *   - erros de console e requisições falhas;
 *   - capturas de tela por largura.
 *
 * Uso: node scripts/cortex/validate-browser.mjs [--base http://localhost:3000]
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const BASE = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : "http://localhost:3000";

const WIDTHS = [390, 768, 1280];
const ROUTES = ["/cortex", "/flow"];
const OUT = path.resolve("tests/fixtures/cortex-engine/browser-evidence");

/** Alvo mínimo do WCAG 2.5.8 (AA). */
const MIN_TARGET = 24;

async function audit(page, width, route) {
  const pageOverflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflowX = doc.scrollWidth - doc.clientWidth;
    // Elemento mais largo: aponta o culpado, não só o número.
    let worst = null;
    for (const el of document.querySelectorAll("body *")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) continue;
      const excess = Math.round(rect.right - doc.clientWidth);
      if (excess > (worst?.excess ?? 0)) {
        worst = {
          excess,
          tag: el.tagName.toLowerCase(),
          cls: (el.className || "").toString().slice(0, 80),
        };
      }
    }
    return { overflowX, worst };
  });

  const targets = await page.evaluate((min) => {
    const sel =
      'button, a[href], [role="button"], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const out = { total: 0, tooSmall: [], covered: [] };
    for (const el of document.querySelectorAll(sel)) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      out.total++;
      if (rect.width < min || rect.height < min) {
        out.tooSmall.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || "").trim().slice(0, 40),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
      }
      // Centro coberto por outro elemento = ação inacessível na prática.
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
      const top = document.elementFromPoint(cx, cy);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) {
        out.covered.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || "").trim().slice(0, 40),
          by: top.tagName.toLowerCase(),
        });
      }
    }
    return out;
  }, MIN_TARGET);

  const skeleton = await page.evaluate(() => {
    const sr = document.querySelector(".sr-only");
    const loading = /Carregando dados do Córtex/.test(document.body.innerText);
    return { hasSrOnly: Boolean(sr), mentionsLoading: loading };
  });

  // Hidratação: sem ela o HTML do servidor fica congelado, os efeitos nunca
  // rodam e a validação visual mede uma página morta. Já aconteceu em dev.
  const hydration = await page.evaluate(() => {
    const countReact = (el) =>
      el ? Object.keys(el).filter((k) => k.startsWith("__react")).length : -1;
    const tab = document.querySelector('[role="tab"]');
    const button = document.querySelector("button");
    return {
      tabReactKeys: countReact(tab),
      buttonReactKeys: countReact(button),
      hydrated: countReact(button) > 0 || countReact(tab) > 0,
    };
  });

  // Estado das telas de espera/vazio/erro do cérebro.
  const brainStates = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      skeleton: document.querySelectorAll('[class*="animate-pulse"]').length,
      pacoteAusente: text.includes("Pacote do conectoma ausente"),
      erroCarregar: text.includes("Não foi possível carregar o cérebro"),
    };
  });

  const shot = path.join(OUT, `${route.replace(/\//g, "") || "root"}-${width}.png`);
  await page.screenshot({ path: shot, fullPage: false });

  return { width, route, pageOverflow, targets, skeleton, hydration, brainStates, shot };
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  const consoleErrors = [];
  const failedRequests = [];

  for (const width of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`[${width}] ${msg.text().slice(0, 200)}`);
    });
    page.on("requestfailed", (req) => {
      failedRequests.push(
        `[${width}] ${req.method()} ${req.url().slice(0, 120)} :: ${req.failure()?.errorText}`
      );
    });

    for (const route of ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 90_000 });
      // Deixa hidratar e buscar dados; sem espera cega longa.
      await page.waitForTimeout(2500);
      results.push(await audit(page, width, route));
    }
    await context.close();
  }

  await browser.close();

  const report = {
    base: BASE,
    validatedAt: new Date().toISOString(),
    widths: WIDTHS,
    results,
    consoleErrors,
    failedRequests,
  };
  const reportPath = path.join(OUT, "browser-validation.json");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log("=== RESUMO ===");
  for (const r of results) {
    console.log(
      `${r.route} @ ${r.width}px | overflowX=${r.pageOverflow.overflowX}px` +
        ` | alvos=${r.targets.total} pequenos=${r.targets.tooSmall.length}` +
        ` cobertos=${r.targets.covered.length}` +
        ` | hidratado=${r.hydration.hydrated}`
    );
    if (r.route === "/cortex") {
      console.log(
        `    cerebro: skeleton=${r.brainStates.skeleton} ` +
          `pacoteAusente=${r.brainStates.pacoteAusente} ` +
          `erro=${r.brainStates.erroCarregar}`
      );
    }
    if (r.pageOverflow.overflowX > 0 && r.pageOverflow.worst) {
      console.log(
        `    culpado: <${r.pageOverflow.worst.tag}> +${r.pageOverflow.worst.excess}px .${r.pageOverflow.worst.cls}`
      );
    }
  }
  console.log(`\nconsole errors: ${consoleErrors.length}`);
  for (const e of consoleErrors.slice(0, 10)) console.log("  " + e);
  console.log(`requisicoes falhas: ${failedRequests.length}`);
  for (const f of failedRequests.slice(0, 10)) console.log("  " + f);
  console.log(`\nrelatorio: ${reportPath}`);
}

main().catch((error) => {
  console.error("FALHA:", error);
  process.exit(1);
});
