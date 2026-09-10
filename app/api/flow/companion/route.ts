import { NextResponse } from 'next/server';
import { browserTransportToken } from '@/lib/flow/browser-image-context';
import { completeBrowserImage, nextBrowserImage } from '@/lib/flow/browser-image-broker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const token = browserTransportToken(request);
    if (!token) return NextResponse.json({ error: 'Conexão ausente.' }, { status: 401 });
    return NextResponse.json({ command: nextBrowserImage(token) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return NextResponse.json({ error: String(error) }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    const token = browserTransportToken(request);
    if (!token) return NextResponse.json({ error: 'Conexão ausente.' }, { status: 401 });
    if (Number(request.headers.get('content-length')) > 70 * 1024 * 1024) throw new Error('Resposta muito grande.');
    const body = await request.json();
    if (typeof body.id !== 'string') throw new Error('Pedido inválido.');
    const result = await completeBrowserImage(token, body.id, body);
    return NextResponse.json({ success: true, result });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
}
