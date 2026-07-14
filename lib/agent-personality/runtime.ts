import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getLocalDataDir } from "../runtime-paths.ts";
import { APP_WORKSPACE_ID } from "../workspace.ts";
import { getDefaultAgentPersonality, parseAgentPersonalityProfile } from "./schema.ts";
import type {
  AgentPersonalityProfileV1,
  CharacterRelationshipState,
  CharacterRuntimeSnapshot,
  CharacterSessionState,
  CharacterTurnMode,
  PersonalityScale
} from "./types.ts";

type RelationshipStore = {
  version: 1;
  relationships: Record<string, CharacterRelationshipState>;
};

const PROFILE_FILE = path.join(getLocalDataDir(), "agent-personality.json");
const RELATIONSHIP_FILE = path.join(getLocalDataDir(), "agent-relationships.json");
const DEFAULT_SESSION_ID = "default";
const MAX_IMPORTANT_MOMENTS = 20;

let profileCache: AgentPersonalityProfileV1 | null = null;
let relationshipStoreCache: RelationshipStore | null = null;
let writeQueue: Promise<void> = Promise.resolve();
const sessionStates = new Map<string, CharacterSessionState>();

function clamp(value: number): PersonalityScale {
  return Number(Math.min(1, Math.max(0, value)).toFixed(2));
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function defaultRelationship(userId: string): CharacterRelationshipState {
  const now = new Date().toISOString();
  return {
    version: 1,
    userId,
    turnCount: 0,
    familiarity: 0.08,
    rapport: 0.42,
    playfulness: 0.45,
    importantMoments: [],
    lastInteractionAt: null,
    updatedAt: now
  };
}

async function readRelationshipStore(): Promise<RelationshipStore> {
  if (relationshipStoreCache) return relationshipStoreCache;
  try {
    const parsed = JSON.parse(await readFile(RELATIONSHIP_FILE, "utf8")) as RelationshipStore;
    relationshipStoreCache = parsed?.version === 1 && parsed.relationships
      ? parsed
      : { version: 1, relationships: {} };
  } catch {
    relationshipStoreCache = { version: 1, relationships: {} };
  }
  return relationshipStoreCache;
}

function queueJsonWrite(filePath: string, value: unknown): Promise<void> {
  writeQueue = writeQueue
    .catch(() => {})
    .then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    });
  return writeQueue;
}

export async function loadAgentPersonalityProfile(): Promise<AgentPersonalityProfileV1> {
  if (profileCache) return structuredClone(profileCache);
  try {
    profileCache = parseAgentPersonalityProfile(JSON.parse(await readFile(PROFILE_FILE, "utf8")));
  } catch {
    profileCache = getDefaultAgentPersonality();
  }
  return structuredClone(profileCache);
}

export async function saveAgentPersonalityProfile(input: unknown): Promise<AgentPersonalityProfileV1> {
  const profile = parseAgentPersonalityProfile(input);
  profileCache = structuredClone(profile);
  await queueJsonWrite(PROFILE_FILE, profile);
  return structuredClone(profile);
}

function inferTurnMode(message: string): CharacterTurnMode {
  const text = normalize(message);
  if (/\b(urgente|erro|falhou|problema|quebrou|corrija|conserte|bug|latencia|lento)\b/.test(text)) return "focused";
  if (/\b(triste|ansioso|preocupado|desanimado|mal|dificil|aconteceu comigo|me sinto)\b/.test(text)) return "supportive";
  if (/\b(piada|engracado|brinca|kkkk|haha|zoeira|divertido)\b/.test(text)) return "playful";
  return "neutral";
}

function buildSessionState(sessionId: string, message: string): CharacterSessionState {
  const id = sessionId.trim() || DEFAULT_SESSION_ID;
  const previous = sessionStates.get(id);
  const mode = inferTurnMode(message);
  const target = mode === "focused"
    ? { energy: 0.62, warmth: 0.54, seriousness: 0.92, playfulness: 0.08 }
    : mode === "supportive"
      ? { energy: 0.38, warmth: 0.9, seriousness: 0.76, playfulness: 0.08 }
      : mode === "playful"
        ? { energy: 0.82, warmth: 0.78, seriousness: 0.22, playfulness: 0.9 }
        : { energy: 0.58, warmth: 0.7, seriousness: 0.52, playfulness: 0.5 };
  const blend = (next: number, prior: number | undefined) => clamp(prior === undefined ? next : next * 0.78 + prior * 0.22);
  const state: CharacterSessionState = {
    sessionId: id,
    mode,
    energy: blend(target.energy, previous?.energy),
    warmth: blend(target.warmth, previous?.warmth),
    seriousness: blend(target.seriousness, previous?.seriousness),
    playfulness: blend(target.playfulness, previous?.playfulness),
    updatedAt: new Date().toISOString()
  };
  sessionStates.set(id, state);
  return state;
}

export async function prepareCharacterRuntime(input: {
  userMessage: string;
  sessionId?: string;
  userId?: string;
}): Promise<CharacterRuntimeSnapshot> {
  const userId = input.userId || APP_WORKSPACE_ID;
  const [profile, store] = await Promise.all([
    loadAgentPersonalityProfile(),
    readRelationshipStore()
  ]);
  const relationship = store.relationships[userId] || defaultRelationship(userId);
  return {
    profile,
    relationship: structuredClone(relationship),
    session: buildSessionState(input.sessionId || DEFAULT_SESSION_ID, input.userMessage)
  };
}

function extractImportantMoment(message: string): string | null {
  const compact = message.replace(/\s+/g, " ").trim();
  if (!/\b(lembre que|lembra que|importante para mim|aconteceu comigo)\b/i.test(normalize(compact))) return null;
  return compact.slice(0, 280);
}

export async function recordCharacterTurn(input: {
  userMessage: string;
  agentResponse: string;
  userId?: string;
}): Promise<void> {
  const userId = input.userId || APP_WORKSPACE_ID;
  const store = await readRelationshipStore();
  const previous = store.relationships[userId] || defaultRelationship(userId);
  const text = normalize(input.userMessage);
  const positive = /\b(obrigado|obrigada|valeu|perfeito|adorei|gostei)\b/.test(text);
  const playful = /\b(kkkk|haha|piada|brinca|engracado|zoeira)\b/.test(text);
  const personal = /\b(me sinto|aconteceu comigo|importante para mim|quero te contar)\b/.test(text);
  const moment = extractImportantMoment(input.userMessage);
  const importantMoments = moment && !previous.importantMoments.includes(moment)
    ? [...previous.importantMoments, moment].slice(-MAX_IMPORTANT_MOMENTS)
    : previous.importantMoments;
  const now = new Date().toISOString();

  store.relationships[userId] = {
    ...previous,
    turnCount: previous.turnCount + 1,
    familiarity: clamp(previous.familiarity + 0.008 + (personal ? 0.025 : 0)),
    rapport: clamp(previous.rapport + (positive ? 0.018 : 0.003)),
    playfulness: clamp(previous.playfulness * 0.92 + (playful ? 0.08 : 0.035)),
    importantMoments,
    lastInteractionAt: now,
    updatedAt: now
  };

  await queueJsonWrite(RELATIONSHIP_FILE, store);
}

export function resetCharacterRuntimeCachesForTests(): void {
  profileCache = null;
  relationshipStoreCache = null;
  sessionStates.clear();
  writeQueue = Promise.resolve();
}
