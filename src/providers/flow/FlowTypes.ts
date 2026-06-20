export interface FlowConfig {
  headless: boolean;
  timeout: number;
  downloadPath: string;
  profilePath: string;
  browserChannel?: string;
  browserDriver: 'playwright' | 'extension';
  extensionTaskTimeout: number;
  flowUrl: string;
  imageUrl?: string;
  videoUrl?: string;
}

export interface ImageGenerationResult {
  success: boolean;
  path: string;
  filename: string;
  paths?: string[];
  filenames?: string[];
  pdfPaths?: string[];
  pdfFilenames?: string[];
  createdAt: string;
  error?: string;
}

export interface VideoGenerationResult {
  success: boolean;
  path: string;
  filename: string;
  paths?: string[];
  filenames?: string[];
  duration: string; // duration of video if available, or generated metadata
  createdAt: string;
  error?: string;
}

export interface FlowStatus {
  initialized: boolean;
  authenticated: boolean;
  activeTasks: number;
  profilePath: string;
  extension?: unknown;
}

export type FlowPortal = 'google' | 'gemini' | 'chatgpt' | 'claude' | 'deepseek';

export interface PortalLoginResult {
  portal: FlowPortal;
  authenticated: boolean;
  reason: 'detected' | 'closed' | 'timeout' | 'error';
  message: string;
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

export interface ImageGenerationOptions {
  aspectRatio?: '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
  quantity?: 1 | 2 | 3 | 4 | '1x' | 'x2' | 'x3' | 'x4';
  model?: string;
  referenceImage?: string;
  folderName?: string;
  originalFilename?: string;
}

export interface VideoGenerationOptions {
  aspectRatio?: '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
  quantity?: 1 | 2 | 3 | 4 | '1x' | 'x2' | 'x3' | 'x4';
  model?: string;
  referenceImage?: string;
}
