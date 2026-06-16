export const dynamic = "force-dynamic";

import Link from "next/link";
import { CreateJobForm } from "@/components/jobs/create-job-form";
import { EmptyState } from "@/components/ui/empty-state";
import { listLocalAvatars } from "@/lib/local-store";
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
  const avatars: Pick<Avatar, "id" | "name" | "image_path" | "consent_accepted" | "status" | "voice_reference_path" | "parent_id">[] =
    await listLocalAvatars();

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
