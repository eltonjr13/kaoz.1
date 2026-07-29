export const INTELLIGENT_EDIT_PLAN_VERSION = 1 as const;

export type IntelligentEditStyle = "subtle" | "balanced" | "dynamic";
export type IntelligentEditPalette =
  | "kaoz"
  | "electric"
  | "premium"
  | "coral"
  | "course-theme";
export type IntelligentEditTextVariant = "concept" | "stat" | "action" | "quote";
export type IntelligentCourseLayout = "roadmap" | "framework" | "editorial";
export type IntelligentCourseThemeKey =
  | "ancestral"
  | "performance"
  | "wellness"
  | "business"
  | "technology"
  | "creative";

export interface IntelligentEditDesign {
  palette: IntelligentEditPalette;
  captionsEnabled: boolean;
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
  source: "local-asr";
}

export interface IntelligentCaption {
  start: number;
  end: number;
  text: string;
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
    | "cursor"
    | "transition";
  start: number;
  duration: number;
  label: string;
  subtitle?: string;
  reason: string;
  variant?: IntelligentEditTextVariant;
  scale?: number;
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
  design?: IntelligentEditDesign;
  courseTheme?: IntelligentCourseThemeProfile & { reused: boolean };
  courseIdentity?: IntelligentCourseIdentity & {
    lessonIndex: number;
    lessonTotal: number;
  };
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
  visual: {
    source: "agent-contact-sheet" | "safe-center-fallback";
    contactSheetPath?: string;
    sampledFrames: number;
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
  palette?: IntelligentEditPalette;
  captionsEnabled?: boolean;
  reuseCourseTheme?: boolean;
  musicPath?: string;
  musicDb?: number;
  useAgent?: boolean;
}
