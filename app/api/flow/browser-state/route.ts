import { NextResponse } from "next/server";
import { flowProvider } from "@/src/providers/flow/FlowProvider";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const base64 = await flowProvider.captureBrowserState();
    if (!base64) {
      return NextResponse.json({ image: null });
    }
    return NextResponse.json({ image: `data:image/jpeg;base64,${base64}` });
  } catch (err: any) {
    return NextResponse.json({ error: `Erro ao capturar tela: ${err.message}` }, { status: 500 });
  }
}
