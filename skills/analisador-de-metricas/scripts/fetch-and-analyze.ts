/// <reference types="node" />

export {};

// Script que recebe a URL de um vídeo (YouTube, TikTok ou Instagram),
// extrai as métricas via scraping da página pública e roda a análise
// de engajamento/retenção automaticamente.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ── Tipos ──────────────────────────────────────────────────────────
interface RawMetrics {
  visualizacoes: number;
  curtidas: number;
  comentarios: number;
  compartilhamentos: number;
  salvamentos: number;
  duracaoSegundos: number;
  tempoRetencaoMedio: number;
  plataforma: string;
  titulo: string;
}

// ── Helpers genéricos ──────────────────────────────────────────────
function firstNumber(pattern: RegExp, text: string): number {
  const m = text.match(pattern);
  if (!m) return 0;
  return parseHumanNumber(m[1]);
}

function parseHumanNumber(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[,.\s]/g, "").trim();
  // Handle K / M / B suffixes (case-insensitive)
  const suffixMatch = raw.trim().match(/^([\d.,]+)\s*([KkMmBb])?$/);
  if (suffixMatch) {
    const base = parseFloat(suffixMatch[1].replace(",", "."));
    const suffix = (suffixMatch[2] || "").toUpperCase();
    if (suffix === "K") return Math.round(base * 1_000);
    if (suffix === "M") return Math.round(base * 1_000_000);
    if (suffix === "B") return Math.round(base * 1_000_000_000);
    return Math.round(base);
  }
  return parseInt(cleaned, 10) || 0;
}

function parseDuration(text: string): number {
  // ISO 8601: PT1M30S, PT2H15M, PT45S
  const iso = text.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (iso) {
    return (parseInt(iso[1] || "0") * 3600) +
           (parseInt(iso[2] || "0") * 60) +
           (parseInt(iso[3] || "0"));
  }
  // MM:SS or HH:MM:SS
  const parts = text.match(/(\d+):(\d+)(?::(\d+))?/);
  if (parts) {
    if (parts[3]) {
      return parseInt(parts[1]) * 3600 + parseInt(parts[2]) * 60 + parseInt(parts[3]);
    }
    return parseInt(parts[1]) * 60 + parseInt(parts[2]);
  }
  // Plain seconds
  const secs = text.match(/(\d+)\s*s(?:egundo|ec)?/i);
  if (secs) return parseInt(secs[1]);
  return 0;
}

function detectPlatform(url: string): "youtube" | "tiktok" | "instagram" | "unknown" {
  if (/youtu\.?be/i.test(url)) return "youtube";
  if (/tiktok\.com/i.test(url)) return "tiktok";
  if (/instagram\.com/i.test(url)) return "instagram";
  return "unknown";
}

// ── Fetcher comum ──────────────────────────────────────────────────
async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao acessar ${url}`);
  return res.text();
}

// ── YouTube ────────────────────────────────────────────────────────
async function extractYouTube(url: string): Promise<RawMetrics> {
  // Normalizar URL
  const videoId =
    url.match(/(?:v=|\/shorts\/|youtu\.be\/)([\w-]{11})/)?.[1];
  if (!videoId) throw new Error("Não foi possível extrair o ID do vídeo do YouTube.");

  const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const html = await fetchPage(pageUrl);

  // Tentar extrair do JSON-LD (mais confiável)
  const ldJson = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  let views = 0, likes = 0, comments = 0, duration = 0, titulo = "";

  if (ldJson) {
    try {
      const data = JSON.parse(ldJson[1]);
      views = parseInt(data.interactionStatistic?.find?.((s: any) =>
        s.interactionType?.["@type"] === "WatchAction"
      )?.userInteractionCount || "0");
      titulo = data.name || "";
      duration = parseDuration(data.duration || "");
    } catch { /* fallback abaixo */ }
  }

  // Fallback: regex no HTML
  if (!views) {
    views = firstNumber(/\"viewCount\"\s*:\s*\"?(\d+)\"?/, html);
  }
  if (!titulo) {
    titulo = html.match(/<title>(.*?)<\/title>/)?.[1]?.replace(/ - YouTube$/, "").trim() || "";
  }
  if (!duration) {
    const dur = html.match(/\"lengthSeconds\"\s*:\s*\"?(\d+)\"?/);
    if (dur) duration = parseInt(dur[1]);
  }

  // Likes (YouTube esconde às vezes)
  const likesMatch = html.match(/\"defaultText\"\s*:\s*\{[^}]*\"simpleText\"\s*:\s*\"([\d.,KkMm]+)\s*\"?\}/);
  if (likesMatch) likes = parseHumanNumber(likesMatch[1]);
  if (!likes) likes = firstNumber(/like-button[^>]*?aria-label="([\d.,KkMm]+)/, html);

  // Comentários
  comments = firstNumber(/\"commentCount\"\s*:\s*\"?(\d+)\"?/, html);

  // YouTube não expõe compartilhamentos/salvamentos publicamente
  return {
    visualizacoes: views,
    curtidas: likes,
    comentarios: comments,
    compartilhamentos: 0,
    salvamentos: 0,
    duracaoSegundos: duration || 60,
    tempoRetencaoMedio: Math.round((duration || 60) * 0.4), // Estimativa conservadora de 40%
    plataforma: "YouTube",
    titulo,
  };
}

// ── TikTok ─────────────────────────────────────────────────────────
async function extractTikTok(url: string): Promise<RawMetrics> {
  const html = await fetchPage(url);

  // TikTok injeta dados no __UNIVERSAL_DATA_FOR_REHYDRATION__ ou SIGI_STATE
  let views = 0, likes = 0, comments = 0, shares = 0, duration = 0, titulo = "";

  // Tentar JSON embutido
  const jsonMatch = html.match(/"statsV2"\s*:\s*\{([^}]+)\}/);
  if (jsonMatch) {
    const block = jsonMatch[1];
    views = firstNumber(/\"playCount\"\s*:\s*\"?(\d+)/, block);
    likes = firstNumber(/\"diggCount\"\s*:\s*\"?(\d+)/, block);
    comments = firstNumber(/\"commentCount\"\s*:\s*\"?(\d+)/, block);
    shares = firstNumber(/\"shareCount\"\s*:\s*\"?(\d+)/, block);
  }

  // Fallback: meta tags
  if (!views) {
    const metaViews = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/)
    if (metaViews) {
      views = firstNumber(/([\d.,KkMm]+)\s*(?:Likes|views|visualiza)/i, metaViews[1]);
      likes = firstNumber(/([\d.,KkMm]+)\s*Likes/i, metaViews[1]);
    }
  }

  // Duração
  const durMatch = html.match(/\"duration\"\s*:\s*(\d+)/);
  if (durMatch) duration = parseInt(durMatch[1]);

  // Título
  const titleMatch = html.match(/<title>(.*?)<\/title>/);
  titulo = titleMatch?.[1]?.replace(/ \| TikTok$/, "").trim() || "";

  return {
    visualizacoes: views,
    curtidas: likes,
    comentarios: comments,
    compartilhamentos: shares,
    salvamentos: 0,
    duracaoSegundos: duration || 30,
    tempoRetencaoMedio: Math.round((duration || 30) * 0.4),
    plataforma: "TikTok",
    titulo,
  };
}

// ── Instagram ──────────────────────────────────────────────────────
async function extractInstagram(url: string): Promise<RawMetrics> {
  // Limpar parâmetros de tracking da URL
  const cleanUrl = url.split("?")[0];

  let views = 0, likes = 0, comments = 0, titulo = "";

  // 1. Tentar o endpoint oEmbed público (funciona sem login)
  try {
    const oembedUrl = `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(cleanUrl)}`;
    const oembedRes = await fetch(oembedUrl, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (oembedRes.ok) {
      const data = await oembedRes.json() as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
      };
      titulo = data.title || "";
      // O título do oEmbed muitas vezes contém contagem: "272 likes, 10 comments - author on Instagram"
      likes = firstNumber(/([\d.,KkMm]+)\s*(?:likes|curtidas)/i, titulo);
      comments = firstNumber(/([\d.,KkMm]+)\s*(?:comments|coment)/i, titulo);
    }
  } catch { /* oEmbed indisponível, prosseguir */ }

  // 2. Fallback: tentar scraping da página com headers melhores
  if (!likes && !comments) {
    try {
      const res = await fetch(cleanUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
        },
        redirect: "follow",
      });
      if (res.ok) {
        const html = await res.text();
        const descMeta = html.match(/<meta[^>]*(?:property|name)="(?:og:description|description)"[^>]*content="([^"]*)"/);
        if (descMeta) {
          const desc = descMeta[1];
          likes = likes || firstNumber(/([\d.,KkMm]+)\s*(?:likes|curtidas)/i, desc);
          comments = comments || firstNumber(/([\d.,KkMm]+)\s*(?:comments|coment)/i, desc);
          views = firstNumber(/([\d.,KkMm]+)\s*(?:views|visualiza|plays)/i, desc);
        }
        if (!titulo) {
          const titleMatch = html.match(/<title>(.*?)<\/title>/);
          titulo = titleMatch?.[1]?.trim() || "";
        }
      }
    } catch { /* scraping falhou */ }
  }

  // Se não conseguiu extrair nenhuma métrica, lançar erro informativo
  if (!likes && !comments && !views) {
    throw new Error(
      "O Instagram bloqueou a extração de métricas deste Reel (a página retorna vazia para requests sem login). " +
      "Alternativa: forneça as métricas manualmente usando a ferramenta 'skill:analisador-de-metricas:calcular' com os valores de visualizações, curtidas, comentários, compartilhamentos, salvamentos, duração e retenção."
    );
  }

  return {
    visualizacoes: views || likes * 10, // Estimativa se views não disponível
    curtidas: likes,
    comentarios: comments,
    compartilhamentos: 0,
    salvamentos: 0,
    duracaoSegundos: 30,
    tempoRetencaoMedio: 12,
    plataforma: "Instagram",
    titulo,
  };
}

// ── Análise (reutiliza a lógica do analyze-metrics.ts) ─────────────
function runAnalysis(m: RawMetrics) {
  const interacoesTotais = m.curtidas + m.comentarios + m.compartilhamentos + m.salvamentos;
  const taxaEngajamento = (interacoesTotais / m.visualizacoes) * 100;
  const taxaRetencao = (m.tempoRetencaoMedio / m.duracaoSegundos) * 100;
  const taxaCompartilhamento = (m.compartilhamentos / m.visualizacoes) * 100;
  const taxaSalvamento = (m.salvamentos / m.visualizacoes) * 100;

  let classificacaoEngajamento = "Regular";
  if (taxaEngajamento >= 10) classificacaoEngajamento = "Excelente";
  else if (taxaEngajamento >= 5) classificacaoEngajamento = "Bom";
  else if (taxaEngajamento >= 2) classificacaoEngajamento = "Médio";
  else classificacaoEngajamento = "Baixo";

  let classificacaoRetencao = "Regular";
  if (taxaRetencao >= 60) classificacaoRetencao = "Viral";
  else if (taxaRetencao >= 40) classificacaoRetencao = "Bom";
  else if (taxaRetencao >= 25) classificacaoRetencao = "Médio";
  else classificacaoRetencao = "Crítico";

  const recomendacoes: string[] = [];
  if (taxaRetencao < 40) {
    recomendacoes.push("O gancho inicial do vídeo (primeiros 3 segundos) pode estar fraco. Melhore com legendas dinâmicas, cortes rápidos e títulos instigantes.");
  }
  if (taxaEngajamento < 4) {
    recomendacoes.push("Taxa de interação baixa. Adicione uma Call to Action (CTA) clara ao final do vídeo e na legenda.");
  }
  if (taxaSalvamento < 0.5) {
    recomendacoes.push("Produza conteúdos que o espectador queira salvar: tutoriais, listas, dicas práticas.");
  }
  if (taxaCompartilhamento < 0.5) {
    recomendacoes.push("Crie ganchos de identificação, memes do nicho ou resolva dores imediatas para incentivar compartilhamentos.");
  }
  if (recomendacoes.length === 0) {
    recomendacoes.push("Excelente performance geral! Mantenha a consistência desta estrutura de vídeo.");
  }

  return {
    metricas: {
      taxaEngajamento: Number(taxaEngajamento.toFixed(2)),
      classificacaoEngajamento,
      taxaRetencao: Number(taxaRetencao.toFixed(2)),
      classificacaoRetencao,
      taxaCompartilhamento: Number(taxaCompartilhamento.toFixed(2)),
      taxaSalvamento: Number(taxaSalvamento.toFixed(2)),
    },
    diagnostico: {
      resumo: `Vídeo com taxa de engajamento de ${taxaEngajamento.toFixed(2)}% (${classificacaoEngajamento}) e retenção estimada de ${taxaRetencao.toFixed(2)}% (${classificacaoRetencao}).`,
      recomendacoes,
    },
  };
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  try {
    const rawArgs = process.env.KAOZ_SKILL_ARGS || "{}";
    const args = JSON.parse(rawArgs);
    const url: string = args.url;

    if (!url || typeof url !== "string") {
      throw new Error("O parâmetro 'url' é obrigatório. Passe o link do vídeo (YouTube, TikTok ou Instagram).");
    }

    const platform = detectPlatform(url);
    let raw: RawMetrics;

    switch (platform) {
      case "youtube":
        raw = await extractYouTube(url);
        break;
      case "tiktok":
        raw = await extractTikTok(url);
        break;
      case "instagram":
        raw = await extractInstagram(url);
        break;
      default:
        throw new Error(`Plataforma não suportada. Envie um link do YouTube, TikTok ou Instagram. URL recebida: ${url}`);
    }

    if (raw.visualizacoes === 0) {
      throw new Error(`Não foi possível extrair métricas da página. A plataforma (${raw.plataforma}) pode estar bloqueando o acesso ou o vídeo é privado.`);
    }

    const analysis = runAnalysis(raw);

    const resultado = {
      sucesso: true,
      plataforma: raw.plataforma,
      titulo: raw.titulo,
      dadosExtraidos: {
        visualizacoes: raw.visualizacoes,
        curtidas: raw.curtidas,
        comentarios: raw.comentarios,
        compartilhamentos: raw.compartilhamentos,
        salvamentos: raw.salvamentos,
        duracaoSegundos: raw.duracaoSegundos,
        tempoRetencaoMedio: raw.tempoRetencaoMedio,
      },
      ...analysis,
      avisos: [
        raw.compartilhamentos === 0 ? "Compartilhamentos não disponíveis publicamente nesta plataforma." : null,
        raw.salvamentos === 0 ? "Salvamentos não disponíveis publicamente nesta plataforma." : null,
        "A retenção é estimada (40% da duração) pois não é exposta publicamente.",
      ].filter(Boolean),
    };

    console.log(JSON.stringify(resultado));
  } catch (e: any) {
    console.error(e.message);
    process.exitCode = 1;
  }
}

main();
