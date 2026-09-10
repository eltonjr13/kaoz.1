/**
 * Adversarial Module Loader for Client Isolation Testing
 * Intercepts ESM resolution and forbids access to Node runtime built-ins.
 */

const FORBIDDEN_BUILTINS = new Set([
  'node:fs',
  'node:fs/promises',
  'node:path',
  'node:crypto',
  'fs',
  'path',
  'crypto',
]);

export async function resolve(specifier, context, nextResolve) {
  if (FORBIDDEN_BUILTINS.has(specifier)) {
    throw new Error(`ISOLATION_FAULT: Forbidden Node built-in "${specifier}" accessed in client context`);
  }
  return nextResolve(specifier, context);
}
