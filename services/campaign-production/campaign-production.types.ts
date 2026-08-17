/**
 * Tipos e contratos para o pipeline "Do Canvas para a Produção Real em 1 Clique"
 */

export type CampaignAspectRatio = '9:16' | '16:9' | '1:1' | '4:3' | '3:4';

export interface CampaignScene {
  sceneNumber: number;
  title: string;
  visualPrompt: string;
  voiceoverText: string;
  durationSeconds: number;
  aspectRatio: CampaignAspectRatio;
  speaker?: string;
  notes?: string;
  styleKeywords?: string[];
}

export interface CampaignParsedData {
  campaignName: string;
  targetPlatform: string;
  aspectRatio: CampaignAspectRatio;
  totalEstimatedDuration: number;
  scenes: CampaignScene[];
  tone?: string;
  targetAudience?: string;
  callToAction?: string;
  rawArtifactsCount: number;
  sourceMode?: 'canonical_spec' | 'structured_script' | 'visual_prompts' | 'fallback';
}

export interface CampaignAssetResult {
  sceneNumber: number;
  title: string;
  visualPrompt: string;
  voiceoverText: string;
  imagePath?: string;
  imageUrl?: string;
  audioPath?: string;
  audioUrl?: string;
  imageStatus: 'pending' | 'generating' | 'completed' | 'placeholder' | 'failed' | 'skipped';
  audioStatus: 'pending' | 'generating' | 'completed' | 'placeholder' | 'failed' | 'skipped';
  imageError?: string;
  audioError?: string;
}

export interface CampaignProductionOptions {
  generateImages?: boolean;
  generateAudio?: boolean;
  createDavinciPlan?: boolean;
  aspectRatio?: CampaignAspectRatio;
  imageModel?: string;
  voiceProvider?: 'fish-audio' | 'cartesia' | 'local' | 'mock';
  voiceModel?: string;
  voiceReferenceId?: string;
}

export type CampaignJobStatus = 'queued' | 'running' | 'completed' | 'completed_with_warnings' | 'failed' | 'cancelled';

export interface CampaignProductionReview {
  status: 'approved' | 'needs_revision';
  score: number;
  minimumScore: number;
  blockingIssues: string[];
}

export interface CampaignProductionSpec {
  schemaVersion: '1.0';
  id: string;
  warRoomSessionId: string;
  campaignName: string;
  objective: string;
  targetPlatform: string;
  aspectRatio: CampaignAspectRatio;
  scenes: CampaignScene[];
  review: CampaignProductionReview;
  sourceArtifactIds: string[];
  generatedAt: string;
}

export interface CampaignProductionJob {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: CampaignJobStatus;
  progress: number; // 0 to 100
  currentStage: string;
  parsedData: CampaignParsedData;
  assets: CampaignAssetResult[];
  options: CampaignProductionOptions;
  davinciPlan?: {
    requestId: string;
    timelineName: string;
    markersCount: number;
    planPath?: string;
  };
  outputDirectory: string;
  error?: string;
  warnings?: string[];
  productionSpecId?: string;
}

export interface ProduceCampaignRequest {
  artifacts?: Array<{ filename?: string; title?: string; content?: string }>;
  artifactIds?: string[];
  options?: CampaignProductionOptions;
  customScenes?: CampaignScene[];
  campaignName?: string;
}

export interface ProduceCampaignResponse {
  success: boolean;
  job: CampaignProductionJob;
  message?: string;
  error?: string;
}
