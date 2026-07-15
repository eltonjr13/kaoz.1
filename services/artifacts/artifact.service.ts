import crypto from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ArtifactType, ExecutionArtifact } from "../orchestrator/orchestrator.types";
import { assertSafeWorkspacePath } from "../orchestrator/orchestrator.policy.ts";

const ARTIFACT_ROOT = path.join(process.cwd(), ".generated", "artifacts");
const MAX_TEXT_ARTIFACT_BYTES = 5 * 1024 * 1024;

export type TextArtifactFormat = "markdown" | "pdf" | "text" | "json" | "csv" | "html";

type StoredArtifactManifest = {
  artifact: ExecutionArtifact;
  storedName: string;
};

const FORMAT_CONFIG: Record<TextArtifactFormat, { extension: string; mimeType: string; type: ArtifactType }> = {
  markdown: { extension: ".md", mimeType: "text/markdown; charset=utf-8", type: "markdown" },
  pdf: { extension: ".pdf", mimeType: "application/pdf", type: "pdf" },
  text: { extension: ".txt", mimeType: "text/plain; charset=utf-8", type: "text" },
  json: { extension: ".json", mimeType: "application/json; charset=utf-8", type: "json" },
  csv: { extension: ".csv", mimeType: "text/csv; charset=utf-8", type: "csv" },
  html: { extension: ".html", mimeType: "text/html; charset=utf-8", type: "html" },
};

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function uniqueFormats(formats: TextArtifactFormat[]): TextArtifactFormat[] {
  return [...new Set(formats)];
}

export function inferRequestedArtifactFormats(requestText: string, skillHint = ""): TextArtifactFormat[] {
  const request = normalizeText(requestText);
  const hint = normalizeText(skillHint);
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

function safeBaseName(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || "documento";
}

function inferBaseName(requestText: string, content: string): string {
  const command = requestText.match(/^\s*\/([a-z0-9.-]+)/i)?.[1];
  if (command) return safeBaseName(command);
  const heading = content.match(/^#{1,3}\s+(.+)$/m)?.[1];
  return safeBaseName(heading || requestText.slice(0, 80));
}

function extractFencedContent(content: string, language: string): string | null {
  const match = content.match(new RegExp("```" + language + "\\s*([\\s\\S]*?)```", "i"));
  return match?.[1]?.trim() || null;
}

function contentForFormat(content: string, format: TextArtifactFormat): string {
  if (format === "json") {
    const candidate = extractFencedContent(content, "json") || content.trim();
    try {
      return `${JSON.stringify(JSON.parse(candidate), null, 2)}\n`;
    } catch {
      return `${JSON.stringify({ content }, null, 2)}\n`;
    }
  }
  if (format === "csv") return `${extractFencedContent(content, "csv") || content.trim()}\n`;
  if (format === "html") {
    const html = extractFencedContent(content, "html");
    if (html) return html;
    const escaped = content.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Documento</title></head><body><pre>${escaped}</pre></body></html>`;
  }
  return content.endsWith("\n") ? content : `${content}\n`;
}

async function atomicWrite(file: string, data: Uint8Array | string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, file);
}

function normalizePdfText(value: string): string {
  return value
    .replace(/[✅☑✔]/g, "[x]")
    .replace(/[❌✖]/g, "[ ]")
    .replace(/[→➜➡]/g, "->")
    .replace(/[←⬅]/g, "<-")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function fontSafeText(value: string, font: PDFFont): string {
  let result = "";
  for (const character of normalizePdfText(value)) {
    try {
      font.encodeText(character);
      result += character;
    } catch {
      if (/\s/.test(character)) result += character;
    }
  }
  return result;
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/^>\s?/, "")
    .trimEnd();
}

function wrapPdfLine(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safe = fontSafeText(text, font);
  if (!safe) return [""];
  const words = safe.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word;
      continue;
    }
    let fragment = "";
    for (const char of word) {
      if (font.widthOfTextAtSize(`${fragment}${char}`, size) > maxWidth && fragment) {
        lines.push(fragment);
        fragment = char;
      } else fragment += char;
    }
    current = fragment;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

async function markdownToPdf(markdown: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 48;
  const bottom = 48;
  let page: PDFPage = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  let inCodeBlock = false;

  const newPage = () => {
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };

  for (const rawLine of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(rawLine)) {
      inCodeBlock = !inCodeBlock;
      y -= 5;
      continue;
    }
    const heading = rawLine.match(/^(#{1,3})\s+(.+)$/);
    const bullet = rawLine.match(/^\s*[-*+]\s+(.+)$/);
    const numbered = rawLine.match(/^\s*(\d+[.)])\s+(.+)$/);
    const font = inCodeBlock ? mono : heading ? bold : regular;
    const size = heading ? (heading[1].length === 1 ? 20 : heading[1].length === 2 ? 16 : 13) : inCodeBlock ? 9 : 11;
    const indent = bullet || numbered ? 14 : 0;
    const prefix = bullet ? "- " : numbered ? `${numbered[1]} ` : "";
    const source = heading ? heading[2] : bullet ? bullet[1] : numbered ? numbered[2] : rawLine;
    const clean = stripInlineMarkdown(source);
    const lines = clean ? wrapPdfLine(`${prefix}${clean}`, font, size, pageWidth - (margin * 2) - indent) : [""];
    const lineHeight = size * 1.35;
    const before = heading ? 8 : 0;
    if (y - before - (lines.length * lineHeight) < bottom) newPage();
    y -= before;
    for (const line of lines) {
      if (y - lineHeight < bottom) newPage();
      if (line) page.drawText(line, { x: margin + indent, y, size, font, color: rgb(0.12, 0.12, 0.14) });
      y -= lineHeight;
    }
    y -= heading ? 5 : clean ? 2 : 5;
  }

  const pages = pdf.getPages();
  pages.forEach((current, index) => {
    const label = `${index + 1} / ${pages.length}`;
    current.drawText(label, { x: pageWidth - margin - regular.widthOfTextAtSize(label, 8), y: 24, size: 8, font: regular, color: rgb(0.45, 0.45, 0.5) });
  });
  return pdf.save();
}

async function storeArtifact(params: {
  data: Uint8Array | string;
  name: string;
  type: ArtifactType;
  mimeType: string;
  metadata?: Record<string, unknown>;
}): Promise<ExecutionArtifact> {
  const size = typeof params.data === "string" ? Buffer.byteLength(params.data) : params.data.byteLength;
  if (size > MAX_TEXT_ARTIFACT_BYTES && params.mimeType.startsWith("text/")) throw new Error("Artefato de texto excede o limite de 5 MB.");
  const id = crypto.randomUUID();
  const directory = path.join(ARTIFACT_ROOT, id);
  const storedName = path.basename(params.name).replace(/[^a-zA-Z0-9._-]/g, "-") || "artifact.bin";
  await atomicWrite(path.join(directory, storedName), params.data);
  const artifact: ExecutionArtifact = {
    id,
    type: params.type,
    name: params.name,
    url: `/api/artifacts/${id}`,
    mimeType: params.mimeType,
    size,
    previewAvailable: isPreviewableMimeType(params.mimeType),
    createdAt: new Date().toISOString(),
    metadata: params.metadata,
  };
  await atomicWrite(path.join(directory, "manifest.json"), `${JSON.stringify({ artifact, storedName } satisfies StoredArtifactManifest, null, 2)}\n`);
  return artifact;
}

export async function registerContentArtifact(params: {
  content: string | Uint8Array;
  name: string;
  type?: ArtifactType;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}): Promise<ExecutionArtifact> {
  const mimeType = params.mimeType || mimeTypeFromName(params.name);
  return storeArtifact({
    data: params.content,
    name: params.name,
    type: params.type || artifactTypeFromMime(mimeType),
    mimeType,
    metadata: params.metadata,
  });
}

export function isPreviewableMimeType(mimeType = ""): boolean {
  return mimeType === "application/pdf" || mimeType.startsWith("text/") || mimeType.startsWith("application/json");
}

export async function materializeResponseArtifacts(params: {
  requestText: string;
  content: string;
  skillHint?: string;
  sessionId?: string;
}): Promise<ExecutionArtifact[]> {
  const formats = inferRequestedArtifactFormats(params.requestText, params.skillHint);
  if (!formats.length || !params.content.trim()) return [];
  const baseName = inferBaseName(params.requestText, params.content);
  return Promise.all(formats.map(async (format) => {
    const config = FORMAT_CONFIG[format];
    const name = `${baseName}${config.extension}`;
    const data = format === "pdf" ? await markdownToPdf(params.content) : contentForFormat(params.content, format);
    return storeArtifact({ data, name, type: config.type, mimeType: config.mimeType, metadata: { sessionId: params.sessionId, source: "flow-response" } });
  }));
}

export async function registerExistingArtifact(params: {
  path: string;
  name?: string;
  type?: ArtifactType;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}): Promise<ExecutionArtifact> {
  const absolute = assertSafeWorkspacePath(params.path);
  const file = await readFile(absolute);
  const details = await stat(absolute);
  if (!details.isFile()) throw new Error("O artefato informado não é um arquivo.");
  const name = params.name || path.basename(absolute);
  const mimeType = params.mimeType || mimeTypeFromName(name);
  return storeArtifact({ data: file, name, type: params.type || artifactTypeFromMime(mimeType), mimeType, metadata: params.metadata });
}

export async function readStoredArtifact(id: string): Promise<{ artifact: ExecutionArtifact; content: Buffer }> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Identificador de artefato inválido.");
  const directory = path.join(ARTIFACT_ROOT, id);
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as StoredArtifactManifest;
  const storedName = path.basename(manifest.storedName);
  const content = await readFile(path.join(directory, storedName));
  return { artifact: manifest.artifact, content };
}

export function mimeTypeFromName(name: string): string {
  const extension = path.extname(name).toLowerCase();
  return ({
    ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".csv": "text/csv; charset=utf-8", ".html": "text/html; charset=utf-8", ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  } as Record<string, string>)[extension] || "application/octet-stream";
}

function artifactTypeFromMime(mimeType: string): ArtifactType {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("text/markdown")) return "markdown";
  if (mimeType.startsWith("application/json")) return "json";
  if (mimeType.startsWith("text/csv")) return "csv";
  if (mimeType.startsWith("text/html")) return "html";
  if (mimeType.startsWith("text/")) return "text";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (/document|sheet|word|excel/.test(mimeType)) return "document";
  return "file";
}
