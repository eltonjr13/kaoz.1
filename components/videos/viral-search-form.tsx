"use client";

import { useState } from "react";
import Link from "next/link";
import { Camera, Copy, ExternalLink, Hash, Loader2, Music2, Play, Plus, Search, TrendingUp } from "lucide-react";
import type { ViralSearchPlatform, ViralSearchResult } from "@/lib/videos/viral-search";

type ViralSearchFormProps = {
  initialNiche: string;
  initialResults: ViralSearchResult[];
};

const platformOptions: { value: ViralSearchPlatform; label: string; icon: typeof Search }[] = [
  { value: "tiktok", label: "TikTok", icon: Music2 },
  { value: "instagram", label: "Instagram", icon: Camera },
  { value: "youtube", label: "YouTube", icon: Play }
];

const collagePlatforms = new Set<ViralSearchPlatform>(["instagram", "youtube"]);

function getPlatformMeta(platform: ViralSearchPlatform) {
  if (platform === "tiktok") {
    return { label: "TikTok", icon: Music2 };
  }

  if (platform === "youtube") {
    return { label: "YouTube", icon: Play };
  }

  return { label: "Instagram", icon: Camera };
}

function buildJobHref(result: ViralSearchResult) {
  const params = new URLSearchParams({
    topic: result.hook,
    sourceVideoTitle: result.title
  });

  return `/jobs/new?${params.toString()}`;
}

export function ViralSearchForm({ initialNiche, initialResults }: ViralSearchFormProps) {
  const [niche, setNiche] = useState(initialNiche);
  const [platforms, setPlatforms] = useState<ViralSearchPlatform[]>(["instagram", "youtube"]);
  const [results, setResults] = useState(initialResults);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  function togglePlatform(platform: ViralSearchPlatform) {
    setPlatforms((current) => {
      if (current.includes(platform)) {
        return current.length === 1 ? current : current.filter((item) => item !== platform);
      }

      return [...current, platform];
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsLoading(true);

    const response = await fetch("/api/viral-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche, platforms, limit: 10 })
    });

    const payload = (await response.json()) as { results?: ViralSearchResult[]; error?: string };
    setIsLoading(false);

    if (!response.ok || !payload.results) {
      setMessage(payload.error ?? "Nao foi possivel buscar referencias.");
      return;
    }

    setResults(payload.results);
  }

  async function copyHook(hook: string) {
    await navigator.clipboard.writeText(hook);
  }

  return (
    <div className="search-layout">
      <form className="form-panel viral-form" onSubmit={handleSubmit}>
        <div className="field" style={{ marginTop: 0 }}>
          <label htmlFor="niche">Nicho</label>
          <input
            id="niche"
            value={niche}
            onChange={(event) => setNiche(event.target.value)}
            placeholder="Ex: frango frito delivery, moda fitness, maquiagem..."
            required
          />
        </div>

        <div className="field">
          <label>Plataformas</label>
          <div className="platforms-grid">
            {platformOptions.map((option) => {
              const Icon = option.icon;
              const isActive = platforms.includes(option.value);

              return (
                <button
                  className={`platform-toggle ${isActive ? "active" : ""}`}
                  type="button"
                  onClick={() => togglePlatform(option.value)}
                  key={option.value}
                >
                  <Icon size={18} />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        {message ? <p className="form-message">{message}</p> : null}

        <div className="row-actions">
          <button className="button" type="submit" disabled={isLoading}>
            {isLoading ? <Loader2 className="spin-icon" size={18} /> : <Search size={18} />}
            {isLoading ? "Buscando" : "Buscar virais"}
          </button>
        </div>
      </form>

      <section className="results-grid" aria-label="Resultados de busca viral">
        {results.map((result) => {
          const platform = getPlatformMeta(result.platform);
          const PlatformIcon = platform.icon;

          return (
            <article className="result-card" key={result.id}>
              <div className="result-card-head">
                <span className={`platform-badge ${result.platform}`}>
                  <PlatformIcon size={15} />
                  {platform.label}
                </span>
                <span className="score-pill">
                  <TrendingUp size={15} />
                  {result.viralScore}
                </span>
              </div>

              <h2>{result.title}</h2>
              <p className="result-hook">{result.hook}</p>

              <div className="result-meta">
                <div>
                  <span>Formato</span>
                  <strong>{result.format}</strong>
                </div>
                <div>
                  <span>Velocidade</span>
                  <strong>{result.metrics.velocity}</strong>
                </div>
                <div>
                  <span>Remix</span>
                  <strong>{result.metrics.remixPotential}</strong>
                </div>
              </div>

              <p className="muted">{result.whyItWorks}</p>

              <div className="tag-list" aria-label="Hashtags sugeridas">
                {result.hashtags.map((tag) => (
                  <span key={tag}>
                    <Hash size={13} />
                    {tag.replace("#", "")}
                  </span>
                ))}
              </div>

              <div className="signal-list">
                {result.signals.map((signal) => (
                  <span key={signal}>{signal}</span>
                ))}
              </div>

              <div className="row-actions result-actions">
                <a className="button secondary" href={result.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} /> Abrir busca
                </a>
                {collagePlatforms.has(result.platform) ? (
                  <Link className="button secondary" href={buildJobHref(result)}>
                    <Plus size={16} /> Usar no job
                  </Link>
                ) : null}
                <button className="button secondary" type="button" onClick={() => copyHook(result.hook)}>
                  <Copy size={16} /> Copiar hook
                </button>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
