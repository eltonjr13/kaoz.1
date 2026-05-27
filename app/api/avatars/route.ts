import { NextResponse } from "next/server";
import { createLocalAvatar, listLocalAvatars } from "@/lib/local-store";
import { createClient } from "@/lib/supabase/server";
import { APP_STORAGE_PREFIX, APP_WORKSPACE_ID } from "@/lib/workspace";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function safeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("avatars")
    .select("*")
    .eq("user_id", APP_WORKSPACE_ID)
    .order("created_at", { ascending: false });

  if (error) {
    const localAvatars = await listLocalAvatars();
    return NextResponse.json({ avatars: localAvatars });
  }

  const localAvatars = await listLocalAvatars();
  return NextResponse.json({ avatars: [...localAvatars, ...(data ?? [])] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const formData = await request.formData().catch(() => null);

  if (!formData) {
    return badRequest("Formulario invalido.");
  }

  const name = String(formData.get("name") ?? "").trim();
  const consentAccepted = String(formData.get("consentAccepted") ?? "") === "true";
  const image = formData.get("image");

  if (!name || !(image instanceof File)) {
    return badRequest("Nome e imagem sao obrigatorios.");
  }

  if (!consentAccepted) {
    return badRequest("Consentimento obrigatorio para usar imagem real.");
  }

  if (!ALLOWED_IMAGE_TYPES.has(image.type)) {
    return badRequest("Use imagem PNG, JPG ou WebP.");
  }

  if (image.size > MAX_IMAGE_SIZE) {
    return badRequest("Imagem maior que 10MB.");
  }

  const imagePath = `${APP_STORAGE_PREFIX}/${crypto.randomUUID()}-${safeFileName(image.name || "avatar.jpg")}`;
  const { error: uploadError } = await supabase.storage.from("avatars").upload(imagePath, image, {
    cacheControl: "3600",
    contentType: image.type,
    upsert: false
  });

  if (!uploadError) {
    const { data, error } = await supabase
      .from("avatars")
      .insert({
        user_id: APP_WORKSPACE_ID,
        name,
        image_path: imagePath,
        consent_accepted: true,
        consent_accepted_at: new Date().toISOString(),
        status: "ready"
      })
      .select("*")
      .single();

    if (!error) {
      return NextResponse.json({ avatar: data }, { status: 201 });
    }
  }

  const avatar = await createLocalAvatar({ name, file: image });
  return NextResponse.json({ avatar, storage: "local" }, { status: 201 });
}
