"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";

export function AvatarForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!file) {
      setMessage("Selecione uma imagem.");
      return;
    }

    if (!consentAccepted) {
      setMessage("Consentimento obrigatorio para usar imagem real.");
      return;
    }

    setIsLoading(true);
    const formData = new FormData();
    formData.set("name", name);
    formData.set("image", file);
    formData.set("consentAccepted", String(consentAccepted));

    const response = await fetch("/api/avatars", {
      method: "POST",
      body: formData
    });

    setIsLoading(false);

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setMessage(payload.error ?? "Nao foi possivel criar o avatar.");
      return;
    }

    setName("");
    setFile(null);
    setConsentAccepted(false);
    router.refresh();
  }

  return (
    <form className="form-panel" onSubmit={handleSubmit}>
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
        <label htmlFor="avatar-file">Imagem autorizada</label>
        <input
          id="avatar-file"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          required
        />
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={consentAccepted}
          onChange={(event) => setConsentAccepted(event.target.checked)}
        />
        <span>Confirmo que tenho autorizacao para usar esta imagem real como avatar.</span>
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
