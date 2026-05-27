import Link from "next/link";
import { Plus, UserRound } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { createClient } from "@/lib/supabase/server";
import type { JobStatus } from "@/types";

type RecentJob = {
  id: string;
  topic: string;
  status: JobStatus;
  created_at: string;
};

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: jobs }, { count: avatarCount }, { count: completedCount }] = await Promise.all([
    supabase
      .from("reaction_jobs")
      .select("id, topic, status, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("avatars").select("id", { count: "exact", head: true }),
    supabase
      .from("reaction_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
  ]);

  const recentJobs = (jobs ?? []) as RecentJob[];

  return (
    <>
      <div className="title-row">
        <div className="section-title">
          <h1>Dashboard</h1>
          <p>Visao geral dos seus avatares e jobs.</p>
        </div>
        <div className="row-actions" style={{ marginTop: 0 }}>
          <Link className="button secondary" href="/avatars">
            <UserRound size={18} /> Avatar
          </Link>
          <Link className="button" href="/jobs/new">
            <Plus size={18} /> Novo job
          </Link>
        </div>
      </div>

      <section className="stats-grid">
        <div className="stat">
          <span>Jobs recentes</span>
          <strong>{recentJobs.length}</strong>
        </div>
        <div className="stat">
          <span>Avatares</span>
          <strong>{avatarCount ?? 0}</strong>
        </div>
        <div className="stat">
          <span>Videos finalizados</span>
          <strong>{completedCount ?? 0}</strong>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <div className="title-row">
          <div className="section-title">
            <h2>Ultimos jobs</h2>
          </div>
          <Link className="button secondary" href="/jobs">
            Ver todos
          </Link>
        </div>

        {recentJobs.length === 0 ? (
          <EmptyState
            title="Nenhum job criado"
            description="Crie um avatar autorizado e inicie seu primeiro video de react."
            actionHref="/jobs/new"
            actionLabel="Criar job"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Assunto</th>
                  <th>Status</th>
                  <th>Criado em</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.topic}</td>
                    <td>
                      <JobStatusBadge status={job.status} />
                    </td>
                    <td>{new Date(job.created_at).toLocaleDateString("pt-BR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
