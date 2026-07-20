export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { discordGatewayManager } = await import("./services/connectors/discord.gateway.ts");
    const { telegramPollingManager } = await import("./services/connectors/telegram.polling.ts");
    const { scheduleConversationConsolidation } = await import("./services/conversation-memory/conversation-memory.consolidator.ts");
    scheduleConversationConsolidation();
    await discordGatewayManager.start().catch((error) => console.error("[DiscordGateway] Falha ao iniciar:", error));
    await telegramPollingManager.start().catch((error) => console.error("[TelegramPolling] Falha ao iniciar:", error));
  }
}
