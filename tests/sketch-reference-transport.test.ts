import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  SketchJobManager,
  type FlowImageProviderContract,
} from '../lib/sketch/sketch-job-manager.ts';
import {
  createDefaultProject,
  saveProject,
  getProject,
  normalizeProject,
} from '../lib/sketch/sketch-storage.ts';
import type { ImageGenerationOptions, ImageGenerationResult } from '../src/providers/flow/FlowTypes.ts';
import type { SketchPath, SketchLayer, SketchAttachment } from '../types/sketch.ts';

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

const SAMPLE_PNG_DATA_URL = `data:image/png;base64,${SAMPLE_PNG_BYTES.toString('base64')}`;

// Distinct 2x2 red PNG
const DISTINCT_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02,
  0x08, 0x02, 0x00, 0x00, 0x00, 0xfd, 0xd4, 0x9a, 0x73,
  0x00, 0x00, 0x00, 0x15, 0x49, 0x44, 0x41, 0x54,
  0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xc0, 0xc0, 0x00, 0xc4, 0x0c, 0x0c,
  0x00, 0x07, 0x0c, 0x02, 0x01, 0x8f, 0xb7, 0x25, 0xb8,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const DISTINCT_PNG_DATA_URL = `data:image/png;base64,${DISTINCT_PNG_BYTES.toString('base64')}`;

interface CapturedProviderCall {
  prompt: string;
  options?: ImageGenerationOptions;
  capturedReferenceBytes?: Buffer;
}

class InspectableFlowProvider implements FlowImageProviderContract {
  public calls: CapturedProviderCall[] = [];
  public delayMs = 5;

  async generateImageWithProgress(
    prompt: string,
    options?: ImageGenerationOptions,
    onLockAcquired?: () => void
  ): Promise<ImageGenerationResult> {
    let capturedBytes: Buffer | undefined;
    if (options?.referenceImage && fs.existsSync(options.referenceImage)) {
      capturedBytes = await fsp.readFile(options.referenceImage);
    }

    this.calls.push({
      prompt,
      options: options ? { ...options } : undefined,
      capturedReferenceBytes: capturedBytes,
    });

    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }

    onLockAcquired?.();

    const testImgPath = path.join(os.tmpdir(), `ref-mock-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    await fsp.writeFile(testImgPath, SAMPLE_PNG_BYTES);

    return {
      success: true,
      path: testImgPath,
      filename: path.basename(testImgPath),
      paths: [testImgPath],
      createdAt: new Date().toISOString(),
    };
  }
}

async function createTestEnv() {
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'sketch-ref-test-'));
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

async function waitForJobTerminal(manager: SketchJobManager, jobId: string, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await manager.getJob(jobId);
    if (job && (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled')) {
      await new Promise((r) => setTimeout(r, 60));
      return job;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Job ${jobId} did not finish within ${timeoutMs}ms`);
}

function createSampleSketchPaths(): SketchPath[] {
  return [
    {
      id: 'path-stroke-1',
      tool: 'brush',
      color: '#ffffff',
      size: 4,
      opacity: 1,
      points: [
        { x: 10, y: 10 },
        { x: 50, y: 50 },
        { x: 100, y: 100 },
      ],
      isGuide: false,
    },
  ];
}

test('salvar e reabrir projeto mantendo "explore" e "baked"', async () => {
  const env = await createTestEnv();
  try {
    const project = createDefaultProject({ id: 'proj-creative-opts-1' });
    project.compositionIntent = 'explore';
    project.textRenderingStrategy = 'baked';

    await saveProject(project, env.projectsDir, env.assetsDir);

    const reloaded = await getProject(project.id, env.projectsDir);
    assert.ok(reloaded);
    assert.equal(reloaded.compositionIntent, 'explore');
    assert.equal(reloaded.textRenderingStrategy, 'baked');

    // Compatibilidade com payload legado sem esses campos
    const legacy = normalizeProject({ id: 'proj-legacy-1', title: 'Legado' });
    assert.equal(legacy.compositionIntent, 'follow');
    assert.equal(legacy.textRenderingStrategy, 'layer');
  } finally {
    await env.cleanup();
  }
});

test('projeto somente com sketch chega ao provedor como imagem (não simple)', async () => {
  const env = await createTestEnv();
  const mockFlow = new InspectableFlowProvider();

  try {
    const project = createDefaultProject({ id: 'proj-sketch-only-1', title: 'Apenas Rabisco' });
    project.layers = [
      {
        id: 'layer-sketch-1',
        name: 'Traços',
        type: 'sketch',
        paths: createSampleSketchPaths(),
        visible: true,
        opacity: 1,
      },
    ];
    await saveProject(project, env.projectsDir, env.assetsDir);

    const manager = new SketchJobManager({
      jobsDir: env.jobsDir,
      assetsDir: env.assetsDir,
      projectsDir: env.projectsDir,
      flowProvider: mockFlow,
    });

    const job = await manager.enqueueJob({
      projectId: project.id,
      referenceDataUrl: SAMPLE_PNG_DATA_URL,
    });

    const terminalJob = await waitForJobTerminal(manager, job.id);
    assert.equal(terminalJob.status, 'completed');

    assert.equal(mockFlow.calls.length, 1);
    const call = mockFlow.calls[0];

    assert.equal(call.options?.operation, 'reference');
    assert.equal(call.options?.referenceKind, 'sketch');
    assert.ok(call.options?.referenceImage);
    assert.ok(call.capturedReferenceBytes);
    assert.equal(call.capturedReferenceBytes.length, SAMPLE_PNG_BYTES.length);
  } finally {
    await env.cleanup();
  }
});

test('projeto com sketch e produto envia a composição aprovada e seus bytes', async () => {
  const env = await createTestEnv();
  const mockFlow = new InspectableFlowProvider();

  try {
    const project = createDefaultProject({ id: 'proj-sketch-product-1', title: 'Sketch e Produto' });
    project.layers = [
      {
        id: 'layer-sketch-1',
        name: 'Composição',
        type: 'sketch',
        paths: createSampleSketchPaths(),
        visible: true,
        opacity: 1,
      },
      {
        id: 'layer-img-prod',
        name: 'Foto Produto',
        type: 'image',
        imageUrl: '/api/sketch/assets/prod.png',
        role: 'product',
        x: 20,
        y: 20,
        width: 60,
        height: 60,
        visible: true,
        opacity: 1,
      },
    ];
    project.attachments = [
      {
        id: 'att-prod-1',
        name: 'prod.png',
        dataUrl: SAMPLE_PNG_DATA_URL,
        role: 'product',
        createdAt: new Date().toISOString(),
      },
    ];
    await saveProject(project, env.projectsDir, env.assetsDir);

    const manager = new SketchJobManager({
      jobsDir: env.jobsDir,
      assetsDir: env.assetsDir,
      projectsDir: env.projectsDir,
      flowProvider: mockFlow,
    });

    const job = await manager.enqueueJob({
      projectId: project.id,
      referenceDataUrl: DISTINCT_PNG_DATA_URL,
    });

    const terminalJob = await waitForJobTerminal(manager, job.id);
    assert.equal(terminalJob.status, 'completed');

    assert.equal(mockFlow.calls.length, 1);
    const call = mockFlow.calls[0];

    assert.equal(call.options?.operation, 'reference');
    assert.equal(call.options?.referenceKind, 'composite');
    assert.ok(call.capturedReferenceBytes);
    assert.deepEqual(call.capturedReferenceBytes, DISTINCT_PNG_BYTES);
    assert.equal(job.snapshot.referenceKind, 'composite');
    assert.equal(job.snapshot.referenceMode, 'composite');
  } finally {
    await env.cleanup();
  }
});

test('múltiplos anexos não escolhem anexo arbitrário', async () => {
  const env = await createTestEnv();
  const mockFlow = new InspectableFlowProvider();

  try {
    const project = createDefaultProject({ id: 'proj-multi-att-1', title: 'Múltiplos Anexos' });
    const att1: SketchAttachment = {
      id: 'att-1',
      name: 'produto.png',
      dataUrl: SAMPLE_PNG_DATA_URL,
      role: 'product',
      createdAt: new Date().toISOString(),
    };
    const att2: SketchAttachment = {
      id: 'att-2',
      name: 'referencia.png',
      dataUrl: SAMPLE_PNG_DATA_URL,
      role: 'reference',
      createdAt: new Date().toISOString(),
    };
    const att3: SketchAttachment = {
      id: 'att-3',
      name: 'composicao.png',
      dataUrl: SAMPLE_PNG_DATA_URL,
      role: 'composition',
      createdAt: new Date().toISOString(),
    };
    project.attachments = [att1, att2, att3];
    project.layers = [
      {
        id: 'layer-sketch-1',
        name: 'Sketch',
        type: 'sketch',
        paths: createSampleSketchPaths(),
        visible: true,
        opacity: 1,
      },
    ];
    await saveProject(project, env.projectsDir, env.assetsDir);

    const manager = new SketchJobManager({
      jobsDir: env.jobsDir,
      assetsDir: env.assetsDir,
      projectsDir: env.projectsDir,
      flowProvider: mockFlow,
    });

    // Envia a composição visual unificada distinta aprovada
    const job = await manager.enqueueJob({
      projectId: project.id,
      referenceDataUrl: DISTINCT_PNG_DATA_URL,
    });

    await waitForJobTerminal(manager, job.id);
    assert.equal(mockFlow.calls.length, 1);
    const call = mockFlow.calls[0];

    // O provedor deve receber exatamente a composição aprovada, e não o anexo 1, 2 ou 3
    assert.ok(call.capturedReferenceBytes);
    assert.deepEqual(call.capturedReferenceBytes, DISTINCT_PNG_BYTES);
  } finally {
    await env.cleanup();
  }
});

test('comparação dos bytes enviados ao provedor com a referência esperada', async () => {
  const env = await createTestEnv();
  const mockFlow = new InspectableFlowProvider();

  try {
    const project = createDefaultProject({ id: 'proj-bytes-check-1' });
    project.layers = [
      {
        id: 'layer-sketch-1',
        name: 'Sketch',
        type: 'sketch',
        paths: createSampleSketchPaths(),
        visible: true,
        opacity: 1,
      },
    ];
    await saveProject(project, env.projectsDir, env.assetsDir);

    const manager = new SketchJobManager({
      jobsDir: env.jobsDir,
      assetsDir: env.assetsDir,
      projectsDir: env.projectsDir,
      flowProvider: mockFlow,
    });

    const expectedSha256 = crypto.createHash('sha256').update(DISTINCT_PNG_BYTES).digest('hex');

    const job = await manager.enqueueJob({
      projectId: project.id,
      referenceDataUrl: DISTINCT_PNG_DATA_URL,
    });

    assert.equal(job.snapshot.referenceSha256, expectedSha256);
    assert.equal(job.snapshot.referenceFileSizeBytes, DISTINCT_PNG_BYTES.length);

    await waitForJobTerminal(manager, job.id);
    assert.equal(mockFlow.calls.length, 1);
    const call = mockFlow.calls[0];

    assert.ok(call.capturedReferenceBytes);
    const actualSha256 = crypto.createHash('sha256').update(call.capturedReferenceBytes).digest('hex');
    assert.equal(actualSha256, expectedSha256);
    assert.ok(call.capturedReferenceBytes.equals(DISTINCT_PNG_BYTES));

    // Ao término seguro, o arquivo temporário do job deve ter sido limpo
    assert.ok(call.options?.referenceImage);
    assert.equal(fs.existsSync(call.options.referenceImage), false);
  } finally {
    await env.cleanup();
  }
});

test('edição posterior do projeto não modifica o snapshot do trabalho nem o snapshot de versão', async () => {
  const env = await createTestEnv();
  const mockFlow = new InspectableFlowProvider();
  mockFlow.delayMs = 100;

  try {
    const project = createDefaultProject({ id: 'proj-immutability-1', title: 'Título Inicial Imutável' });
    project.copy.headline = 'Headline Inicial Congelada';
    project.layers = [
      {
        id: 'layer-sketch-1',
        name: 'Sketch Original',
        type: 'sketch',
        paths: createSampleSketchPaths(),
        visible: true,
        opacity: 1,
      },
    ];
    await saveProject(project, env.projectsDir, env.assetsDir);

    const manager = new SketchJobManager({
      jobsDir: env.jobsDir,
      assetsDir: env.assetsDir,
      projectsDir: env.projectsDir,
      flowProvider: mockFlow,
    });

    const job = await manager.enqueueJob({
      projectId: project.id,
      referenceDataUrl: SAMPLE_PNG_DATA_URL,
    });

    // Usuário continua editando o projeto no canvas enquanto o job está rodando
    const projToEdit = await getProject(project.id, env.projectsDir);
    assert.ok(projToEdit);
    projToEdit.title = 'Título Modificado Posteriormente';
    projToEdit.copy.headline = 'Headline Alterada pelo Usuário';
    projToEdit.layers.push({
      id: 'layer-new-shape-1',
      name: 'Forma Adicionada Depois',
      type: 'shape',
      shapeType: 'rect',
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      strokeColor: '#ff0000',
      strokeWidth: 2,
      visible: true,
      opacity: 1,
    } as SketchLayer);
    await saveProject(projToEdit, env.projectsDir, env.assetsDir);

    const terminalJob = await waitForJobTerminal(manager, job.id);
    assert.equal(terminalJob.status, 'completed');

    // Snapshot no trabalho permaneceu intocado
    assert.equal(terminalJob.snapshot.projectTitle, 'Título Inicial Imutável');
    assert.equal(terminalJob.snapshot.copy.headline, 'Headline Inicial Congelada');
    assert.equal(terminalJob.snapshot.layers.length, 1);

    // O snapshot de versão gravado reflete o projeto que deu origem à solicitação
    const projAfter = await getProject(project.id, env.projectsDir);
    assert.ok(projAfter);
    assert.equal(projAfter.snapshots?.length, 1);
    const snap = projAfter.snapshots[0];
    assert.equal(snap.project.title, 'Título Inicial Imutável');
    assert.equal(snap.project.copy.headline, 'Headline Inicial Congelada');
    assert.equal(snap.project.layers.length, 1);

    // O projeto ativo em disco mantém a edição posterior do usuário
    assert.equal(projAfter.title, 'Título Modificado Posteriormente');
    assert.equal(projAfter.copy.headline, 'Headline Alterada pelo Usuário');
    assert.equal(projAfter.layers.length, 2);
  } finally {
    await env.cleanup();
  }
});

test('referência ausente ou inválida gera erro explícito', async () => {
  const env = await createTestEnv();
  const mockFlow = new InspectableFlowProvider();

  try {
    const project = createDefaultProject({ id: 'proj-error-ref-1' });
    project.layers = [
      {
        id: 'layer-sketch-1',
        name: 'Sketch',
        type: 'sketch',
        paths: createSampleSketchPaths(),
        visible: true,
        opacity: 1,
      },
    ];
    await saveProject(project, env.projectsDir, env.assetsDir);

    const manager = new SketchJobManager({
      jobsDir: env.jobsDir,
      assetsDir: env.assetsDir,
      projectsDir: env.projectsDir,
      flowProvider: mockFlow,
    });

    // Caso A: Formato não suportado ou corrompido
    await assert.rejects(
      async () => {
        await manager.enqueueJob({
          projectId: project.id,
          referenceDataUrl: 'data:image/png;base64,corrupted-not-a-real-png-bytes',
        });
      },
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : '';
        return msg.includes('Referência visual inválida') || msg.includes('Formato não suportado');
      }
    );

    // Caso B: dataUrl vazio ou buffer zerado
    await assert.rejects(
      async () => {
        await manager.enqueueJob({
          projectId: project.id,
          referenceDataUrl: 'data:image/png;base64,',
        });
      },
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : '';
        return msg.includes('dataUrl inválido ou base64 vazio');
      }
    );

    // O FlowProvider nunca deve ter sido chamado em caso de referência inválida
    assert.equal(mockFlow.calls.length, 0);
  } finally {
    await env.cleanup();
  }
});
