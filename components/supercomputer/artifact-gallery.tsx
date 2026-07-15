import type { ExecutionArtifact } from "@/services/orchestrator/orchestrator.types";
import { ArtifactCards } from "@/components/artifacts/artifact-viewer";

export function ArtifactGallery({ artifacts }: { artifacts: ExecutionArtifact[] }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[.025] p-5">
      <h2 className="font-semibold">Artefatos</h2>
      {artifacts.length === 0
        ? <p className="mt-3 text-sm text-white/40">Nenhum artefato produzido ainda.</p>
        : <ArtifactCards artifacts={artifacts} className="mt-4 lg:grid-cols-3" />}
    </section>
  );
}
