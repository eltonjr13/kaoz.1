export type JobStatus =
  | "draft"
  | "queued"
  | "researching"
  | "scripting"
  | "voice_generating"
  | "lip_syncing"
  | "rendering"
  | "review"
  | "completed"
  | "failed";

export type Avatar = {
  id: string;
  user_id: string;
  name: string;
  image_path: string;
  thumbnail_path: string | null;
  consent_accepted: boolean;
  consent_accepted_at: string;
  status: "ready" | "disabled";
  created_at: string;
  updated_at: string;
};

export type ViralVideo = {
  id: string;
  platform: "tiktok" | "youtube" | "instagram" | "other";
  external_id: string | null;
  title: string;
  url: string;
  thumbnail_url: string | null;
  topic: string;
  metrics: Record<string, number | string | boolean | null>;
  published_at: string | null;
  created_at: string;
};

export type ReactionJob = {
  id: string;
  user_id: string;
  avatar_id: string;
  source_video_id: string | null;
  source_video_url?: string | null;
  source_video_title?: string | null;
  topic: string;
  status: JobStatus;
  script_text: string | null;
  voice_provider: "omnivoice" | null;
  audio_path: string | null;
  lip_sync_video_path: string | null;
  final_video_path: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};
