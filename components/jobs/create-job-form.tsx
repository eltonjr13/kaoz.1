"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Play, Rocket } from "lucide-react";
import type { Avatar, RenderLayout } from "@/types";
import { getSourceVideoPlatformLabel, parseSourceVideoUrl } from "@/lib/videos/source-video";

type CreateJobFormProps = {
  avatars: Pick<Avatar, "id" | "name" | "image_path" | "consent_accepted" | "status">[];
  initialTopic?: string;
  initialSourceVideoUrl?: string;
  initialSourceVideoTitle?: string;
};

const layoutOptions: { value: RenderLayout; label: string; description: string }[] = [
  {
    value: "source_pip",
    label: "Fonte cheia + expert",
    description: "Video principal em tela cheia com expert menor no canto."
  },
  {
    value: "source_top_expert_bottom",
    label: "Fonte dominante",
    description: "Video fonte no topo com expert menor embaixo."
  },
  {
    value: "balanced_split",
    label: "Divisao equilibrada",
    description: "Video fonte maior, mas com expert ainda bem visivel."
  }
];

export function CreateJobForm({
  avatars,
  initialTopic = "",
  initialSourceVideoUrl = "",
  initialSourceVideoTitle = ""
}: CreateJobFormProps) {
  const router = useRouter();
  const [topic, setTopic] = useState(initialTopic);
  const [avatarId, setAvatarId] = useState(avatars[0]?.id ?? "");
  const [sourceVideoUrl, setSourceVideoUrl] = useState(initialSourceVideoUrl);
  const [sourceVideoTitle, setSourceVideoTitle] = useState(initialSourceVideoTitle);
  const [renderLayout, setRenderLayout] = useState<RenderLayout>("source_pip");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const parsedSourceVideo = sourceVideoUrl.trim() ? parseSourceVideoUrl(sourceVideoUrl) : null;
  const SourceIcon = parsedSourceVideo?.platform === "instagram" ? Camera : Play;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (sourceVideoUrl.trim() && !parsedSourceVideo) {
      setMessage("Use um link direto valido de video, reel, short ou mp4.");
      return;
    }

    setIsLoading(true);

    const createResponse = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        avatarId,
        sourceVideoUrl: sourceVideoUrl.trim() || null,
        sourceVideoTitle: sourceVideoTitle.trim() || null,
        renderLayout
      })
    });

    const createPayload = (await createResponse.json()) as { job?: { id: string }; error?: string };

    if (!createResponse.ok || !createPayload.job) {
      setIsLoading(false);
      setMessage(createPayload.error ?? "Nao foi possivel criar o job.");
      return;
    }

    const startResponse = await fetch("/api/pipeline/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: createPayload.job.id })
    });

    setIsLoading(false);

    if (!startResponse.ok) {
      const payload = (await startResponse.json()) as { error?: string };
      setMessage(payload.error ?? "Job criado, mas o pipeline nao iniciou.");
      return;
    }

    router.push("/jobs");
    router.refresh();
  }

  return (
    <form className="form-panel" onSubmit={handleSubmit}>
      <div className="field" style={{ marginTop: 0 }}>
        <label htmlFor="avatar">Avatar</label>
        <select id="avatar" value={avatarId} onChange={(event) => setAvatarId(event.target.value)} required>
          {avatars.map((avatar) => (
            <option value={avatar.id} key={avatar.id}>
              {avatar.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="topic">Assunto</label>
        <textarea
          id="topic"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="Ex: produto viral de cozinha, trend de treino, noticia de tecnologia..."
          required
        />
      </div>

      <div className="field">
        <label htmlFor="sourceVideoUrl">Video para colagem</label>
        <input
          id="sourceVideoUrl"
          value={sourceVideoUrl}
          onChange={(event) => setSourceVideoUrl(event.target.value)}
          placeholder="Link direto do reel, short ou video mp4"
        />
      </div>

      <div className="field">
        <label htmlFor="sourceVideoTitle">Titulo do video</label>
        <input
          id="sourceVideoTitle"
          value={sourceVideoTitle}
          onChange={(event) => setSourceVideoTitle(event.target.value)}
          placeholder="Referencia escolhida"
        />
      </div>

      <div className="field">
        <label>Layout do video</label>
        <div className="layout-options" role="group" aria-label="Layout do video">
          {layoutOptions.map((option) => (
            <button
              className={`layout-option ${renderLayout === option.value ? "active" : ""}`}
              type="button"
              onClick={() => setRenderLayout(option.value)}
              key={option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="field-hint">{layoutOptions.find((option) => option.value === renderLayout)?.description}</span>
      </div>

      <div className={`collage-preview ${renderLayout}`} aria-label="Preview da colagem">
        <div className="collage-preview-source">
          <SourceIcon size={18} />
          <span>
            {parsedSourceVideo ? getSourceVideoPlatformLabel(parsedSourceVideo.platform) : "Instagram / YouTube / Video"}
          </span>
        </div>
        <div className="collage-preview-expert">
          <span>Expert</span>
        </div>
      </div>

      {message ? <p className="form-message">{message}</p> : null}

      <div className="row-actions">
        <button className="button" type="submit" disabled={isLoading}>
          <Rocket size={18} /> {isLoading ? "Iniciando" : "Criar e iniciar"}
        </button>
      </div>
    </form>
  );
}
