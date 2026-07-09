import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Avatar, ExpertBackgroundMode, JobStatus, ReactionJob, RenderLayout, VoiceDirection, VoiceSettings } from "@/types";
import { APP_WORKSPACE_ID } from "@/lib/workspace";

const DATA_DIR = path.join(process.cwd(), ".generated", "local-data");
const AVATARS_FILE = path.join(DATA_DIR, "avatars.json");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
const FLY_CAMPAIGNS_FILE = path.join(DATA_DIR, "fly-campaigns.json");
const PUBLIC_AVATAR_DIR = path.join(process.cwd(), "public", "uploads", "avatars");

type NewLocalAvatarInput = {
  name: string;
  file: File;
  voiceFile?: File | null;
  personality?: Record<string, unknown> | null;
  parentId?: string | null;
};

type NewLocalJobInput = {
  avatarId: string;
  sourceVideoId?: string | null;
  sourceVideoUrl?: string | null;
  sourceVideoTitle?: string | null;
  renderLayout?: RenderLayout;
  expertBackgroundMode?: ExpertBackgroundMode;
  topic: string;
  voiceSettings?: VoiceSettings | null;
  voiceDirection?: VoiceDirection | null;
  sourceVideoDescription?: string | null;
  sourceVideoTranscription?: string | null;
  trimStart?: string | null;
  trimEnd?: string | null;
  scriptText?: string | null;
  useCortexMemory?: boolean;
};

type NewFlyCampaignInput = {
  campaignGoal: string;
  questions: string[];
  answers: string[];
  avatarId?: string | null;
  model: string;
  plan: Record<string, unknown>;
};

export type FlyCampaignJobLink = {
  key: string;
  jobId: string;
  type: "ad-creative" | "react-video";
  title?: string | null;
  conceptName?: string | null;
  index?: number | null;
  created_at: string;
};

export type FlyCampaign = {
  id: string;
  user_id: string;
  campaign_goal: string;
  questions: string[];
  answers: string[];
  avatar_id: string | null;
  model: string;
  plan: Record<string, unknown>;
  jobs: FlyCampaignJobLink[];
  created_at: string;
  updated_at: string;
};


async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile<T>(filePath: string, data: T) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function safeFileName(fileName: string) {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function listLocalAvatars(): Promise<Avatar[]> {
  const avatars = await readJsonFile<Avatar[]>(AVATARS_FILE, []);
  return avatars.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export async function createLocalAvatar({ name, file, voiceFile, personality, parentId }: NewLocalAvatarInput): Promise<Avatar> {
  await mkdir(PUBLIC_AVATAR_DIR, { recursive: true });

  const now = new Date().toISOString();
  const fileName = `${crypto.randomUUID()}-${safeFileName(file.name || "avatar.jpg")}`;
  const diskPath = path.join(PUBLIC_AVATAR_DIR, fileName);
  const publicPath = `/uploads/avatars/${fileName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await writeFile(diskPath, buffer);

  let inheritedVoicePath: string | null = null;
  let inheritedPersonality: Record<string, unknown> | null = null;

  if (parentId) {
    const parent = await findLocalAvatar(parentId);
    if (parent) {
      inheritedVoicePath = parent.voice_reference_path;
      inheritedPersonality = (parent.personality as Record<string, unknown>) ?? null;
    }
  }

  let voicePublicPath: string | null = inheritedVoicePath;
  if (voiceFile) {
    const voiceFileName = `${crypto.randomUUID()}-${safeFileName(voiceFile.name || "voice.wav")}`;
    const voiceDiskPath = path.join(PUBLIC_AVATAR_DIR, voiceFileName);
    voicePublicPath = `/uploads/avatars/${voiceFileName}`;
    const voiceBuffer = Buffer.from(await voiceFile.arrayBuffer());
    await writeFile(voiceDiskPath, voiceBuffer);
  }

  const avatar: Avatar = {
    id: crypto.randomUUID(),
    user_id: APP_WORKSPACE_ID,
    name,
    image_path: publicPath,
    thumbnail_path: null,
    voice_reference_path: voicePublicPath,
    consent_accepted: true,
    consent_accepted_at: now,
    status: "ready",
    personality: personality ?? inheritedPersonality ?? null,
    parent_id: parentId ?? null,
    created_at: now,
    updated_at: now
  };
  const avatars = await listLocalAvatars();

  await writeJsonFile(AVATARS_FILE, [avatar, ...avatars]);

  return avatar;
}

export async function updateLocalAvatar(avatarId: string, patch: Partial<Avatar>): Promise<Avatar | null> {
  const avatars = await listLocalAvatars();
  const avatarIndex = avatars.findIndex((avatar) => avatar.id === avatarId);

  if (avatarIndex < 0) {
    return null;
  }

  const updatedAvatar = {
    ...avatars[avatarIndex],
    ...patch,
    updated_at: new Date().toISOString()
  };

  avatars[avatarIndex] = updatedAvatar;
  await writeJsonFile(AVATARS_FILE, avatars);

  return updatedAvatar;
}

export async function findLocalAvatar(avatarId: string) {
  const avatars = await listLocalAvatars();
  return avatars.find((avatar) => avatar.id === avatarId) ?? null;
}

export async function findLocalJob(jobId: string) {
  const jobs = await listLocalJobs();
  return jobs.find((job) => job.id === jobId) ?? null;
}

export async function listLocalJobs(): Promise<ReactionJob[]> {
  const jobs = await readJsonFile<ReactionJob[]>(JOBS_FILE, []);
  return jobs.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export async function listLocalFlyCampaigns(): Promise<FlyCampaign[]> {
  const campaigns = await readJsonFile<FlyCampaign[]>(FLY_CAMPAIGNS_FILE, []);
  return campaigns.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export async function findLocalFlyCampaign(campaignId: string): Promise<FlyCampaign | null> {
  const campaigns = await listLocalFlyCampaigns();
  return campaigns.find((campaign) => campaign.id === campaignId) ?? null;
}

export async function createLocalFlyCampaign(input: NewFlyCampaignInput): Promise<FlyCampaign> {
  const now = new Date().toISOString();
  const campaign: FlyCampaign = {
    id: crypto.randomUUID(),
    user_id: APP_WORKSPACE_ID,
    campaign_goal: input.campaignGoal,
    questions: input.questions,
    answers: input.answers,
    avatar_id: input.avatarId || null,
    model: input.model,
    plan: input.plan,
    jobs: [],
    created_at: now,
    updated_at: now
  };
  const campaigns = await listLocalFlyCampaigns();

  await writeJsonFile(FLY_CAMPAIGNS_FILE, [campaign, ...campaigns]);

  return campaign;
}

export async function addLocalFlyCampaignJob(
  campaignId: string,
  job: Omit<FlyCampaignJobLink, "created_at">
): Promise<FlyCampaign | null> {
  const campaigns = await listLocalFlyCampaigns();
  const campaignIndex = campaigns.findIndex((campaign) => campaign.id === campaignId);

  if (campaignIndex < 0) {
    return null;
  }

  const campaign = campaigns[campaignIndex];
  const now = new Date().toISOString();
  const jobs = campaign.jobs.filter((existing) => existing.key !== job.key && existing.jobId !== job.jobId);
  const updatedCampaign: FlyCampaign = {
    ...campaign,
    jobs: [...jobs, { ...job, created_at: now }],
    updated_at: now
  };

  campaigns[campaignIndex] = updatedCampaign;
  await writeJsonFile(FLY_CAMPAIGNS_FILE, campaigns);

  return updatedCampaign;
}

const defaultJobOptions = {
  sourceVideoId: null,
  sourceVideoUrl: null,
  sourceVideoTitle: null,
  renderLayout: "source_pip" as const,
  expertBackgroundMode: "original" as const,
  voiceSettings: null,
  voiceDirection: null,
  sourceVideoDescription: null,
  sourceVideoTranscription: null,
  trimStart: null,
  trimEnd: null,
  scriptText: null,
  useCortexMemory: true
};

export async function createLocalJob(input: NewLocalJobInput): Promise<ReactionJob> {
  const merged = { ...defaultJobOptions, ...input };
  const now = new Date().toISOString();
  const job: ReactionJob = {
    id: crypto.randomUUID(),
    user_id: APP_WORKSPACE_ID,
    avatar_id: merged.avatarId,
    source_video_id: merged.sourceVideoId,
    source_video_url: merged.sourceVideoUrl,
    source_video_title: merged.sourceVideoTitle,
    render_layout: merged.renderLayout,
    expert_background_mode: merged.expertBackgroundMode,
    topic: merged.topic,
    status: "draft",
    script_text: merged.scriptText,
    voice_provider: null,
    audio_path: null,
    lip_sync_video_path: null,
    final_video_path: null,
    error_message: null,
    voice_settings: merged.voiceSettings,
    voice_direction: merged.voiceDirection,
    source_video_description: merged.sourceVideoDescription,
    source_video_transcription: merged.sourceVideoTranscription,
    trim_start: merged.trimStart,
    trim_end: merged.trimEnd,
    use_cortex_memory: merged.useCortexMemory,
    feedback: null,
    created_at: now,
    updated_at: now
  };
  const jobs = await listLocalJobs();

  await writeJsonFile(JOBS_FILE, [job, ...jobs]);

  return job;
}

export async function updateLocalJobStatus(jobId: string, status: JobStatus) {
  return updateLocalJob(jobId, {
    status,
    error_message: null
  });
}

export async function completeLocalJob(jobId: string, finalVideoPath: string) {
  return updateLocalJob(jobId, {
    status: "completed",
    final_video_path: finalVideoPath,
    error_message: null
  });
}

export async function updateLocalJob(jobId: string, patch: Partial<ReactionJob>) {
  const jobs = await listLocalJobs();
  const jobIndex = jobs.findIndex((job) => job.id === jobId);

  if (jobIndex < 0) {
    return null;
  }

  const updatedJob = {
    ...jobs[jobIndex],
    ...patch,
    updated_at: new Date().toISOString()
  };

  jobs[jobIndex] = updatedJob;
  await writeJsonFile(JOBS_FILE, jobs);

  return updatedJob;
}

const EVENTS_FILE = path.join(DATA_DIR, "events.json");

export type LocalJobEvent = {
  id: string;
  user_id: string;
  job_id: string;
  event_type: string;
  message: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

export async function createLocalJobEvent(
  jobId: string,
  eventType: string,
  message: string,
  metadata?: Record<string, unknown> | null
): Promise<LocalJobEvent> {
  const event: LocalJobEvent = {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(),
    user_id: APP_WORKSPACE_ID,
    job_id: jobId,
    event_type: eventType,
    message,
    metadata: metadata ?? null,
    created_at: new Date().toISOString()
  };
  const events = await readJsonFile<LocalJobEvent[]>(EVENTS_FILE, []);
  events.push(event);
  await writeJsonFile(EVENTS_FILE, events);
  return event;
}

export async function listLocalJobEvents(jobId: string): Promise<LocalJobEvent[]> {
  const events = await readJsonFile<LocalJobEvent[]>(EVENTS_FILE, []);
  return events
    .filter((e) => e.job_id === jobId)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}
