import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  SketchJobManager,
  DuplicateJobError,
  isJobActive,
  type FlowImageProviderContract,
} from '../lib/sketch/sketch-job-manager.ts';
import {
  createDefaultProject,
  saveProject,
} from '../lib/sketch/sketch-storage.ts';
import {
  generateAdCopy,
  extractCopyRequest,
} from '../lib/sketch/sketch-copy-generator.ts';
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
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'sketch-rel-test-'));
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

class ControlledFlowProvider implements FlowImageProviderContract {
  public delayMs = 30;
  public generateCount = 0;
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
    onLockAcquired?.();

    const testImgPath = path.join(os.tmpdir(), `mock-flow-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    await fsp.writeFile(testImgPath, SAMPLE_PNG_BYTES);
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

async function waitForJobTerminal(manager: SketchJobManager, jobId: string, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await manager.getJob(jobId);
    if (job && (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'interrupted')) {
      await new Promise((r) => setTimeout(r, 40));
      return job;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Job ${jobId} did not reach terminal state within ${timeoutMs}ms`);
}

// 1. Promise.all com duas submissões da mesma chave
test('Promise.all com duas submissões da mesma chave retorna o mesmo trabalho', async () => {
  const env = await createTestEnv();
  const mockFlow = new ControlledFlowProvider();

  try {
    const proj = createDefaultProject({ id: 'proj-idemp-1', title: 'Projeto Idempotência' });
    await saveProject(proj, env.projectsDir, env.assetsDir);

    const manager = new SketchJobManager({
      jobsDir: env.jobsDir,
      assetsDir: env.assetsDir,
      projectsDir: env.projectsDir,
      flowProvider: mockFlow,
    });

    const [jobA, jobB] = await Promise.all([
      manager.enqueueJob({
        projectId: proj.id,
        idempotencyToken: 'idem-key-shared-100',
      }),
      manager.enqueueJob({
        projectId: proj.id,
        idempotencyToken: 'idem-key-shared-100',
      }),
    ]);

    assert.equal(jobA.id, jobB.id, 'Ambas as chamadas simultâneas com a mesma chave devem retornar o mesmo jobId');
    assert.equal(jobA.idempotencyToken, 'idem-key-shared-100');

    const files = await fsp.readdir(env.jobsDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    assert.equal(jsonFiles.length, 1, 'Apenas um arquivo de trabalho deve existir no disco');

    await waitForJobTerminal(manager, jobA.id);
  } finally {
    await env.cleanup();
  }
});

// 2. Submissões simultâneas com chaves diferentes no mesmo projeto
test('submissões simultâneas com chaves diferentes no mesmo projeto rejeitam duplicação com DuplicateJobError', async () => {
  const env = await createTestEnv();
  const mockFlow = new ControlledFlowProvider();
  mockFlow.delayMs = 60;

  try {
    const proj = createDefaultProject({ id: 'proj-concurrent-diff', title: 'Projeto Concorrente' });
    await saveProject(proj, env.projectsDir, env.assetsDir);

    const manager = new SketchJobManager({
      jobsDir: env.jobsDir,
      assetsDir: env.assetsDir,
      projectsDir: env.projectsDir,
      flowProvider: mockFlow,
    });

    const results = await Promise.allSettled([
      manager.enqueueJob({
        projectId: proj.id,
        idempotencyToken: 'token-alpha-111',
      }),
      manager.enqueueJob({
        projectId: proj.id,
        idempotencyToken: 'token-beta-222',
      }),
    ]);

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<import('../types/sketch.ts').SketchJobData> => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    assert.equal(fulfilled.length, 1, 'Exatamente um trabalho deve ser enfileirado com sucesso');
    assert.equal(rejected.length, 1, 'A segunda chamada simultânea deve ser rejeitada');

    const error = rejected[0].reason;
    assert.ok(error instanceof DuplicateJobError, 'Erro deve ser instância de DuplicateJobError');
    assert.equal(error.activeJobId, fulfilled[0].value.id, 'Erro deve referenciar o jobId ativo');

    const files = await fsp.readdir(env.jobsDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    assert.equal(jsonFiles.length, 1, 'Apenas um arquivo de trabalho deve ter sido criado no disco');

    await waitForJobTerminal(manager, fulfilled[0].value.id);
  } finally {
    await env.cleanup();
  }
});

// 3. Reinício simulado seguido do caminho de consulta usado pela UI
test('reinício simulado seguido do caminho de consulta usado pela UI expõe estado interrompido e permite nova tentativa', async () => {
  const env = await createTestEnv();

  try {
    const proj = createDefaultProject({ id: 'proj-restart-sim', title: 'Projeto Pós-Restart' });
    await saveProject(proj, env.projectsDir, env.assetsDir);

    const crashedJobId = 'job-crashed-before-boot';
    const crashedJob = {
      schemaVersion: 1,
      version: '1.0.0',
      id: crashedJobId,
      projectId: proj.id,
      processId: 'proc-dead-pid-999',
      status: 'generating_with_flow',
      progressPercentage: 60,
      stepMessage: 'Gerando anúncio com FlowProvider no navegador.',
      snapshot: {
        projectId: proj.id,
        projectTitle: proj.title,
        canvasAspectRatio: '1:1',
        providerAspectRatio: '1:1',
        prompt: 'test prompt',
        useSketchAsReference: false,
        referenceMode: 'none',
        compiledPrompt: 'test prompt',
        diagnostics: [],
        layers: [],
        attachments: [],
        briefing: {},
        copy: {},
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await fsp.writeFile(path.join(env.jobsDir, `${crashedJobId}.json`), JSON.stringify(crashedJob, null, 2));

    // Nova instância do gerenciador representando o processo reiniciado
    const restartedManager = new SketchJobManager({
      jobsDir: env.jobsDir,
      assetsDir: env.assetsDir,
      projectsDir: env.projectsDir,
      flowProvider: new ControlledFlowProvider(),
    });

    // Caminho usado pela UI: findActiveJobForProject (GET /api/sketch/generate?projectId=...)
    const activeBeforeRetry = await restartedManager.findActiveJobForProject(proj.id);
    assert.equal(activeBeforeRetry, null, 'Trabalho interrompido pelo crash não deve ser reportado como ativo para a UI');

    // Consulta por ID usada pelo rastreador (GET /api/sketch/jobs/[id])
    const inspectedJob = await restartedManager.getJob(crashedJobId);
    assert.ok(inspectedJob);
    assert.equal(inspectedJob.status, 'interrupted', 'Status deve ter sido marcado como interrompido');
    assert.ok(inspectedJob.stepMessage.includes('reinício'), 'Mensagem deve indicar reinício');
    assert.ok(inspectedJob.cancellationExplanation?.includes('reinício'));
    assert.ok(inspectedJob.error?.includes('finalizado inesperadamente'));

    // A UI agora pode realizar uma nova tentativa explícita sem bloqueio
    const retryJob = await restartedManager.enqueueJob({
      projectId: proj.id,
      idempotencyToken: 'retry-after-crash-1',
    });
    assert.ok(retryJob);
    assert.ok(retryJob.status === 'queued' || retryJob.status === 'preparing_reference');
    assert.notEqual(retryJob.id, crashedJobId, 'Novo trabalho deve ter ID único');

    await waitForJobTerminal(restartedManager, retryJob.id);
  } finally {
    await env.cleanup();
  }
});

// 4. Consulta durante trabalho legítimo não altera seu estado
test('consulta durante trabalho legítimo não altera seu estado nem limpa recursos', async () => {
  const env = await createTestEnv();
  const mockFlow = new ControlledFlowProvider();
  mockFlow.delayMs = 150;

  try {
    const proj = createDefaultProject({ id: 'proj-legit-run', title: 'Projeto Ativo' });
    await saveProject(proj, env.projectsDir, env.assetsDir);

    const manager = new SketchJobManager({
      jobsDir: env.jobsDir,
      assetsDir: env.assetsDir,
      projectsDir: env.projectsDir,
      flowProvider: mockFlow,
    });

    const job = await manager.enqueueJob({ projectId: proj.id });
    assert.ok(job.status === 'queued' || job.status === 'preparing_reference' || job.status === 'waiting_flow_lock');

    // Consultas concorrentes enquanto o trabalho legítimo está ativo
    const query1 = await manager.getJob(job.id);
    assert.ok(query1);
    assert.ok(isJobActive(query1.status), 'Job deve permanecer com status ativo durante a consulta');

    const activeJob = await manager.findActiveJobForProject(proj.id);
    assert.ok(activeJob);
    assert.equal(activeJob.id, job.id);

    const allJobs = await manager.listJobs({ projectId: proj.id });
    assert.equal(allJobs.length, 1);

    // Tentativa manual de recuperação: não deve marcar o job ativo como interrompido
    const recoveredCount = await manager.recoverInterruptedJobs();
    assert.equal(recoveredCount, 0, 'recoverInterruptedJobs não deve tocar em trabalhos do processo atual');

    const query2 = await manager.getJob(job.id);
    assert.ok(query2);
    assert.notEqual(query2.status, 'interrupted', 'Trabalho legítimo não pode virar interrupted');

    await waitForJobTerminal(manager, job.id);
  } finally {
    await env.cleanup();
  }
});

function assertVerificationError(res: { valid: boolean; error?: string }, expectedSubstr: string): void {
  assert.equal(res.valid, false);
  assert.ok(res.error);
  assert.ok(res.error.toLowerCase().includes(expectedSubstr.toLowerCase()));
}

// 5. Arquivo de texto, imagem truncada e arquivo vazio são rejeitados
test('arquivo de texto, imagem truncada e arquivo vazio são rejeitados na validação estrita', async () => {
  const env = await createTestEnv();
  const manager = new SketchJobManager({
    jobsDir: env.jobsDir,
    assetsDir: env.assetsDir,
    projectsDir: env.projectsDir,
  });

  try {
    // A: Arquivo de texto (como package.json)
    const textPath = path.join(env.tmpBase, 'not-an-image.txt');
    await fsp.writeFile(textPath, JSON.stringify({ name: 'mrchicken', version: '1.0.0' }));
    const textRes = await manager.verifyGeneratedFile(textPath);
    assertVerificationError(textRes, 'suportado');

    // B: Imagem truncada / corrompida (PNG incompleto)
    const truncPath = path.join(env.tmpBase, 'corrupt-header.png');
    await fsp.writeFile(truncPath, SAMPLE_PNG_BYTES.subarray(0, 16));
    const truncRes = await manager.verifyGeneratedFile(truncPath);
    assertVerificationError(truncRes, 'decodificar');

    // C: Arquivo vazio (0 bytes)
    const emptyPath = path.join(env.tmpBase, 'empty-zero.png');
    await fsp.writeFile(emptyPath, Buffer.alloc(0));
    const emptyRes = await manager.verifyGeneratedFile(emptyPath);
    assertVerificationError(emptyRes, 'vazio');

    // D: Arquivo inexistente
    const missingRes = await manager.verifyGeneratedFile(path.join(env.tmpBase, 'non-existent.png'));
    assertVerificationError(missingRes, 'não existe');
  } finally {
    await env.cleanup();
  }
});

// 6. Imagem válida é aceita
test('imagem válida é aceita com decodificação, dimensões e formato confirmados', async () => {
  const env = await createTestEnv();
  const manager = new SketchJobManager({
    jobsDir: env.jobsDir,
    assetsDir: env.assetsDir,
    projectsDir: env.projectsDir,
  });

  try {
    const validPath = path.join(env.tmpBase, 'valid-test.png');
    await fsp.writeFile(validPath, SAMPLE_PNG_BYTES);

    const res = await manager.verifyGeneratedFile(validPath);
    assert.equal(res.valid, true, 'Imagem PNG válida deve ser aceita');
    assert.equal(res.format, 'png');
    assert.equal(res.width, 1);
    assert.equal(res.height, 1);
    assert.equal(res.sizeBytes, SAMPLE_PNG_BYTES.length);
  } finally {
    await env.cleanup();
  }
});

// 7. Falha do modelo de copy não aparece como geração bem-sucedida
test('falha do modelo de copy não aparece como geração bem-sucedida nem inventa alegações', async () => {
  // A: Requisição sem descrição de produto retorna nula
  const extracted = extractCopyRequest({});
  assert.equal(extracted, null, 'Requisição sem produto deve ser nula');

  // B: Simulação de falha de comunicação ou timeout no LLM
  const failingLlm = async () => {
    throw new Error('Falha simulada de rede / timeout no LLM');
  };

  const failResult = await generateAdCopy(
    { productDescription: 'Fone Bluetooth Pro', offer: 'Frete Grátis' },
    failingLlm
  );
  assert.equal(failResult.success, false, 'Em caso de erro do modelo, success deve ser false');
  assert.equal(failResult.statusCode, 502);
  assert.ok(failResult.error?.includes('timeout'));
  assert.equal(failResult.data, undefined);
  assert.equal(failResult.headline, undefined);

  // C: Simulação de resposta vazia do modelo
  const emptyLlm = async () => '';
  const emptyResult = await generateAdCopy(
    { productDescription: 'Fone Bluetooth Pro' },
    emptyLlm
  );
  assert.equal(emptyResult.success, false);
  assert.equal(emptyResult.statusCode, 502);
  assert.ok(emptyResult.error?.includes('vazia'));

  // D: Simulação de resposta malformada ou não-JSON
  const malformedLlm = async () => 'Desculpe, não posso atender este pedido publicitário.';
  const malformedResult = await generateAdCopy(
    { productDescription: 'Fone Bluetooth Pro' },
    malformedLlm
  );
  assert.equal(malformedResult.success, false);
  assert.equal(malformedResult.statusCode, 502);
  assert.ok(malformedResult.error?.includes('inválido'));

  // E: Simulação de resposta válida estruturada
  const validLlm = async () => JSON.stringify({
    headline: 'Som Imersivo Sem Fio',
    subheadline: 'Bateria de 40 horas e cancelamento de ruído.',
    cta: 'Aproveite o Frete Grátis',
    badge: 'Frete Grátis',
    suggestedVisualPrompt: 'Modern headphones in dark studio',
  });
  const validResult = await generateAdCopy(
    { productDescription: 'Fone Bluetooth Pro', offer: 'Frete Grátis' },
    validLlm
  );
  assert.equal(validResult.success, true);
  assert.equal(validResult.statusCode, 200);
  assert.equal(validResult.headline, 'Som Imersivo Sem Fio');
  assert.equal(validResult.cta, 'Aproveite o Frete Grátis');

  // F: Garantir que nenhuma alegação fictícia de fallback é emitida
  assert.notEqual(validResult.headline, 'Descubra a Excelência de Fone Bluetooth Pro', 'Não deve usar fallback genérico inventado');
  assert.notEqual(validResult.subheadline, 'Qualidade e inovação desenvolvidas exclusivamente para elevar os seus resultados.', 'Não deve inventar benefícios não fornecidos');
});
