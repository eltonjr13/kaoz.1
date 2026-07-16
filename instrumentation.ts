export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { discordGatewayManager } = await import("./services/connectors/discord.gateway.ts");
  await discordGatewayManager.start().catch((error) => console.error("[DiscordGateway] Falha ao iniciar:", error));
}
