import test from "node:test";
import assert from "node:assert/strict";
import { normalizeApiProviderModel } from "../services/api-providers/api-provider.settings.ts";

test("normaliza o identificador legado inválido do Grok 4.5 no ZenMux", () => {
  assert.equal(normalizeApiProviderModel("zenmux", "x-ai/grok-4.5-free"), "x-ai/grok-4.5");
});

test("preserva modelos ZenMux personalizados e modelos de outros provedores", () => {
  assert.equal(normalizeApiProviderModel("zenmux", "x-ai/grok-4.2-fast"), "x-ai/grok-4.2-fast");
  assert.equal(normalizeApiProviderModel("openai", "x-ai/grok-4.5-free"), "x-ai/grok-4.5-free");
});
