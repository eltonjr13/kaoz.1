import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CONNECTOR_CATALOG, connectorPublicConfigDefaults, isConnectorInboundEnabled } from "../services/connectors/connector.catalog.ts";
import { ConnectorVault } from "../services/connectors/connector.vault.ts";
import { discordConnector } from "../services/connectors/adapters/discord.connector.ts";
import { blueskyConnector } from "../services/connectors/adapters/bluesky.connector.ts";
import { telegramConnector } from "../services/connectors/adapters/telegram.connector.ts";
import { skillRegistry } from "../services/skills/skill.registry.ts";
import { connectorHandlers } from "../services/orchestrator/adapters/connector.adapter.ts";
import type { StoredConnectorAccount } from "../services/connectors/connector.types.ts";
import { formatDiscordMessage, formatTelegramMessage } from "../services/connectors/message-format.ts";

function account(provider: "discord" | "bluesky" | "telegram"): StoredConnectorAccount {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), provider, displayName: provider, enabled: true, health: "connected", publicConfig: {}, createdAt: now, updatedAt: now };
}

test("catálogo libera Discord, Bluesky e Telegram e mantém integrações futuras visíveis", () => {
  const available = CONNECTOR_CATALOG.filter((item) => item.availability === "available").map((item) => item.provider);
  assert.deepEqual(available, ["discord", "bluesky", "telegram"]);
  assert.ok(CONNECTOR_CATALOG.some((item) => item.provider === "x" && item.availability === "planned"));
  assert.ok(CONNECTOR_CATALOG.some((item) => item.provider === "linkedin" && item.availability === "planned"));
});

test("Discord e Telegram são bidirecionais por padrão e aceitam desligamento explícito", () => {
  assert.deepEqual(connectorPublicConfigDefaults("discord"), { inboundEnabled: "true" });
  assert.deepEqual(connectorPublicConfigDefaults("telegram"), { inboundEnabled: "true" });
  assert.deepEqual(connectorPublicConfigDefaults("bluesky"), {});
  assert.equal(isConnectorInboundEnabled("discord", {}), true);
  assert.equal(isConnectorInboundEnabled("telegram", {}), true);
  assert.equal(isConnectorInboundEnabled("discord", { inboundEnabled: "false" }), false);
  assert.equal(isConnectorInboundEnabled("telegram", { inboundEnabled: "false" }), false);
});

test("cofre cifra credenciais e recupera somente com a chave local", async () => {
  const id = crypto.randomUUID();
  const vault = new ConnectorVault();
  const credentials = { channelId: "123456789012345678", botToken: "secret-bot-token" };
  try {
    await vault.write(id, credentials);
    const raw = await readFile(path.join(process.cwd(), ".generated", "connectors", "vault", `${id}.json`), "utf8");
    assert.equal(raw.includes("secret-token"), false);
    assert.deepEqual(await vault.read(id), credentials);
  } finally {
    await vault.remove(id);
  }
});

test("Discord exige token do bot e ID de canal válido", async () => {
  await assert.rejects(discordConnector.test({ channelId: "123456789012345678" }), /token do bot/);
  await assert.rejects(discordConnector.test({ channelId: "canal-geral", botToken: "token" }), /Snowflake/);
});

test("Discord testa o acesso do bot ao canal configurado", async () => {
  const originalFetch = globalThis.fetch;
  let observedUrl = "";
  let observedAuthorization = "";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    observedUrl = String(input);
    observedAuthorization = new Headers(init?.headers).get("authorization") || "";
    return new Response(JSON.stringify({ id: "123456789012345678", name: "anuncios", guild_id: "111" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await discordConnector.test({ channelId: "123456789012345678", botToken: "bot-secret" });
    assert.equal(observedUrl, "https://discord.com/api/v10/channels/123456789012345678");
    assert.equal(observedAuthorization, "Bot bot-secret");
    assert.equal(result.displayName, "#anuncios");
  } finally { globalThis.fetch = originalFetch; }
});

test("Bluesky exige PDS HTTPS", async () => {
  await assert.rejects(blueskyConnector.test({ identifier: "teste.bsky.social", appPassword: "secret", serviceUrl: "http://localhost:3000" }), /usar HTTPS/);
});

test("Telegram exige token do bot e um destino válido", async () => {
  await assert.rejects(telegramConnector.test({ chatId: "-1001234567890" }), /token do bot/);
  await assert.rejects(telegramConnector.test({ chatId: "canal geral", botToken: "token" }), /ID numérico ou um @canal/);
});

test("Telegram valida bot e acesso ao chat configurado", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const body = url.includes("getMe")
      ? { ok: true, result: { id: 123, username: "kaoz1_bot" } }
      : { ok: true, result: { id: -1001234567890, title: "Canal de testes" } };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await telegramConnector.test({ chatId: "-1001234567890", botToken: "bot-secret" });
    assert.ok(urls.some((url) => url === "https://api.telegram.org/botbot-secret/getMe"));
    assert.ok(urls.some((url) => url.includes("getChat?chat_id=-1001234567890")));
    assert.equal(result.displayName, "Telegram: Canal de testes");
  } finally { globalThis.fetch = originalFetch; }
});

test("Telegram envia texto e devolve o id remoto", async () => {
  const originalFetch = globalThis.fetch;
  let observedUrl = "";
  let observedBody = "";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    observedUrl = String(input);
    observedBody = String(init?.body || "");
    return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await telegramConnector.publish(account("telegram"), { chatId: "@meucanal", botToken: "bot-secret" }, { text: "Olá Telegram" });
    assert.equal(observedUrl, "https://api.telegram.org/botbot-secret/sendMessage");
    assert.match(observedBody, /Olá Telegram/);
    assert.match(observedBody, /"parse_mode":"HTML"/);
    assert.equal(result.remoteId, "99");
    assert.equal(result.url, "https://t.me/meucanal/99");
  } finally { globalThis.fetch = originalFetch; }
});

test("formata Markdown do agente para o HTML seguro do Telegram", () => {
  const formatted = formatTelegramMessage("### **Título**\nTexto com **negrito**, *itálico* e `código`.\n\n| Cena | Texto |\n| --- | --- |\n| 01 | Olá <mundo> |");
  assert.match(formatted, /^<b><b>Título<\/b><\/b>/);
  assert.match(formatted, /<b>negrito<\/b>/);
  assert.match(formatted, /<i>itálico<\/i>/);
  assert.match(formatted, /<code>código<\/code>/);
  assert.match(formatted, /<b>Cena<\/b> · <b>Texto<\/b>/);
  assert.match(formatted, /Olá &lt;mundo&gt;/);
  assert.doesNotMatch(formatted, /\| --- \|/);
});

test("mantém Markdown nativo e torna tabelas legíveis no Discord", () => {
  const formatted = formatDiscordMessage("**Roteiro**\n\n| Cena | Texto |\n| --- | --- |\n| 01 | Olá |");
  assert.match(formatted, /^\*\*Roteiro\*\*/);
  assert.match(formatted, /\*\*Cena\*\* · \*\*Texto\*\*/);
  assert.match(formatted, /• 01 — Olá/);
  assert.doesNotMatch(formatted, /\| --- \|/);
});

test("Discord publica texto e devolve link da mensagem", async () => {
  const originalFetch = globalThis.fetch;
  let observedBody = "";
  let observedUrl = "";
  let observedAuthorization = "";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    observedUrl = String(input);
    observedBody = String(init?.body || "");
    observedAuthorization = new Headers(init?.headers).get("authorization") || "";
    return new Response(JSON.stringify({ id: "999", channel_id: "222", guild_id: "111" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await discordConnector.publish(account("discord"), { channelId: "123456789012345678", botToken: "bot-secret" }, { text: "Olá Discord" });
    assert.equal(observedUrl, "https://discord.com/api/v10/channels/123456789012345678/messages");
    assert.equal(observedAuthorization, "Bot bot-secret");
    assert.match(observedBody, /Olá Discord/);
    assert.match(observedBody, /allowed_mentions/);
    assert.equal(result.url, "https://discord.com/channels/111/222/999");
  } finally { globalThis.fetch = originalFetch; }
});

test("Bluesky cria sessão e publica record no repositório correto", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body || "") });
    const body = url.endsWith("createSession")
      ? { accessJwt: "jwt", did: "did:plc:alice", handle: "alice.bsky.social" }
      : { uri: "at://did:plc:alice/app.bsky.feed.post/abc123", cid: "cid" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await blueskyConnector.publish(account("bluesky"), { identifier: "alice.bsky.social", appPassword: "app-password" }, { text: "Olá Bluesky" });
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /com\.atproto\.repo\.createRecord$/);
    assert.match(calls[1].body, /did:plc:alice/);
    assert.match(calls[1].body, /Olá Bluesky/);
    assert.equal(result.url, "https://bsky.app/profile/alice.bsky.social/post/abc123");
  } finally { globalThis.fetch = originalFetch; }
});

test("ferramentas sociais têm handlers registrados", () => {
  assert.ok(connectorHandlers["social:discord:publish"]);
  assert.ok(connectorHandlers["social:bluesky:publish"]);
  assert.ok(connectorHandlers["social:telegram:publish"]);
});

test("intenção de publicação seleciona a skill social", () => {
  assert.equal(skillRegistry.select("publique no Discord: lançamento amanhã").id, "social.publish");
  assert.equal(skillRegistry.select("poste no Bluesky esta novidade").id, "social.publish");
  assert.equal(skillRegistry.select("envie no Telegram esta novidade").id, "social.publish");
});
