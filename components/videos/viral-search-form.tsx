"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  Camera,
  Copy,
  ExternalLink,
  Hash,
  Loader2,
  Music2,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  TrendingUp
} from "lucide-react";
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

const defaultPlatforms: ViralSearchPlatform[] = ["tiktok", "instagram", "youtube"];

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

function buildSearchPack(result: ViralSearchResult) {
  const lines = [
    `Nicho: ${result.niche}`,
    `Ideia: ${result.title}`,
    `Hook: ${result.hook}`,
    `Formato: ${result.format}`,
    `Angle: ${result.angle}`,
    "",
    ...result.platformSearches.map((entry) => `${entry.label}: ${entry.query} | ${entry.url}`)
  ];

  return lines.join("\n");
}

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand("copy");
  } catch (err) {
    console.error("Clipboard fallback failed", err);
  }
  document.body.removeChild(textarea);
  return Promise.resolve();
}

export function ViralSearchForm({ initialNiche, initialResults }: ViralSearchFormProps) {
  const [niche, setNiche] = useState(initialNiche);
  const [platforms, setPlatforms] = useState<ViralSearchPlatform[]>(defaultPlatforms);
  const [limit, setLimit] = useState(9);
  const [results, setResults] = useState(initialResults);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function togglePlatform(platform: ViralSearchPlatform) {
    setPlatforms((current) => {
      if (current.includes(platform)) {
        return current.length === 1 ? current : current.filter((item) => item !== platform);
      }

      return [...current, platform];
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsLoading(true);

    const response = await fetch("/api/viral-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche, platforms, limit })
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
    await copyToClipboard(hook);
  }

  async function copySearchPack(result: ViralSearchResult) {
    await copyToClipboard(buildSearchPack(result));
    setCopiedId(result.id);
    window.setTimeout(() => setCopiedId((current) => (current === result.id ? null : current)), 1600);
  }

  const platformSummary = platforms.map((platform) => getPlatformMeta(platform).label).join(" + ");

  return (
    <div className="search-layout">
      <form className="form-panel viral-form" onSubmit={handleSubmit}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>
          Descoberta de virais
        </div>
        <h2 style={{ margin: "0 0 8px 0" }}>Busque oportunidades para react</h2>
        <p className="field-hint" style={{ marginTop: 0 }}>
          Coloque um nicho e gere buscas prontas para YouTube, TikTok e Instagram.
        </p>

        <div className="field" style={{ marginTop: 20 }}>
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
          <label htmlFor="limit">Quantidade de ideias</label>
          <div className="limit-row">
            <input
              id="limit"
              type="range"
              min={3}
              max={12}
              step={1}
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
            />
            <strong>{limit}</strong>
          </div>
          <span className="field-hint">Mais alto para explorar, mais baixo para decidir rapido.</span>
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
          <span className="field-hint">Ativo: {platformSummary}</span>
        </div>

        {message ? <p className="form-message">{message}</p> : null}

        <div className="row-actions">
          <button className="button" type="submit" disabled={isLoading}>
            {isLoading ? <Loader2 className="spin-icon" size={18} /> : <Search size={18} />}
            {isLoading ? "Buscando" : "Buscar virais"}
          </button>
        </div>
      </form>

      <section className="results-panel" aria-label="Resultados de busca viral">
        <div className="results-header">
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Resultado da busca
            </div>
            <h2 style={{ margin: 0 }}>Oportunidades prontas para react</h2>
          </div>
          <div className="results-chip">
            <SlidersHorizontal size={16} />
            {results.length} ideias
          </div>
        </div>

        <div className="results-grid">
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

                <h3>{result.title}</h3>
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

                <div className="result-notes">
                  <p className="muted">{result.whyItWorks}</p>
                  <p className="muted">{result.reactAngle}</p>
                </div>

                <div className="search-links" aria-label="Buscas por plataforma">
                  {result.platformSearches.map((entry) => (
                    <a key={entry.platform} className="search-link" href={entry.url} target="_blank" rel="noreferrer">
                      {entry.label}
                      <ExternalLink size={14} />
                    </a>
                  ))}
                </div>

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
                  <Link className="button secondary" href={buildJobHref(result)}>
                    <Plus size={16} /> Usar no job
                  </Link>
                  <button className="button secondary" type="button" onClick={() => copyHook(result.hook)}>
                    <Copy size={16} /> Copiar hook
                  </button>
                  <button className="button secondary" type="button" onClick={() => copySearchPack(result)}>
                    <Copy size={16} /> {copiedId === result.id ? "Copiado" : "Copiar buscas"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
