import Link from "next/link";
import { CreateJobForm } from "@/components/jobs/create-job-form";
import { EmptyState } from "@/components/ui/empty-state";
import { createClient } from "@/lib/supabase/server";
import type { Avatar } from "@/types";

export default async function NewJobPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("avatars")
    .select("id, name, image_path, consent_accepted, status")
    .eq("consent_accepted", true)
    .eq("status", "ready")
    .order("created_at", { ascending: false });

  const avatars = (data ?? []) as Pick<Avatar, "id" | "name" | "image_path" | "consent_accepted" | "status">[];

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
          <CreateJobForm avatars={avatars} />
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
