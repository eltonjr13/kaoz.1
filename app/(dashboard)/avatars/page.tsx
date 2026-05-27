import { AvatarForm } from "@/components/avatars/avatar-form";
import { AvatarList } from "@/components/avatars/avatar-list";
import { listLocalAvatars } from "@/lib/local-store";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { APP_WORKSPACE_ID } from "@/lib/workspace";
import type { Avatar } from "@/types";

export default async function AvatarsPage() {
  const localAvatars = await listLocalAvatars();
  let avatars: Avatar[] = localAvatars;

  if (hasSupabaseConfig()) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("avatars")
      .select("id, name, image_path, thumbnail_path, consent_accepted, consent_accepted_at, status, created_at, updated_at, user_id")
      .eq("user_id", APP_WORKSPACE_ID)
      .order("created_at", { ascending: false });

    avatars = [...localAvatars, ...((data ?? []) as Avatar[])];
  }

  return (
    <>
      <div className="section-title">
        <h1>Avatares</h1>
        <p>Cadastre imagens reais somente com autorizacao e consentimento.</p>
      </div>

      <div className="split-grid">
        <AvatarForm />
        <AvatarList avatars={avatars} />
      </div>
    </>
  );
}
