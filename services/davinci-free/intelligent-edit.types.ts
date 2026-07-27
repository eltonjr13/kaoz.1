export const INTELLIGENT_EDIT_PLAN_VERSION = 1 as const;

export type IntelligentEditStyle = "subtle" | "balanced" | "dynamic";

export interface TimedTranscriptSegment {
  start: number;
  end: number;
  text: string;
  source: "local-asr";
}

export interface IntelligentCaption {
  start: number;
  end: number;
  text: string;
}

export interface IntelligentEditEvent {
  id: string;
  kind: "intro" | "outro" | "lower-third" | "zoom" | "cursor" | "transition";
  start: number;
  duration: number;
  label: string;
  reason: string;
  x?: number;
  y?: number;
}

export interface IntelligentEditPlan {
  version: typeof INTELLIGENT_EDIT_PLAN_VERSION;
  id: string;
  requestId: string;
  sourceHash: string;
  sourcePath: string;
  createdAt: string;
  style: IntelligentEditStyle;
  courseName?: string;
  moduleName: string;
  media: {
    durationSeconds: number;
    width: number;
    height: number;
    fps: number;
    hasAudio: boolean;
    musicPath?: string;
    musicDb: number;
  };
  transcript: TimedTranscriptSegment[];
  captions: IntelligentCaption[];
  events: IntelligentEditEvent[];
  audio: {
    noiseReduction: true;
    equalization: true;
    compression: true;
    limiter: true;
    targetLufs: number;
  };
  color: {
    enabled: true;
    mode: "conservative-local";
  };
  cursorAnalysis: {
    status: "not-applicable" | "coordinates-required" | "events-provided";
    message: string;
  };
  semantic: {
    source: "agent" | "deterministic-fallback";
    provider?: string;
    model?: string;
    inputCharacters: number;
    captionReview: "agent" | "asr-only";
  };
  artifacts: {
    directory: string;
    transcriptPath: string;
    captionsPath: string;
    planPath: string;
    previewPath?: string;
  };
}

export interface IntelligentEditAnalysisInput {
  requestId: string;
  sourcePath: string;
  courseName?: string;
  moduleName: string;
  style?: IntelligentEditStyle;
  musicPath?: string;
  musicDb?: number;
  useAgent?: boolean;
}
