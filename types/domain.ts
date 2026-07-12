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

export type RenderLayout = "source_pip" | "source_top_expert_bottom" | "balanced_split";

export type ExpertBackgroundMode = "original" | "remove";

export type Avatar = {
  id: string;
  user_id: string;
  name: string;
  image_path: string;
  thumbnail_path: string | null;
  voice_reference_path: string | null;
  consent_accepted: boolean;
  consent_accepted_at: string;
  status: "ready" | "disabled";
  personality?: Record<string, unknown> | null;
  parent_id?: string | null;
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

export type VoiceSettings = {
  /** Provider captured when the job is created, so regenerations are reproducible. */
  provider?: "cartesia" | "fish-audio" | "omnivoice";
  inference_steps?: number;
  guidance_scale?: number;
  denoise_ratio?: number;
  speed?: number;
  duration?: number;
  preprocess_prompt?: boolean;
  postprocess_output?: boolean;
};

export type VoiceEffect =
  | "pause"
  | "long-pause"
  | "whisper"
  | "soft"
  | "loud"
  | "emphasis"
  | "laugh"
  | "chuckle"
  | "giggle"
  | "cry"
  | "sigh"
  | "inhale"
  | "exhale"
  | "singing"
  | "sing-song";

export type VoiceDirectionCue = {
  sentence: number;
  effects: VoiceEffect[];
  reason: string;
};

export type VoiceDirection = {
  version: 1;
  cues: VoiceDirectionCue[];
};

export type ReactionJob = {
  id: string;
  user_id: string;
  avatar_id: string;
  source_video_id: string | null;
  source_video_url?: string | null;
  source_video_title?: string | null;
  render_layout?: RenderLayout | null;
  expert_background_mode?: ExpertBackgroundMode | null;
  topic: string;
  status: JobStatus;
  script_text: string | null;
  voice_provider: "cartesia" | "fish-audio" | "omnivoice" | null;
  audio_path: string | null;
  lip_sync_video_path: string | null;
  final_video_path: string | null;
  error_message: string | null;
  voice_settings?: VoiceSettings | null;
  voice_direction?: VoiceDirection | null;
  source_video_description?: string | null;
  source_video_transcription?: string | null;
  trim_start?: string | null;
  trim_end?: string | null;
  use_cortex_memory?: boolean | null;
  feedback?: 'good' | 'bad' | null;
  created_at: string;
  updated_at: string;
};
