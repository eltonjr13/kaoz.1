import type { ImageGenerationOperation } from "@/src/providers/flow/ImageGenerationContract";

export type FlowImageAspectRatio = "16:9" | "4:3" | "1:1" | "3:4" | "9:16";

const MAX_CORE_PROMPT_WORDS = 260;
const MAX_FINAL_PROMPT_WORDS = 320;

const UNREQUESTED_CREATIVE_FORMAT_TERMS = [
  "ugc",
  "user-generated content",
  "user generated content",
  "selfie",
  "influencer",
  "tiktok",
  "instagram reel",
  "testimonial",
  "phone camera",
  "smartphone camera",
  "handheld phone",
  "ad creative",
];

const OPERATION_INSTRUCTIONS: Record<ImageGenerationOperation, string> = {
  simple: [
    "Write a complete standalone text-to-image prompt.",
    "Do not mention an attached image or visual reference.",
  ].join(" "),
  reference: [
    "The attached image is a visual ingredient for the main subject or product.",
    "State how it should be used.",
    "Preserve identity, silhouette, proportions, colors, materials, and defining details, while changing only the pose, setting, composition, or style requested by the user.",
  ].join(" "),
  edit: [
    "This is an image edit.",
    "Lead with the exact requested change and define the preservation boundary.",
    "Keep every unrequested identity, pose, camera angle, crop, composition, lighting, color, material, and background detail unchanged.",
  ].join(" "),
  turnaround3d: [
    "This is a controlled 3D turnaround or model-sheet task.",
    "Prioritize locked character identity, orthographic camera language, one requested view per image, neutral presentation, and cross-view consistency.",
  ].join(" "),
};

const ASPECT_RATIO_INSTRUCTIONS: Record<FlowImageAspectRatio, string> = {
  "16:9": "Compose deliberately for a wide 16:9 landscape frame with a clear horizontal visual hierarchy.",
  "4:3": "Compose deliberately for a 4:3 landscape frame with balanced subject-to-environment spacing.",
  "1:1": "Compose deliberately for a square 1:1 frame with a strong central or intentionally balanced focal hierarchy.",
  "3:4": "Compose deliberately for a 3:4 portrait frame with useful vertical depth and safe margins.",
  "9:16": "Compose deliberately for a tall 9:16 portrait frame with a clear vertical hierarchy and safe margins.",
};

function normalizeIntentText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizePromptWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanPromptEnvelope(value: string): string {
  let cleaned = value.trim();
  try {
    const parsed = JSON.parse(cleaned) as { prompt?: unknown; optimizedPrompt?: unknown; message?: unknown };
    if (typeof parsed.prompt === "string") cleaned = parsed.prompt;
    else if (typeof parsed.optimizedPrompt === "string") cleaned = parsed.optimizedPrompt;
    else if (typeof parsed.message === "string") cleaned = parsed.message;
  } catch {
    // Plain text is the expected format.
  }

  return normalizePromptWhitespace(
    cleaned
      .replace(/```(?:text|markdown|plaintext|json)?/gi, "")
      .replace(/```/g, "")
      .replace(/^\s*(?:optimized image prompt|optimized prompt|prompt otimizado|final prompt)\s*:\s*/i, "")
      .replace(/^["']|["']$/g, ""),
  );
}

function countWords(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function truncateWords(value: string, maximum: number): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length <= maximum) return value;
  return `${words.slice(0, maximum).join(" ").replace(/[,:;.!?-]+$/, "")}.`;
}

function hasReferenceLanguage(prompt: string): boolean {
  return /\b(attached|reference|ingredient|source image|input image|imagem anexada|imagem de referencia|imagem de referência)\b/i.test(prompt);
}

function hasExplicitTextIntent(prompt: string): boolean {
  const normalized = normalizeIntentText(prompt);
  if (/\b(no text|without text|sem texto|sem palavras|no lettering|do not add unrequested text|no unrequested text)\b/.test(normalized)) {
    return false;
  }
  return /["“”][^"“”]{1,120}["“”]/.test(prompt)
    || /\b(text|title|headline|caption|copy|wording|lettering|typography|logo|sign reads|texto|titulo|título|legenda|frase|tipografia|logotipo)\b/i.test(prompt);
}

function appendOnce(segments: string[], segment: string, prompt: string, marker: RegExp): void {
  if (!marker.test(prompt)) segments.push(segment);
}

export function buildFlowImagePromptInstructions(input: {
  operation?: ImageGenerationOperation;
  aspectRatio?: FlowImageAspectRatio;
} = {}): string {
  const operation = input.operation || "simple";
  const aspectRatioInstruction = input.aspectRatio
    ? `Selected output frame: ${ASPECT_RATIO_INSTRUCTIONS[input.aspectRatio]}`
    : "If an aspect ratio is known, make the composition naturally fit that frame.";

  return `[PROFESSIONAL IMAGE PROMPT CONTRACT]
Apply these rules only to action.optimizedPrompt when flow is "image" and to each adCreativePlan.concepts[].visualPrompt:
- Write one cohesive English prompt, normally 60 to 180 words and never more than 240 words. Return prose, not headings, fields, JSON inside the field, or a keyword dump.
- Preserve every explicit user constraint. Never invent a brand, character, person, product feature, story, prop, written phrase, artist, commercial format, or social-media format.
- Establish the requested medium or rendering technique, then describe the concrete subject and action, exact count and spatial relationships, setting, framing and viewpoint, lighting, palette, materials or texture, atmosphere, and finish. Include only categories that improve this specific image.
- Use precise visual relationships instead of vague praise such as "amazing", "epic", "masterpiece", or a stack of generic quality terms. Camera and lens language is optional and must fit the requested medium and shot.
- Keep one coherent scene unless the user explicitly requests a collage, grid, contact sheet, split screen, or multiple panels.
- If visible wording is requested, preserve it exactly, inside quotation marks, with deliberate placement and a general typography style. Do not translate, paraphrase, shorten, or add other wording. Short copy is more reliable, but never silently alter the user's copy.
- Do not add unrequested text, captions, watermarks, signatures, logos, UI, borders, or decorative frames.
- Resolve conflicts in favor of the latest explicit user request. Do not describe the instructions or the optimization process.
Operation: ${OPERATION_INSTRUCTIONS[operation]}
${aspectRatioInstruction}`;
}

export function buildFlowImagePromptRewriteRequest(input: {
  prompt: string;
  operation?: ImageGenerationOperation;
  aspectRatio?: FlowImageAspectRatio;
}): string {
  return `You are a senior prompt engineer for Google Flow image generation.
Rewrite the source request as the strongest faithful production prompt.

${buildFlowImagePromptInstructions(input)}

Return only the final English image prompt. Do not use quotes around the whole prompt, markdown, commentary, alternatives, or JSON.

[SOURCE REQUEST]
${input.prompt.trim()}
[/SOURCE REQUEST]`;
}

export function buildFlowReferencePlanningNotice(): string {
  return `[IMAGEM DE REFERENCIA]
A imagem anexada sera enviada diretamente ao gerador de imagem como ingrediente visual. Nao tente gerar a imagem neste chat. Siga o modo de operacao definido nas instrucoes do sistema e diga no optimizedPrompt como a referencia deve ser usada. Nao presuma personagem 3D, anuncio, selfie, avatar, mudanca de estilo ou edicao se o pedido atual nao definir isso.`;
}

export function sanitizeUnrequestedCreativeFormats(sourcePrompt: string, optimizedPrompt: string): string {
  const source = normalizeIntentText(sourcePrompt);
  const blockedTerms = UNREQUESTED_CREATIVE_FORMAT_TERMS.filter(
    (term) => !source.includes(normalizeIntentText(term)),
  );
  if (blockedTerms.length === 0) return optimizedPrompt.trim();

  const clauses = optimizedPrompt
    .split(/(?:[.;]\s+|,\s+)/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const safeClauses = clauses.filter((clause) => {
    const normalizedClause = normalizeIntentText(clause);
    return !blockedTerms.some((term) => normalizedClause.includes(normalizeIntentText(term)));
  });

  if (safeClauses.length === clauses.length) return optimizedPrompt.trim();
  if (safeClauses.length === 0) return sourcePrompt.trim();

  const cleaned = safeClauses.join(", ").replace(/\s+([,.;:])/g, "$1").trim();
  return cleaned.length >= Math.min(40, optimizedPrompt.trim().length / 3)
    ? cleaned
    : sourcePrompt.trim();
}

export function buildLocalFlowImagePrompt(rawPrompt: string): string {
  const cleaned = cleanPromptEnvelope(rawPrompt);
  const normalized = normalizeIntentText(cleaned);

  let craftDirection: string;
  if (/\b(photo|photograph|photography|foto|fotografia|portrait|retrato)\b/.test(normalized)) {
    craftDirection = "Intentional photographic composition, physically coherent lighting, natural depth, realistic materials, and precise texture detail.";
  } else if (/\b(logo|logotipo|brand mark|marca)\b/.test(normalized)) {
    craftDirection = "Distinctive readable silhouette, disciplined geometry, intentional negative space, clean edges, scalable visual structure, and a controlled color system.";
  } else if (/\b(3d|render|cgi|character model|personagem)\b/.test(normalized)) {
    craftDirection = "Consistent 3D form language, coherent proportions, physically plausible materials, controlled lighting, clean silhouette, and polished surface detail.";
  } else if (/\b(illustration|illustracao|ilustracao|ilustração|drawing|desenho|painting|pintura|anime|cartoon)\b/.test(normalized)) {
    craftDirection = "Consistent illustration technique, deliberate shape language, clear value hierarchy, controlled palette, expressive detail, and a polished finish.";
  } else {
    craftDirection = "Clear focal subject, coherent setting, intentional composition, controlled lighting and color palette, consistent materials, natural depth, and polished detail.";
  }

  return `${cleaned}. ${craftDirection}`;
}

export function prepareFlowImagePrompt(input: {
  prompt: string;
  operation?: ImageGenerationOperation;
  aspectRatio?: FlowImageAspectRatio;
}): string {
  const operation = input.operation || "simple";
  let core = cleanPromptEnvelope(input.prompt);
  if (!core) return "";

  core = truncateWords(core, MAX_CORE_PROMPT_WORDS);
  const segments = [core];
  const assembledCore = core;

  if (operation === "edit") {
    segments[0] = /^edit\b/i.test(core)
      ? core
      : `Edit the attached source image. Apply this requested change: ${core}`;
    appendOnce(
      segments,
      "Keep every unrequested subject identity, pose, camera angle, crop, composition, lighting, color, material, and background detail unchanged.",
      assembledCore,
      /\bevery unrequested\b|\bkeep all other\b|\bpreserve all other\b/i,
    );
  } else if (operation === "reference") {
    if (!hasReferenceLanguage(assembledCore)) {
      segments.push("Use the attached image as the visual reference for the main subject or product.");
    }
    appendOnce(
      segments,
      "Preserve its identity, silhouette, proportions, colors, materials, and defining details; change only what the request explicitly asks to change.",
      assembledCore,
      /\bpreserve\b[\s\S]{0,100}\b(identity|silhouette|proportions|defining details)\b/i,
    );
  }

  if (input.aspectRatio && operation !== "turnaround3d") {
    appendOnce(
      segments,
      ASPECT_RATIO_INSTRUCTIONS[input.aspectRatio],
      assembledCore,
      new RegExp(input.aspectRatio.replace(":", "\\:")),
    );
  }

  if (hasExplicitTextIntent(assembledCore)) {
    appendOnce(
      segments,
      "Render only the explicitly requested wording exactly as written; do not translate, paraphrase, misspell, or add other wording.",
      assembledCore,
      /\bexactly as written\b|\bdo not translate\b/i,
    );
  } else {
    appendOnce(
      segments,
      "Do not add unrequested text, captions, watermarks, signatures, logos, UI, borders, or decorative frames.",
      assembledCore,
      /\bdo not add unrequested text\b|\bno unrequested text\b/i,
    );
  }

  const prepared = normalizePromptWhitespace(segments.join(" "));
  return countWords(prepared) > MAX_FINAL_PROMPT_WORDS
    ? truncateWords(prepared, MAX_FINAL_PROMPT_WORDS)
    : prepared;
}
