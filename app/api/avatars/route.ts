import { NextResponse } from "next/server";
import { createLocalAvatar, listLocalAvatars } from "@/lib/local-store";
import { createClient } from "@/lib/supabase/server";
import { APP_STORAGE_PREFIX, APP_WORKSPACE_ID } from "@/lib/workspace";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm"
]);

const MAX_AUDIO_SIZE = 15 * 1024 * 1024; // 15MB
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp3",
  "audio/ogg"
]);

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
  const voiceReference = formData.get("voice_reference");

  if (!name || !(image instanceof File)) {
    return badRequest("Nome e arquivo de imagem/vídeo são obrigatórios.");
  }

  if (!consentAccepted) {
    return badRequest("Consentimento obrigatório para usar imagem/vídeo real.");
  }

  const ext = image.name.split(".").pop()?.toLowerCase();
  const isAllowedImageOrVideo = ALLOWED_TYPES.has(image.type) || (ext && new Set(["png", "jpg", "jpeg", "webp", "mp4", "mov", "webm"]).has(ext));
  
  if (!isAllowedImageOrVideo) {
    return badRequest("Use uma imagem PNG/JPG/WebP ou vídeo MP4/MOV/WebM válido.");
  }

  if (image.size > MAX_FILE_SIZE) {
    return badRequest("O arquivo de avatar não pode ser maior que 50MB.");
  }

  let voiceRefFile: File | null = null;
  if (voiceReference instanceof File && voiceReference.size > 0 && voiceReference.name !== "") {
    const voiceExt = voiceReference.name.split(".").pop()?.toLowerCase();
    const isAllowedAudio = ALLOWED_AUDIO_TYPES.has(voiceReference.type) || (voiceExt && new Set(["mp3", "wav", "ogg", "mpeg"]).has(voiceExt));
    
    if (!isAllowedAudio) {
      return badRequest("O áudio de referência deve ser um arquivo MP3, WAV ou OGG válido.");
    }
    if (voiceReference.size > MAX_AUDIO_SIZE) {
      return badRequest("O áudio de referência não pode ser maior que 15MB.");
    }
    voiceRefFile = voiceReference;
  }

  // Upload image/video
  const imagePath = `${APP_STORAGE_PREFIX}/${crypto.randomUUID()}-${safeFileName(image.name || "avatar.jpg")}`;
  const { error: uploadError } = await supabase.storage.from("avatars").upload(imagePath, image, {
    cacheControl: "3600",
    contentType: image.type,
    upsert: false
  });

  if (!uploadError) {
    let voicePath: string | null = null;
    if (voiceRefFile) {
      const tempPath = `${APP_STORAGE_PREFIX}/${crypto.randomUUID()}-${safeFileName(voiceRefFile.name || "voice.wav")}`;
      const { error: audioUploadError } = await supabase.storage.from("avatars").upload(tempPath, voiceRefFile, {
        cacheControl: "3600",
        contentType: voiceRefFile.type,
        upsert: false
      });
      if (!audioUploadError) {
        voicePath = tempPath;
      }
    }

    const { data, error } = await supabase
      .from("avatars")
      .insert({
        user_id: APP_WORKSPACE_ID,
        name,
        image_path: imagePath,
        voice_reference_path: voicePath,
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

  const avatar = await createLocalAvatar({ name, file: image, voiceFile: voiceRefFile });
  return NextResponse.json({ avatar, storage: "local" }, { status: 201 });
}
