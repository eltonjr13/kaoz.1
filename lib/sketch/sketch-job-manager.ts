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
import { validateAttachmentBuffer } from './sketch-attachment-validator.ts';
import { buildSketchProviderReference } from './sketch-reference-builder.ts';
import { cleanupTemporaryReference } from '../flow/reference-files.ts';
import { browserImageContext, withBrowserImageTransport } from '../flow/browser-image-context.ts';

async function resolveDefaultFlowProvider(): Promise<FlowImageProviderContract> {
  const mod = await import('../../src/providers/flow/FlowProvider.ts');
  return mod.flowProvider as unknown as FlowImageProviderContract;
}
import type {
  BackgroundLayer,
  GenerationHistoryItem,
  SketchAttachment,
  SketchJobData,
  SketchJobResult,
  SketchJobSnapshot,
  SketchJobStep,
  SketchLayer,
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
  if (flowResult.path) return flowResult.path;
  if (Array.isArray(flowResult.paths) && flowResult.paths.length > 0 && flowResult.paths[0]) {
    return flowResult.paths[0];
  }
  const anyResult = flowResult as unknown as { images?: Array<{ path?: string }> };
  if (Array.isArray(anyResult.images) && anyResult.images.length > 0 && anyResult.images[0]?.path) {
    return anyResult.images[0].path;
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
  projectsDir?: string;
  flowProvider?: FlowImageProviderContract;
}

export interface EnqueueSketchJobParams {
  projectId: string;
  idempotencyToken?: string;
  referenceDataUrl?: string;
  model?: string;
  browserTransportToken?: string;
}

export class DuplicateJobError extends Error {
  public activeJobId: string;
  constructor(message: string, activeJobId: string) {
    super(message);
    this.name = 'DuplicateJobError';
    this.activeJobId = activeJobId;
  }
}

export function extractBufferFromDataUrl(dataUrl: string): Buffer | null {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;
  const match = dataUrl.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,(.+)$/);
  if (!match || !match[1]) return null;
  try {
    return Buffer.from(match[1], 'base64');
  } catch {
    return null;
  }
}

interface PersistedJobReference {
  filePath: string;
  sizeBytes: number;
  sha256: string;
  format: string;
  width: number;
  height: number;
}

async function validateAndPersistJobReference(
  jobsDir: string,
  jobId: string,
  dataUrl: string,
  referenceMode: string
): Promise<PersistedJobReference> {
  const buf = extractBufferFromDataUrl(dataUrl);
  if (!buf || buf.length === 0) {
    throw new Error(
      `Imagem de referência visual para o modo "${referenceMode}" possui formato dataUrl inválido ou base64 vazio.`
    );
  }

  const validation = await validateAttachmentBuffer(buf);
  if (!validation.valid) {
    throw new Error(
      `Referência visual inválida para o modo "${referenceMode}": ${validation.error}`
    );
  }

  await fsp.mkdir(jobsDir, { recursive: true });
  const ext = validation.format === 'jpeg' ? 'jpg' : validation.format;
  const refFilename = `ref_${jobId}.${ext}`;
  const filePath = path.join(jobsDir, refFilename);
  await fsp.writeFile(filePath, buf);

  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

  return {
    filePath,
    sizeBytes: buf.length,
    sha256,
    format: validation.format,
    width: validation.width,
    height: validation.height,
  };
}

export class SketchJobManager {
  private jobsDir: string;
  private assetsDir: string;
  private projectsDir?: string;
  private flowProvider?: FlowImageProviderContract;
  private activeJobsMap = new Map<string, SketchJobData>();
  private queueProcessing = false;
  private executionQueue: string[] = [];
  private browserTransportTokens?: Map<string, string>;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private processId = `proc-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

  constructor(options?: SketchJobManagerOptions) {
    this.jobsDir = options?.jobsDir || getSketchJobsDir();
    this.assetsDir = options?.assetsDir || getSketchAssetsDir();
    this.projectsDir = options?.projectsDir;
    this.flowProvider = options?.flowProvider;
  }

  public getProcessId(): string {
    return this.processId;
  }

  private getBrowserTransportTokens(): Map<string, string> {
    return this.browserTransportTokens ??= new Map<string, string>();
  }

  public async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (!this.initPromise) {
      this.initPromise = this.performInitialization();
    }
    await this.initPromise;
  }

  private async performInitialization(): Promise<void> {
    await this.recoverInterruptedJobs();
    this.initialized = true;
  }

  private async getEffectiveFlowProvider(): Promise<FlowImageProviderContract> {
    if (!this.flowProvider) {
      this.flowProvider = await resolveDefaultFlowProvider();
    }
    return this.flowProvider;
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

  private async readJobFromDisk(id: string): Promise<SketchJobData | null> {
    if (!isValidJobId(id)) return null;
    const filePath = this.getJobFilePath(id);
    try {
      const raw = await fsp.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as SketchJobData;
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'ENOENT') return null;
      throw err;
    }
  }

  public async getJob(id: string): Promise<SketchJobData | null> {
    if (!isValidJobId(id)) return null;
    await this.ensureInitialized();
    const cached = this.activeJobsMap.get(id);
    if (cached) return cached;

    const job = await this.readJobFromDisk(id);
    if (job) {
      this.activeJobsMap.set(job.id, job);
    }
    return job;
  }

  public async listJobs(filter?: { projectId?: string; status?: SketchJobStep }): Promise<SketchJobData[]> {
    await this.ensureInitialized();
    await fsp.mkdir(this.jobsDir, { recursive: true });
    const entries = await fsp.readdir(this.jobsDir, { withFileTypes: true });
    const jobs: SketchJobData[] = [];
    const seenIds = new Set<string>();

    for (const entry of entries) {
      if (!entry.isFile() || !isJobFile(entry.name)) continue;
      const job = await this.getJob(entry.name.replace(/\.json$/, ''));
      if (job && matchesJobFilter(job, filter)) {
        jobs.push(job);
        seenIds.add(job.id);
      }
    }

    for (const activeJob of this.activeJobsMap.values()) {
      if (!seenIds.has(activeJob.id) && matchesJobFilter(activeJob, filter)) {
        jobs.push(activeJob);
        seenIds.add(activeJob.id);
      }
    }

    return jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async findActiveJobForProject(projectId: string): Promise<SketchJobData | null> {
    await this.ensureInitialized();
    const jobs = await this.listJobs({ projectId });
    return jobs.find((j) => isJobActive(j.status)) || null;
  }

  public async isAttachmentInUse(attachmentId: string): Promise<boolean> {
    await this.ensureInitialized();
    const activeJobs = (await this.listJobs()).filter((j) => isJobActive(j.status));
    for (const job of activeJobs) {
      const atts = job.snapshot.attachments || [];
      if (atts.some((a) => a.id === attachmentId)) {
        return true;
      }
    }
    return false;
  }

  private shouldRecoverJob(job: SketchJobData): boolean {
    if (!isJobActive(job.status)) return false;
    if (job.processId === this.processId && this.activeJobsMap.has(job.id)) {
      return false;
    }
    return true;
  }

  private async markJobInterrupted(job: SketchJobData): Promise<void> {
    job.status = 'interrupted';
    job.stepMessage = 'Trabalho interrompido pelo reinício do servidor. Não reexecutado automaticamente.';
    job.cancellationExplanation = 'Interrompido por reinício do processo. O resultado anterior é desconhecido.';
    job.error = 'Processo finalizado inesperadamente antes da conclusão.';
    this.cleanupJobTempFiles(job.tempFilesToCleanup);
    job.tempFilesToCleanup = [];
    await this.persistJob(job);
  }

  public async recoverInterruptedJobs(): Promise<number> {
    await fsp.mkdir(this.jobsDir, { recursive: true });
    const entries = await fsp.readdir(this.jobsDir, { withFileTypes: true });
    let recoveredCount = 0;

    for (const entry of entries) {
      if (!entry.isFile() || !isJobFile(entry.name)) continue;
      const id = entry.name.replace(/\.json$/, '');
      const job = await this.readJobFromDisk(id);
      if (job && this.shouldRecoverJob(job)) {
        await this.markJobInterrupted(job);
        recoveredCount++;
      }
    }

    return recoveredCount;
  }

  private cleanupJobTempFiles(files?: string[]): void {
    if (!files || files.length === 0) return;
    for (const file of files) {
      try {
        if (file && fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch {
        // Ignorar erros de limpeza secundária
      }
    }
  }

  private createSnapshot(
    project: SketchProjectData,
    compiled: import('../../types/sketch.ts').SketchGenerationRequest,
    persistedRef?: PersistedJobReference
  ): SketchJobSnapshot {
    const dims = persistedRef ? { width: persistedRef.width, height: persistedRef.height } : undefined;
    return {
      projectId: project.id,
      projectTitle: project.title,
      originProjectVersion: project.snapshots?.length || 0,
      originProject: JSON.parse(JSON.stringify(project)),
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
      referenceKind: compiled.referenceKind,
      referenceImagePath: persistedRef?.filePath,
      referenceFileSizeBytes: persistedRef?.sizeBytes,
      referenceSha256: persistedRef?.sha256,
      referenceDimensions: dims,
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
    await this.ensureInitialized();
    const lockKey = `enqueue:${this.jobsDir}:${params.projectId}`;
    return await serializeWrite(lockKey, async () => {
      return await this.createAndEnqueueJobInternal(params);
    });
  }

  private async createAndEnqueueJobInternal(params: EnqueueSketchJobParams): Promise<SketchJobData> {
    const project = await getProject(params.projectId, this.projectsDir);
    if (!project) {
      throw new Error(`Projeto não encontrado: "${params.projectId}"`);
    }

    const existingJobs = await this.listJobs({ projectId: params.projectId });
    const existing = this.checkDuplicateSubmission(existingJobs, params.projectId, params.idempotencyToken);
    if (existing) {
      return existing;
    }

    const compiled = prepareSketchCompositeReference(project, {
      referenceDataUrlOverride: params.referenceDataUrl,
    });

    // The Flow provider accepts one reference per request, so the single image
    // is assembled here from every reference the user actually selected. The
    // sketch the interface sends is one ingredient, never a replacement for the
    // attached product/reference images.
    const builtReference = await buildSketchProviderReference({
      project,
      providerAspectRatio: compiled.providerAspectRatio,
      clientSketchDataUrl: params.referenceDataUrl,
      assetsDir: this.assetsDir,
    });
    compiled.referenceMode = builtReference.mode;
    compiled.referenceKind = builtReference.kind;
    compiled.preparedReferenceImage = builtReference.dataUrl;
    compiled.diagnostics.push(...builtReference.diagnostics);
    if (compiled.compositePreview) {
      compiled.compositePreview.dataUrl = builtReference.dataUrl;
      compiled.compositePreview.includedReferencesCount = builtReference.attachmentIds.length;
      compiled.compositePreview.includedRoles = builtReference.includedRoles;
    }

    const id = `job-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    let persistedRef: PersistedJobReference | undefined;

    if (compiled.referenceMode !== 'none') {
      const refDataUrl = builtReference.dataUrl;
      if (!refDataUrl) {
        throw new Error(
          `Referência visual obrigatória ausente para o modo "${compiled.referenceMode}". A geração foi abortada sem fallback silencioso.`
        );
      }
      persistedRef = await validateAndPersistJobReference(this.jobsDir, id, refDataUrl, compiled.referenceMode);
    }

    const snapshot = this.createSnapshot(project, compiled, persistedRef);
    const now = new Date().toISOString();

    const job: SketchJobData = {
      schemaVersion: 1,
      version: '1.0.0',
      id,
      projectId: params.projectId,
      processId: this.processId,
      idempotencyToken: params.idempotencyToken,
      status: 'queued',
      progressPercentage: 5,
      stepMessage: 'Trabalho enfileirado no estúdio Sketch.',
      snapshot,
      referenceImagePath: persistedRef?.filePath,
      tempFilesToCleanup: persistedRef ? [persistedRef.filePath] : [],
      createdAt: now,
      updatedAt: now,
    };

    await this.persistJob(job);
    const browserTransportToken = params.browserTransportToken || browserImageContext.getStore();
    if (browserTransportToken) this.getBrowserTransportTokens().set(job.id, browserTransportToken);
    this.executionQueue.push(job.id);
    void this.processNextInQueue();
    return job;
  }

  public async cancelJob(id: string): Promise<SketchJobData> {
    await this.ensureInitialized();
    const job = await this.getJob(id);
    if (!job) {
      throw new Error(`Trabalho não encontrado: "${id}"`);
    }

    if (isJobTerminal(job.status)) {
      return job;
    }

    const wasRunning = job.status !== 'queued';
    job.cancellationRequested = true;
    job.status = 'cancelled';

    if (wasRunning) {
      job.cancellationExplanation =
        'A geração em andamento no navegador foi descartada e o resultado não será aplicado ao projeto.';
      job.stepMessage = 'Geração cancelada. Operação no navegador descartada.';
    } else {
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
        const browserTransportTokens = this.getBrowserTransportTokens();
        const browserTransportToken = browserTransportTokens.get(job.id);
        try {
          await withBrowserImageTransport(browserTransportToken, () => this.executeJob(job));
        } finally {
          browserTransportTokens.delete(job.id);
        }
      }
    }

    this.queueProcessing = false;
  }

  public async verifyGeneratedFile(filePath: string): Promise<{
    valid: boolean;
    sizeBytes: number;
    width?: number;
    height?: number;
    format?: string;
    error?: string;
  }> {
    if (!filePath || !fs.existsSync(filePath)) {
      return { valid: false, sizeBytes: 0, error: 'Arquivo gerado não existe no disco.' };
    }
    let buf: Buffer;
    try {
      buf = await fsp.readFile(filePath);
    } catch (err: unknown) {
      return { valid: false, sizeBytes: 0, error: `Falha ao ler arquivo gerado: ${toErrorMessage(err)}` };
    }
    if (buf.length <= 0) {
      return { valid: false, sizeBytes: 0, error: 'Arquivo gerado está corrompido ou vazio (0 bytes).' };
    }

    const validation = await validateAttachmentBuffer(buf);
    if (!validation.valid) {
      return { valid: false, sizeBytes: buf.length, error: `Arquivo gerado inválido: ${validation.error}` };
    }

    return {
      valid: true,
      sizeBytes: buf.length,
      width: validation.width,
      height: validation.height,
      format: validation.format,
    };
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
    const project = await getProject(projectId, this.projectsDir);
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
    const baseProjectForSnapshot = job.snapshot.originProject || project;

    const snapshot: SketchVersionSnapshot = {
      id: snapId,
      versionNumber: nextVer,
      label: `Arte Gerada #${nextVer} (${job.snapshot.providerAspectRatio})`,
      timestamp: new Date().toISOString(),
      project: JSON.parse(JSON.stringify({ ...baseProjectForSnapshot, snapshots: [] })),
    };

    project.generationHistory = [historyItem, ...(project.generationHistory || [])];
    project.snapshots = [snapshot, ...(project.snapshots || [])];
    await saveProject(project, this.projectsDir, this.assetsDir);

    return { versionNumber: nextVer, snapshotId: snapId };
  }

  private async prepareJobExecution(job: SketchJobData): Promise<string | undefined> {
    job.status = 'preparing_reference';
    job.progressPercentage = 20;
    job.stepMessage = 'Preparando referência e parâmetros visuais.';
    await this.persistJob(job);

    if (job.snapshot.referenceMode === 'none') {
      return undefined;
    }

    const refPath = job.referenceImagePath || job.snapshot.referenceImagePath;
    if (!refPath || !fs.existsSync(refPath)) {
      throw new Error(
        `Referência visual obrigatória para o modo "${job.snapshot.referenceMode}" não foi encontrada no disco (${refPath || 'indefinida'}). A geração foi abortada para evitar resultados incorretos.`
      );
    }

    const stat = fs.statSync(refPath);
    if (stat.size === 0) {
      throw new Error(
        `Arquivo de referência visual "${path.basename(refPath)}" está vazio (0 bytes). A geração foi abortada para evitar resultados incorretos.`
      );
    }

    job.referenceImagePath = refPath;
    return refPath;
  }

  private async waitForLockAndGenerate(
    job: SketchJobData,
    referenceImage?: string
  ): Promise<ImageGenerationResult> {
    job.status = 'waiting_flow_lock';
    job.progressPercentage = 35;
    job.stepMessage = 'Aguardando liberação de lock exclusivo do FlowProvider.';
    await this.persistJob(job);

    const isRefRequired = job.snapshot.referenceMode !== 'none';
    const flowOptions: ImageGenerationOptions = {
      operation: isRefRequired ? 'reference' : 'simple',
      aspectRatio: job.snapshot.providerAspectRatio,
      referenceImage: isRefRequired ? referenceImage : undefined,
      referenceKind: isRefRequired ? job.snapshot.referenceKind : undefined,
      // The sketch pipeline already compiled the prompt with the operation,
      // aspect ratio and reference kind. Re-preparing it downstream truncated
      // the user's idea and the creative directives.
      promptPrepared: true,
    };

    const provider = await this.getEffectiveFlowProvider();
    return await provider.generateImageWithProgress(
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

    const verification = await this.verifyGeneratedFile(rawImagePath);
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
    const project = await getProject(projectId, this.projectsDir);
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
    return await saveProject(project, this.projectsDir, this.assetsDir);
  }
}

// Global singleton instance for production runtime
const globalForSketchJobs = globalThis as unknown as {
  sketchJobManagerInstance?: SketchJobManager;
};

export const sketchJobManager =
  globalForSketchJobs.sketchJobManagerInstance ?? new SketchJobManager();

if (process.env.NODE_ENV !== 'production') {
  Object.setPrototypeOf(sketchJobManager, SketchJobManager.prototype);
  globalForSketchJobs.sketchJobManagerInstance = sketchJobManager;
}
