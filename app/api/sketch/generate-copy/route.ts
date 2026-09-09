import { NextResponse } from 'next/server';
import { generateAdCopy, extractCopyRequest } from '@/lib/sketch/sketch-copy-generator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const copyReq = extractCopyRequest(body);

    if (!copyReq) {
      return NextResponse.json(
        { success: false, error: 'A descrição do produto ou anúncio é obrigatória.' },
        { status: 400 }
      );
    }

    const result = await generateAdCopy(copyReq);
    return NextResponse.json(result, { status: result.statusCode });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API SKETCH] Erro ao gerar copy:', err);
    return NextResponse.json({ success: false, error: `Erro ao gerar copy: ${message}` }, { status: 500 });
  }
}
