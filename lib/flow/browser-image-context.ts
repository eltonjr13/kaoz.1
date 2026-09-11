import { AsyncLocalStorage } from 'node:async_hooks';
import { isSameOriginOrLoopback } from './loopback-origin.ts';

const shared = globalThis as typeof globalThis & { kaozBrowserImageContext?: AsyncLocalStorage<string> };
export const browserImageContext = shared.kaozBrowserImageContext ??= new AsyncLocalStorage<string>();

export function browserTransportToken(request: Request): string | undefined {
  const token = request.headers.get('x-kaoz-flow-browser');
  if (!token) return undefined;
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Conexão da extensão inválida.');
  const origin = request.headers.get('origin');
  // Aceita localhost e 127.0.0.1 como a mesma origem local: o Next reconstrói a
  // URL da requisição com um dos dois, independentemente do Host enviado.
  if (origin && !isSameOriginOrLoopback(origin, request.url)) throw new Error('Origem da conexão inválida.');
  return token;
}

export function withBrowserImageTransport<T>(token: string | undefined, action: () => T): T {
  return token ? browserImageContext.run(token, action) : action();
}
