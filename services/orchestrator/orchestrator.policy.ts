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
export function redactSecrets(value: unknown): string { const text = typeof value === "string" ? value : JSON.stringify(value); return text.replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[=:]\s*)[^\s,;"']+/gi, "$1[REDACTED]").replace(/\b(?:sk|ghp|xox[baprs])-[A-Za-z0-9_-]{10,}\b/g, "[REDACTED]"); }

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
