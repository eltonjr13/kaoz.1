import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRichMarkdown } from "../components/markdown/rich-markdown.ts";

test("estrutura títulos soltos e blocos Mermaid como Markdown legível", () => {
  const normalized = normalizeRichMarkdown(`1. Síntese Executiva da Campanha
mermaid flowchart TD
A --> B
Componentes-Chave da Campanha:
Texto final.`);

  assert.match(normalized, /^## 1\. Síntese Executiva da Campanha/m);
  assert.match(normalized, /```mermaid\nflowchart TD\nA --> B\n```/);
  assert.match(normalized, /^## Componentes-Chave da Campanha/m);
});

test("repara sequências corrompidas conhecidas antes da visualização", () => {
  const normalized = normalizeRichMarkdown("Fluxo de produ��o e computa��o para valida��o.");
  assert.equal(normalized, "Fluxo de produção e computação para validação.");
  assert.doesNotMatch(normalized, /�/);
});
