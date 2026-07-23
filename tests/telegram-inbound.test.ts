import test from "node:test";
import assert from "node:assert/strict";
import { getTelegramImageAttachment, requestsTelegramImageGeneration, telegramImageOperation, telegramInboundEnabled, telegramMessagePrompt } from "../services/connectors/telegram.inbound.ts";
import type { StoredConnectorAccount } from "../services/connectors/connector.types.ts";
import { parseDiscordCommand, TELEGRAM_BOT_COMMANDS } from "../services/connectors/discord.commands.ts";
import { buildConnectorImageOptimizationPrompt, localConnectorImagePrompt, optimizeConnectorImagePrompt } from "../services/connectors/image-prompt.ts";

const account: StoredConnectorAccount = {
  id: "telegram-1",
  provider: "telegram",
  displayName: "Telegram",
  enabled: true,
  health: "connected",
  publicConfig: { inboundEnabled: "true" },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

test("mantém o inbound Telegram condicionado à conta habilitada", () => {
  assert.equal(telegramInboundEnabled(account), true);
  assert.equal(telegramInboundEnabled({ ...account, publicConfig: {} }), true);
  assert.equal(telegramInboundEnabled({ ...account, enabled: false }), false);
  assert.equal(telegramInboundEnabled({ ...account, publicConfig: { inboundEnabled: "false" } }), false);
});

test("interpreta comandos do Telegram sem delegar ao LLM", () => {
  assert.deepEqual(TELEGRAM_BOT_COMMANDS.map((command) => command.command), ["help", "status", "model", "imagine", "reset"]);
  assert.deepEqual(parseDiscordCommand("/start"), { kind: "help" });
  assert.deepEqual(parseDiscordCommand("/status@Kaoz1Bot"), { kind: "status" });
  assert.deepEqual(parseDiscordCommand("/modelo codex gpt-5.6"), { kind: "model", provider: "codex", model: "gpt-5.6" });
  assert.deepEqual(parseDiscordCommand("/imagine@Kaoz1Bot arte exata para a capa"), { kind: "imagine", prompt: "arte exata para a capa" });
  assert.deepEqual(parseDiscordCommand("/limpar"), { kind: "reset" });
});

test("separa conversa de texto de pedidos explícitos de imagem", () => {
  assert.equal(requestsTelegramImageGeneration("gere uma imagem de um frango cyberpunk"), true);
  assert.equal(requestsTelegramImageGeneration("faça uma ilustração de uma cidade futurista"), true);
  assert.equal(requestsTelegramImageGeneration("explique como gerar uma imagem no Flow"), false);
  assert.equal(requestsTelegramImageGeneration("qual é a capital da Noruega?"), false);
});

test("usa a maior foto do Telegram como referência e lê o caption como prompt", () => {
  const message = {
    message_id: 42,
    caption: "transforme em arte cyberpunk",
    photo: [
      { file_id: "small", file_size: 100, width: 90, height: 90 },
      { file_id: "large", file_size: 2_000, width: 1_280, height: 720 },
    ],
  };
  assert.deepEqual(getTelegramImageAttachment(message), { fileId: "large", filename: "telegram-42.jpg", mimeType: "image/jpeg", size: 2_000 });
  assert.equal(telegramMessagePrompt(message, true), "transforme em arte cyberpunk");
  assert.equal(telegramImageOperation(message.caption, true), "edit");
});

test("aceita documento de imagem e cria prompt para anexo sem legenda", () => {
  const message = { message_id: 43, document: { file_id: "doc", file_name: "referencia.webp", mime_type: "application/octet-stream", file_size: 1_024 } };
  assert.deepEqual(getTelegramImageAttachment(message), { fileId: "doc", filename: "referencia.webp", mimeType: "image/webp", size: 1_024 });
  assert.match(telegramMessagePrompt(message, true), /baseada na imagem enviada/);
  assert.equal(telegramImageOperation("use como referência", true), "reference");
});

test("ignora documento que não é imagem e mantém texto normal", () => {
  assert.equal(getTelegramImageAttachment({ document: { file_id: "pdf", file_name: "arquivo.pdf", mime_type: "application/pdf" } }), null);
  assert.equal(telegramMessagePrompt({ text: "olá" }, false), "olá");
});

test("aprimora o prompt de imagem com o agente antes de enviar ao Flow", async () => {
  let agentPrompt = "";
  const optimized = await optimizeConnectorImagePrompt({
    prompt: "gere uma imagem de um frango cyberpunk",
    operation: "simple",
    recent: [{ role: "user", content: "quero um clima noturno em Sao Paulo" }],
  }, async (prompt, options) => {
    agentPrompt = prompt;
    assert.equal(options?.useExternalTools, false);
    return 'Optimized prompt: "A cyberpunk chicken beneath neon lights in Sao Paulo, cinematic low-angle composition, rain-soaked street, detailed feathers"';
  });

  assert.match(agentPrompt, /Recent conversation context/);
  assert.match(agentPrompt, /Return only the final image prompt/);
  assert.equal(optimized, "A cyberpunk chicken beneath neon lights in Sao Paulo, cinematic low-angle composition, rain-soaked street, detailed feathers");
});

test("orienta edição com referência e usa fallback quando o agente está indisponível", async () => {
  const prompt = buildConnectorImageOptimizationPrompt({ prompt: "troque o fundo por uma floresta", operation: "edit" });
  assert.match(prompt, /preserve every unrequested/i);

  const fallback = await optimizeConnectorImagePrompt(
    { prompt: "troque o fundo por uma floresta", operation: "edit" },
    async () => null,
  );
  assert.equal(fallback, localConnectorImagePrompt({ prompt: "troque o fundo por uma floresta", operation: "edit" }));
  assert.match(fallback, /preserving all other reference-image details/);
});
