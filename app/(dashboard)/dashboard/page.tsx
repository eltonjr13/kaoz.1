export const dynamic = "force-dynamic";

import Link from "next/link";
import { Plus, Search, UserRound } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { listLocalAvatars, listLocalJobs } from "@/lib/local-store";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/server";
import { APP_WORKSPACE_ID } from "@/lib/workspace";
import type { JobStatus } from "@/types";

type RecentJob = {
  id: string;
  topic: string;
  status: JobStatus;
  created_at: string;
};

export default async function DashboardPage() {
  const localAvatars = await listLocalAvatars();
  const localJobs = await listLocalJobs();
  let recentJobs: RecentJob[] = localJobs.slice(0, 5);
  let avatarCount = localAvatars.length;
  let completedCount = 0;

  if (hasSupabaseConfig()) {
    const supabase = await createClient();

    const [{ data: jobs }, { count: totalAvatars }, { count: totalCompleted }] = await Promise.all([
      supabase
        .from("reaction_jobs")
        .select("id, topic, status, created_at")
        .eq("user_id", APP_WORKSPACE_ID)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase.from("avatars").select("id", { count: "exact", head: true }).eq("user_id", APP_WORKSPACE_ID),
      supabase
        .from("reaction_jobs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", APP_WORKSPACE_ID)
        .eq("status", "completed")
    ]);

    recentJobs = [...recentJobs, ...((jobs ?? []) as RecentJob[])]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .slice(0, 5);
    avatarCount += totalAvatars ?? 0;
    completedCount = localJobs.filter((job) => job.status === "completed").length + (totalCompleted ?? 0);
  }

  return (
    <>
      <div className="title-row">
        <div className="section-title">
          <h1>Dashboard</h1>
          <p>Visao geral dos seus avatares e jobs.</p>
        </div>
        <div className="row-actions" style={{ marginTop: 0 }}>
          <Link className="button" href="/viral-search">
            <Search size={18} /> Buscar virais
          </Link>
          <Link className="button secondary" href="/avatars">
            <UserRound size={18} /> Avatar
          </Link>
          <Link className="button secondary" href="/jobs/new">
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
          <strong>{avatarCount}</strong>
        </div>
        <div className="stat">
          <span>Videos finalizados</span>
          <strong>{completedCount}</strong>
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
            title="Comece pela busca viral"
            description="Encontre referencias por nicho no TikTok, Instagram e YouTube antes de criar o react."
            actionHref="/viral-search"
            actionLabel="Buscar virais"
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
