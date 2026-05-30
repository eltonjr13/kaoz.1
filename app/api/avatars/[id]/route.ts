import { NextResponse } from "next/server";
import { findLocalAvatar, updateLocalAvatar } from "@/lib/local-store";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { APP_STORAGE_PREFIX, APP_WORKSPACE_ID } from "@/lib/workspace";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm"
]);

const PUBLIC_AVATAR_DIR = path.join(process.cwd(), "public", "uploads", "avatars");

function safeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const formData = await request.formData().catch(() => null);

    if (!formData) {
      return NextResponse.json({ error: "Formulário inválido." }, { status: 400 });
    }

    const name = formData.get("name") ? String(formData.get("name")).trim() : null;
    const image = formData.get("image");

    let existingAvatar = await findLocalAvatar(id);
    if (!existingAvatar && hasSupabaseConfig()) {
      try {
        const supabase = await createClient();
        const { data } = await supabase
          .from("avatars")
          .select("*")
          .eq("id", id)
          .eq("user_id", APP_WORKSPACE_ID)
          .single();
        if (data) {
          existingAvatar = data;
        }
      } catch (err) {
        console.error("Erro ao buscar avatar no Supabase:", err);
      }
    }

    if (!existingAvatar) {
      return NextResponse.json({ error: "Avatar não encontrado." }, { status: 404 });
    }

    const patch: Record<string, string> = {};
    if (name) {
      patch.name = name;
    }

    if (image instanceof File && image.size > 0 && image.name !== "") {
      const ext = image.name.split(".").pop()?.toLowerCase();
      const isAllowedImageOrVideo = ALLOWED_TYPES.has(image.type) || (ext && new Set(["png", "jpg", "jpeg", "webp", "mp4", "mov", "webm"]).has(ext));
      
      if (!isAllowedImageOrVideo) {
        return NextResponse.json({ error: "Use uma imagem PNG/JPG/WebP ou vídeo MP4/MOV/WebM válido." }, { status: 400 });
      }

      if (image.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: "O arquivo de avatar não pode ser maior que 50MB." }, { status: 400 });
      }

      if (hasSupabaseConfig()) {
        try {
          const supabase = await createClient();
          const imagePath = `${APP_STORAGE_PREFIX}/${crypto.randomUUID()}-${safeFileName(image.name || "avatar.jpg")}`;
          const { error: uploadError } = await supabase.storage.from("avatars").upload(imagePath, image, {
            cacheControl: "3600",
            contentType: image.type,
            upsert: false
          });

          if (uploadError) {
            throw uploadError;
          }

          patch.image_path = imagePath;
        } catch (err) {
          console.error("Falha ao subir imagem para o Supabase:", err);
          return NextResponse.json({ error: "Falha ao enviar arquivo para o armazenamento em nuvem." }, { status: 500 });
        }
      } else {
        await mkdir(PUBLIC_AVATAR_DIR, { recursive: true });
        const fileName = `${crypto.randomUUID()}-${safeFileName(image.name || "avatar.jpg")}`;
        const diskPath = path.join(PUBLIC_AVATAR_DIR, fileName);
        const publicPath = `/uploads/avatars/${fileName}`;
        const buffer = Buffer.from(await image.arrayBuffer());
        await writeFile(diskPath, buffer);
        patch.image_path = publicPath;
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ avatar: existingAvatar, message: "Nenhuma alteração enviada." });
    }

    if (hasSupabaseConfig()) {
      try {
        const supabase = await createClient();
        const { data, error } = await supabase
          .from("avatars")
          .update({
            ...patch,
            updated_at: new Date().toISOString()
          })
          .eq("id", id)
          .eq("user_id", APP_WORKSPACE_ID)
          .select("*")
          .single();

        if (error) {
          throw error;
        }

        return NextResponse.json({ avatar: data });
      } catch (err) {
        console.error("Falha ao atualizar no Supabase, caindo para local:", err);
      }
    }

    const updated = await updateLocalAvatar(id, patch);
    return NextResponse.json({ avatar: updated });
  } catch (err) {
    console.error("Erro ao atualizar avatar:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro interno do servidor." },
      { status: 500 }
    );
  }
}
