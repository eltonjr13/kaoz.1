import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CONNECTOR_CATALOG } from "../services/connectors/connector.catalog.ts";
import { ConnectorVault } from "../services/connectors/connector.vault.ts";
import { discordConnector } from "../services/connectors/adapters/discord.connector.ts";
import { blueskyConnector } from "../services/connectors/adapters/bluesky.connector.ts";
import { skillRegistry } from "../services/skills/skill.registry.ts";
import { connectorHandlers } from "../services/orchestrator/adapters/connector.adapter.ts";
import type { StoredConnectorAccount } from "../services/connectors/connector.types.ts";

function account(provider: "discord" | "bluesky"): StoredConnectorAccount {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), provider, displayName: provider, enabled: true, health: "connected", publicConfig: {}, createdAt: now, updatedAt: now };
}

test("catálogo libera Discord e Bluesky e mantém integrações futuras visíveis", () => {
  const available = CONNECTOR_CATALOG.filter((item) => item.availability === "available").map((item) => item.provider);
  assert.deepEqual(available, ["discord", "bluesky"]);
  assert.ok(CONNECTOR_CATALOG.some((item) => item.provider === "x" && item.availability === "planned"));
  assert.ok(CONNECTOR_CATALOG.some((item) => item.provider === "linkedin" && item.availability === "planned"));
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
});

test("intenção de publicação seleciona a skill social", () => {
  assert.equal(skillRegistry.select("publique no Discord: lançamento amanhã").id, "social.publish");
  assert.equal(skillRegistry.select("poste no Bluesky esta novidade").id, "social.publish");
});
