"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Play, Rocket, Settings, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import type { Avatar, RenderLayout } from "@/types";
import { getSourceVideoPlatformLabel, parseSourceVideoUrl } from "@/lib/videos/source-video";

type CreateJobFormProps = {
  avatars: Pick<Avatar, "id" | "name" | "image_path" | "consent_accepted" | "status" | "voice_reference_path">[];
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

  // Voice advanced settings state
  const [inferenceSteps, setInferenceSteps] = useState(32);
  const [guidanceScale, setGuidanceScale] = useState(3);
  const [denoiseRatio, setDenoiseRatio] = useState(0.8);
  const [speed, setSpeed] = useState(1);
  const [duration, setDuration] = useState(0);
  const [preprocessPrompt, setPreprocessPrompt] = useState(true);
  const [postprocessOutput, setPostprocessOutput] = useState(true);
  const [showAdvancedVoice, setShowAdvancedVoice] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (sourceVideoUrl.trim() && !parsedSourceVideo) {
      setMessage("Use um link direto valido de video, reel, short ou mp4.");
      return;
    }

    setIsLoading(true);

    try {
      const createResponse = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          avatarId,
          sourceVideoUrl: sourceVideoUrl.trim() || null,
          sourceVideoTitle: sourceVideoTitle.trim() || null,
          renderLayout,
          voiceSettings: {
            inference_steps: inferenceSteps,
            guidance_scale: guidanceScale,
            denoise_ratio: denoiseRatio,
            speed,
            duration,
            preprocess_prompt: preprocessPrompt,
            postprocess_output: postprocessOutput
          }
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
    } catch (err) {
      setIsLoading(false);
      setMessage("Erro de conexao ao processar requisicoes.");
    }
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

      {/* Advanced Voice Settings */}
      <div className="advanced-settings-panel">
        <button
          type="button"
          className="advanced-settings-header button secondary full"
          style={{ 
            display: "flex", 
            justifyContent: "space-between", 
            alignItems: "center", 
            border: "none", 
            borderRadius: 0,
            background: "none",
            minHeight: "48px",
            padding: "12px 16px"
          }}
          onClick={() => setShowAdvancedVoice(!showAdvancedVoice)}
        >
          <span className="advanced-settings-title" style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 800 }}>
            <Settings size={18} />
            Configurações Avançadas de Voz
          </span>
          {showAdvancedVoice ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>

        {showAdvancedVoice && (
          <div className="advanced-settings-content">
            {/* Inference Steps */}
            <div className="advanced-slider-group">
              <div className="advanced-slider-header">
                <span className="advanced-slider-label">Inference Steps</span>
                <div className="advanced-slider-controls">
                  <span className="advanced-slider-val">{inferenceSteps}</span>
                  <button
                    type="button"
                    className="advanced-slider-reset"
                    onClick={() => setInferenceSteps(32)}
                    title="Resetar"
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              </div>
              <div className="advanced-slider-input-row">
                <span className="advanced-slider-limit">8</span>
                <input
                  type="range"
                  min="8"
                  max="64"
                  step="1"
                  value={inferenceSteps}
                  onChange={(e) => setInferenceSteps(parseInt(e.target.value))}
                />
                <span className="advanced-slider-limit">64</span>
              </div>
            </div>

            {/* Guidance Scale */}
            <div className="advanced-slider-group">
              <div className="advanced-slider-header">
                <span className="advanced-slider-label">Guidance Scale</span>
                <div className="advanced-slider-controls">
                  <span className="advanced-slider-val">{guidanceScale}</span>
                  <button
                    type="button"
                    className="advanced-slider-reset"
                    onClick={() => setGuidanceScale(3)}
                    title="Resetar"
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              </div>
              <div className="advanced-slider-input-row">
                <span className="advanced-slider-limit">0</span>
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.5"
                  value={guidanceScale}
                  onChange={(e) => setGuidanceScale(parseFloat(e.target.value))}
                />
                <span className="advanced-slider-limit">10</span>
              </div>
            </div>

            {/* Denoise Ratio */}
            <div className="advanced-slider-group">
              <div className="advanced-slider-header">
                <span className="advanced-slider-label">Denoise Ratio</span>
                <div className="advanced-slider-controls">
                  <span className="advanced-slider-val">{denoiseRatio.toFixed(1).replace(".", ",")}</span>
                  <button
                    type="button"
                    className="advanced-slider-reset"
                    onClick={() => setDenoiseRatio(0.8)}
                    title="Resetar"
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              </div>
              <div className="advanced-slider-input-row">
                <span className="advanced-slider-limit">0</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={denoiseRatio}
                  onChange={(e) => setDenoiseRatio(parseFloat(e.target.value))}
                />
                <span className="advanced-slider-limit">1</span>
              </div>
            </div>

            {/* Speed */}
            <div className="advanced-slider-group">
              <div className="advanced-slider-header">
                <span className="advanced-slider-label">Speed</span>
                <div className="advanced-slider-controls">
                  <span className="advanced-slider-val">{speed.toFixed(1).replace(".", ",")}</span>
                  <button
                    type="button"
                    className="advanced-slider-reset"
                    onClick={() => setSpeed(1)}
                    title="Resetar"
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              </div>
              <div className="advanced-slider-input-row">
                <span className="advanced-slider-limit">0.5</span>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={speed}
                  onChange={(e) => setSpeed(parseFloat(e.target.value))}
                />
                <span className="advanced-slider-limit">2</span>
              </div>
            </div>

            {/* Duration */}
            <div className="advanced-slider-group">
              <div className="advanced-slider-header">
                <span className="advanced-slider-label">Duration (0 = auto)</span>
                <div className="advanced-slider-controls">
                  <span className="advanced-slider-val">{duration}</span>
                  <button
                    type="button"
                    className="advanced-slider-reset"
                    onClick={() => setDuration(0)}
                    title="Resetar"
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              </div>
              <div className="advanced-slider-input-row">
                <span className="advanced-slider-limit">0</span>
                <input
                  type="range"
                  min="0"
                  max="30"
                  step="1"
                  value={duration}
                  onChange={(e) => setDuration(parseInt(e.target.value))}
                />
                <span className="advanced-slider-limit">30</span>
              </div>
            </div>

            {/* Checkboxes Row */}
            <div className="advanced-checkboxes-row">
              <label className="advanced-checkbox-item">
                <input
                  type="checkbox"
                  checked={preprocessPrompt}
                  onChange={(e) => setPreprocessPrompt(e.target.checked)}
                />
                <span>Preprocess Prompt</span>
              </label>
              <label className="advanced-checkbox-item">
                <input
                  type="checkbox"
                  checked={postprocessOutput}
                  onChange={(e) => setPostprocessOutput(e.target.checked)}
                />
                <span>Postprocess Output</span>
              </label>
            </div>
          </div>
        )}
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
