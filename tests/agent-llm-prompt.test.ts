import test from "node:test";
import assert from "node:assert/strict";
import { compactInlinePrompt, compactToolSchema, connectorPublishProvider, missingConnectorToolCallInstruction } from "../services/agent-llm/agent-llm.prompt.ts";

test("compacta prompt grande preservando sistema, cauda e pedido atual", () => {
  const latest = "Encontre tendências virais recentes sobre inteligência artificial para pequenos negócios.";
  const prompt = `[SYSTEM INSTRUCTIONS]:\nREGRA-ESSENCIAL\n${"contexto antigo ".repeat(3_000)}\nUSUARIO:\n${latest}\n\n[INSTRUCAO FINAL]:\nRESPONDA-JSON`;
  const compact = compactInlinePrompt(prompt, 27_500, latest);
  assert.equal(compact.length, 27_500);
  assert.match(compact, /REGRA-ESSENCIAL/);
  assert.match(compact, /RESPONDA-JSON/);
  assert.match(compact, /Encontre tendências virais recentes/);
  assert.match(compact, /CONTEXTO INTERMEDIARIO COMPACTADO/);
});

test("não altera prompt que já cabe no limite", () => {
  assert.equal(compactInlinePrompt("prompt curto", 100, "pedido"), "prompt curto");
});

test("reduz schema de ferramenta sem perder campos operacionais", () => {
  const compact = compactToolSchema({
    type: "object",
    required: ["query"],
    properties: { query: { type: "string", description: "descrição muito longa" }, limit: { type: "number", enum: [5, 10] } },
    additionalProperties: false,
  });
  assert.deepEqual(compact, {
    type: "object",
    required: ["query"],
    properties: { query: { type: "string" }, limit: { type: "number", enum: [5, 10] } },
    additionalProperties: false,
  });
});

test("pedido direto de publicação seleciona o conector sem confirmação redundante", () => {
  assert.equal(connectorPublishProvider("Envie uma mensagem no Discord"), "discord");
  assert.equal(connectorPublishProvider("Publique no Bluesky: novidade lançada"), "bluesky");
  assert.equal(connectorPublishProvider("Explique como funciona o Discord"), null);
  assert.equal(connectorPublishProvider("Escreva uma mensagem para o Discord, mas não envie"), null);
});

test("resposta sem tool call gera correção obrigatória sem fingir publicação", () => {
  const instruction = missingConnectorToolCallInstruction("discord", "Pode deixar, vou mandar agora!");
  assert.match(instruction, /PUBLICACAO NAO EXECUTADA/);
  assert.match(instruction, /social:discord:publish/);
  assert.match(instruction, /CONTEUDO FINAL COMPLETO/);
  assert.match(instruction, /Nao escreva promessa/);
});
