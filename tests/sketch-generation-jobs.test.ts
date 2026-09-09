import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  SketchJobManager,
  DuplicateJobError,
  type FlowImageProviderContract,
} from '../lib/sketch/sketch-job-manager.ts';
import {
  createDefaultProject,
  saveProject,
  getProject,
} from '../lib/sketch/sketch-storage.ts';
import type { ImageGenerationOptions, ImageGenerationResult } from '../src/providers/flow/FlowTypes.ts';

const SAMPLE_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
  0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54,
  0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
  0x0d, 0x0a, 0x2d, 0xb4,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

async function createTestEnv() {
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'sketch-job-test-'));
  const jobsDir = path.join(tmpBase, 'jobs');
  const assetsDir = path.join(tmpBase, 'assets');
  const projectsDir = path.join(tmpBase, 'projects');
  await fsp.mkdir(jobsDir, { recursive: true });
  await fsp.mkdir(assetsDir, { recursive: true });
  await fsp.mkdir(projectsDir, { recursive: true });

  const cleanup = async () => {
    await fsp.rm(tmpBase, { recursive: true, force: true }).catch(() => {});
  };

  return { tmpBase, jobsDir, assetsDir, projectsDir, cleanup };
}

class MockFlowProvider implements FlowImageProviderContract {
  public lockAcquiredCount = 0;
  public generateCount = 0;
  public delayMs = 5;
  public shouldFail = false;
  public failErrorMessage = 'Falha simulada no FlowProvider';
  public generateNonExistentFile = false;
  public generateEmptyFile = false;
  public createdFiles: string[] = [];

  async generateImageWithProgress(
    _prompt: string,
    _options?: ImageGenerationOptions,
    onLockAcquired?: () => void
  ): Promise<ImageGenerationResult> {
    this.generateCount++;

    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }

    this.lockAcquiredCount++;
    onLockAcquired?.();

    if (this.shouldFail) {
      return {
        success: false,
        path: '',
        filename: '',
        createdAt: new Date().toISOString(),
        error: this.failErrorMessage,
      };
    }

    if (this.generateNonExistentFile) {
      const missingPath = path.join(os.tmpdir(), 'missing-image-file.png');
      return {
        success: true,
        path: missingPath,
        filename: 'missing.png',
        paths: [missingPath],
        createdAt: new Date().toISOString(),
      };
    }

    const testImgPath = path.join(os.tmpdir(), `mock-flow-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    const content = this.generateEmptyFile ? Buffer.alloc(0) : SAMPLE_PNG_BYTES;
    await fsp.writeFile(testImgPath, content);
    this.createdFiles.push(testImgPath);

    return {
      success: true,
      path: testImgPath,
      filename: path.basename(testImgPath),
      paths: [testImgPath],
      createdAt: new Date().toISOString(),
    };
  }
}

async function waitForJobTerminal(manager: SketchJobManager, jobId: string, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await manager.getJob(jobId);
    if (job && (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'interrupted')) {
      // Drain: let any in-flight persistJob atomic-rename writes settle before the caller cleans up.
      await new Promise((r) => setTimeout(r, 60));
      return job;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Job ${jobId} did not reach terminal state within ${timeoutMs}ms`);
}

test('ciclo de sucesso de job com arquivo real e versionamento incremental', async () => {
  const env = await createTestEnv();
  const mockFlow = new MockFlowProvider();

  try {
    const initial = createDefaultProject({ id: 'proj-success-1', title: 'Campanha Sérum Glow' });
    await saveProject(initial, env.projectsDir, env.assetsDir);

    const manager = new SketchJobManager({
      jobsDir: env.jobsDir,
      assetsDir: env.assetsDir,
      projectsDir: env.projectsDir,
      flowProvider: mockFlow,
    });

    const job = await manager.enqueueJob({ projectId: initial.id });
    const initialStatus = job.status;
    assert.ok(
      initialStatus === 'queued' || initialStatus === 'preparing_reference',
      `Expected queued or preparing_reference immediately after enqueue, got: ${initialStatus}`
    );
    assert.equal(job.snapshot.projectTitle, 'Campanha Sérum Glow');
    assert.ok(job.snapshot.compiledPrompt.length > 0);

    const terminalJob = await waitForJobTerminal(manager, job.id);
    assert.equal(terminalJob.status, 'completed');
    assert.equal(terminalJob.progressPercentage, 100);
    assert.ok(terminalJob.result);
    assert.ok(terminalJob.result.fileSizeBytes > 0);
    assert.ok(terminalJob.result.imageUrl.startsWith('/api/sketch/assets/'));

    assert.ok(fs.existsSync(terminalJob.result.imagePath));
    const stats = fs.statSync(terminalJob.result.imagePath);
    assert.ok(stats.size > 0);

    const updatedProj = await getProject(initial.id, env.projectsDir);
    assert.ok(updatedProj);
    assert.equal(updatedProj.snapshots?.length, 1);
    assert.equal(updatedProj.snapshots?.[0].versionNumber, 1);
    assert.equal(updatedProj.generationHistory.length, 1);
    assert.equal(updatedProj.generationHistory[0].imageUrl, terminalJob.result.imageUrl);
  } finally {
    await env.cleanup();
  }
});

test('ciclo de falha com mensagem descritiva sem registrar versão corrompida', async () => {
  const env = await createTestEnv();
  const mockFlow = new MockFlowProvider();
  mockFlow.shouldFail = true;
  mockFlow.failErrorMessage = 'Quota de GPU excedida no Flow';

  try {
    const proj = createDefaultProject({ id: 'proj-fail-1' });
    await saveProject(proj, env.projectsDir, env.assetsDir);

    const manager = new SketchJobManager({
      jobsDir: env.jobsDir,
      assetsDir: env.assetsDir,
      projectsDir: env.projectsDir,
      flowProvider: mockFlow,
    });

    const job = await manager.enqueueJob({ projectId: proj.id });
    const terminalJob = await waitForJobTerminal(manager, job.id);

    assert.equal(terminalJob.status, 'failed');
    assert.ok(terminalJob.error?.includes('Quota de GPU excedida'));

    const projAfter = await getProject(proj.id, env.projectsDir);
    assert.equal(projAfter?.generationHistory.length, 0);
    assert.equal(projAfter?.snapshots?.length, 0);
  } finally {
    await env.cleanup();
  }
});

test('rejeição estrita de arquivos não existentes ou vazios (sem placeholders)', async () => {
  const env = await createTestEnv();
  const mockFlow = new MockFlowProvider();
  mockFlow.generateNonExistentFile = true;

  try {
    const proj = createDefaultProject({ id: 'proj-missing-1' });
    await saveProject(proj, env.projectsDir, env.assetsDir);

    const manager = new SketchJobManager({
      jobsDir: env.jobsDir,
      assetsDir: env.assetsDir,
      projectsDir: env.projectsDir,
      flowProvider: mockFlow,
    });

    const job = await manager.enqueueJob({ projectId: proj.id });
    const terminalJob = await waitForJobTerminal(manager, job.id);

    assert.equal(terminalJob.status, 'failed');
    assert.ok(terminalJob.error?.includes('não existe'));
  } finally {
    await env.cleanup();
  }
});

test('rejeição de submissão duplicada por clique concorrente e suporte a idempotência', async () => {
  const env = await createTestEnv();
  const mockFlow = new MockFlowProvider();
  mockFlow.delayMs = 150;

  try {
    const proj = createDefaultProject({ id: 'proj-dup-1' });
    await saveProject(proj, env.projectsDir, env.assetsDir);

    const manager = new SketchJobManager({
      jobsDir: env.jobsDir,
      assetsDir: env.assetsDir,
      projectsDir: env.projectsDir,
      flowProvider: mockFlow,
    });

    const job1 = await manager.enqueueJob({
      projectId: proj.id,
      idempotencyToken: 'token-abc-123',
    });

    const job1Repeat = await manager.enqueueJob({
      projectId: proj.id,
      idempotencyToken: 'token-abc-123',
    });
    assert.equal(job1Repeat.id, job1.id);

    await assert.rejects(
      async () => {
        await manager.enqueueJob({
          projectId: proj.id,
          idempotencyToken: 'token-different-456',
        });
      },
      (err: unknown) => {
        return err instanceof DuplicateJobError && err.activeJobId === job1.id;
      }
    );

    await waitForJobTerminal(manager, job1.id);
  } finally {
    await env.cleanup();
  }
});

test('identificação de trabalhos interrompidos após reinício do processo sem reexecução cega', async () => {
  const env = await createTestEnv();

  try {
    const interruptedJobId = 'job-interrupted-sim-1';
    const rawJob = {
      schemaVersion: 1,
      version: '1.0.0',
      id: interruptedJobId,
      projectId: 'proj-sim-1',
      status: 'generating_with_flow',
      progressPercentage: 60,
      stepMessage: 'Gerando com Flow',
      snapshot: {
        projectId: 'proj-sim-1',
        projectTitle: 'Simulação de crash',
        briefing: {},
        copy: {},
        layers: [],
        attachments: [],
        canvasAspectRatio: '1:1',
        providerAspectRatio: '1:1',
        prompt: 'test prompt',
        useSketchAsReference: false,
        referenceMode: 'none',
        compiledPrompt: 'test prompt',
        diagnostics: [],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const filePath = path.join(env.jobsDir, `${interruptedJobId}.json`);
    await fsp.writeFile(filePath, JSON.stringify(rawJob, null, 2));

    const freshManager = new SketchJobManager({
      jobsDir: env.jobsDir,
      assetsDir: env.assetsDir,
    });

    const recoveredCount = await freshManager.recoverInterruptedJobs();
    assert.equal(recoveredCount, 1);

    const recoveredJob = await freshManager.getJob(interruptedJobId);
    assert.ok(recoveredJob);
    assert.equal(recoveredJob.status, 'interrupted');
    assert.ok(recoveredJob.stepMessage.includes('reinício do servidor'));
    assert.ok(recoveredJob.cancellationExplanation?.includes('desconhecido'));
  } finally {
    await env.cleanup();
  }
});

test('cancelamento de trabalho pendente vs em execução com explicação de alcance', async () => {
  const env = await createTestEnv();
  const mockFlow = new MockFlowProvider();
  mockFlow.delayMs = 120;

  try {
    const proj = createDefaultProject({ id: 'proj-cancel-1' });
    await saveProject(proj, env.projectsDir, env.assetsDir);

    const manager = new SketchJobManager({
      jobsDir: env.jobsDir,
      assetsDir: env.assetsDir,
      projectsDir: env.projectsDir,
      flowProvider: mockFlow,
    });

    const job = await manager.enqueueJob({ projectId: proj.id });
    await new Promise((r) => setTimeout(r, 10));

    const cancelledJob = await manager.cancelJob(job.id);
    assert.equal(cancelledJob.status, 'cancelled');
    assert.ok(cancelledJob.cancellationExplanation?.length);

    await waitForJobTerminal(manager, job.id);
    const finalJob = await manager.getJob(job.id);
    assert.equal(finalJob?.status, 'cancelled');
  } finally {
    await env.cleanup();
  }
});

test('preservação de versões sucessivas e histórico de gerações', async () => {
  const env = await createTestEnv();
  const mockFlow = new MockFlowProvider();

  try {
    const proj = createDefaultProject({ id: 'proj-multi-ver-1' });
    await saveProject(proj, env.projectsDir, env.assetsDir);

    const manager = new SketchJobManager({
      jobsDir: env.jobsDir,
      assetsDir: env.assetsDir,
      projectsDir: env.projectsDir,
      flowProvider: mockFlow,
    });

    const job1 = await manager.enqueueJob({ projectId: proj.id });
    await waitForJobTerminal(manager, job1.id);

    const job2 = await manager.enqueueJob({ projectId: proj.id });
    await waitForJobTerminal(manager, job2.id);

    const finalProject = await getProject(proj.id, env.projectsDir);
    assert.ok(finalProject);
    assert.equal(finalProject.snapshots?.length, 2);
    assert.equal(finalProject.snapshots?.[0].versionNumber, 2);
    assert.equal(finalProject.snapshots?.[1].versionNumber, 1);
    assert.equal(finalProject.generationHistory.length, 2);
  } finally {
    await env.cleanup();
  }
});

test('operação de editar resultado atualiza camada de fundo preservando texto por cima', async () => {
  const env = await createTestEnv();

  try {
    const proj = createDefaultProject({ id: 'proj-apply-bg-1' });
    await saveProject(proj, env.projectsDir, env.assetsDir);

    const manager = new SketchJobManager({
      jobsDir: env.jobsDir,
      assetsDir: env.assetsDir,
      projectsDir: env.projectsDir,
    });

    const updated = await manager.applyResultAsBackgroundLayer(
      proj.id,
      '/api/sketch/assets/gen-123.png',
      'storage/flow/generated/gen-123.png'
    );

    const bgLayer = updated.layers.find((l) => l.type === 'background');
    assert.ok(bgLayer);
    assert.equal((bgLayer as { fillType?: string }).fillType, 'image');
    assert.equal((bgLayer as { imageUrl?: string }).imageUrl, '/api/sketch/assets/gen-123.png');

    const textLayers = updated.layers.filter((l) => l.type === 'text');
    assert.ok(textLayers.length >= 3);
    assert.equal(textLayers[0].visible, true);
  } finally {
    await env.cleanup();
  }
});

test('convivência com exclusão mútua do FlowProvider e fila sequencial do navegador', async () => {
  const providerCode = await fsp.readFile(
    path.resolve('src/providers/flow/FlowProvider.ts'),
    'utf-8'
  );
  assert.ok(providerCode.includes('generateImageWithProgress'));
  assert.ok(providerCode.includes('onLockAcquired?.()'));
  assert.ok(providerCode.includes('runBrowserTaskExclusive'));
  assert.ok(providerCode.includes('isBrowserBusy()'));

  let activeInBrowser = 0;
  let maxConcurrent = 0;

  class ConcurrentFlowLockMock implements FlowImageProviderContract {
    private tail: Promise<void> = Promise.resolve();

    async generateImageWithProgress(
      _prompt: string,
      _options?: ImageGenerationOptions,
      onLockAcquired?: () => void
    ): Promise<ImageGenerationResult> {
      const prev = this.tail;
      let release: (() => void) | undefined;
      this.tail = new Promise<void>((res) => {
        release = res;
      });

      await prev;
      try {
        onLockAcquired?.();
        activeInBrowser++;
        maxConcurrent = Math.max(maxConcurrent, activeInBrowser);
        await new Promise((r) => setTimeout(r, 40));
        activeInBrowser--;
        const tmp = path.join(os.tmpdir(), `lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
        return {
          success: true,
          path: tmp,
          filename: 'test.png',
          paths: [tmp],
          createdAt: new Date().toISOString(),
        };
      } finally {
        release?.();
      }
    }
  }

  const env = await createTestEnv();
  try {
    const projA = createDefaultProject({ id: 'proj-lock-a' });
    const projB = createDefaultProject({ id: 'proj-lock-b' });
    await saveProject(projA, env.projectsDir, env.assetsDir);
    await saveProject(projB, env.projectsDir, env.assetsDir);

    const lockProvider = new ConcurrentFlowLockMock();
    const managerA = new SketchJobManager({ jobsDir: env.jobsDir, assetsDir: env.assetsDir, projectsDir: env.projectsDir, flowProvider: lockProvider });
    const managerB = new SketchJobManager({ jobsDir: env.jobsDir, assetsDir: env.assetsDir, projectsDir: env.projectsDir, flowProvider: lockProvider });

    const [jobA, jobB] = await Promise.all([
      managerA.enqueueJob({ projectId: projA.id }),
      managerB.enqueueJob({ projectId: projB.id }),
    ]);

    await Promise.all([
      waitForJobTerminal(managerA, jobA.id),
      waitForJobTerminal(managerB, jobB.id),
    ]);

    assert.equal(maxConcurrent, 1, 'Exclusão mútua do navegador preservada: max concurrency no browser foi 1');
  } finally {
    await env.cleanup();
  }
});
