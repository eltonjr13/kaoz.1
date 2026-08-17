export type ToolEffect = "read" | "write" | "external" | "destructive";
export type ApprovalMode = "never" | "plan" | "step";

export type ArtifactType = "image" | "video" | "audio" | "document" | "markdown" | "pdf" | "json" | "csv" | "html" | "text" | "file";
export type ExecutionArtifact = {
  id: string;
  type: ArtifactType;
  name: string;
  path?: string;
  url?: string;
  mimeType?: string;
  size?: number;
  previewAvailable?: boolean;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
};
