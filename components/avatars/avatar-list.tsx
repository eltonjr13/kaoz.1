/* eslint-disable @next/next/no-img-element */

import type { Avatar } from "@/types";

function getMediaUrl(filePath: string | null | undefined) {
  if (!filePath) return "";
  if (filePath.startsWith("/")) {
    return filePath;
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${supabaseUrl}/storage/v1/object/public/avatars/${filePath}`;
}

const isVideo = (path: string) => /\.(mp4|mov|webm|mkv|avi)$/i.test(path);

export function AvatarList({ avatars }: { avatars: Avatar[] }) {
  if (avatars.length === 0) {
    return (
      <section className="empty-state">
        <h2>Nenhum avatar</h2>
        <p>Avatares cadastrados aparecem aqui.</p>
      </section>
    );
  }

  return (
    <section className="cards-grid">
      {avatars.map((avatar) => (
        <article className="card" key={avatar.id} style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div className="avatar-thumb" style={{ flexShrink: 0 }}>
              {avatar.image_path ? (
                isVideo(avatar.image_path) ? (
                  <video
                    src={getMediaUrl(avatar.image_path)}
                    muted
                    loop
                    autoPlay
                    playsInline
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <img
                    src={getMediaUrl(avatar.image_path)}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    alt={avatar.name}
                  />
                )
              ) : (
                avatar.name.slice(0, 2).toUpperCase()
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{avatar.name}</h2>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <span className={`status-badge ${avatar.status === "ready" ? "completed" : "failed"}`}>
                  {avatar.status === "ready" ? "ativo" : "desativado"}
                </span>
              </div>
            </div>
          </div>

          {avatar.voice_reference_path ? (
            <div style={{ marginTop: 14, padding: "10px", borderRadius: "8px", background: "var(--bg-soft)", border: "1px solid var(--line)" }}>
              <span className="status-badge voice_generating" style={{ marginBottom: 8, display: "inline-flex" }}>
                🎙️ voz clonada
              </span>
              <audio
                src={getMediaUrl(avatar.voice_reference_path)}
                controls
                style={{ width: "100%", height: "32px", display: "block" }}
              />
            </div>
          ) : null}

          <p className="muted" style={{ fontSize: "0.85rem", marginTop: 14, marginBottom: 0 }}>
            Consentimento aceito em {new Date(avatar.consent_accepted_at).toLocaleDateString("pt-BR")}.
          </p>
        </article>
      ))}
    </section>
  );
}
