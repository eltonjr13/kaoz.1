"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";

export function AvatarForm() {
  const router = useRouter();
  const [formKey, setFormKey] = useState(0);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null);

  const [consentAccepted, setConsentAccepted] = useState(false);
  const [personalityFile, setPersonalityFile] = useState<File | null>(null);
  const [personalityError, setPersonalityError] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] ?? null;
    setFile(selectedFile);

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }

    if (selectedFile) {
      setPreviewUrl(URL.createObjectURL(selectedFile));
    }
  }

  function handleVoiceChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] ?? null;
    setVoiceFile(selectedFile);

    if (voicePreviewUrl) {
      URL.revokeObjectURL(voicePreviewUrl);
      setVoicePreviewUrl(null);
    }

    if (selectedFile) {
      setVoicePreviewUrl(URL.createObjectURL(selectedFile));
    }
  }

  function handlePersonalityChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] ?? null;
    setPersonalityFile(selectedFile);
    setPersonalityError("");

    if (selectedFile && !selectedFile.name.endsWith(".json")) {
      setPersonalityError("O arquivo de personalidade deve ser um JSON (.json).");
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!file) {
      setMessage("Selecione um arquivo de imagem ou vídeo.");
      return;
    }

    if (!consentAccepted) {
      setMessage("Consentimento obrigatório para usar imagem ou vídeo real.");
      return;
    }

    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.set("name", name);
      formData.set("image", file);
      formData.set("consentAccepted", String(consentAccepted));
      if (voiceFile) {
        formData.set("voice_reference", voiceFile);
      }
      if (personalityFile) {
        formData.set("personality", personalityFile);
      }

      const response = await fetch("/api/avatars", {
        method: "POST",
        body: formData
      });

      setIsLoading(false);

      if (!response.ok) {
        let errMsg = "Não foi possível criar o avatar.";
        try {
          const payload = (await response.json()) as { error?: string };
          errMsg = payload.error ?? errMsg;
        } catch (err) {
          console.error("Falha ao ler JSON de erro:", err);
        }
        setMessage(errMsg);
        return;
      }

      setName("");
      setFile(null);
      setVoiceFile(null);
      setPersonalityFile(null);
      setConsentAccepted(false);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
      if (voicePreviewUrl) {
        URL.revokeObjectURL(voicePreviewUrl);
        setVoicePreviewUrl(null);
      }
      setFormKey((prev) => prev + 1);
      router.refresh();
    } catch (err) {
      setIsLoading(false);
      setMessage(err instanceof Error ? err.message : "Erro de conexão ao criar o avatar.");
      console.error(err);
    }
  }

  return (
    <form key={formKey} className="form-panel" onSubmit={handleSubmit}>
      <div className="field" style={{ marginTop: 0 }}>
        <label htmlFor="avatar-name">Nome</label>
        <input
          id="avatar-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ex: Ana apresentadora"
          required
        />
      </div>

      <div className="field">
        <label htmlFor="avatar-file">Imagem ou Vídeo autorizado</label>
        <input
          id="avatar-file"
          type="file"
          accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm"
          onChange={handleFileChange}
          required
        />
        {previewUrl && file ? (
          <div style={{ marginTop: 10 }}>
            <span style={{ fontSize: "0.82rem", color: "var(--muted)", display: "block", marginBottom: 6 }}>Pré-visualização:</span>
            {file.type.startsWith("video/") ? (
              <video
                src={previewUrl}
                muted
                loop
                autoPlay
                playsInline
                style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }}
              />
            ) : (
              <img
                src={previewUrl}
                style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }}
                alt="Preview"
              />
            )}
          </div>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="avatar-voice">Áudio de voz de referência (Opcional)</label>
        <input
          id="avatar-voice"
          type="file"
          accept="audio/mpeg,audio/wav,audio/mp3,audio/ogg"
          onChange={handleVoiceChange}
        />
        {voicePreviewUrl ? (
          <div style={{ marginTop: 8 }}>
            <span style={{ fontSize: "0.82rem", color: "var(--muted)", display: "block", marginBottom: 6 }}>Prévia da Voz:</span>
            <audio src={voicePreviewUrl} controls style={{ width: "100%", maxHeight: 40 }} />
          </div>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="avatar-personality">Detalhes da Personalidade (.json - Opcional)</label>
        <input
          id="avatar-personality"
          type="file"
          accept=".json,application/json"
          onChange={handlePersonalityChange}
        />
        {personalityError ? (
          <p className="form-message" style={{ marginTop: 6 }}>{personalityError}</p>
        ) : personalityFile ? (
          <div style={{ marginTop: 8 }}>
            <span style={{ fontSize: "0.82rem", color: "var(--success)", display: "block" }}>
              ✓ Personalidade carregada: {personalityFile.name}
            </span>
          </div>
        ) : null}
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={consentAccepted}
          onChange={(event) => setConsentAccepted(event.target.checked)}
        />
        <span>Confirmo que tenho autorização para usar esta imagem ou vídeo real como avatar.</span>
      </label>

      {message ? <p className="form-message">{message}</p> : null}

      <div className="row-actions">
        <button className="button" type="submit" disabled={isLoading}>
          <Upload size={18} /> {isLoading ? "Enviando" : "Cadastrar avatar"}
        </button>
      </div>
    </form>
  );
}
