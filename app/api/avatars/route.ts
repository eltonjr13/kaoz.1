import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return badRequest("Nao autenticado.", 401);
  }

  const { data, error } = await supabase
    .from("avatars")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return badRequest(error.message, 500);
  }

  return NextResponse.json({ avatars: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return badRequest("Nao autenticado.", 401);
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    imagePath?: unknown;
    consentAccepted?: unknown;
  } | null;

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const imagePath = typeof body?.imagePath === "string" ? body.imagePath.trim() : "";
  const consentAccepted = body?.consentAccepted === true;

  if (!name || !imagePath) {
    return badRequest("Nome e imagem sao obrigatorios.");
  }

  if (!consentAccepted) {
    return badRequest("Consentimento obrigatorio para usar imagem real.");
  }

  const { data, error } = await supabase
    .from("avatars")
    .insert({
      user_id: user.id,
      name,
      image_path: imagePath,
      consent_accepted: true,
      consent_accepted_at: new Date().toISOString(),
      status: "ready"
    })
    .select("*")
    .single();

  if (error) {
    return badRequest(error.message, 500);
  }

  return NextResponse.json({ avatar: data }, { status: 201 });
}
