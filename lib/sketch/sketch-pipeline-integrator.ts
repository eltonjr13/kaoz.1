/**
 * sketch-pipeline-integrator.ts
 *
 * Phase 4 — Connects the minimalist SimpleOrder interface to the creative
 * planner (Phase 3) and job manager (existing infrastructure) to deliver
 * finished ad assets end-to-end.
 *
 * Pipeline: SimpleOrder → CreativePlan → Reference preparation → Visual
 *   generation → Deterministic composition → Final file delivered.
 */

import type {
  SketchSimpleOrder,
  SketchCreativePlan,
  SketchCreativeResult,
  SketchChangeIntent,
  SketchProjectData,
  FlowSupportedAspectRatio,
  FinalAssetResource,
  ResourcesForAdjustment,
  ResultLineage,
  LineageIterationType,
  ChangeIntentType,
} from '../../types/sketch.ts';
import { planCreative } from './sketch-creative-planner.ts';

// ---------------------------------------------------------------------------
// Order Builder — constructs a valid SimpleOrder from user input
// ---------------------------------------------------------------------------

let orderCounter = 0;
function generateOrderId(): string {
  orderCounter += 1;
  return `order-${Date.now()}-${orderCounter}`;
}

export interface CreateOrderInput {
  prompt: string;
  aspectRatio?: FlowSupportedAspectRatio;
  attachmentIds?: string[];
  sketchDataUrl?: string;
  sketchPaths?: import('../../types/sketch.ts').SketchPath[];
}

export function createSimpleOrder(input: CreateOrderInput): SketchSimpleOrder {
  const refs = (input.attachmentIds || []).map((id) => ({
    attachmentId: id,
  }));

  const hasSketch = Boolean(
    input.sketchDataUrl || (input.sketchPaths && input.sketchPaths.length > 0)
  );

  return {
    schemaVersion: 1,
    version: '1.0.0',
    id: generateOrderId(),
    prompt: input.prompt,
    aspectRatio: input.aspectRatio || '1:1',
    selectedReferences: refs,
    sketchDrawing: hasSketch
      ? {
          paths: input.sketchPaths || [],
          dataUrl: input.sketchDataUrl,
          hasDrawing: true,
        }
      : undefined,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Change Intent Builder — formalizes adjustment requests
// ---------------------------------------------------------------------------

let intentCounter = 0;
function generateIntentId(): string {
  intentCounter += 1;
  return `intent-${Date.now()}-${intentCounter}`;
}

export function createChangeIntent(
  type: ChangeIntentType,
  targetResultId: string,
  userFeedback: string
): SketchChangeIntent {
  return {
    schemaVersion: 1,
    version: '1.0.0',
    id: generateIntentId(),
    type,
    targetResultId,
    userFeedback,
    keepBaseImage: type === 'refine_text',
    createdAt: new Date().toISOString(),
  };
}

export function classifyChangeIntent(feedback: string): ChangeIntentType {
  const lower = feedback.toLowerCase();
  const textKeywords = [
    'texto', 'título', 'headline', 'copy', 'cta', 'frase',
    'escrita', 'palavra', 'subtítulo', 'badge', 'selo',
  ];
  const visualKeywords = [
    'cor', 'imagem', 'foto', 'visual', 'fundo', 'background',
    'iluminação', 'luz', 'estilo', 'composição',
  ];
  const newConceptKeywords = [
    'outra ideia', 'novo conceito', 'diferente', 'outro',
    'nova ideia', 'completamente diferente',
  ];

  if (newConceptKeywords.some((k) => lower.includes(k))) return 'new_concept';
  if (textKeywords.some((k) => lower.includes(k))) return 'refine_text';
  if (visualKeywords.some((k) => lower.includes(k))) return 'refine_visual';
  return 'refine_visual';
}

// ---------------------------------------------------------------------------
// Result Builder — creates immutable version records
// ---------------------------------------------------------------------------

let resultCounter = 0;
function generateResultId(): string {
  resultCounter += 1;
  return `result-${Date.now()}-${resultCounter}`;
}

export function buildResultLineage(
  existingResults: SketchCreativeResult[],
  iterationType: LineageIterationType,
  parentId?: string,
  adjustmentPrompt?: string
): ResultLineage {
  const version = existingResults.length + 1;
  return {
    versionNumber: version,
    parentId,
    iterationType,
    adjustmentPrompt,
    timestamp: new Date().toISOString(),
  };
}

export function createCreativeResult(
  projectId: string,
  order: SketchSimpleOrder,
  plan: SketchCreativePlan,
  finalAsset: FinalAssetResource,
  lineage: ResultLineage,
  resourcesForAdjustments?: ResourcesForAdjustment
): SketchCreativeResult {
  return {
    schemaVersion: 1,
    version: '1.0.0',
    id: generateResultId(),
    projectId,
    originOrderId: order.id,
    planId: plan.id,
    lineage,
    creativePlan: plan,
    finalAsset,
    resourcesForAdjustments: resourcesForAdjustments || {},
    status: 'ready',
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Pipeline Executor — orchestrates the full minimalist flow
// ---------------------------------------------------------------------------

export interface PipelineExecutionResult {
  success: boolean;
  order: SketchSimpleOrder;
  plan?: SketchCreativePlan;
  result?: SketchCreativeResult;
  error?: string;
}

export interface PipelineExecutorOptions {
  queryFn?: (prompt: string) => Promise<string>;
}

/**
 * Execute the creative planning phase of the pipeline.
 * This is a pure async function that does not perform I/O beyond the optional
 * queryFn — it can be called from server API routes before enqueuing a job.
 */
export async function executePlanningPhase(
  order: SketchSimpleOrder,
  options?: PipelineExecutorOptions
): Promise<SketchCreativePlan> {
  return await planCreative(order, options?.queryFn);
}

/**
 * Apply a creative result to a project, recording it immutably in the
 * project's result history. Never overwrites previous results.
 */
export function applyResultToProject(
  project: SketchProjectData,
  order: SketchSimpleOrder,
  plan: SketchCreativePlan,
  finalAsset: FinalAssetResource,
  changeIntent?: SketchChangeIntent
): SketchProjectData {
  const existingResults = project.creativeResults || [];
  const parentId = changeIntent?.targetResultId;
  const iterationType: LineageIterationType = changeIntent
    ? mapIntentToLineage(changeIntent.type)
    : 'initial';

  const lineage = buildResultLineage(
    existingResults,
    iterationType,
    parentId,
    changeIntent?.userFeedback
  );

  const result = createCreativeResult(
    project.id,
    order,
    plan,
    finalAsset,
    lineage
  );

  // Immutable append — never overwrite existing results
  const updated: SketchProjectData = {
    ...project,
    currentOrder: order,
    creativePlan: plan,
    creativeResults: [...existingResults, result],
    activeResultId: result.id,
    updatedAt: new Date().toISOString(),
  };

  // Track change intents
  if (changeIntent) {
    updated.changeIntents = [...(project.changeIntents || []), changeIntent];
  }

  return updated;
}

function mapIntentToLineage(type: ChangeIntentType): LineageIterationType {
  switch (type) {
    case 'refine_text': return 'text_adjustment';
    case 'refine_visual': return 'visual_adjustment';
    case 'new_concept': return 'new_concept';
    default: return 'visual_adjustment';
  }
}

/**
 * Check whether a text-only adjustment can reuse the existing base image
 * instead of generating a new one.
 */
export function canReuseBaseImage(
  intent: SketchChangeIntent,
  existingResult?: SketchCreativeResult
): boolean {
  if (intent.type !== 'refine_text') return false;
  if (!existingResult) return false;
  if (!existingResult.resourcesForAdjustments.baseImageUrl) return false;
  return intent.keepBaseImage;
}

/**
 * Verify that no selected references have been silently discarded.
 */
export function validateReferencesPreserved(
  order: SketchSimpleOrder,
  processedRefs: string[]
): string[] {
  const issues: string[] = [];
  for (const ref of order.selectedReferences) {
    if (!processedRefs.includes(ref.attachmentId)) {
      issues.push(
        `Referência "${ref.attachmentId}" foi selecionada mas não processada. ` +
        `Nenhum anexo deve ser descartado silenciosamente.`
      );
    }
  }
  return issues;
}
