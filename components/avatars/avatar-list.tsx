"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Upload, Plus, RefreshCw } from "lucide-react";
import type { Avatar } from "@/types";

function getMediaUrl(filePath: string | null | undefined) {
  if (!filePath) return "";
  return filePath.startsWith("/") ? filePath : `/${filePath}`;
}

const isVideo = (path: string) => /\.(mp4|mov|webm|mkv|avi)$/i.test(path);

export function AvatarList({ avatars }: { avatars: Avatar[] }) {
  const router = useRouter();
  const [expandedAvatars, setExpandedAvatars] = useState<Record<string, boolean>>({});
  const [uploadingVersionId, setUploadingVersionId] = useState<string | null>(null);
  const [showAddVersionId, setShowAddVersionId] = useState<string | null>(null);
  const [newVersionName, setNewVersionName] = useState("");
  const [newVersionFile, setNewVersionFile] = useState<File | null>(null);
  const [isSubmittingNewVersion, setIsSubmittingNewVersion] = useState(false);
  const [messages, setMessages] = useState<Record<string, string>>({});

  const mainAvatars = avatars.filter((a) => !a.parent_id);

  function toggleExpand(id: string) {
    setExpandedAvatars((prev) => ({
      ...prev,
      [id]: !prev[id]
    }));
  }

  async function handleVideoSwap(versionId: string, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingVersionId(versionId);
    setMessages((prev) => ({ ...prev, [versionId]: "Enviando novo vídeo..." }));

    try {
      const formData = new FormData();
      formData.append("image", file);

      const response = await fetch(`/api/avatars/${versionId}`, {
        method: "PATCH",
        body: formData
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Erro ao atualizar vídeo.");
      }

      setMessages((prev) => ({ ...prev, [versionId]: "✓ Vídeo atualizado!" }));
      router.refresh();
    } catch (err) {
      setMessages((prev) => ({ ...prev, [versionId]: `Erro: ${err instanceof Error ? err.message : String(err)}` }));
    } finally {
      setUploadingVersionId(null);
    }
  }

  async function handleCreateVersion(parentId: string, event: React.FormEvent) {
    event.preventDefault();
    if (!newVersionName.trim() || !newVersionFile) {
      setMessages((prev) => ({ ...prev, [`add-${parentId}`]: "Nome e arquivo são obrigatórios." }));
      return;
    }

    setIsSubmittingNewVersion(true);
    setMessages((prev) => ({ ...prev, [`add-${parentId}`]: "Criando versão..." }));

    try {
      const formData = new FormData();
      formData.append("name", newVersionName.trim());
      formData.append("image", newVersionFile);
      formData.append("parent_id", parentId);
      formData.append("consentAccepted", "true"); // Herda consentimento

      const response = await fetch("/api/avatars", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Erro ao criar versão.");
      }

      setNewVersionName("");
      setNewVersionFile(null);
      setShowAddVersionId(null);
      setMessages((prev) => ({ ...prev, [`add-${parentId}`]: "✓ Versão criada com sucesso!" }));
      router.refresh();
    } catch (err) {
      setMessages((prev) => ({ ...prev, [`add-${parentId}`]: `Erro: ${err instanceof Error ? err.message : String(err)}` }));
    } finally {
      setIsSubmittingNewVersion(false);
    }
  }

  if (mainAvatars.length === 0) {
    return (
      <section className="empty-state">
        <h2>Nenhum avatar</h2>
        <p>Avatares cadastrados aparecem aqui.</p>
      </section>
    );
  }

  return (
    <section className="cards-grid">
      {mainAvatars.map((parent) => {
        const subversions = avatars.filter((a) => a.parent_id === parent.id);
        const totalVersions = 1 + subversions.length;
        const isExpanded = !!expandedAvatars[parent.id];

        const defaultVersion = { ...parent, name: "Padrão (original)" };
        const allVersions = [defaultVersion, ...subversions];

        return (
          <article className="card" key={parent.id} style={{ display: "flex", flexDirection: "column", justifySelf: "stretch" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <div className="avatar-thumb" style={{ flexShrink: 0 }}>
                {parent.image_path ? (
                  isVideo(parent.image_path) ? (
                    <video
                      src={getMediaUrl(parent.image_path)}
                      muted
                      loop
                      autoPlay
                      playsInline
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <img
                      src={getMediaUrl(parent.image_path)}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      alt={parent.name}
                    />
                  )
                ) : (
                  parent.name.slice(0, 2).toUpperCase()
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{parent.name}</h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <span className={`status-badge ${parent.status === "ready" ? "completed" : "failed"}`}>
                    {parent.status === "ready" ? "ativo" : "desativado"}
                  </span>
                  <span className="status-badge" style={{ background: "var(--bg-soft)", color: "var(--text)" }}>
                    {totalVersions} {totalVersions === 1 ? "versão" : "versões"}
                  </span>
                </div>
              </div>
            </div>

            {parent.voice_reference_path ? (
              <div style={{ marginTop: 14, padding: "10px", borderRadius: "8px", background: "var(--bg-soft)", border: "1px solid var(--line)" }}>
                <span className="status-badge voice_generating" style={{ marginBottom: 8, display: "inline-flex" }}>
                  🎙️ voz clonada
                </span>
                <audio
                  src={getMediaUrl(parent.voice_reference_path)}
                  controls
                  style={{ width: "100%", height: "32px", display: "block" }}
                />
              </div>
            ) : null}

            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 14, marginBottom: 10 }}>
              Consentimento em {new Date(parent.consent_accepted_at).toLocaleDateString("pt-BR")}.
            </p>

            {/* Accordion toggle button */}
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: "auto" }}>
              <button
                type="button"
                className="button secondary full"
                style={{ justifyContent: "space-between", minHeight: "36px", fontSize: "0.85rem", padding: "0 12px" }}
                onClick={() => toggleExpand(parent.id)}
              >
                <span>Ver Versões</span>
                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            </div>

            {/* Accordion panel */}
            {isExpanded && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0 0", marginTop: 8, borderTop: "1px dashed var(--line)" }}>
                <span style={{ fontSize: "0.82rem", fontWeight: "bold", color: "var(--muted)" }}>Versões do Avatar:</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {allVersions.map((version) => (
                    <div
                      key={version.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "8px",
                        borderRadius: "8px",
                        background: "var(--panel-strong)",
                        border: "1px solid var(--line)"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: 6,
                            overflow: "hidden",
                            background: "var(--bg-soft)",
                            flexShrink: 0
                          }}
                        >
                          {version.image_path ? (
                            isVideo(version.image_path) ? (
                              <video
                                src={getMediaUrl(version.image_path)}
                                muted
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              />
                            ) : (
                              <img
                                src={getMediaUrl(version.image_path)}
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                alt={version.name}
                              />
                            )
                          ) : null}
                        </div>
                        <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                          <span style={{ fontSize: "0.82rem", fontWeight: "bold", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                            {version.name}
                          </span>
                          {messages[version.id] && (
                            <span style={{ fontSize: "0.75rem", color: messages[version.id].includes("Erro") ? "var(--danger)" : "var(--success)" }}>
                              {messages[version.id]}
                            </span>
                          )}
                        </div>
                      </div>

                      <label
                        className="button secondary"
                        style={{
                          padding: "0 10px",
                          minHeight: "30px",
                          fontSize: "0.78rem",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6
                        }}
                      >
                        {uploadingVersionId === version.id ? (
                          <RefreshCw size={12} className="spin-icon" />
                        ) : (
                          <Upload size={12} />
                        )}
                        <span>{uploadingVersionId === version.id ? "Salvando" : "Trocar Vídeo"}</span>
                        <input
                          type="file"
                          accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp"
                          style={{ display: "none" }}
                          disabled={uploadingVersionId !== null}
                          onChange={(e) => handleVideoSwap(version.id, e)}
                        />
                      </label>
                    </div>
                  ))}
                </div>

                {/* Form to add a new version */}
                <div style={{ marginTop: 4 }}>
                  {showAddVersionId === parent.id ? (
                    <form
                      onSubmit={(e) => handleCreateVersion(parent.id, e)}
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        border: "1px solid var(--line)",
                        background: "var(--bg-soft)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10
                      }}
                    >
                      <span style={{ fontSize: "0.82rem", fontWeight: "bold" }}>Nova Versão para {parent.name}</span>
                      
                      <div className="field" style={{ marginTop: 0 }}>
                        <label style={{ fontSize: "0.78rem" }}>Nome da Versão</label>
                        <input
                          type="text"
                          placeholder="Ex: Sem fundo, Casual, Roupa de frio..."
                          value={newVersionName}
                          onChange={(e) => setNewVersionName(e.target.value)}
                          style={{ padding: "8px 10px", fontSize: "0.82rem", background: "var(--panel)" }}
                          required
                        />
                      </div>

                      <div className="field" style={{ marginTop: 0 }}>
                        <label style={{ fontSize: "0.78rem" }}>Vídeo ou Imagem</label>
                        <input
                          type="file"
                          accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp"
                          onChange={(e) => setNewVersionFile(e.target.files?.[0] ?? null)}
                          style={{ fontSize: "0.8rem", padding: "6px" }}
                          required
                        />
                      </div>

                      {messages[`add-${parent.id}`] && (
                        <span
                          style={{
                            fontSize: "0.78rem",
                            color: messages[`add-${parent.id}`].includes("Erro") ? "var(--danger)" : "var(--success)"
                          }}
                        >
                          {messages[`add-${parent.id}`]}
                        </span>
                      )}

                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
                        <button
                          type="button"
                          className="button secondary"
                          style={{ minHeight: "32px", padding: "0 10px", fontSize: "0.78rem" }}
                          onClick={() => {
                            setShowAddVersionId(null);
                            setNewVersionName("");
                            setNewVersionFile(null);
                          }}
                          disabled={isSubmittingNewVersion}
                        >
                          Cancelar
                        </button>
                        <button
                          type="submit"
                          className="button"
                          style={{ minHeight: "32px", padding: "0 10px", fontSize: "0.78rem" }}
                          disabled={isSubmittingNewVersion}
                        >
                          Criar Versão
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="button secondary full"
                      style={{ borderStyle: "dashed", minHeight: "34px", fontSize: "0.82rem", gap: 6 }}
                      onClick={() => setShowAddVersionId(parent.id)}
                    >
                      <Plus size={14} />
                      <span>Adicionar Versão</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}
