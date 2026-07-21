import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildDiscordAgentPrompt, discordImageOperation, discordInboundEnabled, evaluateDiscordInbound, getDiscordImageAttachment, normalizeDiscordAgentResponse, parseSnowflakeList, requestsDiscordImageGeneration } from "../services/connectors/discord.inbound.ts";
import type { StoredConnectorAccount } from "../services/connectors/connector.types.ts";
import { DISCORD_APPLICATION_COMMANDS, executeDiscordCommand, parseDiscordCommand } from "../services/connectors/discord.commands.ts";

const account: StoredConnectorAccount = {
  id: "account-1",
  provider: "discord",
  displayName: "Discord",
  enabled: true,
  health: "connected",
  publicConfig: {
    inboundEnabled: "true",
    allowedChannelIds: "1527075963958071508",
    allowedGuildIds: "1527000000000000000",
    allowedUserIds: "1527111111111111111",
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

test("ativa inbound somente para conta Discord habilitada", () => {
  assert.equal(discordInboundEnabled(account), true);
  assert.equal(discordInboundEnabled({ ...account, publicConfig: {} }), true);
  assert.equal(discordInboundEnabled({ ...account, enabled: false }), false);
  assert.equal(discordInboundEnabled({ ...account, publicConfig: { ...account.publicConfig, inboundEnabled: "false" } }), false);
});

test("expõe os comandos slash nativos do Discord", () => {
  assert.deepEqual(DISCORD_APPLICATION_COMMANDS.map((command) => command.name), ["help", "status", "model", "reset"]);
  const model = DISCORD_APPLICATION_COMMANDS.find((command) => command.name === "model");
  assert.ok(model && "options" in model);
});

test("interpreta comandos do Discord sem delegar ao LLM", () => {
  assert.deepEqual(parseDiscordCommand("/help"), { kind: "help" });
  assert.deepEqual(parseDiscordCommand("/status@MrChickenBot"), { kind: "status" });
  assert.deepEqual(parseDiscordCommand("/model iamhc DeepSeek-V4-Flash"), { kind: "model", provider: "iamhc", model: "DeepSeek-V4-Flash" });
  assert.deepEqual(parseDiscordCommand("/reset"), { kind: "reset" });
  assert.deepEqual(parseDiscordCommand("explique /model"), null);
});

test("altera e persiste o provedor e modelo sem chamar o LLM", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "mrchicken-command-model-"));
  const previousDataDir = process.env.MRCHICKEN_DATA_DIR;
  process.env.MRCHICKEN_DATA_DIR = dataDir;
  try {
    const response = await executeDiscordCommand({ kind: "model", provider: "codex", model: "gpt-command-test" });
    assert.match(response, /codex-cli/);
    assert.match(response, /gpt-command-test/);
    const saved = JSON.parse(await readFile(path.join(dataDir, "local-data", "agent-llm-settings.json"), "utf8")) as { provider?: string; codexModel?: string };
    assert.deepEqual({ provider: saved.provider, model: saved.codexModel }, { provider: "codex-cli", model: "gpt-command-test" });
  } finally {
    if (previousDataDir === undefined) delete process.env.MRCHICKEN_DATA_DIR;
    else process.env.MRCHICKEN_DATA_DIR = previousDataDir;
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("aceita menção autorizada e remove a menção do pedido", () => {
  const result = evaluateDiscordInbound({
    id: "message-1",
    channel_id: "1527075963958071508",
    guild_id: "1527000000000000000",
    content: "<@1527222222222222222> calcule 10% de 200",
    author: { id: "1527111111111111111", username: "elton" },
    mentions: [{ id: "1527222222222222222" }],
  }, account, "1527222222222222222", "1527075963958071508");
  assert.equal(result.accepted, true);
  if (result.accepted) assert.equal(result.prompt, "calcule 10% de 200");
});

test("bloqueia mensagem sem menção, canal ou usuário fora da allowlist", () => {
  const base = {
    id: "message-1", channel_id: "1527075963958071508", guild_id: "1527000000000000000",
    content: "<@1527222222222222222> olá", author: { id: "1527111111111111111" }, mentions: [{ id: "1527222222222222222" }],
  };
  assert.deepEqual(evaluateDiscordInbound({ ...base, mentions: [] }, account, "1527222222222222222", base.channel_id), { accepted: false, reason: "not_mentioned" });
  assert.deepEqual(evaluateDiscordInbound({ ...base, channel_id: "1527999999999999999" }, account, "1527222222222222222", base.channel_id), { accepted: false, reason: "channel_not_allowed" });
  assert.deepEqual(evaluateDiscordInbound({ ...base, author: { id: "1527333333333333333" } }, account, "1527222222222222222", base.channel_id), { accepted: false, reason: "user_not_allowed" });
  assert.deepEqual(evaluateDiscordInbound({ ...base, author: { id: "1527111111111111111", bot: true } }, account, "1527222222222222222", base.channel_id), { accepted: false, reason: "bot" });
});

test("normaliza IDs, contexto e resposta do modelo", () => {
  assert.deepEqual([...parseSnowflakeList("1527111111111111111, inválido;1527222222222222222")], ["1527111111111111111", "1527222222222222222"]);
  const prompt = buildDiscordAgentPrompt({
    prompt: "resuma isso",
    username: "Elton",
    agentIdentity: { provider: "iamhc", model: "DeepSeek-V4-Flash" },
    recent: [{ role: "assistant", content: "contexto" }],
  });
  assert.match(prompt, /resuma isso/);
  assert.match(prompt, /contexto/);
  assert.match(prompt, /DeepSeek-V4-Flash/);
  assert.equal(normalizeDiscordAgentResponse('{"message":"Resposta pronta","action":null}'), "Resposta pronta");
  assert.equal(normalizeDiscordAgentResponse("<TOOL_CALL>{}</TOOL_CALL>"), "Não consegui gerar uma resposta agora.");
});

test("identifica pedidos explícitos de geração de imagem", () => {
  assert.equal(requestsDiscordImageGeneration("gere uma imagem de um frango cyberpunk"), true);
  assert.equal(requestsDiscordImageGeneration("faça uma ilustração de uma cidade futurista"), true);
  assert.equal(requestsDiscordImageGeneration("explique como gerar uma imagem no Flow"), false);
});

test("aceita imagem anexada como referência e identifica edição", () => {
  const message = {
    id: "image-1", channel_id: "1527075963958071508", guild_id: "1527000000000000000",
    content: "<@1527222222222222222> transforme em arte cyberpunk", author: { id: "1527111111111111111" }, mentions: [{ id: "1527222222222222222" }],
    attachments: [{ url: "https://cdn.discordapp.com/attachments/1/2/referencia.png", filename: "referencia.png", content_type: "image/png", size: 1024 }],
  };
  assert.deepEqual(getDiscordImageAttachment(message), { url: "https://cdn.discordapp.com/attachments/1/2/referencia.png", filename: "referencia.png", mimeType: "image/png", size: 1024 });
  assert.equal(discordImageOperation("transforme em arte cyberpunk", true), "edit");
  const onlyImage = evaluateDiscordInbound({ ...message, content: "<@1527222222222222222>" }, account, "1527222222222222222", message.channel_id);
  assert.equal(onlyImage.accepted, true);
  if (onlyImage.accepted) assert.match(onlyImage.prompt, /baseada na imagem enviada/);
});
