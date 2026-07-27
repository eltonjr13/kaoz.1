export const DAVINCI_FREE_PLAN_VERSION = 1 as const;

export type DavinciFreeMarkerKind =
  | "lower-third"
  | "zoom"
  | "cursor"
  | "transition"
  | "caption"
  | "review";

export interface DavinciFreeMarker {
  frame: number;
  kind: DavinciFreeMarkerKind;
  name: string;
  note?: string;
  durationFrames?: number;
}

export interface DavinciFreePlan {
  version: typeof DAVINCI_FREE_PLAN_VERSION;
  requestId: string;
  createdAt: string;
  timelineName: string;
  fps: number;
  media: {
    introPath?: string;
    mainPath: string;
    outroPath?: string;
    processedVoicePath?: string;
    musicPath?: string;
    reviewedSrtPath?: string;
  };
  audio: {
    musicDb: number;
    voicePrepared: boolean;
  };
  color: {
    enabled: boolean;
    cdl?: {
      slope: string;
      offset: string;
      power: string;
      saturation: string;
    };
  };
  markers: DavinciFreeMarker[];
}

export interface DavinciFreeStatus {
  runnerInstalled: boolean;
  runnerDirectory: string;
  pendingPlan: null | {
    requestId: string;
    timelineName: string;
    createdAt: string;
  };
  latestResult: null | Record<string, unknown>;
  instructions: string[];
}
