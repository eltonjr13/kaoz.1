import fs from 'node:fs/promises';
import path from 'node:path';
import { isSameOriginOrLoopback, parseLoopbackBaseUrl } from './loopback-origin.ts';

export interface DesktopCompanionRuntime {
  baseUrl: string;
  token: string;
  pid: number;
  updatedAt: string;
}

export function desktopCompanionRuntimePath() {
  const configured = process.env.KAOZ1_FLOW_NATIVE_RUNTIME_FILE?.trim();
  if (configured) return path.resolve(configured);
  const appData = process.env.APPDATA?.trim();
  return path.join(appData || process.cwd(), 'Kaoz.1', 'flow-companion-runtime.json');
}

export async function readDesktopCompanionRuntime(): Promise<DesktopCompanionRuntime | null> {
  try {
    const value = JSON.parse(await fs.readFile(desktopCompanionRuntimePath(), 'utf8')) as Partial<DesktopCompanionRuntime>;
    if (!parseLoopbackBaseUrl(value.baseUrl)) return null;
    if (!/^[a-f0-9]{64}$/.test(value.token || '') || !Number.isInteger(value.pid)) return null;
    return value as DesktopCompanionRuntime;
  } catch { return null; }
}

export async function authorizeDesktopCompanion(request: Request): Promise<DesktopCompanionRuntime> {
  const runtime = await readDesktopCompanionRuntime();
  if (!runtime) throw new Error('Aplicativo desktop indisponível.');
  // O Next monta a URL da requisição como `localhost`, enquanto o app grava
  // `127.0.0.1` no runtime: os dois são o mesmo host local.
  if (!isSameOriginOrLoopback(request.url, runtime.baseUrl)) throw new Error('Destino desktop inválido.');
  if (request.headers.get('authorization') !== `Bearer ${runtime.token}`) throw new Error('Conexão desktop não autorizada.');
  return runtime;
}
