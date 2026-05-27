"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Rocket } from "lucide-react";
import type { Avatar } from "@/types";

type CreateJobFormProps = {
  avatars: Pick<Avatar, "id" | "name" | "image_path" | "consent_accepted" | "status">[];
};

export function CreateJobForm({ avatars }: CreateJobFormProps) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [avatarId, setAvatarId] = useState(avatars[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsLoading(true);

    const createResponse = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, avatarId })
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

      {message ? <p className="form-message">{message}</p> : null}

      <div className="row-actions">
        <button className="button" type="submit" disabled={isLoading}>
          <Rocket size={18} /> {isLoading ? "Iniciando" : "Criar e iniciar"}
        </button>
      </div>
    </form>
  );
}
