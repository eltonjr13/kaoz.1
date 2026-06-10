export interface FlowConfig {
  headless: boolean;
  timeout: number;
  downloadPath: string;
  profilePath: string;
  flowUrl: string;
  imageUrl?: string;
  videoUrl?: string;
}

export interface ImageGenerationResult {
  success: boolean;
  path: string;
  filename: string;
  createdAt: string;
  error?: string;
}

export interface VideoGenerationResult {
  success: boolean;
  path: string;
  filename: string;
  duration: string; // duration of video if available, or generated metadata
  createdAt: string;
  error?: string;
}

export interface FlowStatus {
  initialized: boolean;
  authenticated: boolean;
  activeTasks: number;
  profilePath: string;
}

// Future expansion types
export interface AudioGenerationResult {
  success: boolean;
  path: string;
  filename: string;
  createdAt: string;
  error?: string;
}

export interface MusicGenerationResult {
  success: boolean;
  path: string;
  filename: string;
  createdAt: string;
  error?: string;
}

export interface SpeechGenerationResult {
  success: boolean;
  path: string;
  filename: string;
  createdAt: string;
  error?: string;
}

export interface AvatarGenerationResult {
  success: boolean;
  path: string;
  filename: string;
  createdAt: string;
  error?: string;
}
