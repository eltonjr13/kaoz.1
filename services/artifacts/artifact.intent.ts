export type TextArtifactFormat = "markdown" | "pdf" | "text" | "json" | "csv" | "html";
export type OutputIntentKind = "conversation" | "document" | "media" | "mixed";
export type MediaFlowIntent = "image" | "video" | "project" | "ad-creative";
export type OutputIntent = {
  kind: OutputIntentKind;
  formats: TextArtifactFormat[];
  explicitMedia: boolean;
  mediaFlow?: MediaFlowIntent;
};

function normalizeIntentText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function uniqueFormats(formats: TextArtifactFormat[]): TextArtifactFormat[] {
  return [...new Set(formats)];
}

export function inferRequestedArtifactFormats(requestText: string, skillHint = ""): TextArtifactFormat[] {
  const request = normalizeIntentText(requestText);
  const hint = normalizeIntentText(skillHint);
  const slashCommand = /^\s*\/[a-z0-9.-]+(?:\s|$)/i.test(requestText);
  const creationIntent = slashCommand || /\b(gerar|gere|gera|criar|crie|cria|produzir|produza|entregar|entregue|exportar|exporte|salvar|salve|baixar|arquivo|documento|formato)\b/.test(request);
  if (!creationIntent) return [];

  const formats: TextArtifactFormat[] = [];
  const combined = `${request}\n${slashCommand ? hint : ""}`;
  if (/\bpdf\b|\.pdf\b/.test(combined)) formats.push("pdf");
  if (/\bmarkdown\b|\.md\b/.test(combined)) formats.push("markdown");
  if (/\bjson\b|\.json\b/.test(request)) formats.push("json");
  if (/\bcsv\b|\.csv\b/.test(request)) formats.push("csv");
  if (/\bhtml\b|\.html\b/.test(request)) formats.push("html");
  if (/\btxt\b|texto simples|\.txt\b/.test(request)) formats.push("text");
  return uniqueFormats(formats);
}

const MEDIA_OBJECT = "(?:imagem|imagens|foto|fotos|ilustracao|ilustracoes|desenho|desenhos|video|videos|clipe|clipes|react|thumbnail|thumbnails|logo|logos|criativo|criativos|anuncio|anuncios)";
const MEDIA_ACTION = "(?:gerar|gera|gere|criar|cria|crie|fazer|faz|faca|produzir|produza|editar|edite|alterar|altere|ajustar|ajuste|corrigir|corrija|refinar|refine|animar|anime)";
const MEDIA_DESIRE = "(?:quero|preciso|gostaria|desejo)";
const MEDIA_ACTION_PATTERN = new RegExp(`\\b${MEDIA_ACTION}\\b[^.!?\\n]{0,48}\\b${MEDIA_OBJECT}\\b|\\b${MEDIA_OBJECT}\\b[^.!?\\n]{0,32}\\b${MEDIA_ACTION}\\b|\\b${MEDIA_DESIRE}\\b[^.!?\\n]{0,32}\\b${MEDIA_OBJECT}\\b`, "i");
const DIRECT_MEDIA_COMMAND_PATTERN = new RegExp(`^\\s*${MEDIA_OBJECT}\\b`, "i");

export function hasExplicitMediaGenerationIntent(requestText: string): boolean {
  const normalized = normalizeIntentText(requestText);
  if (/\b(nao|sem)\s+(?:gerar|criar|fazer|produzir)\b[^.!?\n]{0,32}\b(?:imagem|foto|video)\b/.test(normalized)) return false;
  return MEDIA_ACTION_PATTERN.test(normalized) || DIRECT_MEDIA_COMMAND_PATTERN.test(normalized);
}

export function inferRequestedMediaFlow(requestText: string): MediaFlowIntent | undefined {
  if (!hasExplicitMediaGenerationIntent(requestText)) return undefined;
  const normalized = normalizeIntentText(requestText);
  if (/\b(anuncio|anuncios|campanha|criativo|criativos)\b/.test(normalized)) return "ad-creative";
  if (/\b(react|projeto\s+(?:completo\s+)?de\s+video)\b/.test(normalized)) return "project";
  if (/\b(video|videos|clipe|clipes)\b/.test(normalized)) return "video";
  if (/\b(imagem|imagens|foto|fotos|ilustracao|ilustracoes|desenho|desenhos|thumbnail|thumbnails|logo|logos)\b/.test(normalized)) return "image";
  return undefined;
}

export function classifyOutputIntent(requestText: string, skillHint = ""): OutputIntent {
  const formats = inferRequestedArtifactFormats(requestText, skillHint);
  const explicitMedia = hasExplicitMediaGenerationIntent(requestText);
  const mediaFlow = inferRequestedMediaFlow(requestText);
  const kind: OutputIntentKind = formats.length > 0
    ? explicitMedia ? "mixed" : "document"
    : explicitMedia ? "media" : "conversation";
  return { kind, formats, explicitMedia, mediaFlow };
}

export function allowsMediaAction(intent: OutputIntent): boolean {
  return intent.kind === "media" || intent.kind === "mixed";
}
