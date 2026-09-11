/**
 * Validação funcional da Fase 5 no navegador (plano, seção 16).
 *
 * Exercita o ciclo de vida da memória pela INTERFACE: criar pelo extrator real,
 * ver na lista, corrigir pela UI, conferir a correção pela API e excluir pela UI.
 *
 * A memória é semeada pelo caminho real (`extractChatMemoryCandidates` +
 * `ChatMemoryService`), não escrevendo JSON à mão. Não existe botão de criação
 * na interface: memórias nascem da conversa.
 *
 * Limpa o que criou ao final. O conteúdo é marcado como teste.
 *
 * Uso: node scripts/cortex/validate-memory-flow.mjs [--base URL]
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const BASE = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : "http://127.0.0.1:3000";

/** Marcador inequívoco para não confundir com dado real e permitir limpeza. */
const MARKER = "ZZ-TESTE-VALIDACAO-CORTEX";
const ORIGINAL = `lembre que ${MARKER} usa luz quente de 3200K`;
const CORRIGIDO = `${MARKER} usa luz fria de 5600K`;

const OUT = path.resolve("tests/fixtures/cortex-engine/browser-evidence");

const log = [];
const record = (step, detail) => {
  log.push({ step, detail });
  console.log(`  ${step}: ${detail}`);
};

async function seed() {
  const { extractChatMemoryCandidates } = await import(
    "../../lib/cognitive-memory/chat/ChatMemoryExtractor.ts"
  );
  const { ChatMemoryService, LOCAL_MEMORY_USER_ID } = await import(
    "../../lib/cognitive-memory/chat/ChatMemoryService.ts"
  );
  const { JsonStorageProvider } = await import(
    "../../lib/cognitive-memory/storage/JsonStorageProvider.ts"
  );

  const candidates = extractChatMemoryCandidates(ORIGINAL);
  if (!candidates.length) {
    throw new Error(
      "o extrator nao produziu candidatos para a mensagem de teste; ajuste a frase"
    );
  }
  const service = new ChatMemoryService(new JsonStorageProvider());
  const result = await service.saveChatMemoryCandidates(candidates, {
    userId: LOCAL_MEMORY_USER_ID,
    cortexEnabled: true,
  });
  const saved = result.saved[0];
  if (!saved) throw new Error("nenhuma memoria foi salva pelo servico");
  return { id: saved.id, content: saved.content };
}

async function apiGetMemory(id) {
  const res = await fetch(`${BASE}/api/cortex/chat-memories`);
  const body = await res.json();
  const list = body?.data?.memories ?? [];
  return list.find((m) => m.id === id) ?? null;
}

async function apiForget(id) {
  await fetch(`${BASE}/api/cortex/chat-memories`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "forget", memoryId: id }),
  });
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 200)));

  let seeded = null;
  try {
    console.log("=== 1. criar memoria pelo caminho real ===");
    seeded = await seed();
    record("criada", `id=${seeded.id} conteudo="${seeded.content}"`);

    console.log("\n=== 2. abrir /cortex na aba Memorias ===");
    await page.goto(`${BASE}/cortex`, { waitUntil: "networkidle", timeout: 90_000 });
    await page.waitForTimeout(2500);

    const tabMemorias = page.locator('[role="tab"]', { hasText: "Memórias" }).first();
    if (!(await tabMemorias.count())) throw new Error("aba Memorias nao encontrada");
    await tabMemorias.click();
    await page.waitForTimeout(3000);
    record("aba Memorias", "aberta");

    const visivel = await page.evaluate((marker) => {
      return document.body.innerText.includes(marker);
    }, MARKER);
    record("memoria visivel na lista", String(visivel));
    if (!visivel) throw new Error("a memoria semeada nao apareceu na interface");

    await page.screenshot({ path: path.join(OUT, "fluxo-1-lista.png") });

    console.log("\n=== 3. corrigir pela interface ===");
    const linha = page.locator("li, tr, div").filter({ hasText: MARKER }).last();
    const botaoEditar = linha.locator("button", { hasText: "Editar" }).first();
    if (!(await botaoEditar.count())) {
      // Fallback: o botao pode estar fora do container filtrado.
      await page.locator("button", { hasText: "Editar" }).first().click();
    } else {
      await botaoEditar.click();
    }
    await page.waitForTimeout(1200);

    const campo = page.locator("textarea, input[type='text']").first();
    if (!(await campo.count())) throw new Error("campo de edicao nao encontrado");
    await campo.fill(CORRIGIDO);
    await page.locator("button", { hasText: "Salvar correção" }).first().click();
    await page.waitForTimeout(2500);
    record("edicao enviada", "Salvar correcao");

    const aposEdicao = await apiGetMemory(seeded.id);
    const editou = Boolean(aposEdicao && aposEdicao.content.includes("5600K"));
    record("API confirma a correcao", String(editou));
    if (!editou) {
      throw new Error(
        `a correcao nao persistiu; conteudo atual: ${aposEdicao?.content ?? "<ausente>"}`
      );
    }

    await page.screenshot({ path: path.join(OUT, "fluxo-2-corrigido.png") });

    console.log("\n=== 4. excluir pela interface ===");
    page.once("dialog", (d) => d.accept());
    const botaoEsquecer = page.locator("button", { hasText: "Esquecer" }).first();
    if (!(await botaoEsquecer.count())) throw new Error("botao Esquecer nao encontrado");
    await botaoEsquecer.click();
    await page.waitForTimeout(3000);

    const aindaExiste = await page.evaluate((m) => document.body.innerText.includes(m), MARKER);
    const perfilAtivo = await apiGetMemory(seeded.id);
    record("sumiu da lista", String(!aindaExiste));
    record("inativo na API", String(!perfilAtivo));
    if (aindaExiste) throw new Error("a memoria continuou visivel apos Esquecer");

    await page.screenshot({ path: path.join(OUT, "fluxo-3-excluido.png") });
    console.log("\n=== 5. trocar de tarefa / ver rastros ===");
    const tabCerebro = page.locator('[role="tab"]', { hasText: "Cérebro" }).first();
    await tabCerebro.click();
    await page.waitForTimeout(4000);
    const tracers = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        pacoteAusente: text.includes("Pacote do conectoma ausente"),
        skeleton: document.querySelectorAll('[class*="animate-pulse"]').length,
        trecho: text.replace(/\s+/g, " ").slice(280, 560),
      };
    });
    record("aba Cerebro apos hidratar", JSON.stringify(tracers));
    await page.screenshot({ path: path.join(OUT, "fluxo-4-cerebro.png") });

    record("resultado", "CICLO COMPLETO OK");
  } catch (error) {
    record("FALHA", error.message);
    process.exitCode = 1;
  } finally {
    // Limpeza: nunca deixar dado de teste no armazenamento real.
    if (seeded) {
      try {
        await apiForget(seeded.id);
        console.log("\n  limpeza: memoria de teste removida");
      } catch (e) {
        console.log(`\n  ATENCAO: falha ao limpar ${seeded.id}: ${e.message}`);
      }
    }
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
