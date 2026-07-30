import path from "node:path";
import type { ApprovalMode, ToolEffect } from "./orchestrator.types";

const SENSITIVE_TOKEN_KEYS = new Set([
  "token",
  "access_token",
  "refresh_token",
  "auth_token",
  "authentication_token",
  "authorization_token",
  "bearer_token",
  "api_token",
  "id_token",
  "identity_token",
  "session_token",
  "oauth_token",
  "bot_token",
  "client_token",
  "user_token",
  "service_token",
  "personal_access_token",
  "installation_token",
  "registration_token",
  "verification_token",
  "reset_token",
  "invite_token",
  "webhook_token",
  "csrf_token",
  "jwt_token",
  "discord_token",
  "telegram_token",
  "github_token",
  "google_token",
  "spotify_token",
  "slack_token",
]);

export function requiredApproval(effect: ToolEffect, declared: ApprovalMode): ApprovalMode { if (effect === "destructive" || effect === "external") return "step"; if (effect === "write") return declared === "never" ? "plan" : declared; return declared; }
export function assertSafeWorkspacePath(candidate: string, root = process.cwd()): string { const resolved = path.resolve(root, candidate); const relative = path.relative(path.resolve(root), resolved); if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Caminho fora da raiz permitida."); return resolved; }

export function redactSecrets(value: unknown): string {
  let text = typeof value === "string" ? value : JSON.stringify(value);
  text = text.replace(
    /"([A-Za-z][A-Za-z0-9_.-]*)"\s*([=:])\s*"((?:\\.|[^"\\])*)"/g,
    (match, key: string, separator: string) =>
      isSensitiveKey(key)
        ? `"${key}"${separator}"[REDACTED]"`
        : match,
  );
  text = text.replace(
    /'([A-Za-z][A-Za-z0-9_.-]*)'\s*([=:])\s*'((?:\\.|[^'\\])*)'/g,
    (match, key: string, separator: string) =>
      isSensitiveKey(key)
        ? `'${key}'${separator}'[REDACTED]'`
        : match,
  );
  text = text.replace(
    /\b([A-Za-z][A-Za-z0-9_.-]*)\s*([=:])\s*([^\s,;"'&]+)/g,
    (match, key: string, separator: string, item: string) => {
      if (!isSensitiveKey(key) || /^(?:Bearer|Basic)$/i.test(item)) {
        return match;
      }
      return `${key}${separator}[REDACTED]`;
    },
  );
  text = text.replace(
    /(--?)([A-Za-z][A-Za-z0-9_-]*)\s+("[^"]*"|'[^']*'|[^\s,;]+)/g,
    (match, prefix: string, key: string) =>
      isSensitiveKey(key) ? `${prefix}${key} [REDACTED]` : match,
  );
  return text
    .replace(
      /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{8,}={0,2}/gi,
      "$1 [REDACTED]",
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
      "[REDACTED]",
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/gi,
      "[REDACTED]",
    )
    .replace(
      /(\b[a-z][a-z0-9+.-]*:\/\/)([^@\s/]+)@/gi,
      "$1[REDACTED]@",
    );
}

export function sanitizePublicErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const code = publicErrorCode(error);
  let message = redactSecrets(raw)
    .replace(
      /\b(?:Command failed|Comando falhou|Comando executado|Command|Comando|args|arguments|argumentos)\s*[:=]\s*[^\r\n]*/gi,
      (match) => `${match.slice(0, match.search(/[:=]/) + 1)} [REDACTED]`,
    )
    .replace(/\bspawn\s+[^\r\n]*/gi, "spawn [REDACTED]")
    .replace(/"(?:(?:[A-Za-z]:[\\/])|\\\\)[^"]+"/g, '"[LOCAL_PATH]"')
    .replace(/'(?:(?:[A-Za-z]:[\\/])|\\\\)[^']+'/g, "'[LOCAL_PATH]'")
    .replace(/\b[A-Za-z]:[\\/][^\s"'`<>|,;]+/g, "[LOCAL_PATH]")
    .replace(/\\\\[^\\\s]+\\[^\s"'`<>|,;]+/g, "[LOCAL_PATH]")
    .replace(
      /(?<![:A-Za-z0-9])\/(?:Users|home|tmp|var|etc|opt|mnt|workspace|data)\/[^\s"'`<>|,;]+/gi,
      "[LOCAL_PATH]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  if (!message) {
    message = "Falha interna durante a execução MCP.";
  }
  return code && !message.includes(code) ? `${code}: ${message}` : message;
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeSensitiveKey(key);
  return (
    SENSITIVE_TOKEN_KEYS.has(normalized) ||
    normalized === "api_key" ||
    normalized.endsWith("_api_key") ||
    normalized === "secret" ||
    normalized.endsWith("_secret") ||
    normalized === "password" ||
    normalized.endsWith("_password") ||
    normalized === "passphrase" ||
    normalized.endsWith("_passphrase") ||
    normalized === "authorization" ||
    normalized.endsWith("_authorization") ||
    normalized === "credential" ||
    normalized === "credentials" ||
    normalized.endsWith("_credential") ||
    normalized.endsWith("_credentials") ||
    normalized === "private_key" ||
    normalized.endsWith("_private_key")
  );
}

export function sanitizeSensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeSensitiveValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        isSensitiveKey(key) ? "[REDACTED]" : sanitizeSensitiveValue(item),
      ]),
    );
  }
  return typeof value === "string" ? redactSecrets(value) : value;
}

function normalizeSensitiveKey(key: string): string {
  return key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function publicErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(code)
    ? code
    : null;
}
