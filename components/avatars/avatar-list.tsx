import type { Avatar } from "@/types";

function getAvatarUrl(avatar: Avatar) {
  if (!avatar.image_path) return "";
  if (avatar.image_path.startsWith("/")) {
    return avatar.image_path;
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${supabaseUrl}/storage/v1/object/public/avatars/${avatar.image_path}`;
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
        <article className="card" key={avatar.id}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div className="avatar-thumb" style={{ flexShrink: 0 }}>
              {avatar.image_path ? (
                isVideo(avatar.image_path) ? (
                  <video
                    src={getAvatarUrl(avatar)}
                    muted
                    loop
                    autoPlay
                    playsInline
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <img
                    src={getAvatarUrl(avatar)}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    alt={avatar.name}
                  />
                )
              ) : (
                avatar.name.slice(0, 2).toUpperCase()
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{avatar.name}</h2>
              <div>
                <span className={`status-badge ${avatar.status === "ready" ? "completed" : "failed"}`}>
                  {avatar.status === "ready" ? "ativo" : "desativado"}
                </span>
              </div>
            </div>
          </div>
          <p className="muted" style={{ fontSize: "0.85rem", marginTop: 14, marginBottom: 0 }}>
            Consentimento aceito em {new Date(avatar.consent_accepted_at).toLocaleDateString("pt-BR")}.
          </p>
        </article>
      ))}
    </section>
  );
}
