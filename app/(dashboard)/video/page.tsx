import type { Metadata } from "next";
import { VideoEditorClient } from "@/components/video/video-editor-client";

export const metadata: Metadata = {
  title: "Edição de Vídeo — Kaoz.1 Studio",
  description: "Estúdio de edição inteligente de vídeo com análise de IA, renderização local e integração ao DaVinci Resolve Free.",
};

export const dynamic = "force-dynamic";

export default function VideoEditorPage() {
  return <VideoEditorClient />;
}

