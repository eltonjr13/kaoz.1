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

test("catálogo libera Discord e Bluesky e mantém integrações futuras visíveis", () => {
  const available = CONNECTOR_CATALOG.filter((item) => item.availability === "available").map((item) => item.provider);
  assert.deepEqual(available, ["discord", "bluesky"]);
  assert.ok(CONNECTOR_CATALOG.some((item) => item.provider === "x" && item.availability === "planned"));
  assert.ok(CONNECTOR_CATALOG.some((item) => item.provider === "linkedin" && item.availability === "planned"));
});

test("cofre cifra credenciais e recupera somente com a chave local", async () => {
  const id = crypto.randomUUID();
  const vault = new ConnectorVault();
  const credentials = { webhookUrl: "https://discord.com/api/webhooks/123/secret-token" };
  try {
    await vault.write(id, credentials);
    const raw = await readFile(path.join(process.cwd(), ".generated", "connectors", "vault", `${id}.json`), "utf8");
    assert.equal(raw.includes("secret-token"), false);
    assert.deepEqual(await vault.read(id), credentials);
  } finally {
    await vault.remove(id);
  }
});

test("Discord rejeita hosts falsos antes de fazer requisição", async () => {
  await assert.rejects(discordConnector.test({ webhookUrl: "https://example.com/api/webhooks/123/token" }), /oficial do Discord/);
});

test("Bluesky exige PDS HTTPS", async () => {
  await assert.rejects(blueskyConnector.test({ identifier: "teste.bsky.social", appPassword: "secret", serviceUrl: "http://localhost:3000" }), /usar HTTPS/);
});

test("ferramentas sociais têm handlers registrados", () => {
  assert.ok(connectorHandlers["social:discord:publish"]);
  assert.ok(connectorHandlers["social:bluesky:publish"]);
});

test("intenção de publicação seleciona a skill social", () => {
  assert.equal(skillRegistry.select("publique no Discord: lançamento amanhã").id, "social.publish");
  assert.equal(skillRegistry.select("poste no Bluesky esta novidade").id, "social.publish");
});
