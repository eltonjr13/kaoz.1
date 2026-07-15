import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  materializeResponseArtifacts,
  readStoredArtifact,
  registerContentArtifact,
} from "../services/artifacts/artifact.service.ts";
import {
  allowsMediaAction,
  classifyOutputIntent,
  inferRequestedArtifactFormats,
} from "../services/artifacts/artifact.intent.ts";
import { normalizeSkillScriptResult } from "../services/orchestrator/adapters/skill-script.adapter.ts";

const createdIds = new Set<string>();

function remember<T extends { id: string }>(artifacts: T[]): T[] {
  artifacts.forEach((artifact) => createdIds.add(artifact.id));
  return artifacts;
}

test.after(async () => {
  await Promise.all([...createdIds].map((id) => rm(path.join(process.cwd(), ".generated", "artifacts", id), { recursive: true, force: true })));
});

test("detecta formatos somente quando existe intenção de criar ou exportar", () => {
  assert.deepEqual(inferRequestedArtifactFormats("Como funciona um PDF?"), []);
  assert.deepEqual(
    inferRequestedArtifactFormats("/redator-de-threads crie o conteúdo e entregue em Markdown e PDF"),
    ["pdf", "markdown"]
  );
  assert.deepEqual(
    inferRequestedArtifactFormats("/document-builder crie um relatório", "PDF Document Builder"),
    ["pdf"]
  );
});

test("separa documentos, mídia e pedidos mistos sem usar o modo visual como intenção", () => {
  const document = classifyOutputIntent(
    "Crie um guia prático sobre produtividade. Entregue o resultado em Markdown e PDF."
  );
  assert.equal(document.kind, "document");
  assert.deepEqual(document.formats, ["pdf", "markdown"]);
  assert.equal(document.mediaFlow, undefined);
  assert.equal(allowsMediaAction(document), false);

  const image = classifyOutputIntent("Crie uma imagem de um escritório futurista");
  assert.equal(image.kind, "media");
  assert.equal(image.mediaFlow, "image");

  const video = classifyOutputIntent("Produza um vídeo curto sobre produtividade");
  assert.equal(video.kind, "media");
  assert.equal(video.mediaFlow, "video");

  assert.equal(classifyOutputIntent("Crie um roteiro sobre produtividade").kind, "conversation");
});

test("distingue imagens incorporadas ao documento de uma geração de mídia separada", () => {
  const illustratedPdf = classifyOutputIntent("Crie um PDF com imagens ilustrativas e checklist");
  assert.equal(illustratedPdf.kind, "document");
  assert.equal(illustratedPdf.mediaFlow, undefined);

  const mixed = classifyOutputIntent("Gere uma imagem de capa e entregue também o briefing em PDF");
  assert.equal(mixed.kind, "mixed");
  assert.equal(mixed.mediaFlow, "image");
  assert.deepEqual(mixed.formats, ["pdf"]);

  const negated = classifyOutputIntent("Não gere uma imagem; entregue somente um PDF");
  assert.equal(negated.kind, "document");
  assert.equal(negated.mediaFlow, undefined);
});

test("materializa Markdown e PDF persistentes sem expor caminho local", async () => {
  const artifacts = remember(await materializeResponseArtifacts({
    requestText: "/relatorio crie e entregue em Markdown e PDF",
    content: "# Relatório\n\nConteúdo com acentuação, lista e seta →.\n\n- Primeiro item\n- Segundo item",
    sessionId: "chat-test",
  }));
  assert.equal(artifacts.length, 2);
  assert.deepEqual(artifacts.map((artifact) => artifact.type), ["pdf", "markdown"]);
  assert.ok(artifacts.every((artifact) => artifact.url?.startsWith("/api/artifacts/")));
  assert.ok(artifacts.every((artifact) => !artifact.path));

  const pdf = await readStoredArtifact(artifacts[0].id);
  assert.equal(pdf.artifact.mimeType, "application/pdf");
  assert.equal(pdf.content.subarray(0, 4).toString(), "%PDF");
  const markdown = await readStoredArtifact(artifacts[1].id);
  assert.match(markdown.content.toString("utf8"), /^# Relatório/);
});

test("normaliza artefatos inline retornados por scripts de qualquer skill", async () => {
  const result = await normalizeSkillScriptResult({
    output: { success: true },
    artifacts: [{ name: "dados.json", content: "{\"ok\":true}", type: "json", mimeType: "application/json" }],
  });
  const artifacts = remember(result.artifacts || []);
  assert.deepEqual(result.output, { success: true });
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].type, "json");
  assert.equal((await readStoredArtifact(artifacts[0].id)).content.toString(), "{\"ok\":true}");
});

test("registra conteúdo textual reutilizando o mesmo contrato", async () => {
  const artifact = await registerContentArtifact({ name: "notas.txt", content: "conteúdo", type: "text" });
  remember([artifact]);
  assert.equal(artifact.previewAvailable, true);
  assert.equal((await readStoredArtifact(artifact.id)).content.toString("utf8"), "conteúdo");
});
