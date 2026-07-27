const INHERITED_ENV_KEYS = ["PATH", "HOME", "USER", "USERPROFILE", "TEMP", "TMP", "SystemRoot"] as const;
export function buildSafeMcpEnvironment(
  configEnv?: Record<string, string>,
  source: Record<string, string | undefined> = process.env,
  allowedConfigKeys?: readonly string[],
) {
  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV_KEYS) {
    const value = source[key];
    if (typeof value === "string") env[key] = value;
  }
  const allowed = allowedConfigKeys ? new Set(allowedConfigKeys) : null;
  for (const [key, value] of Object.entries(configEnv || {})) {
    if (allowed && !allowed.has(key)) continue;
    if (typeof value === "string" && value.length > 0) env[key] = value;
  }
  return env;
}
