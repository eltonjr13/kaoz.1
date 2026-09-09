import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  getSketchJobsDir,
  getSketchAssetsDir,
} from '../runtime-paths.ts';
import {
  atomicWriteJsonFile,
  serializeWrite,
  getProject,
  saveProject,
} from './sketch-storage.ts';
import { prepareSketchCompositeReference } from './sketch-composite-preparer.ts';
import { saveBase64ReferenceImage, cleanupTemporaryReference } from '../flow/reference-files.ts';
import { flowProvider as defaultFlowProvider } from '../../src/providers/flow/FlowProvider.ts';
import type {
  BackgroundLayer,
  GenerationHistoryItem,
  SketchAttachment,
  SketchJobData,
  SketchJobResult,
  SketchJobSnapshot,
  SketchJobStep,
  SketchProjectData,
  SketchVersionSnapshot,
} from '../../types/sketch.ts';
import type { ImageGenerationOptions, ImageGenerationResult } from '../../src/providers/flow/FlowTypes.ts';

const SAFE_JOB_ID_REGEX = /^job-[a-zA-Z0-9_-]{1,128}$/;

export const ACTIVE_JOB_STEPS = new Set<SketchJobStep>([
  'queued',
  'preparing_reference',
  'waiting_flow_lock',
  'generating_with_flow',
  'verifying_output',
]);

export const TERMINAL_JOB_STEPS = new Set<SketchJobStep>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

function matchesJobFilter(job: SketchJobData, filter?: { projectId?: string; status?: SketchJobStep }): boolean {
  if (filter?.projectId && job.projectId !== filter.projectId) return false;
  if (filter?.status && job.status !== filter.status) return false;
  return true;
}

function isJobFile(entryName: string): boolean {
  return entryName.endsWith('.json') && isValidJobId(entryName.replace(/\.json$/, ''));
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isJobCancelledOrAborted(job: SketchJobData): boolean {
  return Boolean(job.cancellationRequested || job.status === 'cancelled');
}

function extractFirstImagePath(flowResult: ImageGenerationResult): string {
  const images = flowResult.images;
  if (Array.isArray(images) && images.length > 0 && images[0]?.path) {
    return images[0].path;
  }
  return '';
}

export function isValidJobId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  return SAFE_JOB_ID_REGEX.test(id) && !id.includes('..');
}

export function isJobActive(status: SketchJobStep): boolean {
  return ACTIVE_JOB_STEPS.has(status);
}

export function isJobTerminal(status: SketchJobStep): boolean {
  return TERMINAL_JOB_STEPS.has(status);
}

export interface FlowImageProviderContract {
  generateImageWithProgress(
    prompt: string,
    options?: ImageGenerationOptions,
    onLockAcquired?: () => void
  ): Promise<ImageGenerationResult>;
  isBrowserBusy?(): boolean;
}

export interface SketchJobManagerOptions {
  jobsDir?: string;
  assetsDir?: string;
  flowProvider?: FlowImageProviderContract;
}

export interface EnqueueSketchJobParams {
  projectId: string;
  idempotencyToken?: string;
  referenceDataUrl?: string;
  model?: string;
}

export class DuplicateJobError extends Error {
  public activeJobId: string;
  constructor(message: string, activeJobId: string) {
    super(message);
    this.name = 'DuplicateJobError';
    this.activeJobId = activeJobId;
  }
}

export class SketchJobManager {
  private jobsDir: string;
  private assetsDir: string;
  private flowProvider: FlowImageProviderContract;
  private activeJobsMap = new Map<string, SketchJobData>();
  private queueProcessing = false;
  private executionQueue: string[] = [];

  constructor(options?: SketchJobManagerOptions) {
    this.jobsDir = options?.jobsDir || getSketchJobsDir();
    this.assetsDir = options?.assetsDir || getSketchAssetsDir();
    this.flowProvider = options?.flowProvider || (defaultFlowProvider as unknown as FlowImageProviderContract);
  }

  public getJobsDirectory(): string {
    return this.jobsDir;
  }

  public getJobFilePath(id: string): string {
    if (!isValidJobId(id)) {
      throw new Error(`Invalid job ID: "${id}"`);
    }
    return path.join(this.jobsDir, `${id}.json`);
  }

  private async persistJob(job: SketchJobData): Promise<SketchJobData> {
    job.updatedAt = new Date().toISOString();
    const filePath = this.getJobFilePath(job.id);
    await serializeWrite(filePath, async () => {
      await atomicWriteJsonFile(filePath, job);
    });
    this.activeJobsMap.set(job.id, job);
    return job;
  }

  public async getJob(id: string): Promise<SketchJobData | null> {
    if (!isValidJobId(id)) return null;
    const cached = this.activeJobsMap.get(id);
    if (cached) return cached;

    const filePath = this.getJobFilePath(id);
    try {
      const raw = await fsp.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as SketchJobData;
      this.activeJobsMap.set(parsed.id, parsed);
      return parsed;
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'ENOENT') return null;
      throw err;
    }
  }

  public async listJobs(filter?: { projectId?: string; status?: SketchJobStep }): Promise<SketchJobData[]> {
    await fsp.mkdir(this.jobsDir, { recursive: true });
    const entries = await fsp.readdir(this.jobsDir, { withFileTypes: true });
    const jobs: SketchJobData[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !isJobFile(entry.name)) continue;
      const job = await this.getJob(entry.name.replace(/\.json$/, ''));
      if (job && matchesJobFilter(job, filter)) {
        jobs.push(job);
      }
    }

    return jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async findActiveJobForProject(projectId: string): Promise<SketchJobData | null> {
    const jobs = await this.listJobs({ projectId });
    return jobs.find((j) => isJobActive(j.status)) || null;
  }

  public async isAttachmentInUse(attachmentId: string): Promise<boolean> {
    const activeJobs = (await this.listJobs()).filter((j) => isJobActive(j.status));
    for (const job of activeJobs) {
      const atts = job.snapshot.attachments || [];
      if (atts.some((a) => a.id === attachmentId)) {
        return true;
      }
    }
    return false;
  }

  public async recoverInterruptedJobs(): Promise<number> {
    await fsp.mkdir(this.jobsDir, { recursive: true });
    const jobs = await this.listJobs();
    let recoveredCount = 0;

    for (const job of jobs) {
      if (isJobActive(job.status)) {
        job.status = 'interrupted';
        job.stepMessage = 'Trabalho interrompido pelo reinício do servidor. Não reexecutado automaticamente.';
        job.cancellationExplanation = 'Interrompido por reinício do processo. O resultado anterior é desconhecido.';
        job.error = 'Processo finalizado inesperadamente antes da conclusão.';
        this.cleanupJobTempFiles(job.tempFilesToCleanup);
        job.tempFilesToCleanup = [];
        await this.persistJob(job);
        recoveredCount++;
      }
    }

    return recoveredCount;
  }

  private cleanupJobTempFiles(files?: string[]): void {
    if (!files || files.length === 0) return;
    for (const file of files) {
      try {
        cleanupTemporaryReference(file);
      } catch {
        // Ignorar erros de limpeza secundária
      }
    }
  }

  private createSnapshot(project: SketchProjectData, referenceDataUrl?: string): SketchJobSnapshot {
    const compiled = prepareSketchCompositeReference(project, {
      referenceDataUrlOverride: referenceDataUrl,
    });

    return {
      projectId: project.id,
      projectTitle: project.title,
      briefing: JSON.parse(JSON.stringify(project.briefing || {})),
      copy: JSON.parse(JSON.stringify(project.copy)),
      layers: JSON.parse(JSON.stringify(project.layers)),
      attachments: JSON.parse(JSON.stringify(project.attachments)),
      canvasAspectRatio: project.canvasAspectRatio || project.aspectRatio || '1:1',
      providerAspectRatio: compiled.providerAspectRatio,
      canvasDimensions: project.canvasDimensions,
      prompt: project.prompt,
      useSketchAsReference: project.useSketchAsReference !== false,
      referenceMode: compiled.referenceMode,
      compositionIntent: compiled.compositionIntent,
      textRenderingStrategy: compiled.textRenderingStrategy,
      compiledPrompt: compiled.preparedPrompt,
      diagnostics: compiled.diagnostics,
    };
  }

  private checkDuplicateSubmission(
    existingJobs: SketchJobData[],
    projectId: string,
    idempotencyToken?: string
  ): SketchJobData | null {
    if (idempotencyToken) {
      const match = existingJobs.find(
        (j) => j.idempotencyToken === idempotencyToken && j.projectId === projectId
      );
      if (match) return match;
    }

    const active = existingJobs.find((j) => j.projectId === projectId && isJobActive(j.status));
    if (active) {
      throw new DuplicateJobError(
        `Já existe uma geração em andamento para este projeto (Job: ${active.id}). Aguarde a conclusão ou cancele o trabalho ativo.`,
        active.id
      );
    }
    return null;
  }

  public async enqueueJob(params: EnqueueSketchJobParams): Promise<SketchJobData> {
    const project = await getProject(params.projectId);
    if (!project) {
      throw new Error(`Projeto não encontrado: "${params.projectId}"`);
    }

    const existingJobs = await this.listJobs({ projectId: params.projectId });
    const existing = this.checkDuplicateSubmission(existingJobs, params.projectId, params.idempotencyToken);
    if (existing) {
      return existing;
    }

    const snapshot = this.createSnapshot(project, params.referenceDataUrl);
    const id = `job-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const now = new Date().toISOString();

    const job: SketchJobData = {
      schemaVersion: 1,
      version: '1.0.0',
      id,
      projectId: params.projectId,
      idempotencyToken: params.idempotencyToken,
      status: 'queued',
      progressPercentage: 5,
      stepMessage: 'Trabalho enfileirado no estúdio Sketch.',
      snapshot,
      tempFilesToCleanup: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.persistJob(job);
    this.executionQueue.push(job.id);
    void this.processNextInQueue();
    return job;
  }

  public async cancelJob(id: string): Promise<SketchJobData> {
    const job = await this.getJob(id);
    if (!job) {
      throw new Error(`Trabalho não encontrado: "${id}"`);
    }

    if (isJobTerminal(job.status)) {
      return job;
    }

    if (job.status === 'generating_with_flow') {
      job.cancellationRequested = true;
      job.status = 'cancelled';
      job.cancellationExplanation =
        'A geração em andamento no navegador foi descartada e o resultado não será aplicado ao projeto.';
      job.stepMessage = 'Geração cancelada. Operação no navegador descartada.';
    } else {
      job.status = 'cancelled';
      job.cancellationExplanation = 'Trabalho cancelado antes de iniciar a geração no navegador.';
      job.stepMessage = 'Trabalho cancelado com sucesso.';
      this.cleanupJobTempFiles(job.tempFilesToCleanup);
      job.tempFilesToCleanup = [];
    }

    await this.persistJob(job);
    return job;
  }

  private async processNextInQueue(): Promise<void> {
    if (this.queueProcessing || this.executionQueue.length === 0) return;
    this.queueProcessing = true;

    while (this.executionQueue.length > 0) {
      const jobId = this.executionQueue.shift()!;
      const job = await this.getJob(jobId);
      if (job && !isJobTerminal(job.status)) {
        await this.executeJob(job);
      }
    }

    this.queueProcessing = false;
  }

  private resolveReferenceImage(job: SketchJobData): string | undefined {
    if (job.snapshot.referenceMode === 'none') return undefined;

    const placedAtt = job.snapshot.attachments?.find(
      (a) => a.role === 'product' || a.role === 'reference' || a.role === 'composition'
    );

    if (placedAtt && placedAtt.filePath) {
      const fullPath = path.join(this.assetsDir, placedAtt.filePath);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
    return undefined;
  }

  private prepareJobReference(job: SketchJobData): string | undefined {
    if (job.snapshot.referenceMode === 'none') return undefined;

    const resolved = this.resolveReferenceImage(job);
    if (resolved) return resolved;

    const base64Att = job.snapshot.attachments?.find((a) => a.dataUrl?.startsWith('data:image/'));
    if (base64Att?.dataUrl) {
      const saved = saveBase64ReferenceImage(base64Att.dataUrl, `ref_${job.id}`);
      job.tempFilesToCleanup = job.tempFilesToCleanup || [];
      job.tempFilesToCleanup.push(saved.filePath);
      return saved.filePath;
    }

    return undefined;
  }

  private verifyGeneratedFile(filePath: string): { valid: boolean; sizeBytes: number; error?: string } {
    if (!filePath || !fs.existsSync(filePath)) {
      return { valid: false, sizeBytes: 0, error: 'Arquivo gerado não existe no disco.' };
    }
    const stat = fs.statSync(filePath);
    if (stat.size <= 0) {
      return { valid: false, sizeBytes: 0, error: 'Arquivo gerado está corrompido ou vazio (0 bytes).' };
    }
    return { valid: true, sizeBytes: stat.size };
  }

  private async copyToSketchAssets(sourcePath: string, jobId: string): Promise<{ assetPath: string; assetUrl: string; filename: string }> {
    await fsp.mkdir(this.assetsDir, { recursive: true });
    const ext = path.extname(sourcePath) || '.png';
    const filename = `gen-${jobId}${ext}`;
    const targetPath = path.join(this.assetsDir, filename);

    await fsp.copyFile(sourcePath, targetPath);
    return {
      assetPath: targetPath,
      assetUrl: `/api/sketch/assets/${filename}`,
      filename,
    };
  }

  private async applyVersionToProject(
    projectId: string,
    job: SketchJobData,
    result: SketchJobResult
  ): Promise<{ versionNumber: number; snapshotId: string }> {
    const project = await getProject(projectId);
    if (!project) {
      return { versionNumber: 1, snapshotId: `snap-${Date.now()}` };
    }

    const historyItem: GenerationHistoryItem = {
      id: `gen-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      prompt: job.snapshot.compiledPrompt,
      imageUrl: result.imageUrl,
      flowPath: result.imagePath,
      aspectRatio: job.snapshot.providerAspectRatio,
      providerAspectRatio: job.snapshot.providerAspectRatio,
      canvasAspectRatio: job.snapshot.canvasAspectRatio,
      referenceMode: job.snapshot.referenceMode,
      createdAt: new Date().toISOString(),
    };

    const nextVer = (project.snapshots?.length || 0) + 1;
    const snapId = `snap-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const snapshot: SketchVersionSnapshot = {
      id: snapId,
      versionNumber: nextVer,
      label: `Arte Gerada #${nextVer} (${job.snapshot.providerAspectRatio})`,
      timestamp: new Date().toISOString(),
      project: JSON.parse(JSON.stringify({ ...project, snapshots: [] })),
    };

    project.generationHistory = [historyItem, ...(project.generationHistory || [])];
    project.snapshots = [snapshot, ...(project.snapshots || [])];
    await saveProject(project);

    return { versionNumber: nextVer, snapshotId: snapId };
  }

  private async prepareJobExecution(job: SketchJobData): Promise<string | undefined> {
    job.status = 'preparing_reference';
    job.progressPercentage = 20;
    job.stepMessage = 'Preparando referência e parâmetros visuais.';
    await this.persistJob(job);

    const referenceImage = this.prepareJobReference(job);
    job.referenceImagePath = referenceImage;
    return referenceImage;
  }

  private async waitForLockAndGenerate(
    job: SketchJobData,
    referenceImage?: string
  ): Promise<ImageGenerationResult> {
    job.status = 'waiting_flow_lock';
    job.progressPercentage = 35;
    job.stepMessage = 'Aguardando liberação de lock exclusivo do FlowProvider.';
    await this.persistJob(job);

    const flowOptions: ImageGenerationOptions = {
      operation: referenceImage ? 'reference' : 'simple',
      aspectRatio: job.snapshot.providerAspectRatio,
      referenceImage,
      referenceKind: referenceImage ? 'composite' : undefined,
    };

    return await this.flowProvider.generateImageWithProgress(
      job.snapshot.compiledPrompt,
      flowOptions,
      () => {
        if (job.status !== 'cancelled') {
          job.status = 'generating_with_flow';
          job.progressPercentage = 60;
          job.stepMessage = 'Gerando anúncio com FlowProvider no navegador.';
          void this.persistJob(job);
        }
      }
    );
  }

  private handleCancelledGeneration(job: SketchJobData): void {
    job.status = 'cancelled';
    job.cancellationExplanation =
      'A geração em andamento no navegador foi descartada e o resultado não será aplicado ao projeto.';
    job.stepMessage = 'Geração descartada após cancelamento.';
  }

  private async completeVerifiedJob(
    job: SketchJobData,
    rawImagePath: string,
    fileSizeBytes: number
  ): Promise<void> {
    const asset = await this.copyToSketchAssets(rawImagePath, job.id);
    const result: SketchJobResult = {
      imagePath: asset.assetPath,
      imageUrl: asset.assetUrl,
      filename: asset.filename,
      fileSizeBytes,
      providerAspectRatio: job.snapshot.providerAspectRatio,
      canvasAspectRatio: job.snapshot.canvasAspectRatio,
    };

    const verInfo = await this.applyVersionToProject(job.projectId, job, result);
    result.versionNumber = verInfo.versionNumber;
    result.snapshotId = verInfo.snapshotId;

    job.result = result;
    job.status = 'completed';
    job.progressPercentage = 100;
    job.stepMessage = `Arte gerada com sucesso e salva como Versão #${verInfo.versionNumber}.`;
    job.completedAt = new Date().toISOString();
  }

  private async verifyAndFinalize(job: SketchJobData, rawImagePath: string): Promise<void> {
    job.status = 'verifying_output';
    job.progressPercentage = 85;
    job.stepMessage = 'Validando arquivo de imagem gerado.';
    await this.persistJob(job);

    const verification = this.verifyGeneratedFile(rawImagePath);
    if (!verification.valid) {
      job.status = 'failed';
      job.progressPercentage = 100;
      job.error = verification.error || 'Arquivo de imagem inválido.';
      job.stepMessage = 'Falha na validação do arquivo de imagem gerado.';
      return;
    }

    await this.completeVerifiedJob(job, rawImagePath, verification.sizeBytes);
  }

  private async executeJob(job: SketchJobData): Promise<void> {
    job.startedAt = new Date().toISOString();
    try {
      if (isJobCancelledOrAborted(job)) return;
      const ref = await this.prepareJobExecution(job);

      if (isJobCancelledOrAborted(job)) return;
      const flowResult = await this.waitForLockAndGenerate(job, ref);

      if (isJobCancelledOrAborted(job)) {
        this.handleCancelledGeneration(job);
        await this.persistJob(job);
        return;
      }

      if (!flowResult.success) {
        job.status = 'failed';
        job.progressPercentage = 100;
        job.error = flowResult.error || 'Falha desconhecida na geração pelo FlowProvider.';
        job.stepMessage = 'A geração falhou no FlowProvider.';
        await this.persistJob(job);
        return;
      }

      await this.verifyAndFinalize(job, extractFirstImagePath(flowResult));
      await this.persistJob(job);
    } catch (err: unknown) {
      const msg = toErrorMessage(err);
      job.status = 'failed';
      job.progressPercentage = 100;
      job.error = msg;
      job.stepMessage = `Erro interno durante a geração: ${msg}`;
      await this.persistJob(job);
    } finally {
      this.cleanupJobTempFiles(job.tempFilesToCleanup);
      job.tempFilesToCleanup = [];
      await this.persistJob(job);
    }
  }

  public async applyResultAsBackgroundLayer(
    projectId: string,
    imageUrl: string,
    flowMediaPath?: string
  ): Promise<SketchProjectData> {
    const project = await getProject(projectId);
    if (!project) {
      throw new Error(`Projeto não encontrado: "${projectId}"`);
    }

    const updatedLayers = project.layers.map((l) => {
      if (l.type === 'background') {
        const bg = l as BackgroundLayer;
        return {
          ...bg,
          fillType: 'image' as const,
          imageUrl,
          flowMediaPath,
          color: undefined,
        };
      }
      return l;
    });

    project.layers = updatedLayers;
    return await saveProject(project);
  }
}

// Global singleton instance for production runtime
const globalForSketchJobs = globalThis as unknown as {
  sketchJobManagerInstance?: SketchJobManager;
};

export const sketchJobManager =
  globalForSketchJobs.sketchJobManagerInstance ?? new SketchJobManager();

if (process.env.NODE_ENV !== 'production') {
  globalForSketchJobs.sketchJobManagerInstance = sketchJobManager;
}
