import { NextResponse } from 'next/server';
import { parseWhatsAppChat } from '@/lib/model-p/chat-parser';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let rawText = '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      if (file && typeof file === 'object' && 'text' in file) {
        rawText = await (file as Blob).text();
      } else {
        const textParam = formData.get('text');
        if (typeof textParam === 'string') rawText = textParam;
      }
    } else {
      const body = await request.json().catch(() => null) as { text?: string } | null;
      if (body?.text) rawText = body.text;
    }

    if (!rawText || rawText.trim().length === 0) {
      return NextResponse.json(
        { error: 'Nenhum conteúdo de conversa fornecido. Envie um arquivo .txt ou texto colado.' },
        { status: 400 }
      );
    }

    const parsed = parseWhatsAppChat(rawText);
    return NextResponse.json(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
