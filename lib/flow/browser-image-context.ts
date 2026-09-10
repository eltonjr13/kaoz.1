import { AsyncLocalStorage } from 'node:async_hooks';

const shared = globalThis as typeof globalThis & { kaozBrowserImageContext?: AsyncLocalStorage<string> };
export const browserImageContext = shared.kaozBrowserImageContext ??= new AsyncLocalStorage<string>();

export function browserTransportToken(request: Request): string | undefined {
  const token = request.headers.get('x-kaoz-flow-browser');
  if (!token) return undefined;
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Conexão da extensão inválida.');
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new Error('Origem da conexão inválida.');
  return token;
}

export function withBrowserImageTransport<T>(token: string | undefined, action: () => T): T {
  return token ? browserImageContext.run(token, action) : action();
}
