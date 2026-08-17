import assert from "node:assert/strict";
import test from "node:test";
import {
  registerContentArtifact,
  updateContentArtifact,
  readStoredArtifact,
  mimeTypeFromName,
} from "../services/artifacts/artifact.service.ts";

test("reconhece e mapeia extensões para o Live Artifact Canvas", () => {
  assert.equal(mimeTypeFromName("briefing.md"), "text/markdown; charset=utf-8");
  assert.equal(mimeTypeFromName("dados.json"), "application/json; charset=utf-8");
  assert.equal(mimeTypeFromName("relatorio.pdf"), "application/pdf");
  assert.equal(mimeTypeFromName("prompts.txt"), "text/plain; charset=utf-8");
});

test("suporta ciclo de vida completo de edição de artefatos pelo Canvas", async () => {
  const initial = await registerContentArtifact({
    name: "01_Briefing_Estrategico.md",
    content: "# Briefing Inicial\n\nObjetivo: validação de produto.",
    type: "markdown",
    metadata: { author: "Alex Vance", role: "campaign-director" },
  });

  assert.ok(initial.id);
  assert.equal(initial.name, "01_Briefing_Estrategico.md");

  // Simula edição no editor do Live Artifact Canvas
  const updated = await updateContentArtifact({
    id: initial.id,
    content: "# Briefing Revisado pelo Usuário\n\nObjetivo: lançamento nacional de alta conversão.",
    name: "01_Briefing_Estrategico_v2.md",
  });

  assert.equal(updated.id, initial.id);
  assert.equal(updated.name, "01_Briefing_Estrategico_v2.md");
  assert.ok(updated.updatedAt);

  const persisted = await readStoredArtifact(initial.id);
  assert.match(persisted.content.toString("utf8"), /# Briefing Revisado pelo Usuário/);
  assert.match(persisted.content.toString("utf8"), /lançamento nacional de alta conversão/);
});
