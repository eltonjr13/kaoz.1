export const INTELLIGENT_EDIT_PLAN_VERSION = 3 as const;
export const INTELLIGENT_PEDAGOGICAL_ANALYSIS_VERSION = 2 as const;

export type IntelligentEditStyle = "subtle" | "balanced" | "dynamic" | "meme";
export type IntelligentMotionPace = "calm" | "natural" | "energetic";
export type IntelligentEditPalette =
  | "kaoz"
  | "electric"
  | "premium"
  | "coral"
  | "course-theme"
  | "meme";
export type IntelligentEditTextVariant = "concept" | "stat" | "action" | "quote";
export type IntelligentSoundEffect =
  | "soft-whoosh"
  | "interface-click"
  | "page-flip"
  | "keyboard-typing"
  | "light-impact"
  | "subtle-pop"
  | "positive-confirmation"
  | "soft-error"
  | "rising-swoosh";
export type IntelligentCourseLayout = "roadmap" | "framework" | "editorial";
export type IntelligentCourseThemeKey =
  | "ancestral"
  | "performance"
  | "wellness"
  | "business"
  | "technology"
  | "creative";

export type IntelligentCaptionPreset =
  | "hormozi"
  | "karaoke"
  | "clean"
  | "classic"
  | "neon"
  | "boxed"
  | "outline"
  | "highlight";

export interface IntelligentEditDesign {
  palette: IntelligentEditPalette;
  captionsEnabled: boolean;
  captionPreset?: IntelligentCaptionPreset;
  captionEmojis?: boolean;
  captionPosition?: "bottom" | "center" | "top";
  colors: {
    background: string;
    surface: string;
    primary: string;
    secondary: string;
    text: string;
    muted: string;
  };
}

export interface IntelligentCourseThemeProfile {
  id: string;
  courseName: string;
  key: IntelligentCourseThemeKey;
  label: string;
  rationale: string;
  tone: string;
  createdAt: string;
  updatedAt: string;
  colors: IntelligentEditDesign["colors"];
}

export interface IntelligentCourseIdentity {
  title: string;
  eyebrow: string;
  promise: string;
  layout: IntelligentCourseLayout;
  source: "agent" | "deterministic-fallback";
  lessons: Array<{
    index: number;
    title: string;
    subtitle: string;
  }>;
}

export interface TimedTranscriptSegment {
  start: number;
  end: number;
  text: string;
  source: "local-asr" | "webspeech";
  words?: IntelligentTimedWord[];
  timingPrecision?: IntelligentTimingPrecision;
}

export type IntelligentTimingPrecision = "precise" | "approximate";

export interface IntelligentTimedWord {
  start: number;
  end: number;
  text: string;
  confidence?: number;
}

export type IntelligentPedagogicalItemKind =
  | "objective"
  | "prerequisite"
  | "promise"
  | "chapter"
  | "concept"
  | "definition"
  | "process-step"
  | "example"
  | "demonstration"
  | "warning"
  | "common-error"
  | "exercise"
  | "action"
  | "summary"
  | "previous-link"
  | "next-link";

export type IntelligentPedagogicalItemStatus =
  | "suggested"
  | "approved"
  | "edited"
  | "rejected";

export interface IntelligentPedagogicalItem {
  id: string;
  kind: IntelligentPedagogicalItemKind;
  title: string;
  detail?: string;
  start: number;
  end: number;
  evidence: string;
  importance: "low" | "medium" | "high";
  confidence: number;
  editorialSuggestion: string;
  status: IntelligentPedagogicalItemStatus;
  source: "chunk-agent" | "chunk-fallback";
}

export interface IntelligentPedagogicalAnalysis {
  version: typeof INTELLIGENT_PEDAGOGICAL_ANALYSIS_VERSION;
  source: "agent" | "hybrid" | "deterministic-fallback";
  chunkCount: number;
  segmentsAnalyzed: number;
  analyzedCharacters: number;
  items: IntelligentPedagogicalItem[];
}

export interface IntelligentCaption {
  start: number;
  end: number;
  text: string;
  words?: IntelligentTimedWord[];
}

export interface IntelligentEditEvent {
  id: string;
  kind:
    | "intro"
    | "outro"
    | "lower-third"
    | "impact-text"
    | "zoom"
    | "cut"
    | "remove"
    | "cursor"
    | "transition"
    | "sound-effect"
    | "meme-sfx";
  start: number;
  duration: number;
  label: string;
  subtitle?: string;
  reason: string;
  variant?: IntelligentEditTextVariant;
  soundEffect?: IntelligentSoundEffect;
  soundEffectGainDb?: number;
  memeTag?:
    | "vine-boom"
    | "anime-wow"
    | "rizz"
    | "fart"
    | "bone-crack"
    | "among-us"
    | "faah"
    | "error"
    | "punch"
    | "baby-laugh"
    | "spiderman"
    | "nemesis";
  scale?: number;
  x?: number;
  y?: number;
}

export interface IntelligentEditorialEventOverride {
  id: string;
  enabled?: boolean;
  start?: number;
  duration?: number;
  label?: string;
  subtitle?: string;
  scale?: number;
  x?: number;
  y?: number;
}

export interface IntelligentEditorialCaptionOverride {
  index: number;
  enabled?: boolean;
  start?: number;
  end?: number;
  text?: string;
}

export interface IntelligentPedagogicalReviewOverride {
  id: string;
  status?: IntelligentPedagogicalItemStatus;
  title?: string;
  detail?: string;
  start?: number;
  end?: number;
  editorialSuggestion?: string;
}

export interface IntelligentEditorialReview {
  version: 1;
  planId: string;
  updatedAt: string;
  captionsEnabled?: boolean;
  captionPreset?: IntelligentCaptionPreset;
  captionEmojis?: boolean;
  motionPace?: IntelligentMotionPace;
  events: IntelligentEditorialEventOverride[];
  addedEvents?: IntelligentEditEvent[];
  captions: IntelligentEditorialCaptionOverride[];
  pedagogy?: IntelligentPedagogicalReviewOverride[];
  previewPath?: string;
}

export interface IntelligentCourseEditorialStandard {
  version: 1;
  courseName: string;
  updatedAt: string;
  captionsEnabled: boolean;
  enabledKinds: Partial<Record<IntelligentEditEvent["kind"], boolean>>;
  zoomScale?: number;
  motionPace?: IntelligentMotionPace;
  eventDurations?: Partial<Record<IntelligentEditEvent["kind"], number>>;
}

export interface IntelligentEditPlan {
  version: typeof INTELLIGENT_EDIT_PLAN_VERSION;
  id: string;
  requestId: string;
  sourceHash: string;
  sourcePath: string;
  sourceOrigin?: {
    provider: "google-drive";
    fileId: string;
    name: string;
    mimeType: string;
    sizeBytes?: number;
    parentId?: string;
    webViewLink?: string;
  };
  createdAt: string;
  style: IntelligentEditStyle;
  motion?: { pace: IntelligentMotionPace };
  design?: IntelligentEditDesign;
  courseTheme?: IntelligentCourseThemeProfile & { reused: boolean };
  courseIdentity?: IntelligentCourseIdentity & {
    lessonIndex: number;
    lessonTotal: number;
  };
  courseName?: string;
  moduleName: string;
  lessonNumber?: string;
  lessonName?: string;
  media: {
    durationSeconds: number;
    width: number;
    height: number;
    fps: number;
    hasAudio: boolean;
    musicPath?: string;
    musicDb: number;
    autoDucking?: boolean;
    duckingDb?: number;
    voiceEnhance?: boolean;
    voiceEnhanceMode?: "subtle" | "studio" | "aggressive";
    sfxEnabled?: boolean;
    sfxVolumeDb?: number;
    sfxPack?: "minimal" | "dynamic" | "tech";
  };
  transcript: TimedTranscriptSegment[];
  transcription?: {
    engine: "webspeech" | "cloud" | "whisper-cpp" | "parakeet";
    modelId?: string;
    backend?: "web" | "cloud" | "vulkan" | "cpu" | "parakeet";
    deviceName?: string;
    language: "pt";
    timingPrecision?: IntelligentTimingPrecision;
  };
  pedagogy: IntelligentPedagogicalAnalysis;
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
  visual: {
    source: "agent-contact-sheet" | "safe-center-fallback";
    contactSheetPath?: string;
    sampledFrames: number;
  };
  editorial?: {
    version: 1;
    updatedAt: string;
    modifiedEventIds: string[];
    modifiedCaptionIndexes: number[];
  };
  artifacts: {
    directory: string;
    transcriptPath: string;
    transcriptTextPath?: string;
    pedagogyPath: string;
    captionsPath: string;
    planPath: string;
    previewPath?: string;
  };
}

export interface IntelligentEditAnalysisInput {
  requestId: string;
  sourcePath: string;
  sourceOrigin?: IntelligentEditPlan["sourceOrigin"];
  courseName?: string;
  moduleName: string;
  lessonNumber?: string;
  lessonName?: string;
  style?: IntelligentEditStyle;
  motionPace?: IntelligentMotionPace;
  palette?: IntelligentEditPalette;
  captionsEnabled?: boolean;
  captionPreset?: IntelligentCaptionPreset;
  captionEmojis?: boolean;
  reuseCourseTheme?: boolean;
  musicPath?: string;
  musicDb?: number;
  autoDucking?: boolean;
  duckingDb?: number;
  voiceEnhance?: boolean;
  voiceEnhanceMode?: "subtle" | "studio" | "aggressive";
  sfxEnabled?: boolean;
  sfxVolumeDb?: number;
  sfxPack?: "minimal" | "dynamic" | "tech";
  useAgent?: boolean;
  transcriptionRuntime?: "web" | "desktop";
  transcriptionModelId?: string | null;
  transcriptionDevice?: "auto" | "vulkan" | "cpu";
  transcriptionAllowCloudFallback?: boolean;
  transcriptionMode?: "webspeech" | "cloud" | "local";
  transcriptionSegments?: TimedTranscriptSegment[];
}
