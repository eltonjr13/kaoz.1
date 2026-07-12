export const dynamic = "force-dynamic";

import { AvatarForm } from "@/components/avatars/avatar-form";
import { AvatarList } from "@/components/avatars/avatar-list";
import { listLocalAvatars } from "@/lib/local-store";

export default async function AvatarsPage() {
  const avatars = await listLocalAvatars();

  const mainAvatars = avatars.filter((a) => !a.parent_id);

  return (
    <>
      <div className="section-title">
        <h1>Avatares</h1>
        <p>Cadastre imagens reais somente com autorizacao e consentimento.</p>
      </div>

      <div className="split-grid">
        <AvatarForm mainAvatars={mainAvatars} />
        <AvatarList avatars={avatars} />
      </div>
    </>
  );
}
