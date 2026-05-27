import { ViralSearchForm } from "@/components/videos/viral-search-form";
import { searchViralVideos } from "@/lib/videos/viral-search";

export default async function ViralSearchPage() {
  const initialNiche = "frango frito delivery";
  const initialResults = await searchViralVideos({
    niche: initialNiche,
    platforms: ["instagram", "youtube"],
    limit: 10
  });

  return (
    <>
      <div className="section-title">
        <h1>Busca viral</h1>
        <p>Pesquisa por nicho para encontrar angulos, formatos e buscas prontas em Instagram e YouTube.</p>
      </div>

      <ViralSearchForm initialNiche={initialNiche} initialResults={initialResults} />
    </>
  );
}
