import type { FlowDecision } from "@/lib/ai/gemini";
import type { ExecutionTask } from "@/services/agents";
import type {
  ImageGenerationOperation,
  ImageReferenceSource,
} from "../ImageGenerationContract";

export type GenerationQuantity = 1 | 2 | 3 | 4 | "1x" | "x2" | "x3" | "x4";
export type ImagePackageMode = "turnaround3d";
export type TurnaroundView =
  | "front"
  | "left"
  | "right"
  | "back"
  | "top"
  | "bottom";

export const MAX_IMAGE_BATCH_SIZE = 4;
export const MAX_SCALE_IMAGE_COUNT = 40;
export const BASE_TURNAROUND_VIEWS: readonly TurnaroundView[] = [
  "front",
  "left",
  "right",
  "back",
];
export const TOP_BOTTOM_VIEWS: readonly TurnaroundView[] = ["top", "bottom"];
export const TURNAROUND_VIEW_LABELS: Readonly<
  Record<TurnaroundView, string>
> = Object.freeze({
  front: "front view",
  left: "left side view",
  right: "right side view",
  back: "back view",
  top: "top view",
  bottom: "bottom view",
});
export const TURNAROUND_VIEW_INSTRUCTIONS: Readonly<
  Record<TurnaroundView, string>
> = Object.freeze({
  front:
    "FRONT VIEW: character faces directly forward, both eyes visible symmetrically, shoulders square to camera, 0 degree rotation.",
  left:
    "LEFT SIDE VIEW: exact 90 degree left profile. Only the left side contour is visible; one eye profile, one ear, nose silhouette, chest and feet aligned sideways. Do not use a 3/4 view.",
  right:
    "RIGHT SIDE VIEW: exact 90 degree right profile. Only the right side contour is visible; one eye profile, one ear, nose silhouette, chest and feet aligned sideways. Do not use a 3/4 view.",
  back:
    "BACK VIEW: exact 180 degree rear view. Face is not visible, only back of head, back of body, back of clothing and shoes. Do not use a 3/4 back view.",
  top:
    "TOP VIEW: exact overhead orthographic view looking straight down at the same character.",
  bottom:
    "BOTTOM VIEW: exact underside orthographic view looking straight up at the same character.",
});

export interface AgentTaskOptions {
  topic: string;
  avatarId: string;
  model:
    | "deepseek"
    | "claude"
    | "chatgpt"
    | "gemini"
    | "cerebras"
    | "zenmux"
    | "iamhc";
  imageModel?: string;
  imageQuantity?: GenerationQuantity;
  requestedImageCount?: number;
  videoModel?: string;
  videoQuantity?: GenerationQuantity;
  aspectRatio?: "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
  jobId: string;
  baseUrl?: string;
  approvedPlan?: FlowDecision;
  visualReferenceImage?: string;
  inputReferenceImage?: string;
  cleanupInputReferenceImage?: boolean;
  imageOperation?: ImageGenerationOperation;
  referenceSource?: ImageReferenceSource;
  referenceXPath?: string;
  useAvatarVisualReference?: boolean;
  useExistingFlowReference?: boolean;
  useAvatarPersonality?: boolean;
  useCortexMemory?: boolean;
  imagePackageMode?: ImagePackageMode;
  turnaroundViews?: TurnaroundView[];
}

export interface FlowExecutionResult {
  readonly success: boolean;
  readonly jobId: string;
  readonly videoPath?: string;
  readonly imagePaths?: string[];
  readonly error?: string;
}

export type FlowTaskInput =
  | {
      readonly kind: "planning";
      readonly topic: string;
    }
  | {
      readonly kind: "prepare";
      readonly options: AgentTaskOptions;
    }
  | {
      readonly kind:
        | "image"
        | "video"
        | "creative"
        | "refine"
        | "project";
      readonly options: AgentTaskOptions;
      readonly decision: FlowDecision;
    };

export interface FlowExecutionTask extends ExecutionTask {
  readonly input: FlowTaskInput;
}

export function requireFlowTaskInput<
  TKind extends FlowTaskInput["kind"],
>(
  task: ExecutionTask,
  kind: TKind,
): Extract<FlowTaskInput, { readonly kind: TKind }> {
  const input = task.input as FlowTaskInput | undefined;
  if (!input || input.kind !== kind) {
    throw new Error(
      `Flow task "${task.id}" requires input kind "${kind}".`,
    );
  }
  return input as Extract<FlowTaskInput, { readonly kind: TKind }>;
}
