import type { Avatar } from "@/types";

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
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="avatar-thumb">{avatar.name.slice(0, 2).toUpperCase()}</div>
            <div>
              <h2 style={{ margin: 0 }}>{avatar.name}</h2>
              <span>{avatar.status === "ready" ? "ativo" : "desativado"}</span>
            </div>
          </div>
          <p className="muted">Consentimento aceito em {new Date(avatar.consent_accepted_at).toLocaleDateString("pt-BR")}.</p>
        </article>
      ))}
    </section>
  );
}
