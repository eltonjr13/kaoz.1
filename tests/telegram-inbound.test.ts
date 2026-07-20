import test from "node:test";
import assert from "node:assert/strict";
import { getTelegramImageAttachment, requestsTelegramImageGeneration, telegramImageOperation, telegramInboundEnabled, telegramMessagePrompt } from "../services/connectors/telegram.inbound.ts";
import type { StoredConnectorAccount } from "../services/connectors/connector.types.ts";

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
  assert.equal(telegramInboundEnabled({ ...account, enabled: false }), false);
  assert.equal(telegramInboundEnabled({ ...account, publicConfig: { inboundEnabled: "false" } }), false);
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
