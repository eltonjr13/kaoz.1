export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowRight, Film, Image as ImageIcon, Megaphone, Sparkles, Video } from "lucide-react";
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

const agentShortcuts = [
  {
    href: "/flow?mode=image",
    label: "Imagem",
    description: "Prompt, referencia visual, pacote 3D e variacoes de imagem pelo agente.",
    icon: ImageIcon
  },
  {
    href: "/flow?mode=video",
    label: "Video Flow",
    description: "Geracao de clipes no Flow com plano aprovado antes de executar.",
    icon: Video
  },
  {
    href: "/flow?mode=ad-creative",
    label: "Criativos",
    description: "Anuncios em imagem com quantidade controlada e memoria Cortex opcional.",
    icon: Megaphone
  },
  {
    href: "/flow?mode=ad-creative&fly=1",
    label: "Modo Fly",
    description: "Planejamento de campanha, conceitos, react videos e legendas em uma central.",
    icon: Sparkles
  }
];

export default async function NewJobPage({ searchParams }: NewJobPageProps) {
  const params = await searchParams;
  const initialTopic = getSearchParam(params, "topic");
  const initialSourceVideoUrl = getSearchParam(params, "sourceVideoUrl");
  const initialSourceVideoTitle = getSearchParam(params, "sourceVideoTitle");
  const avatars: Pick<Avatar, "id" | "name" | "image_path" | "consent_accepted" | "status" | "voice_reference_path" | "parent_id">[] =
    await listLocalAvatars();

  return (
    <div className="min-h-screen bg-[#080808] px-4 py-8 text-white md:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex max-w-3xl flex-col gap-3">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#9D7CFF]">
              <Film size={14} />
              Generation Studio
            </div>
            <div>
              <h1 className="m-0 text-3xl font-light tracking-tight text-white md:text-4xl">Criar conteudo</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/52">
                Use esta aba para iniciar geracoes guiadas. O fluxo de react video continua no pipeline local,
                e imagens, videos Flow e campanhas entram pelo agente com plano antes da execucao.
              </p>
            </div>
          </div>

          <Link
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-white no-underline transition-colors hover:bg-white/[0.08]"
            href="/jobs"
          >
            Ver projetos
            <ArrowRight size={16} />
          </Link>
        </header>

        {avatars.length === 0 ? (
          <EmptyState
            title="Crie um avatar primeiro"
            description="O pipeline exige consentimento aceito para usar imagem real."
            actionHref="/avatars"
            actionLabel="Cadastrar avatar"
          />
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
            <section className="rounded-lg border border-white/10 bg-white/[0.025] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.28)] md:p-5">
              <div className="mb-5 flex flex-col gap-2 border-b border-white/10 pb-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/38">Pipeline local</span>
                  <h2 className="mt-1 text-xl font-semibold tracking-tight text-white">React video</h2>
                </div>
                <span className="w-fit rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                  roteiro, voz, lip-sync e render
                </span>
              </div>
              <CreateJobForm
                avatars={avatars}
                initialTopic={initialTopic}
                initialSourceVideoTitle={initialSourceVideoTitle}
                initialSourceVideoUrl={initialSourceVideoUrl}
              />
            </section>

            <aside className="flex flex-col gap-4">
              <section className="rounded-lg border border-white/10 bg-white/[0.025] p-5">
                <div className="mb-4">
                  <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/38">Agente MrChicken</span>
                  <h2 className="mt-1 text-lg font-semibold text-white">Outros modos de geracao</h2>
                  <p className="mt-2 text-sm leading-6 text-white/50">
                    Estes modos usam o `/flow` existente, mantendo memoria Cortex, aprovacao de plano e automacao do Flow no mesmo lugar.
                  </p>
                </div>

                <div className="grid gap-3">
                  {agentShortcuts.map((shortcut) => {
                    const Icon = shortcut.icon;
                    return (
                      <Link
                        key={shortcut.href}
                        href={shortcut.href}
                        className="group rounded-lg border border-white/10 bg-black/20 p-4 text-white no-underline transition-colors hover:border-[#9D7CFF]/50 hover:bg-[#9D7CFF]/10"
                      >
                        <div className="flex items-start gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-[#9D7CFF]">
                            <Icon size={17} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-3 text-sm font-semibold">
                              {shortcut.label}
                              <ArrowRight size={15} className="shrink-0 text-white/36 transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-white/48">{shortcut.description}</span>
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-lg border border-white/10 bg-white/[0.025] p-5">
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/38">Arquitetura</span>
                <p className="mt-2 text-sm leading-6 text-white/52">
                  A tela nao cria um pipeline novo. Ela organiza os pontos de entrada e reaproveita o backend atual:
                  jobs locais para react video e agente `/flow` para criacao multimodal.
                </p>
              </section>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
