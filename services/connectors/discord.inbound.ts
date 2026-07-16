import type { StoredConnectorAccount } from "./connector.types.ts";

export interface DiscordInboundMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  content?: string;
  author?: { id?: string; username?: string; global_name?: string; bot?: boolean };
  mentions?: Array<{ id?: string }>;
}

export type DiscordInboundDecision =
  | { accepted: true; prompt: string; userId: string; username: string }
  | { accepted: false; reason: "bot" | "not_mentioned" | "channel_not_allowed" | "guild_not_allowed" | "user_not_allowed" | "empty" };

export function parseSnowflakeList(value?: string): Set<string> {
  return new Set((value || "").split(/[\s,;]+/).map((item) => item.trim()).filter((item) => /^\d{15,22}$/.test(item)));
}

export function discordInboundEnabled(account: StoredConnectorAccount): boolean {
  return account.enabled && account.provider === "discord" && account.publicConfig.inboundEnabled === "true";
}

export function evaluateDiscordInbound(
  message: DiscordInboundMessage,
  account: StoredConnectorAccount,
  botUserId: string,
  fallbackChannelId: string,
): DiscordInboundDecision {
  if (message.author?.bot) return { accepted: false, reason: "bot" };
  const mentioned = message.mentions?.some((mention) => mention.id === botUserId) || false;
  if (!mentioned) return { accepted: false, reason: "not_mentioned" };

  const channels = parseSnowflakeList(account.publicConfig.allowedChannelIds || account.publicConfig.channelId || fallbackChannelId);
  if (channels.size === 0 || !channels.has(message.channel_id)) return { accepted: false, reason: "channel_not_allowed" };
  const guilds = parseSnowflakeList(account.publicConfig.allowedGuildIds || account.publicConfig.guildId);
  if (guilds.size > 0 && (!message.guild_id || !guilds.has(message.guild_id))) return { accepted: false, reason: "guild_not_allowed" };
  const userId = message.author?.id || "";
  const users = parseSnowflakeList(account.publicConfig.allowedUserIds);
  if (users.size > 0 && !users.has(userId)) return { accepted: false, reason: "user_not_allowed" };

  const prompt = (message.content || "")
    .replace(new RegExp(`<@!?${botUserId}>`, "g"), " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!prompt) return { accepted: false, reason: "empty" };
  return { accepted: true, prompt, userId, username: message.author?.global_name || message.author?.username || userId };
}

export function buildDiscordAgentPrompt(input: {
  prompt: string;
  username: string;
  agentIdentity: { provider: string; model: string };
  recent: Array<{ role: "user" | "assistant"; content: string }>;
}): string {
  const context = input.recent.slice(-6).map((item) => `${item.role === "user" ? "USUARIO" : "MRCHICKEN"}: ${item.content.slice(0, 1_500)}`).join("\n");
  return `Você é o agente MrChicken respondendo a uma menção recebida no Discord.
Responda em português do Brasil, de forma direta e útil, com no máximo 1.800 caracteres.
Você pode usar Markdown compatível com Discord. Não use @everyone, @here ou menções a usuários/cargos.
Não diga que executou ações que não foram realmente executadas. A resposta será enviada automaticamente como reply; não use a ferramenta social:discord:publish.

CONTEXTO RECENTE DESTA CONVERSA:
PROVEDOR E MODELO EM USO: ${input.agentIdentity.provider} / ${input.agentIdentity.model}
Se perguntarem qual modelo ou provedor voce usa, responda somente com esses dados efetivamente configurados; nao invente outro nome.

${context || "Sem contexto anterior."}

USUÁRIO ATUAL: ${input.username}
PEDIDO: ${input.prompt}

Responda somente com o texto final da mensagem.`;
}

export function normalizeDiscordAgentResponse(value: string): string {
  let output = value.trim();
  try {
    const parsed = JSON.parse(output) as { message?: unknown };
    if (typeof parsed.message === "string") output = parsed.message.trim();
  } catch {
    // Plain text is the preferred response for Discord.
  }
  output = output.replace(/<TOOL_CALL>[\s\S]*?<\/TOOL_CALL>/gi, "").trim();
  return (output || "Não consegui gerar uma resposta agora.").slice(0, 1_900);
}
