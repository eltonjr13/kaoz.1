export type ViralSearchPlatform = "tiktok" | "instagram" | "youtube";

export type ViralSearchInput = {
  topic?: string;
  niche?: string;
  platforms?: ViralSearchPlatform[];
  limit?: number;
  language?: string;
  intent?: "react" | "discover" | "analyze";
};

export type ViralSearchLink = {
  platform: ViralSearchPlatform;
  label: string;
  query: string;
  url: string;
};

export type ViralSearchResult = {
  id: string;
  platform: ViralSearchPlatform;
  title: string;
  niche: string;
  searchQuery: string;
  url: string;
  viralScore: number;
  platformSearches: ViralSearchLink[];
  hook: string;
  format: string;
  angle: string;
  whyItWorks: string;
  reactAngle: string;
  searchAngle: string;
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
  platform: ViralSearchPlatform;
  reactAngle: string;
};

const DEFAULT_PLATFORMS: ViralSearchPlatform[] = ["tiktok", "instagram", "youtube"];

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
    signals: ["payoff visual", "retencao alta", "comentarios de prova"],
    platform: "instagram",
    reactAngle: "Use para comparar o antes com o seu ponto de vista e manter o ritmo acelerado."
  },
  {
    title: "3 erros que travam resultado",
    hook: "Se voce faz isso em {niche}, provavelmente esta perdendo resultado.",
    format: "Lista curta com cortes a cada erro",
    angle: "Diagnostico direto para gerar salvamentos e compartilhamentos.",
    whyItWorks: "Erros especificos criam identificacao rapida e comentarios defensivos.",
    tags: ["erros", "dicas", "aprenda"],
    score: 88,
    signals: ["salvamentos", "comentarios polarizados", "educacional curto"],
    platform: "youtube",
    reactAngle: "Abre bem para react explicando qual erro mais acontece no nicho e por que ele importa."
  },
  {
    title: "Produto ou metodo em teste real",
    hook: "Comprei o item mais comentado de {niche} para ver se entrega mesmo.",
    format: "Teste honesto com cronometro e close no detalhe",
    angle: "Validacao pratica antes da audiencia gastar dinheiro.",
    whyItWorks: "Teste real reduz desconfianca e cria curiosidade ate a nota final.",
    tags: ["testereal", "review", "valeapena"],
    score: 93,
    signals: ["prova social", "intencao de compra", "comentarios pedindo link"],
    platform: "youtube",
    reactAngle: "Muito forte para react quando voce quer analisar se a promessa do video realmente entrega."
  },
  {
    title: "Mito vs realidade",
    hook: "Todo mundo fala isso sobre {niche}, mas a realidade e outra.",
    format: "Tela dividida com afirmacao e quebra de expectativa",
    angle: "Contraste entre senso comum e experiencia pratica.",
    whyItWorks: "Quebra de expectativa aumenta retencao e compartilhamento.",
    tags: ["mitos", "realidade", "trend"],
    score: 86,
    signals: ["debate", "replay", "gancho controverso"],
    platform: "tiktok",
    reactAngle: "Bom para react com opiniao forte, desde que voce entregue uma leitura clara e curta."
  },
  {
    title: "Rotina de 7 dias",
    hook: "Fiz isso por 7 dias no nicho de {niche} e mudaria so uma coisa.",
    format: "Mini vlog vertical com checkpoints diarios",
    angle: "Experimento curto com progresso claro.",
    whyItWorks: "Series curtas criam continuidade e chance de follow-up.",
    tags: ["7dias", "rotina", "experimento"],
    score: 84,
    signals: ["serie", "retorno do publico", "progresso"],
    platform: "instagram",
    reactAngle: "Funciona bem como react de acompanhamento, destacando a evolucao ou o ponto que faltou no experimento."
  },
  {
    title: "Reacao a video viral do nicho",
    hook: "Esse video de {niche} viralizou por um motivo especifico.",
    format: "React com pausa em momentos-chave",
    angle: "Explicar o motivo do viral e acrescentar opiniao propria.",
    whyItWorks: "React aproveita demanda existente e adiciona contexto novo.",
    tags: ["react", "analise", "viralizou"],
    score: 90,
    signals: ["remix", "dueto", "comentarios de opiniao"],
    platform: "tiktok",
    reactAngle: "E o formato mais direto para transformar tendencia em comentario com alta retencao."
  },
  {
    title: "Ranking do melhor do nicho",
    hook: "Separei os 3 videos de {niche} que mais valem o seu tempo agora.",
    format: "Comparativo rapido com score na tela",
    angle: "Classificacao facilita decisao e gera compartilhamento.",
    whyItWorks: "Listas ranqueadas são faceis de consumir e estimulam debate.",
    tags: ["ranking", "top3", "comparativo"],
    score: 89,
    signals: ["salvamento", "comentarios com discordancia", "alto potencial de serie"],
    platform: "youtube",
    reactAngle: "Excelente quando voce quer montar um react com opiniao e ranking no final."
  },
  {
    title: "Hot take do nicho",
    hook: "Vou falar uma coisa impopular sobre {niche} que muita gente evita dizer.",
    format: "Hook forte + tese curta + fechamento com exemplo",
    angle: "Opiniao clara com risco controlado.",
    whyItWorks: "Tese forte gera clique, retenção e conversa nos comentarios.",
    tags: ["hottake", "opiniao", "controverso"],
    score: 87,
    signals: ["debate", "comentarios longos", "replay"],
    platform: "tiktok",
    reactAngle: "Bom para react com personalidade, principalmente quando a sua leitura diverge do video original."
  },
  {
    title: "Checklist pratico",
    hook: "Se o seu video de {niche} nao tem esses 3 pontos, ele provavelmente para cedo.",
    format: "Checklist em tela com ritmo alto",
    angle: "Didatico e acionavel, bom para educar enquanto comenta.",
    whyItWorks: "Checklist reduz atrito e passa sensação de utilidade imediata.",
    tags: ["checklist", "passoapasso", "guia"],
    score: 85,
    signals: ["salvamentos", "tempo de tela", "volta para revisar"],
    platform: "instagram",
    reactAngle: "Funciona muito bem para react que ensina enquanto analisa a peça principal."
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
    platform === "tiktok"
      ? "trend viral"
      : platform === "youtube"
        ? "shorts viral"
        : "reels viral";

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

function buildPlatformSearches(
  niche: string,
  pattern: Pattern,
  selectedPlatforms: ViralSearchPlatform[],
  hashtags: string[]
): ViralSearchLink[] {
  return selectedPlatforms.map((platform) => {
    const query = buildSearchQuery(niche, pattern, platform);
    return {
      platform,
      label: platform === "tiktok" ? "TikTok" : platform === "youtube" ? "YouTube" : "Instagram",
      query,
      url: buildUrl(platform, query, hashtags)
    };
  });
}

function stableOffset(value: string) {
  return Array.from(value).reduce((total, char) => total + char.charCodeAt(0), 0) % 8;
}

function buildResult({
  niche,
  pattern,
  index,
  selectedPlatforms
}: {
  niche: string;
  pattern: Pattern;
  index: number;
  selectedPlatforms: ViralSearchPlatform[];
}): ViralSearchResult {
  const keywords = getKeywords(niche);
  const platformTag =
    pattern.platform === "tiktok" ? "tiktokbrasil" : pattern.platform === "youtube" ? "shortsbrasil" : "reelsbrasil";
  const hashtags = Array.from(new Set([toHashtag(niche), ...keywords.map(toHashtag), ...pattern.tags, platformTag]))
    .filter(Boolean)
    .slice(0, 7)
    .map((tag) => `#${tag}`);

  const searchQuery = buildSearchQuery(niche, pattern, pattern.platform);
  const selectedSearches = buildPlatformSearches(niche, pattern, selectedPlatforms, hashtags);
  const platformBoost = pattern.platform === "tiktok" ? 2 : pattern.platform === "youtube" ? 1 : 0;
  const viralScore = Math.min(99, pattern.score + platformBoost + stableOffset(`${niche}-${pattern.platform}-${pattern.title}`));

  return {
    id: `${pattern.platform}-${index}-${toHashtag(niche) || "nicho"}`,
    platform: pattern.platform,
    title: pattern.title.replace("{niche}", niche),
    niche,
    searchQuery,
    url: buildUrl(pattern.platform, searchQuery, hashtags),
    viralScore,
    platformSearches: selectedSearches,
    hook: pattern.hook.replace("{niche}", niche),
    format: pattern.format,
    angle: pattern.angle,
    whyItWorks: pattern.whyItWorks,
    reactAngle: pattern.reactAngle,
    searchAngle: `Melhor encaixe em ${pattern.platform === "tiktok" ? "TikTok" : pattern.platform === "youtube" ? "YouTube" : "Instagram"}.`,
    hashtags,
    metrics: {
      velocity: viralScore >= 94 ? "muito alta" : viralScore >= 89 ? "alta" : "media",
      competition: viralScore >= 94 ? "alta" : "media",
      remixPotential: pattern.tags.includes("react") || pattern.tags.includes("dueto") ? "muito alto" : "alto"
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
  const supportedPatterns = PATTERNS.filter((pattern) => platforms.includes(pattern.platform));
  const results = supportedPatterns.map((pattern, index) =>
    buildResult({
      niche,
      pattern,
      index,
      selectedPlatforms: platforms
    })
  );

  return results.sort((a, b) => b.viralScore - a.viralScore).slice(0, limit);
}
