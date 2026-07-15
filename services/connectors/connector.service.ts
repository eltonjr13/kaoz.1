import crypto from "node:crypto";
import { CONNECTOR_CATALOG, getConnectorDefinition } from "./connector.catalog";
import { connectorStore } from "./connector.store";
import { connectorVault } from "./connector.vault";
import type { ConnectorAccount, ConnectorAdapter, ConnectorProvider, ConnectorPublishInput, StoredConnectorAccount } from "./connector.types";
import { discordConnector } from "./adapters/discord.connector";
import { blueskyConnector } from "./adapters/bluesky.connector";

const adapters: Partial<Record<ConnectorProvider, ConnectorAdapter>> = {
  discord: discordConnector,
  bluesky: blueskyConnector
};

function adapterFor(provider: ConnectorProvider) {
  const adapter = adapters[provider];
  if (!adapter) throw new Error(`O conector ${provider} ainda não está disponível.`);
  return adapter;
}

function cleanCredentials(credentials: unknown) {
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) return {};
  return Object.fromEntries(Object.entries(credentials).filter((entry): entry is [string, string] => typeof entry[1] === "string").map(([key, value]) => [key, value.trim()]));
}

async function publicAccount(account: StoredConnectorAccount): Promise<ConnectorAccount> {
  return { ...account, hasCredentials: await connectorVault.has(account.id) };
}

export class ConnectorService {
  async overview() {
    return {
      catalog: CONNECTOR_CATALOG,
      accounts: await Promise.all((await connectorStore.listAccounts()).map(publicAccount)),
      history: await connectorStore.listHistory(30)
    };
  }

  async save(input: { id?: string; provider?: string; displayName?: string; enabled?: boolean; publicConfig?: unknown; credentials?: unknown }) {
    const provider = input.provider as ConnectorProvider;
    const definition = getConnectorDefinition(provider);
    if (!definition || definition.availability !== "available") throw new Error("Conector inválido ou ainda indisponível.");
    const existing = input.id ? await connectorStore.getAccount(input.id) : null;
    if (existing && existing.provider !== provider) throw new Error("Não é possível trocar o provedor de uma conexão existente.");
    const credentials = cleanCredentials(input.credentials);
    const missing = definition.credentialFields.filter((field) => field.required && !credentials[field.key] && !existing);
    if (missing.length) throw new Error(`Preencha: ${missing.map((field) => field.label).join(", ")}.`);
    const now = new Date().toISOString();
    const account: StoredConnectorAccount = {
      id: existing?.id || crypto.randomUUID(),
      provider,
      displayName: input.displayName?.trim() || existing?.displayName || definition.name,
      enabled: input.enabled ?? existing?.enabled ?? true,
      health: existing?.health || "untested",
      publicConfig: input.publicConfig && typeof input.publicConfig === "object" && !Array.isArray(input.publicConfig)
        ? Object.fromEntries(Object.entries(input.publicConfig).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
        : existing?.publicConfig || {},
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastCheckedAt: existing?.lastCheckedAt,
      lastError: existing?.lastError
    };
    await connectorStore.saveAccount(account);
    if (Object.keys(credentials).length) await connectorVault.write(account.id, { ...(existing ? await connectorVault.read(account.id).catch(() => ({})) : {}), ...credentials });
    return publicAccount(account);
  }

  async remove(id: string) {
    await connectorStore.removeAccount(id);
    await connectorVault.remove(id);
  }

  async test(id: string, signal?: AbortSignal) {
    const account = await connectorStore.getAccount(id);
    if (!account) throw new Error("Conexão não encontrada.");
    const now = new Date().toISOString();
    try {
      const result = await adapterFor(account.provider).test(await connectorVault.read(id), signal);
      account.health = account.enabled ? "connected" : "disabled";
      account.lastCheckedAt = now;
      account.lastError = undefined;
      if (result.displayName && account.displayName === getConnectorDefinition(account.provider)?.name) account.displayName = result.displayName;
      account.updatedAt = now;
      await connectorStore.saveAccount(account);
      return publicAccount(account);
    } catch (error) {
      account.health = "error";
      account.lastCheckedAt = now;
      account.lastError = error instanceof Error ? error.message : String(error);
      account.updatedAt = now;
      await connectorStore.saveAccount(account);
      throw error;
    }
  }

  async publish(provider: ConnectorProvider, input: ConnectorPublishInput & { accountId?: string }, signal?: AbortSignal) {
    const accounts = (await connectorStore.listAccounts()).filter((account) => account.provider === provider && account.enabled);
    const account = input.accountId ? accounts.find((item) => item.id === input.accountId) : accounts[0];
    if (!account) throw new Error(`Nenhuma conta ${provider} ativa foi encontrada.`);
    const preview = input.text.trim().slice(0, 160);
    try {
      const result = await adapterFor(provider).publish(account, await connectorVault.read(account.id), input, signal);
      const publishedAt = new Date().toISOString();
      const output = { ...result, provider, accountId: account.id, publishedAt };
      await connectorStore.appendHistory({ ...output, id: crypto.randomUUID(), status: "published", textPreview: preview });
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await connectorStore.appendHistory({ id: crypto.randomUUID(), remoteId: "", provider, accountId: account.id, publishedAt: new Date().toISOString(), status: "failed", textPreview: preview, error: message });
      throw error;
    }
  }
}

export const connectorService = new ConnectorService();
