export const dynamic = "force-dynamic";

import Link from "next/link";
import { CreateJobForm } from "@/components/jobs/create-job-form";
import { EmptyState } from "@/components/ui/empty-state";
import { listLocalAvatars } from "@/lib/local-store";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { APP_WORKSPACE_ID } from "@/lib/workspace";
import type { Avatar } from "@/types";

type NewJobPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getSearchParam(params: Record<string, string | string[] | undefined> | undefined, key: string) {
  const value = params?.[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function NewJobPage({ searchParams }: NewJobPageProps) {
  const params = await searchParams;
  const initialTopic = getSearchParam(params, "topic");
  const initialSourceVideoUrl = getSearchParam(params, "sourceVideoUrl");
  const initialSourceVideoTitle = getSearchParam(params, "sourceVideoTitle");
  const localAvatars = await listLocalAvatars();
  let avatars: Pick<Avatar, "id" | "name" | "image_path" | "consent_accepted" | "status">[] = localAvatars;

  if (hasSupabaseConfig()) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("avatars")
      .select("id, name, image_path, consent_accepted, status")
      .eq("user_id", APP_WORKSPACE_ID)
      .eq("consent_accepted", true)
      .eq("status", "ready")
      .order("created_at", { ascending: false });

    avatars = [
      ...localAvatars,
      ...((data ?? []) as Pick<Avatar, "id" | "name" | "image_path" | "consent_accepted" | "status">[])
    ];
  }

  return (
    <>
      <div className="section-title">
        <h1>Novo job</h1>
        <p>Escolha o avatar autorizado e o assunto do react.</p>
      </div>

      {avatars.length === 0 ? (
        <EmptyState
          title="Crie um avatar primeiro"
          description="O pipeline exige consentimento aceito para usar imagem real."
          actionHref="/avatars"
          actionLabel="Cadastrar avatar"
        />
      ) : (
        <div className="split-grid">
          <CreateJobForm
            avatars={avatars}
            initialTopic={initialTopic}
            initialSourceVideoTitle={initialSourceVideoTitle}
            initialSourceVideoUrl={initialSourceVideoUrl}
          />
          <section className="card">
            <span>Pipeline</span>
            <h2>Fila preparada</h2>
            <p className="muted">
              Ao iniciar, o job muda para fila e fica pronto para o worker conectar busca viral,
              roteiro, OmniVoice, lip-sync e render vertical.
            </p>
            <Link className="button secondary" href="/jobs">
              Ver jobs
            </Link>
          </section>
        </div>
      )}
    </>
  );
}
