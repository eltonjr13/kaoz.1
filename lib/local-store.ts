import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Avatar, ExpertBackgroundMode, JobStatus, ReactionJob, RenderLayout, VoiceSettings } from "@/types";
import { APP_WORKSPACE_ID } from "@/lib/workspace";

const DATA_DIR = path.join(process.cwd(), ".generated", "local-data");
const AVATARS_FILE = path.join(DATA_DIR, "avatars.json");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
const PUBLIC_AVATAR_DIR = path.join(process.cwd(), "public", "uploads", "avatars");

type NewLocalAvatarInput = {
  name: string;
  file: File;
  voiceFile?: File | null;
  personality?: Record<string, unknown> | null;
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
  sourceVideoDescription?: string | null;
  sourceVideoTranscription?: string | null;
  trimStart?: string | null;
  trimEnd?: string | null;
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

export async function createLocalAvatar({ name, file, voiceFile, personality }: NewLocalAvatarInput): Promise<Avatar> {
  await mkdir(PUBLIC_AVATAR_DIR, { recursive: true });

  const now = new Date().toISOString();
  const fileName = `${crypto.randomUUID()}-${safeFileName(file.name || "avatar.jpg")}`;
  const diskPath = path.join(PUBLIC_AVATAR_DIR, fileName);
  const publicPath = `/uploads/avatars/${fileName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await writeFile(diskPath, buffer);

  let voicePublicPath: string | null = null;
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
    personality: personality ?? null,
    created_at: now,
    updated_at: now
  };
  const avatars = await listLocalAvatars();

  await writeJsonFile(AVATARS_FILE, [avatar, ...avatars]);

  return avatar;
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

export async function createLocalJob({
  avatarId,
  sourceVideoId = null,
  sourceVideoUrl = null,
  sourceVideoTitle = null,
  renderLayout = "source_pip",
  expertBackgroundMode = "original",
  topic,
  voiceSettings = null,
  sourceVideoDescription = null,
  sourceVideoTranscription = null,
  trimStart = null,
  trimEnd = null
}: NewLocalJobInput): Promise<ReactionJob> {
  const now = new Date().toISOString();
  const job: ReactionJob = {
    id: crypto.randomUUID(),
    user_id: APP_WORKSPACE_ID,
    avatar_id: avatarId,
    source_video_id: sourceVideoId,
    source_video_url: sourceVideoUrl,
    source_video_title: sourceVideoTitle,
    render_layout: renderLayout,
    expert_background_mode: expertBackgroundMode,
    topic,
    status: "draft",
    script_text: null,
    voice_provider: null,
    audio_path: null,
    lip_sync_video_path: null,
    final_video_path: null,
    error_message: null,
    voice_settings: voiceSettings ?? null,
    source_video_description: sourceVideoDescription,
    source_video_transcription: sourceVideoTranscription,
    trim_start: trimStart,
    trim_end: trimEnd,
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
