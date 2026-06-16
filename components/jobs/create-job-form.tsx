"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Play, Rocket, Settings, RotateCcw, ChevronDown, ChevronUp, Scissors, Upload } from "lucide-react";
import type { Avatar, ExpertBackgroundMode, RenderLayout } from "@/types";
import { getSourceVideoPlatformLabel, parseSourceVideoUrl } from "@/lib/videos/source-video";

function getMediaUrl(filePath: string | null | undefined) {
  if (!filePath) return "";
  return filePath.startsWith("/") ? filePath : `/${filePath}`;
}

const isVideo = (path: string) => /\.(mp4|mov|webm|mkv|avi)$/i.test(path);

type CreateJobFormProps = {
  avatars: Pick<Avatar, "id" | "name" | "image_path" | "consent_accepted" | "status" | "voice_reference_path" | "parent_id">[];
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
  const [step, setStep] = useState(1);
  const [topic, setTopic] = useState(initialTopic);
  
  // Parent and Version Selection states
  const mainAvatars = avatars.filter((a) => !a.parent_id);
  const [parentId, setParentId] = useState(mainAvatars[0]?.id ?? "");
  const [versionId, setVersionId] = useState(mainAvatars[0]?.id ?? "");

  // Video base swapping states
  const [swappedVideoFile, setSwappedVideoFile] = useState<File | null>(null);
  const [saveAsNewVersion, setSaveAsNewVersion] = useState(true);
  const [newVersionName, setNewVersionName] = useState("");

  const avatarId = versionId;

  function handleParentChange(newParentId: string) {
    setParentId(newParentId);
    setVersionId(newParentId);
    setSwappedVideoFile(null);
    setNewVersionName("");
  }

  const [sourceVideoUrl, setSourceVideoUrl] = useState(initialSourceVideoUrl);
  const [sourceVideoTitle, setSourceVideoTitle] = useState(initialSourceVideoTitle);
  const [renderLayout, setRenderLayout] = useState<RenderLayout>("source_pip");
  const [expertBackgroundMode, setExpertBackgroundMode] = useState<ExpertBackgroundMode>("original");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Video analysis and editing states
  const [scriptText, setScriptText] = useState("");
  const [sourceVideoDescription, setSourceVideoDescription] = useState("");
  const [sourceVideoTranscription, setSourceVideoTranscription] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);

  // Video trimming state
  const [shouldTrim, setShouldTrim] = useState(true);
  const [trimStart, setTrimStart] = useState("00:00");
  const [trimEnd, setTrimEnd] = useState("00:15");

  const parsedSourceVideo = sourceVideoUrl.trim() ? parseSourceVideoUrl(sourceVideoUrl) : null;
  const SourceIcon = parsedSourceVideo?.platform === "instagram" ? Camera : Play;
  const canRemoveExpertBackground = renderLayout === "source_pip";

  // Voice advanced settings state
  const [inferenceSteps, setInferenceSteps] = useState(32);
  const [guidanceScale, setGuidanceScale] = useState(3);
  const [denoiseRatio, setDenoiseRatio] = useState(0.8);
  const [speed, setSpeed] = useState(1);
  const [duration, setDuration] = useState(0);
  const [preprocessPrompt, setPreprocessPrompt] = useState(true);
  const [postprocessOutput, setPostprocessOutput] = useState(true);
  const [showAdvancedVoice, setShowAdvancedVoice] = useState(false);

  async function handleStep1Analyze() {
    setMessage("");
    setIsAnalyzing(true);
    try {
      const response = await fetch("/api/pipeline/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceVideoUrl: sourceVideoUrl.trim(),
          trimStart: shouldTrim ? trimStart.trim() || null : null,
          trimEnd: shouldTrim ? trimEnd.trim() || null : null
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.error || "Falha ao analisar o vídeo.");
        return;
      }

      setSourceVideoDescription(data.description || "");
      setSourceVideoTranscription(data.transcription || "");
      if (data.topic) setTopic(data.topic);
      if (data.title) setSourceVideoTitle(data.title);
      setStep(2); // Avança para a Etapa 2 de parâmetros
    } catch (err) {
      console.error(err);
      setMessage("Erro de conexão ao solicitar análise do vídeo.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleGenerateScript() {
    setMessage("");
    setIsGeneratingScript(true);
    try {
      const response = await fetch("/api/pipeline/generate-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          description: sourceVideoDescription,
          transcription: sourceVideoTranscription,
          avatarId
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.error || "Falha ao gerar roteiro.");
        return;
      }

      setScriptText(data.script || "");
      setStep(3); // Avança para a Etapa 3 de revisão do roteiro
    } catch (err) {
      console.error(err);
      setMessage("Erro de conexão ao solicitar geração do roteiro.");
    } finally {
      setIsGeneratingScript(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (sourceVideoUrl.trim() && !parsedSourceVideo) {
      setMessage("Use um link direto valido de video, reel, short ou mp4.");
      return;
    }

    setIsLoading(true);
    let finalAvatarId = avatarId;

    if (swappedVideoFile) {
      setMessage("Processando arquivo de vídeo do avatar...");
      try {
        if (saveAsNewVersion) {
          const formData = new FormData();
          formData.append("name", newVersionName.trim() || `Versão via Job - ${new Date().toLocaleDateString("pt-BR")}`);
          formData.append("image", swappedVideoFile);
          formData.append("parent_id", parentId);
          formData.append("consentAccepted", "true");

          const response = await fetch("/api/avatars", {
            method: "POST",
            body: formData
          });

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || "Não foi possível salvar o novo vídeo como versão.");
          }

          const data = await response.json();
          finalAvatarId = data.avatar.id;
        } else {
          const formData = new FormData();
          formData.append("image", swappedVideoFile);

          const response = await fetch(`/api/avatars/${versionId}`, {
            method: "PATCH",
            body: formData
          });

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || "Não foi possível atualizar o vídeo base da versão.");
          }
        }
      } catch (err) {
        setIsLoading(false);
        setMessage(err instanceof Error ? err.message : "Erro ao processar vídeo do avatar.");
        return;
      }
    }

    try {
      const createResponse = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          avatarId: finalAvatarId,
          sourceVideoUrl: sourceVideoUrl.trim() || null,
          sourceVideoTitle: sourceVideoTitle.trim() || null,
          renderLayout,
          expertBackgroundMode,
          trimStart: shouldTrim ? trimStart.trim() || null : null,
          trimEnd: shouldTrim ? trimEnd.trim() || null : null,
          scriptText,
          sourceVideoDescription,
          sourceVideoTranscription,
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
    } catch {
      setIsLoading(false);
      setMessage("Erro de conexao ao processar requisicoes.");
    }
  }

  return (
    <form className="form-panel" onSubmit={handleSubmit}>
      {/* Visual Step Indicator */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "24px" }}>
        <span className={`status-badge ${step === 1 ? "queued" : "completed"}`} style={{ padding: "4px 10px" }}>
          Etapa 1: Origem
        </span>
        <div style={{ flex: 1, height: "2px", background: "var(--line)" }}></div>
        <span className={`status-badge ${step === 2 ? "queued" : step > 2 ? "completed" : ""}`} style={{ padding: "4px 10px" }}>
          Etapa 2: Parâmetros
        </span>
        <div style={{ flex: 1, height: "2px", background: "var(--line)" }}></div>
        <span className={`status-badge ${step === 3 ? "queued" : ""}`} style={{ padding: "4px 10px" }}>
          Etapa 3: Roteiro & Voz
        </span>
      </div>

      {step === 1 && (
        /* STEP 1: Video selection and trimming */
        <div>
          <div className="field" style={{ marginTop: 0 }}>
            <label htmlFor="sourceVideoUrl">Link do vídeo para colagem</label>
            <input
              id="sourceVideoUrl"
              value={sourceVideoUrl}
              onChange={(event) => setSourceVideoUrl(event.target.value)}
              placeholder="Link direto do reel, short ou video mp4"
              required
            />
            <span className="field-hint">Suporta links do YouTube, Instagram Reels e TikTok.</span>
          </div>

          <div className="field" style={{ marginTop: "20px" }}>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={shouldTrim}
                onChange={(event) => setShouldTrim(event.target.checked)}
              />
              <Scissors size={18} />
              <span>Cortar/Limitar trecho do vídeo?</span>
            </label>
            <span className="field-hint">
              Recorta o vídeo original antes de fazer a análise de IA e renderização final.
            </span>
          </div>

          {shouldTrim && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "12px" }}>
              <div className="field" style={{ marginTop: 0 }}>
                <label htmlFor="trimStart">Início do trecho (segundos ou MM:SS)</label>
                <input
                  id="trimStart"
                  value={trimStart}
                  onChange={(e) => setTrimStart(e.target.value)}
                  placeholder="00:00"
                />
              </div>
              <div className="field" style={{ marginTop: 0 }}>
                <label htmlFor="trimEnd">Fim do trecho (segundos ou MM:SS)</label>
                <input
                  id="trimEnd"
                  value={trimEnd}
                  onChange={(e) => setTrimEnd(e.target.value)}
                  placeholder="00:15"
                />
              </div>
            </div>
          )}

          {shouldTrim && (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
              <button
                type="button"
                className="button secondary"
                style={{ fontSize: "0.8rem", minHeight: "32px", padding: "0 10px" }}
                onClick={() => {
                  setTrimStart("00:00");
                  setTrimEnd("00:10");
                }}
              >
                10s Iniciais
              </button>
              <button
                type="button"
                className="button secondary"
                style={{ fontSize: "0.8rem", minHeight: "32px", padding: "0 10px" }}
                onClick={() => {
                  setTrimStart("00:00");
                  setTrimEnd("00:15");
                }}
              >
                15s Iniciais
              </button>
              <button
                type="button"
                className="button secondary"
                style={{ fontSize: "0.8rem", minHeight: "32px", padding: "0 10px" }}
                onClick={() => {
                  setTrimStart("00:00");
                  setTrimEnd("00:30");
                }}
              >
                30s Iniciais
              </button>
              <button
                type="button"
                className="button secondary"
                style={{ fontSize: "0.8rem", minHeight: "32px", padding: "0 10px" }}
                onClick={() => {
                  setTrimStart("");
                  setTrimEnd("");
                }}
              >
                Vídeo Completo
              </button>
            </div>
          )}

          <div className="row-actions" style={{ marginTop: "32px" }}>
            <button
              type="button"
              className="button"
              disabled={isAnalyzing || !sourceVideoUrl.trim()}
              onClick={handleStep1Analyze}
            >
              {isAnalyzing ? "Analisando com Gemini..." : "Analisar vídeo e avançar"}
            </button>
          </div>
          {message ? <p className="form-message" style={{ marginTop: "12px" }}>{message}</p> : null}
        </div>
      )}

      {step === 2 && (
        /* STEP 2: React Settings */
        <div>
          {/* Summary Panel */}
          <div
            style={{
              padding: "12px 16px",
              background: "var(--panel-strong)",
              borderRadius: "8px",
              marginBottom: "20px",
              border: "1px solid var(--line)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center"
            }}
          >
            <div>
              <span style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: "bold", display: "block" }}>
                Vídeo de Origem Selecionado
              </span>
              <span style={{ fontSize: "0.9rem", wordBreak: "break-all" }}>{sourceVideoUrl}</span>
              <span style={{ fontSize: "0.84rem", display: "block", marginTop: "4px", color: "var(--brand)", fontWeight: 700 }}>
                {shouldTrim ? `Trecho: de ${trimStart || "0"} até ${trimEnd || "fim"}` : "Vídeo completo (sem cortes)"}
              </span>
            </div>
            <button
              type="button"
              className="button secondary"
              style={{ minHeight: "36px", padding: "0 12px", fontSize: "0.82rem" }}
              onClick={() => setStep(1)}
            >
              Alterar
            </button>
          </div>

          {/* Video Preview */}
          {parsedSourceVideo && (
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", marginBottom: "8px", fontWeight: "bold", fontSize: "0.9rem" }}>
                Prévia do Vídeo Original
              </label>
              {parsedSourceVideo.platform === "youtube" ? (
                <div style={{ position: "relative", width: "100%", paddingBottom: "56.25%", height: 0, borderRadius: "8px", overflow: "hidden", border: "1px solid var(--line)", background: "#000" }}>
                  <iframe
                    src={`https://www.youtube.com/embed/${parsedSourceVideo.externalId}`}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title="YouTube Video Preview"
                  />
                </div>
              ) : parsedSourceVideo.platform === "instagram" ? (
                <div style={{ position: "relative", width: "100%", paddingBottom: "125%", height: 0, borderRadius: "8px", overflow: "hidden", border: "1px solid var(--line)", background: "#000" }}>
                  <iframe
                    src={`https://www.instagram.com/reel/${parsedSourceVideo.externalId}/embed/captioned/`}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
                    frameBorder="0"
                    scrolling="no"
                    allowTransparency
                    title="Instagram Video Preview"
                  />
                </div>
              ) : (
                <video
                  src={sourceVideoUrl}
                  controls
                  style={{ width: "100%", maxHeight: "360px", borderRadius: "8px", border: "1px solid var(--line)", background: "#000" }}
                />
              )}
            </div>
          )}

          <div className="field" style={{ marginTop: 0 }}>
            <label htmlFor="avatar-parent">Avatar Principal</label>
            <select
              id="avatar-parent"
              value={parentId}
              onChange={(event) => handleParentChange(event.target.value)}
              required
            >
              {mainAvatars.map((avatar) => (
                <option value={avatar.id} key={avatar.id}>
                  {avatar.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="avatar-version">Versão do Avatar</label>
            <select
              id="avatar-version"
              value={versionId}
              onChange={(event) => {
                setVersionId(event.target.value);
                setSwappedVideoFile(null);
                setNewVersionName("");
              }}
              required
            >
              {avatars.find((a) => a.id === parentId) && (
                <option value={parentId}>Padrão (original)</option>
              )}
              {avatars
                .filter((a) => a.parent_id === parentId)
                .map((version) => (
                  <option value={version.id} key={version.id}>
                    {version.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Selected Version Preview */}
          {versionId && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, padding: 10, background: "var(--bg-soft)", borderRadius: 8, border: "1px solid var(--line)" }}>
              <div style={{ width: 44, height: 44, borderRadius: 6, overflow: "hidden", background: "#000", flexShrink: 0 }}>
                {avatars.find(a => a.id === versionId)?.image_path ? (
                  isVideo(avatars.find(a => a.id === versionId)!.image_path) ? (
                    <video
                      src={getMediaUrl(avatars.find(a => a.id === versionId)!.image_path)}
                      muted
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <img
                      src={getMediaUrl(avatars.find(a => a.id === versionId)!.image_path)}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      alt="Avatar Preview"
                    />
                  )
                ) : null}
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: "bold" }}>
                  {avatars.find(a => a.id === versionId)?.name || "Avatar padrão"}
                </span>
                <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                  {avatars.find(a => a.id === versionId)?.parent_id ? "Subversão do avatar" : "Versão principal padrão"}
                </span>
              </div>
            </div>
          )}

          {/* Optional Base Video Swapping */}
          <div style={{ border: "1px dashed var(--line)", padding: 14, borderRadius: 8, marginTop: 16, background: "var(--panel-strong)" }}>
            <div className="field" style={{ marginTop: 0 }}>
              <label htmlFor="swapped-video" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Upload size={16} /> Trocar vídeo base para este job? (Opcional)
              </label>
              <input
                id="swapped-video"
                type="file"
                accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setSwappedVideoFile(file);
                  if (file && !newVersionName) {
                    setNewVersionName(`Versão via Job - ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR").slice(0, 5)}`);
                  }
                }}
              />
              <span className="field-hint" style={{ fontSize: "0.78rem" }}>
                Selecione um novo vídeo ou imagem para usar como base para o avatar neste job.
              </span>
            </div>

            {swappedVideoFile && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={saveAsNewVersion}
                    onChange={(e) => setSaveAsNewVersion(e.target.checked)}
                  />
                  <span>Salvar como uma nova versão do avatar principal?</span>
                </label>

                {saveAsNewVersion && (
                  <div className="field" style={{ marginTop: 0 }}>
                    <label htmlFor="new-version-name">Nome da Nova Versão</label>
                    <input
                      id="new-version-name"
                      value={newVersionName}
                      onChange={(e) => setNewVersionName(e.target.value)}
                      placeholder="Ex: João com terno azul"
                      required={saveAsNewVersion}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="field">
            <label htmlFor="topic">Assunto do React</label>
            <textarea
              id="topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Ex: produto viral de cozinha, trend de treino, noticia de tecnologia..."
              required
            />
          </div>

          <div className="field">
            <label htmlFor="sourceVideoTitle">Título de referência do vídeo</label>
            <input
              id="sourceVideoTitle"
              value={sourceVideoTitle}
              onChange={(event) => setSourceVideoTitle(event.target.value)}
              placeholder="Ex: Receita com frango crocante"
            />
          </div>

          {message ? <p className="form-message">{message}</p> : null}

          <div className="row-actions">
            <button className="button secondary" type="button" onClick={() => setStep(1)} disabled={isGeneratingScript}>
              Voltar
            </button>
            <button
              className="button"
              type="button"
              onClick={handleGenerateScript}
              disabled={isGeneratingScript || !topic.trim() || !avatarId}
            >
              {isGeneratingScript ? "Gerando roteiro..." : "Gerar Roteiro e Avançar"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        /* STEP 3: Script Review & Edits */
        <div>
          {/* Summary Panel */}
          <div
            style={{
              padding: "12px 16px",
              background: "var(--panel-strong)",
              borderRadius: "8px",
              marginBottom: "20px",
              border: "1px solid var(--line)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center"
            }}
          >
            <div>
              <span style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: "bold", display: "block" }}>
                Revisão do Roteiro e Configurações
              </span>
              <span style={{ fontSize: "0.9rem", wordBreak: "break-all" }}>
                Avatar: {avatars.find(a => a.id === avatarId)?.name || "Nenhum"} | Assunto: {topic}
              </span>
            </div>
            <button
              type="button"
              className="button secondary"
              style={{ minHeight: "36px", padding: "0 12px", fontSize: "0.82rem" }}
              onClick={() => setStep(2)}
              disabled={isLoading}
            >
              Alterar Assunto/Avatar
            </button>
          </div>

          <div className="field" style={{ marginTop: 0 }}>
            <label htmlFor="scriptText">Roteiro da Dublagem (Gerado pela IA - Você pode editar)</label>
            <textarea
              id="scriptText"
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              rows={6}
              placeholder="Escreva ou edite o roteiro do react..."
              required
            />
            <span className="field-hint">Este texto será falado pelo avatar e usado no Lip-sync.</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
            <div className="field" style={{ marginTop: 0 }}>
              <label htmlFor="transcription">Transcrição do Vídeo Original (IA)</label>
              <textarea
                id="transcription"
                value={sourceVideoTranscription || "Sem transcrição de áudio significativa."}
                readOnly
                rows={4}
                style={{ background: "var(--panel-strong)", opacity: 0.8, fontSize: "0.86rem" }}
              />
            </div>
            <div className="field" style={{ marginTop: 0 }}>
              <label htmlFor="description">Descrição Visual do Vídeo (IA)</label>
              <textarea
                id="description"
                value={sourceVideoDescription || "Sem descrição visual disponível."}
                readOnly
                rows={4}
                style={{ background: "var(--panel-strong)", opacity: 0.8, fontSize: "0.86rem" }}
              />
            </div>
          </div>

          <div className="field">
            <label>Layout do vídeo colagem</label>
            <div className="layout-options" role="group" aria-label="Layout do video">
              {layoutOptions.map((option) => (
                <button
                  className={`layout-option ${renderLayout === option.value ? "active" : ""}`}
                  type="button"
                  onClick={() => {
                    setRenderLayout(option.value);
                    if (option.value !== "source_pip") {
                      setExpertBackgroundMode("original");
                    }
                  }}
                  key={option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <span className="field-hint">
              {layoutOptions.find((option) => option.value === renderLayout)?.description}
            </span>
          </div>

          <div className="field">
            <label className={`toggle-row ${!canRemoveExpertBackground ? "disabled" : ""}`}>
              <input
                type="checkbox"
                checked={expertBackgroundMode === "remove"}
                disabled={!canRemoveExpertBackground}
                onChange={(event) => setExpertBackgroundMode(event.target.checked ? "remove" : "original")}
              />
              <Scissors size={18} />
              <span>Remover fundo do expert</span>
            </label>
            <span className="field-hint">Disponível no layout Fonte cheia + expert. Exige rembg no worker.</span>
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

          <div
            className={`collage-preview ${renderLayout} ${expertBackgroundMode === "remove" ? "expert-cutout" : ""}`}
            aria-label="Preview da colagem"
          >
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
            <button className="button secondary" type="button" onClick={() => setStep(2)} disabled={isLoading}>
              Voltar
            </button>
            <button className="button" type="submit" disabled={isLoading}>
              <Rocket size={18} /> {isLoading ? "Criando e Renderizando..." : "Criar e Iniciar Renderização"}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
