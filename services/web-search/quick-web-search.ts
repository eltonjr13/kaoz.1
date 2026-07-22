import { mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { getLocalDataDir } from "../../lib/runtime-paths.ts";
import type { ChatAgentResponse } from "../../lib/ai/gemini.ts";

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

type CacheEntry = {
  id: string;
  query: string;
  normalizedQuery: string;
  status: "pending" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  results: SearchResult[];
  error?: string;
};

const DATA_DIR = getLocalDataDir();
const CACHE_FILE = path.join(DATA_DIR, "quick-web-search-cache.json");
const CACHE_VERSION = "v3";
const CACHE_TTL_MS = 10 * 60 * 1000;
const PENDING_TTL_MS = 30 * 1000;
const SEARCH_TIMEOUT_MS = 8_000;
const MAX_RESULTS = 5;

let cache: Record<string, CacheEntry> = {};
let cacheLoaded = false;
let cacheLoadPromise: Promise<void> | null = null;

function normalizeQuery(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(pesquise|pesquisar|busque|buscar|procure|procurar|para mim|pra mim|na internet|internet|google)\b/gi, " ")
    .replace(/\b(quais|qual|quem|quando|onde|como|sao|serao|os|as|um|uma|uns|umas|o|a|de|do|da|dos|das|no|na|nos|nas|por|favor)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function createSearchId(normalizedQuery: string): string {
  return crypto.createHash("sha1").update(normalizedQuery).digest("hex").slice(0, 12);
}

async function loadCache(): Promise<void> {
  if (cacheLoaded) return;
  if (!cacheLoadPromise) {
    cacheLoadPromise = (async () => {
      try {
        cache = JSON.parse(await readFile(CACHE_FILE, "utf8")) as Record<string, CacheEntry>;
      } catch {
        cache = {};
      } finally {
        cacheLoaded = true;
      }
    })();
  }
  await cacheLoadPromise;
}

async function persistCache(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function isFresh(entry: CacheEntry, now = Date.now()): boolean {
  return now - Date.parse(entry.updatedAt) < CACHE_TTL_MS;
}

function isPending(entry: CacheEntry, now = Date.now()): boolean {
  return entry.status === "pending" && now - Date.parse(entry.updatedAt) < PENDING_TTL_MS;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(item: string, tag: string): string {
  return decodeXml(item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"))?.[1] || "");
}

function stripHtml(value: string): string {
  return decodeXml(value);
}

function decodeDuckDuckGoUrl(value: string): string {
  const decoded = decodeXml(value);
  try {
    const url = new URL(decoded.startsWith("//") ? `https:${decoded}` : decoded);
    return url.searchParams.get("uddg") || decoded;
  } catch {
    return decoded;
  }
}

function buildSearchQuery(normalizedQuery: string): string {
  if (/\bdisney\b/.test(normalizedQuery) && /\blancamentos?\b/.test(normalizedQuery)) {
    return "Disney upcoming releases movies series 2026 2027";
  }

  return normalizedQuery
    .replace(/\bproximos?\b/g, "upcoming")
    .replace(/\blancamentos?\b/g, "releases")
    .replace(/\bfilmes?\b/g, "movies")
    .replace(/\bseries?\b/g, "series")
    .replace(/\s+/g, " ")
    .trim();
}

async function searchWithBrave(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return [];

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_RESULTS}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Brave Search retornou HTTP ${response.status}`);
  }

  const data = await response.json() as {
    web?: {
      results?: Array<{ title?: string; url?: string; description?: string }>;
    };
  };

  return (data.web?.results || [])
    .map((result) => ({
      title: result.title || "",
      url: result.url || "",
      snippet: result.description || "",
    }))
    .filter((result) => result.title && result.url)
    .slice(0, MAX_RESULTS);
}

async function searchWithDuckDuckGo(query: string): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 MrChickenQuickSearch/1.0",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo retornou HTTP ${response.status}`);
  }

  const html = await response.text();
  const matches = Array.from(html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi));
  const snippets = Array.from(html.matchAll(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/gi));

  const results = matches.map((match, index) => ({
    title: stripHtml(match[2]),
    url: decodeDuckDuckGoUrl(match[1]),
    snippet: stripHtml(snippets[index]?.[1] || snippets[index]?.[2] || ""),
  })).filter((result) => result.title && result.url);

  if (!results.length) {
    throw new Error("DuckDuckGo nao retornou resultados parseaveis.");
  }

  return results.slice(0, MAX_RESULTS);
}

async function searchWithBingRss(query: string): Promise<SearchResult[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 MrChickenQuickSearch/1.0",
      Accept: "application/rss+xml, application/xml, text/xml",
    },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Bing RSS retornou HTTP ${response.status}`);
  }

  const xml = await response.text();
  return Array.from(xml.matchAll(/<item\b[\s\S]*?<\/item>/gi))
    .map((match) => {
      const item = match[0];
      return {
        title: extractTag(item, "title"),
        url: extractTag(item, "link"),
        snippet: extractTag(item, "description"),
      };
    })
    .filter((result) => result.title && result.url)
    .slice(0, MAX_RESULTS);
}

async function searchWeb(query: string): Promise<SearchResult[]> {
  const braveResults = await searchWithBrave(query);
  if (braveResults.length) return braveResults;

  try {
    return await searchWithDuckDuckGo(query);
  } catch {
    return searchWithBingRss(query);
  }
}

function formatCompletedMessage(entry: CacheEntry): string {
  const lines = entry.results.map((result, index) => {
    const snippet = result.snippet ? ` - ${result.snippet}` : "";
    return `${index + 1}. [${result.title}](${result.url})${snippet}`;
  });

  return [
    `Resultado rapido em cache para: "${entry.query}"`,
    "",
    ...lines,
    "",
    `Cache atualizado em ${new Date(entry.updatedAt).toLocaleString("pt-BR")}.`,
  ].join("\n");
}

function formatPendingMessage(entry: CacheEntry): string {
  return [
    `Recebi a pesquisa e iniciei a busca em segundo plano: "${entry.query}".`,
    `ID: ${entry.id}`,
    "",
    "Para manter a resposta abaixo de 200ms, nao vou segurar o chat esperando navegador/MCP. Reenvie a mesma pergunta em alguns segundos para receber o resultado em cache.",
  ].join("\n");
}

async function runSearchJob(entry: CacheEntry, cacheKey: string): Promise<void> {
  try {
    const results = await searchWeb(buildSearchQuery(entry.normalizedQuery));
    const updatedAt = new Date().toISOString();
    cache[cacheKey] = {
      ...entry,
      status: "completed",
      updatedAt,
      results,
      error: results.length ? undefined : "A busca nao retornou resultados.",
    };
  } catch (err) {
    const updatedAt = new Date().toISOString();
    cache[cacheKey] = {
      ...entry,
      status: "failed",
      updatedAt,
      results: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  await persistCache().catch((err) => {
    console.error("[QuickWebSearch] Falha ao persistir cache:", err);
  });
}

export async function getQuickWebSearchResponse(rawQuery: string): Promise<ChatAgentResponse> {
  await loadCache();

  const query = rawQuery.replace(/\s+/g, " ").trim();
  const normalizedQuery = normalizeQuery(query) || query.toLowerCase();
  const cacheKey = `${CACHE_VERSION}:${normalizedQuery}`;
  const existing = cache[cacheKey];
  const now = Date.now();

  if (existing?.status === "completed" && isFresh(existing, now)) {
    return {
      message: formatCompletedMessage(existing),
      action: null,
    };
  }

  if (existing && isPending(existing, now)) {
    return {
      message: formatPendingMessage(existing),
      action: null,
    };
  }

  const timestamp = new Date().toISOString();
  const entry: CacheEntry = {
    id: createSearchId(cacheKey),
    query,
    normalizedQuery,
    status: "pending",
    createdAt: timestamp,
    updatedAt: timestamp,
    results: [],
  };

  cache[cacheKey] = entry;
  void persistCache().catch((err) => {
    console.error("[QuickWebSearch] Falha ao persistir estado pendente:", err);
  });
  void runSearchJob(entry, cacheKey);

  return {
    message: formatPendingMessage(entry),
    action: null,
  };
}
