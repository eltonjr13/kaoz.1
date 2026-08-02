export const CHAT_RESPONSE_TIMEOUT_MS = 180_000;
export const CHAT_RESPONSE_WITH_EXTERNAL_TOOLS_TIMEOUT_MS = 10 * 60_000;

export function resolveChatResponseTimeout(
  hasExternalTools: boolean,
): number {
  return hasExternalTools
    ? CHAT_RESPONSE_WITH_EXTERNAL_TOOLS_TIMEOUT_MS
    : CHAT_RESPONSE_TIMEOUT_MS;
}
