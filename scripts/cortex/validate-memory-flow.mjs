/**
 * Validação funcional da Fase 5 no navegador (plano, seção 16).
 *
 * Ciclo de vida da memória pela INTERFACE: criar pelo extrator real, ver na
 * lista, corrigir pela UI, conferir a linhagem, excluir pela UI, conferir o
 * estado do cérebro.
 *
 * Sobre a correção: o projeto NÃO sobrescreve. `editMemory` marca a versão
 * anterior como `superseded` e cria uma nova `active` com `supersedesId`. O
 * critério correto é, portanto:
 *   1) exatamente UMA versão `active`, com o conteúdo novo;
 *   2) a anterior em `superseded` (fora das recuperações);
 *   3) linhagem preservada.
 * Procurar pelo id antigo com `includeHistory: true` daria falso negativo.
 *
 * A memória é semeada pelo caminho real, nunca escrevendo JSON à mão. Não há
 * botão de criação: memórias nascem da conversa.
 *
 * Limpa o que criou ao final. Uso:
 *   node --experimental-strip-types scripts/cortex/validate-memory-flow.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const BASE = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : "http://localhost:3000";

const MARKER = "ZZ-TESTE-VALIDACAO-CORTEX";
const ORIGINAL = `lembre que ${MARKER} usa luz quente de 3200K`;
const CORRIGIDO = `${MARKER} usa luz fria de 5600K`;

const OUT = path.resolve("tests/fixtures/cortex-engine/browser-evidence");
const log = [];
const record = (step, detail) => {
  log.push({ step, detail });
  console.log(`  ${step}: ${detail}`);
};

const { extractChatMemoryCandidates } = await import(
  "../../lib/cognitive-memory/chat/ChatMemoryExtractor.ts"
);
const { ChatMemoryService, LOCAL_MEMORY_USER_ID } = await import(
  "../../lib/cognitive-memory/chat/ChatMemoryService.ts"
);
const { JsonStorageProvider } = await import(
  "../../lib/cognitive-memory/storage/JsonStorageProvider.ts"
);
const service = new ChatMemoryService(new JsonStorageProvider());

const serieCompleta = async () =>
  (await service.listActiveChatMemories({
    userId: LOCAL_MEMORY_USER_ID,
    includeHistory: true,
  })).filter((m) => m.content.includes(MARKER));

async function limparSerie() {
  for (const m of await serieCompleta()) {
    await service.forgetMemoryById(m.id, LOCAL_MEMORY_USER_ID);
  }
}

/** Cria a memória pelo caminho real (extrator + serviço). */
async function criar() {
  const candidatos = extractChatMemoryCandidates(ORIGINAL);
  if (!candidatos.length) throw new Error("o extrator nao produziu candidatos");
  const salvo = (await service.saveChatMemoryCandidates(candidatos, {
    userId: LOCAL_MEMORY_USER_ID,
    cortexEnabled: true,
  })).saved[0];
  if (!salvo) throw new Error("nada foi salvo pelo servico");
  record("criada", `id=${salvo.id.slice(0, 8)} | ${salvo.content}`);
  return salvo;
}

async function abrirMemorias(page) {
  await page.goto(`${BASE}/cortex`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(2500);
  await page.locator('[role="tab"]', { hasText: "Memórias" }).first().click();
  await page.waitForTimeout(3000);
}

async function verNaLista(page) {
  const visivel = await page.evaluate((m) => document.body.innerText.includes(m), MARKER);
  record("visivel na lista", String(visivel));
  if (!visivel) throw new Error("a memoria semeada nao apareceu na interface");
  await page.screenshot({ path: path.join(OUT, "fluxo-1-lista.png") });
}

/** Corrige pela UI e confere a LINHAGEM (não o id antigo). */
async function corrigir(page) {
  await page.locator("button", { hasText: "Editar" }).first().click();
  await page.waitForTimeout(1500);
  await page.locator("textarea").first().fill(CORRIGIDO);
  await page.locator("button", { hasText: "Salvar correção" }).first().click();
  await page.waitForTimeout(3000);

  const serie = await serieCompleta();
  const ativas = serie.filter((m) => m.status === "active");
  const superseded = serie.filter((m) => m.status === "superseded");
  const ativaNova = ativas.find((m) => m.content.includes("5600K"));
  const ativaAntiga = ativas.find((m) => m.content.includes("3200K"));

  record("versoes na serie", `total=${serie.length} ativas=${ativas.length} superseded=${superseded.length}`);
  record("1. uma unica versao ativa", String(ativas.length === 1));
  record("2. a ativa tem o conteudo novo", String(Boolean(ativaNova)));
  record("3. a anterior esta superseded", String(superseded.length >= 1));
  record("4. nenhuma ativa com conteudo antigo", String(!ativaAntiga));
  record("5. linhagem preservada", String(Boolean(ativaNova?.supersedesId)));
  const ok = ativas.length === 1 && Boolean(ativaNova) && !ativaAntiga && Boolean(ativaNova.supersedesId);
  if (!ok) throw new Error("a linhagem da correcao nao esta correta");

  const rotulada = await page.evaluate(() => document.body.innerText.includes("superseded"));
  record("interface rotula a versao antiga", String(rotulada));
  await page.screenshot({ path: path.join(OUT, "fluxo-2-corrigido.png") });
}

async function excluir(page) {
  page.once("dialog", (d) => d.accept());
  await page.locator("button", { hasText: "Esquecer" }).first().click();
  await page.waitForTimeout(3000);
  const restantes = await serieCompleta();
  const ativas = restantes.filter((m) => m.status === "active");
  record("nenhuma versao ativa apos esquecer", String(ativas.length === 0));
  if (ativas.length) throw new Error("ainda ha versao ativa apos Esquecer");
  await page.screenshot({ path: path.join(OUT, "fluxo-3-excluido.png") });
}

/** O cérebro precisa mostrar estado definido — nunca esqueleto eterno. */
async function conferirCerebro(page) {
  await page.locator('[role="tab"]', { hasText: "Cérebro" }).first().click();
  await page.waitForTimeout(4000);
  const cerebro = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      skeleton: document.querySelectorAll('[class*="animate-pulse"]').length,
      pacoteAusente: t.includes("Pacote do conectoma ausente"),
      erro: t.includes("Não foi possível carregar o cérebro"),
    };
  });
  record("cerebro", JSON.stringify(cerebro));
  if (cerebro.skeleton > 0) throw new Error("o cerebro ficou preso no esqueleto de carregamento");
  if (!cerebro.pacoteAusente && !cerebro.erro) {
    throw new Error("o cerebro nao mostrou estado operacional definido");
  }
  await page.screenshot({ path: path.join(OUT, "fluxo-4-cerebro.png") });
}

async function executar(page) {
  console.log("=== 1. criar memoria pelo caminho real ===");
  await criar();
  console.log("\n=== 2. abrir /cortex na aba Memorias ===");
  await abrirMemorias(page);
  await verNaLista(page);
  console.log("\n=== 3. corrigir pela interface ===");
  await corrigir(page);
  console.log("\n=== 4. excluir pela interface ===");
  await excluir(page);
  console.log("\n=== 5. estado do cerebro ===");
  await conferirCerebro(page);
  record("resultado", "CICLO COMPLETO OK");
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  await limparSerie(); // resíduo de execução anterior não pode contaminar
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 200)));

  try {
    await executar(page);
  } catch (error) {
    record("FALHA", error.message);
    process.exitCode = 1;
  } finally {
    await limparSerie();
    record("limpeza", "serie de teste removida do armazenamento real");
    await fs.writeFile(
      path.join(OUT, "fluxo-memoria.json"),
      JSON.stringify({ base: BASE, marker: MARKER, log, pageErrors }, null, 2),
      "utf8"
    );
    await browser.close();
  }
}

main().catch((e) => {
  console.error("FALHA FATAL:", e);
  process.exit(1);
});
