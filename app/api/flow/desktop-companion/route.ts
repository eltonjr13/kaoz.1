import { NextResponse } from 'next/server';
import { authorizeDesktopCompanion } from '@/lib/flow/desktop-companion-auth';
import { completeDesktopImage, desktopCompanionStatus, nextDesktopImage } from '@/lib/flow/desktop-image-broker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await authorizeDesktopCompanion(request);
    const url = new URL(request.url);
    if (url.searchParams.get('status') === '1') return NextResponse.json({ status: desktopCompanionStatus() });
    const version = request.headers.get('x-kaoz-flow-extension-version') || undefined;
    return NextResponse.json({ command: nextDesktopImage(version) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    await authorizeDesktopCompanion(request);
    if (Number(request.headers.get('content-length')) > 70 * 1024 * 1024) throw new Error('Resposta muito grande.');
    const body = await request.json();
    if (typeof body.id !== 'string') throw new Error('Pedido inválido.');
    const result = await completeDesktopImage(body.id, body);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
