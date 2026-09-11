/**
 * Next 16 rebuilds the request URL from the hostname it bound to, ignoring the
 * `Host` header (`experimental.trustHostHeader` is off). A server bound to
 * loopback reports `http://localhost:<port>` even when the desktop app writes
 * `http://127.0.0.1:<port>` in its runtime descriptor, so strict string
 * equality between those two URLs always fails. Both spellings mean the same
 * machine, so they must compare as equal while the port and the token keep
 * doing the real authentication.
 */

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function isLoopbackHostname(hostname?: string | null): boolean {
  if (!hostname) return false;
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

function parseUrl(value?: string | null): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Accepts a loopback http URL with an explicit port, or nothing. */
export function parseLoopbackBaseUrl(value?: string | null): URL | null {
  const url = parseUrl(value);
  if (!url) return null;
  if (url.protocol !== 'http:') return null;
  if (!url.port) return null;
  if (!isLoopbackHostname(url.hostname)) return null;
  return url;
}

/**
 * Equal origins, or two loopback origins on the same port. Different ports and
 * non-loopback hosts stay apart.
 */
export function isSameOriginOrLoopback(left?: string | null, right?: string | null): boolean {
  if (!left || !right) return false;
  const a = parseUrl(left);
  const b = parseUrl(right);
  if (!a || !b) return false;
  if (a.protocol !== b.protocol) return false;
  if (a.port !== b.port) return false;
  if (a.hostname === b.hostname) return true;
  return isLoopbackHostname(a.hostname) && isLoopbackHostname(b.hostname);
}
