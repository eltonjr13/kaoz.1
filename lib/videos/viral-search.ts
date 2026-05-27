export type ViralSearchPlatform = "tiktok" | "instagram" | "youtube";

export type ViralSearchInput = {
  topic?: string;
  niche?: string;
  platforms?: ViralSearchPlatform[];
  limit?: number;
};

export type ViralSearchResult = {
  id: string;
  platform: ViralSearchPlatform;
  title: string;
  niche: string;
  searchQuery: string;
  url: string;
  viralScore: number;
  hook: string;
  format: string;
  angle: string;
  whyItWorks: string;
  hashtags: string[];
  metrics: {
    velocity: string;
    competition: string;
    remixPotential: string;
  };
  signals: string[];
};

type Pattern = {
  title: string;
  hook: string;
  format: string;
  angle: string;
  whyItWorks: string;
  tags: string[];
  score: number;
  signals: string[];
};

const DEFAULT_PLATFORMS: ViralSearchPlatform[] = ["instagram", "youtube"];

const STOPWORDS = new Set([
  "a",
  "ao",
  "as",
  "com",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "na",
  "nas",
  "no",
  "nos",
  "o",
  "os",
  "para",
  "por",
  "um",
  "uma"
]);

const PATTERNS: Pattern[] = [
  {
    title: "Antes e depois em 15 segundos",
    hook: "Eu testei isso no nicho de {niche} e o resultado aparece no final.",
    format: "Corte rapido com prova visual e legenda grande",
    angle: "Transformacao simples que parece replicavel pelo publico.",
    whyItWorks: "Conteudos com contraste visual seguram retencao ate o payoff.",
    tags: ["antesedepois", "resultado", "viral"],
    score: 91,
    signals: ["payoff visual", "retencao alta", "comentarios de prova"]
  },
  {
    title: "3 erros que travam resultado",
    hook: "Se voce faz isso em {niche}, provavelmente esta perdendo resultado.",
    format: "Lista curta com cortes a cada erro",
    angle: "Diagnostico direto para gerar salvamentos e compartilhamentos.",
    whyItWorks: "Erros especificos criam identificacao rapida e comentarios defensivos.",
    tags: ["erros", "dicas", "aprenda"],
    score: 88,
    signals: ["salvamentos", "comentarios polarizados", "educacional curto"]
  },
  {
    title: "Produto ou metodo em teste real",
    hook: "Comprei o item mais comentado de {niche} para ver se entrega mesmo.",
    format: "Teste honesto com cronometro e close no detalhe",
    angle: "Validacao pratica antes da audiencia gastar dinheiro.",
    whyItWorks: "Teste real reduz desconfianca e cria curiosidade ate a nota final.",
    tags: ["testereal", "review", "valeapena"],
    score: 93,
    signals: ["prova social", "intencao de compra", "comentarios pedindo link"]
  },
  {
    title: "Mito vs realidade",
    hook: "Todo mundo fala isso sobre {niche}, mas a realidade e outra.",
    format: "Tela dividida com afirmacao e quebra de expectativa",
    angle: "Contraste entre senso comum e experiencia pratica.",
    whyItWorks: "Quebra de expectativa aumenta retencao e compartilhamento.",
    tags: ["mitos", "realidade", "trend"],
    score: 86,
    signals: ["debate", "replay", "gancho controverso"]
  },
  {
    title: "Rotina de 7 dias",
    hook: "Fiz isso por 7 dias no nicho de {niche} e mudaria so uma coisa.",
    format: "Mini vlog vertical com checkpoints diarios",
    angle: "Experimento curto com progresso claro.",
    whyItWorks: "Series curtas criam continuidade e chance de follow-up.",
    tags: ["7dias", "rotina", "experimento"],
    score: 84,
    signals: ["serie", "retorno do publico", "progresso"]
  },
  {
    title: "Reacao a video viral do nicho",
    hook: "Esse video de {niche} viralizou por um motivo especifico.",
    format: "React com pausa em momentos-chave",
    angle: "Explicar o motivo do viral e acrescentar opiniao propria.",
    whyItWorks: "React aproveita demanda existente e adiciona contexto novo.",
    tags: ["react", "analise", "viralizou"],
    score: 90,
    signals: ["remix", "dueto", "comentarios de opiniao"]
  }
];

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getKeywords(niche: string) {
  const words = normalizeText(niche)
    .split(/[^a-z0-9]+/g)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));

  return Array.from(new Set(words)).slice(0, 4);
}

function toHashtag(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]/g, "");
}

function buildSearchQuery(niche: string, pattern: Pattern, platform: ViralSearchPlatform) {
  const platformIntent =
    platform === "tiktok" ? "trend viral" : platform === "youtube" ? "shorts viral" : "reels viral";
  return `${niche} ${platformIntent} ${pattern.tags[0]}`;
}

function buildUrl(platform: ViralSearchPlatform, searchQuery: string, hashtags: string[]) {
  if (platform === "tiktok") {
    return `https://www.tiktok.com/search?q=${encodeURIComponent(searchQuery)}`;
  }

  if (platform === "youtube") {
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
  }

  const primaryTag = hashtags[0]?.replace(/^#/, "") || toHashtag(searchQuery);
  return `https://www.instagram.com/explore/tags/${encodeURIComponent(primaryTag)}/`;
}

function stableOffset(value: string) {
  return Array.from(value).reduce((total, char) => total + char.charCodeAt(0), 0) % 8;
}

function buildResult({
  niche,
  platform,
  pattern,
  index
}: {
  niche: string;
  platform: ViralSearchPlatform;
  pattern: Pattern;
  index: number;
}): ViralSearchResult {
  const keywords = getKeywords(niche);
  const platformTag = platform === "tiktok" ? "tiktokbrasil" : platform === "youtube" ? "shortsbrasil" : "reelsbrasil";
  const hashtags = Array.from(new Set([toHashtag(niche), ...keywords.map(toHashtag), ...pattern.tags, platformTag]))
    .filter(Boolean)
    .slice(0, 7)
    .map((tag) => `#${tag}`);

  const searchQuery = buildSearchQuery(niche, pattern, platform);
  const platformBoost = platform === "tiktok" ? 2 : platform === "youtube" ? 1 : 0;
  const viralScore = Math.min(99, pattern.score + platformBoost + stableOffset(`${niche}-${platform}-${pattern.title}`));

  return {
    id: `${platform}-${index}-${toHashtag(niche) || "nicho"}`,
    platform,
    title: pattern.title.replace("{niche}", niche),
    niche,
    searchQuery,
    url: buildUrl(platform, searchQuery, hashtags),
    viralScore,
    hook: pattern.hook.replace("{niche}", niche),
    format: pattern.format,
    angle: pattern.angle,
    whyItWorks: pattern.whyItWorks,
    hashtags,
    metrics: {
      velocity: viralScore >= 94 ? "muito alta" : viralScore >= 89 ? "alta" : "media",
      competition: viralScore >= 94 ? "alta" : "media",
      remixPotential: pattern.tags.includes("react") ? "muito alto" : "alto"
    },
    signals: pattern.signals
  };
}

export async function searchViralVideos(input: ViralSearchInput): Promise<ViralSearchResult[]> {
  const niche = (input.niche ?? input.topic ?? "").trim();

  if (!niche) {
    return [];
  }

  const platforms = input.platforms?.length ? input.platforms : DEFAULT_PLATFORMS;
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);
  const results = platforms.flatMap((platform) =>
    PATTERNS.map((pattern, index) =>
      buildResult({
        niche,
        platform,
        pattern,
        index
      })
    )
  );

  return results.sort((a, b) => b.viralScore - a.viralScore).slice(0, limit);
}
