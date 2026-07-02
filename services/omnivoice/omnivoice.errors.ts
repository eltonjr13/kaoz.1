export function getFriendlyOmniVoiceError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Could not resolve app config|fetch failed|404|ECONNREFUSED|ENOTFOUND/i.test(message)) {
    return "Nao consegui conectar ao OmniVoice. Atualize a URL publica do Gradio nas configuracoes.";
  }
  return message || "Erro desconhecido no OmniVoice.";
}
