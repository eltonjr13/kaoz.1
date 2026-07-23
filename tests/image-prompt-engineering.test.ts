import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFlowImagePromptInstructions,
  buildFlowReferencePlanningNotice,
  buildLocalFlowImagePrompt,
  prepareFlowImagePrompt,
  sanitizeUnrequestedCreativeFormats,
} from "../lib/ai/image-prompt-engineering.ts";

test("contrato orienta o agente por operacao e enquadramento sem keyword stuffing", () => {
  const instructions = buildFlowImagePromptInstructions({
    operation: "reference",
    aspectRatio: "9:16",
  });

  assert.match(instructions, /visual ingredient/i);
  assert.match(instructions, /Preserve identity, silhouette, proportions/i);
  assert.match(instructions, /tall 9:16 portrait frame/i);
  assert.match(instructions, /not headings, fields, JSON inside the field, or a keyword dump/i);
  assert.match(instructions, /Never invent a brand, character, person, product feature/i);
});

test("prompt simples recebe composicao para a proporcao sem fingir referencia", () => {
  const prompt = prepareFlowImagePrompt({
    prompt: "Final prompt: a watercolor illustration of a red fox reading beside a quiet lake",
    operation: "simple",
    aspectRatio: "3:4",
  });

  assert.match(prompt, /watercolor illustration/i);
  assert.match(prompt, /3:4 portrait frame/i);
  assert.doesNotMatch(prompt, /attached image|visual reference/i);
  assert.match(prompt, /Do not add unrequested text/i);
});

test("prompt com referencia define o papel do ingrediente sem bloquear mudancas pedidas", () => {
  const prompt = prepareFlowImagePrompt({
    prompt: "Place the same sneaker on a wet neon-lit street at night",
    operation: "reference",
    aspectRatio: "16:9",
  });

  assert.match(prompt, /attached image as the visual reference for the main subject or product/i);
  assert.match(prompt, /Preserve its identity, silhouette, proportions, colors, materials/i);
  assert.match(prompt, /change only what the request explicitly asks/i);
});

test("edicao descreve primeiro a mudanca e preserva todo detalhe nao solicitado", () => {
  const prompt = prepareFlowImagePrompt({
    prompt: "change the jacket from blue to deep red",
    operation: "edit",
  });

  assert.match(prompt, /^Edit the attached source image\. Apply this requested change:/i);
  assert.match(prompt, /Keep every unrequested subject identity, pose, camera angle, crop, composition/i);
});

test("copy solicitada e preservada exatamente e texto extra e proibido", () => {
  const prompt = prepareFlowImagePrompt({
    prompt: 'A minimalist poster with the headline "MENOS, MELHOR" in the upper third',
    operation: "simple",
  });

  assert.match(prompt, /"MENOS, MELHOR"/);
  assert.match(prompt, /exactly as written/i);
  assert.match(prompt, /do not translate, paraphrase, misspell, or add other wording/i);
});

test("filtro remove apenas o formato criativo inventado e mantem a direcao visual util", () => {
  const sanitized = sanitizeUnrequestedCreativeFormats(
    "uma chaleira de ceramica em uma cozinha calma",
    "A ceramic teapot in a quiet kitchen, influencer selfie, warm window light, muted earth tones",
  );

  assert.doesNotMatch(sanitized, /influencer|selfie/i);
  assert.match(sanitized, /ceramic teapot/i);
  assert.match(sanitized, /warm window light/i);
  assert.match(sanitized, /muted earth tones/i);
});

test("fallback local respeita a midia em vez de forcar fotografia e lente 85 mm", () => {
  const prompt = buildLocalFlowImagePrompt("Ilustracao vetorial minimalista de uma galinha geometrica");

  assert.match(prompt, /illustration technique/i);
  assert.doesNotMatch(prompt, /85mm|photorealistic|cinematic photograph/i);
});

test("aviso de referencia nao converte toda imagem anexada em personagem 3D", () => {
  const notice = buildFlowReferencePlanningNotice();

  assert.match(notice, /ingrediente visual/i);
  assert.match(notice, /Nao presuma personagem 3D/i);
  assert.doesNotMatch(notice, /transformar fielmente a referencia em um objeto\/personagem 3D/i);
});

test("prompt final fica abaixo do teto conservador de palavras", () => {
  const prompt = prepareFlowImagePrompt({
    prompt: Array.from({ length: 500 }, (_, index) => `detail${index}`).join(" "),
    operation: "simple",
  });

  assert.ok(prompt.split(/\s+/).length <= 320);
  assert.match(prompt, /Do not add unrequested text/i);
});

test("preparacao e idempotente entre chat, agente e provider", () => {
  const firstPass = prepareFlowImagePrompt({
    prompt: "Place the same ceramic robot in a quiet library",
    operation: "reference",
    aspectRatio: "4:3",
  });
  const secondPass = prepareFlowImagePrompt({
    prompt: firstPass,
    operation: "reference",
    aspectRatio: "4:3",
  });

  assert.equal(secondPass, firstPass);
});
