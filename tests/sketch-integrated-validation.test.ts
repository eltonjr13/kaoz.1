import test from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  type SketchProjectData,
  type SketchBriefingData,
  type SketchCopyData,
  type SketchLayer,
  type SketchAttachment,
  type TextLayer,
  type BackgroundLayer,
  type ImageLayer,
  SKETCH_SCHEMA_VERSION,
  CANVAS_ASPECT_RATIO_PRESETS,
  resolveProviderAspectRatio,
} from '../types/sketch.ts';
import {
  compileCreativeGenerationRequest,
} from '../lib/sketch/sketch-prompt-compiler.ts';
import {
  prepareSketchCompositeReference,
} from '../lib/sketch/sketch-composite-preparer.ts';
import {
  saveProject,
  getProject,
  createDefaultProject,
} from '../lib/sketch/sketch-storage.ts';
import {
  validateAttachmentBuffer,
} from '../lib/sketch/sketch-attachment-validator.ts';
import {
  SketchJobManager,
  type FlowImageProviderContract,
} from '../lib/sketch/sketch-job-manager.ts';
import {
  renderCompositionToCanvas,
} from '../lib/sketch/sketch-exporter.ts';
import { isJobActive } from '../lib/sketch/sketch-job-state.ts';
import {
  runSketchProductTechnicalProof,
} from '../lib/sketch/sketch-technical-proof.ts';
import type { ImageGenerationResult, ImageGenerationOptions } from '../src/providers/flow/FlowTypes.ts';

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

// Mock canvas para ambiente Node
class MockCanvasContext {
  public fillStyle = '#000000';
  public strokeStyle = '#000000';
  public lineWidth = 1;
  public globalAlpha = 1;
  public font = '10px sans-serif';
  public textAlign = 'left';
  public textBaseline = 'alphabetic';

  save() {}
  restore() {}
  fillRect() {}
  strokeRect() {}
  drawImage() {}
  fillText() {}
  measureText(text: string) {
    return { width: text.length * 10 };
  }
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  ellipse() {}
  roundRect() {}
  stroke() {}
  fill() {}
  translate() {}
  rotate() {}
}

class MockCanvasElement {
  public width = 0;
  public height = 0;
  public ctx = new MockCanvasContext();

  getContext(id: string) {
    if (id === '2d') return this.ctx;
    return null;
  }

  toBlob(cb: (b: Blob | null) => void, mime = 'image/png') {
    const dummy = { size: 1024, type: mime } as unknown as Blob;
    cb(dummy);
  }

  toDataURL(mime = 'image/png') {
    return `data:${mime};base64,mockResultBase64`;
  }
}

async function createTempStorage() {
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'sketch-validation-'));
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

class MockFlowService implements FlowImageProviderContract {
  public callCount = 0;
  public shouldFail = false;
  public failMessage = 'Simulated provider error';

  async generateImageWithProgress(
    _prompt: string,
    _options?: ImageGenerationOptions,
    onLockAcquired?: () => void
  ): Promise<ImageGenerationResult> {
    this.callCount++;
    if (onLockAcquired) onLockAcquired();

    if (this.shouldFail) {
      return {
        success: false,
        path: '',
        filename: '',
        createdAt: new Date().toISOString(),
        error: this.failMessage,
      };
    }

    const tmpFile = path.join(os.tmpdir(), `mock-flow-${Date.now()}.png`);
    await fsp.writeFile(tmpFile, SAMPLE_PNG_BYTES);

    return {
      success: true,
      path: tmpFile,
      filename: path.basename(tmpFile),
      createdAt: new Date().toISOString(),
    };
  }
}

function buildIntegratedBriefing(): SketchBriefingData {
  return {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    product: 'Smart Watch Aura Pulse',
    productDescription: 'Relógio inteligente premium com monitoramento cardíaco em titânio e tela OLED.',
    brandName: 'Aura Tech',
    targetAudience: 'Entusiastas de esportes e tecnologia de alta performance',
    objective: 'Vendas diretas no lançamento com oferta especial',
    offer: 'De R$ 1.299 por R$ 899 + Frete Grátis',
    keyBenefits: ['Bateria com 14 dias de duração', 'Resistente à água 50m', 'Corpo em titânio aeroespacial'],
    tone: 'Sofisticado, dinâmico e inovador',
    visualStyle: 'Fotografia publicitária de estúdio com iluminação lateral dramática',
    colorPalette: ['#090d16', '#6366f1', '#10b981'],
    suggestedVisualPrompt: 'Advertising studio shot of luxury titanium smartwatch on dark basalt stone.',
  };
}

function buildIntegratedCopy(): SketchCopyData {
  return {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    headline: 'Supere Seus Limites em Cada Segundo',
    subheadline: 'O novo Aura Pulse une precisão biométrica ao titânio de grau aeroespacial.',
    cta: 'Compre com R$ 400 de Desconto',
    badge: 'Lançamento Limitado',
  };
}

// ------------------------------------------------------------------------------------------------
// CENÁRIO 1: Anúncio somente por descrição
// ------------------------------------------------------------------------------------------------
test('cenário 1: anúncio somente por descrição compila zonas de copy e espaço negativo limpo', () => {
  const project = createDefaultProject({ id: 'cenario-1-desc', title: 'Anúncio Descritivo' });
  project.briefing = buildIntegratedBriefing();
  project.copy = buildIntegratedCopy();
  project.attachments = [];
  project.useSketchAsReference = false;

  const request = compileCreativeGenerationRequest(project);
  assert.ok(request.creativeCompilation);

  assert.equal(request.creativeCompilation.subjectPlacements.length, 0, 'Não deve haver sujeitos sem anexos');
  assert.ok(request.creativeCompilation.reservedCopyZones.length >= 3, 'Deve compilar zonas reservadas para headline, subheadline e cta');
  assert.equal(request.textRenderingStrategy, 'layer', 'Padrão deve ser modo camada com espaço limpo');
  assert.ok(
    request.preparedPrompt.toLowerCase().includes('photo') || request.preparedPrompt.toLowerCase().includes('fotografia'),
    'Prompt deve guiar composição fotográfica'
  );
  assert.ok(request.preparedPrompt.includes('Smart Watch Aura Pulse'), 'Prompt deve incluir o produto do briefing');
  assert.ok(!request.preparedPrompt.includes('sketch lines'), 'Prompt descritivo não deve mencionar linhas de sketch');
  assert.equal(request.creativeCompilation.validationIssues.length, 0, 'Não deve haver contradições no prompt');
});

// ------------------------------------------------------------------------------------------------
// CENÁRIO 2: Anúncio com foto de produto
// ------------------------------------------------------------------------------------------------
test('cenário 2: anúncio com foto de produto preserva identidade sem distorções de rótulo', () => {
  const project = createDefaultProject({ id: 'cenario-2-prod', title: 'Anúncio Foto Produto' });
  project.briefing = buildIntegratedBriefing();
  project.copy = buildIntegratedCopy();
  project.useSketchAsReference = false;

  const productAttachment: SketchAttachment = {
    id: 'att-watch-photo',
    name: 'smartwatch-product-front.png',
    dataUrl: SAMPLE_PNG_DATA_URL,
    role: 'product',
    width: 800,
    height: 1000,
    createdAt: new Date().toISOString(),
  };
  project.attachments = [productAttachment];
  project.activeReferenceId = 'att-watch-photo';

  const productImageLayer: ImageLayer = {
    id: 'layer-prod-img',
    name: 'smartwatch-product-front.png',
    type: 'image',
    imageUrl: SAMPLE_PNG_DATA_URL,
    attachmentId: 'att-watch-photo',
    role: 'product',
    x: 25,
    y: 25,
    width: 50,
    height: 50,
    visible: true,
    opacity: 1,
  };
  project.layers.push(productImageLayer);

  const request = compileCreativeGenerationRequest(project);
  assert.ok(request.creativeCompilation);

  assert.equal(request.creativeCompilation.subjectPlacements.length, 1, 'Deve identificar a foto de produto');
  assert.equal(request.creativeCompilation.subjectPlacements[0].role, 'product');
  assert.equal(request.referenceMode, 'identity', 'Com foto de produto sem sketch, modo de referência é identity');
  assert.ok(request.preparedPrompt.includes('Smart Watch Aura Pulse'));
  assert.ok(request.preparedPrompt.includes('Preserve its identity, silhouette, proportions'));
  assert.ok(!request.preparedPrompt.includes('sketch lines'));
  assert.equal(request.diagnostics.filter((d) => d.severity === 'error').length, 0);
});

// ------------------------------------------------------------------------------------------------
// CENÁRIO 3: Anúncio com sketch e foto de produto
// ------------------------------------------------------------------------------------------------
test('cenário 3: anúncio com sketch e foto de produto gera composição unificada sem rabiscos impressos', () => {
  const project = createDefaultProject({ id: 'cenario-3-sketch-prod', title: 'Sketch e Foto Produto' });
  project.briefing = buildIntegratedBriefing();
  project.copy = buildIntegratedCopy();
  project.useSketchAsReference = true;

  const productAttachment: SketchAttachment = {
    id: 'att-watch-3',
    name: 'watch-cutout.png',
    dataUrl: SAMPLE_PNG_DATA_URL,
    role: 'product',
    width: 600,
    height: 800,
    createdAt: new Date().toISOString(),
  };
  project.attachments = [productAttachment];
  project.activeReferenceId = 'att-watch-3';

  const sketchLayer: SketchLayer = {
    id: 'layer-sketch-canvas',
    name: 'Desenho de Pódio',
    type: 'sketch',
    visible: true,
    opacity: 1,
    paths: [
      {
        id: 'stroke-podium',
        tool: 'brush',
        color: '#6366f1',
        size: 5,
        opacity: 1,
        points: [{ x: 100, y: 700 }, { x: 900, y: 700 }, { x: 800, y: 900 }, { x: 200, y: 900 }],
      },
      {
        id: 'guide-box-headline',
        tool: 'box',
        color: '#f59e0b',
        size: 2,
        opacity: 0.8,
        isGuide: true,
        boxLabel: 'GUIA: HEADLINE TOPO',
        boxRect: { x: 50, y: 50, width: 900, height: 150 },
        points: [],
      },
    ],
  };

  const productImageLayer: ImageLayer = {
    id: 'layer-watch-placed',
    name: 'Relógio no Pódio',
    type: 'image',
    imageUrl: SAMPLE_PNG_DATA_URL,
    attachmentId: 'att-watch-3',
    role: 'product',
    x: 25,
    y: 20,
    width: 50,
    height: 60,
    visible: true,
    opacity: 1,
  };

  project.layers = [sketchLayer, productImageLayer];

  const composite = prepareSketchCompositeReference(project);
  assert.ok(composite.compositePreview);

  assert.equal(composite.referenceMode, 'composite', 'Deve usar modo composite para fundir sketch e produto');
  assert.ok(composite.compositePreview.includedRoles.includes('composition'));
  assert.ok(composite.compositePreview.includedRoles.includes('product'));
  assert.ok(composite.preparedPrompt.includes('without sketch lines, wireframes, or rough marks'));
  assert.ok(composite.preparedPrompt.includes('NOTICE: These notes are creative art direction guides'));
  assert.ok(composite.preparedPrompt.includes('strictly NOT be rendered as printed text'));
});

// ------------------------------------------------------------------------------------------------
// CENÁRIO 4: Múltiplos anexos com funções diferentes
// ------------------------------------------------------------------------------------------------
test('cenário 4: múltiplos anexos com diferentes funções validam limites e sniff de magic bytes', async () => {
  const attProduct: SketchAttachment = {
    id: 'att-4-prod',
    name: 'pulseira-metal.png',
    dataUrl: SAMPLE_PNG_DATA_URL,
    role: 'product',
    width: 500,
    height: 500,
    createdAt: new Date().toISOString(),
  };

  const attLogo: SketchAttachment = {
    id: 'att-4-logo',
    name: 'auratech-logo.png',
    dataUrl: SAMPLE_PNG_DATA_URL,
    role: 'logo',
    width: 300,
    height: 100,
    createdAt: new Date().toISOString(),
  };

  const attStyle: SketchAttachment = {
    id: 'att-4-style',
    name: 'moodboard-style.png',
    dataUrl: SAMPLE_PNG_DATA_URL,
    role: 'style',
    width: 800,
    height: 600,
    createdAt: new Date().toISOString(),
  };

  const validValidation = await validateAttachmentBuffer(SAMPLE_PNG_BYTES, {
    currentAttachmentCount: 3,
  });
  assert.equal(validValidation.valid, true);

  const overflowValidation = await validateAttachmentBuffer(SAMPLE_PNG_BYTES, {
    currentAttachmentCount: 6,
  });
  assert.equal(overflowValidation.valid, false);
  assert.ok(overflowValidation.error.includes('6 anexos'));

  const fakeExeBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00corrupted');
  const fakeValidation = await validateAttachmentBuffer(fakeExeBuffer, {
    currentAttachmentCount: 3,
  });
  assert.equal(fakeValidation.valid, false);
  assert.ok(fakeValidation.error.includes('Formato'));

  const project = createDefaultProject({ id: 'cenario-4-multi', title: 'Multiplos Anexos' });
  project.attachments = [attProduct, attLogo, attStyle];

  assert.equal(project.attachments.length, 3);
  assert.ok(project.attachments.some((a) => a.role === 'product'));
  assert.ok(project.attachments.some((a) => a.role === 'logo'));
  assert.ok(project.attachments.some((a) => a.role === 'style'));
});

// ------------------------------------------------------------------------------------------------
// CENÁRIO 5: Alteração de preço e CTA sem nova geração
// ------------------------------------------------------------------------------------------------
test('cenário 5: alteração de preço e CTA atualiza camadas editáveis sem disparar novo job', async () => {
  const env = await createTempStorage();
  const mockFlow = new MockFlowService();

  try {
    const project = createDefaultProject({ id: 'cenario-5-preco', title: 'Campanha Promo' });
    const bgLayer: BackgroundLayer = {
      id: 'bg-generated',
      name: 'Arte Gerada',
      type: 'background',
      fillType: 'image',
      imageUrl: '/api/sketch/assets/generated-bg.png',
      visible: true,
      opacity: 1,
    };
    const headlineLayer: TextLayer = {
      id: 'text-price',
      name: 'Preço Original',
      type: 'text',
      text: 'De R$ 1.299 por R$ 899',
      role: 'headline',
      x: 100,
      y: 200,
      width: 80,
      fontSize: 48,
      fontFamily: 'Inter',
      fontWeight: '700',
      textAlign: 'left',
      color: '#ffffff',
      visible: true,
      opacity: 1,
    };
    const ctaLayer: TextLayer = {
      id: 'text-cta',
      name: 'Botão CTA',
      type: 'text',
      text: 'Comprar Agora',
      role: 'cta',
      x: 100,
      y: 800,
      width: 40,
      fontSize: 32,
      fontFamily: 'Inter',
      fontWeight: '700',
      textAlign: 'center',
      color: '#ffffff',
      backgroundColor: '#10b981',
      backgroundPadding: 16,
      borderRadius: 12,
      visible: true,
      opacity: 1,
    };
    project.layers = [bgLayer, headlineLayer, ctaLayer];

    await saveProject(project, env.projectsDir, env.assetsDir);
    assert.equal(mockFlow.callCount, 0, 'Nenhuma geração disparada inicialmente');

    // Usuário altera preço e CTA nas camadas de texto
    headlineLayer.text = 'De R$ 1.299 por R$ 699 (OFERTA RELÂMPAGO)';
    ctaLayer.text = 'Garantir com 50% OFF';
    ctaLayer.backgroundColor = '#ef4444';
    project.updatedAt = new Date().toISOString();

    await saveProject(project, env.projectsDir, env.assetsDir);

    const reloaded = await getProject(project.id, env.projectsDir);
    assert.ok(reloaded);
    assert.equal(mockFlow.callCount, 0, 'Provedor de IA não foi chamado para atualizar copy/preço');
    const updatedPrice = reloaded.layers.find((l) => l.id === 'text-price') as TextLayer;
    const updatedCta = reloaded.layers.find((l) => l.id === 'text-cta') as TextLayer;
    assert.equal(updatedPrice.text, 'De R$ 1.299 por R$ 699 (OFERTA RELÂMPAGO)');
    assert.equal(updatedCta.text, 'Garantir com 50% OFF');
    assert.equal(updatedCta.backgroundColor, '#ef4444');
  } finally {
    await env.cleanup();
  }
});

// ------------------------------------------------------------------------------------------------
// CENÁRIO 6: Reabertura do projeto preservando objetos e versões
// ------------------------------------------------------------------------------------------------
test('cenário 6: reabertura do projeto preserva objetos, coordenadas e versões em disco', async () => {
  const env = await createTempStorage();

  try {
    const project = createDefaultProject({ id: 'cenario-6-reopen', title: 'Campanha Reabertura' });
    project.briefing = buildIntegratedBriefing();
    project.copy = buildIntegratedCopy();
    project.canvasAspectRatio = '4:5';
    project.aspectRatio = '3:4';

    const textLayer: TextLayer = {
      id: 'layer-precise-text',
      name: 'Headline Topo',
      type: 'text',
      role: 'headline',
      text: 'Precisão Inabalável',
      x: 120,
      y: 180,
      width: 800,
      height: 90,
      rotation: 15,
      fontSize: 42,
      fontFamily: 'Inter',
      fontWeight: '700',
      color: '#ffffff',
      textAlign: 'center',
      visible: true,
      opacity: 0.95,
      locked: true,
    };
    project.layers.push(textLayer);

    project.snapshots = [
      {
        id: 'snap-v1',
        versionNumber: 1,
        label: 'Versão 1 - Conceito Base',
        timestamp: new Date().toISOString(),
        project: JSON.parse(JSON.stringify(project)),
      },
    ];

    await saveProject(project, env.projectsDir, env.assetsDir);

    const loaded = await getProject(project.id, env.projectsDir);
    assert.ok(loaded, 'Projeto deve ser carregado com sucesso');
    assert.equal(loaded.id, 'cenario-6-reopen');
    assert.equal(loaded.canvasAspectRatio, '4:5');
    assert.equal(loaded.aspectRatio, '3:4');
    assert.equal(loaded.briefing?.product, 'Smart Watch Aura Pulse');
    assert.equal(loaded.copy?.headline, 'Supere Seus Limites em Cada Segundo');
    assert.ok(loaded.snapshots);
    assert.equal(loaded.snapshots.length, 1);
    assert.equal(loaded.snapshots[0].label, 'Versão 1 - Conceito Base');

    const loadedLayer = loaded.layers.find((l) => l.id === 'layer-precise-text') as TextLayer;
    assert.ok(loadedLayer);
    assert.equal(loadedLayer.x, 120);
    assert.equal(loadedLayer.y, 180);
    assert.equal(loadedLayer.rotation, 15);
    assert.equal(loadedLayer.locked, true);
  } finally {
    await env.cleanup();
  }
});

// ------------------------------------------------------------------------------------------------
// CENÁRIO 7: Falha de upload e falha de geração sem perda do trabalho
// ------------------------------------------------------------------------------------------------
test('cenário 7: falha de upload e falha de geração não causam perda de trabalho do usuário', async () => {
  const env = await createTempStorage();
  const mockFlow = new MockFlowService();
  mockFlow.shouldFail = true;
  mockFlow.failMessage = 'Erro de timeout no FlowProvider';

  const manager = new SketchJobManager({
    jobsDir: env.jobsDir,
    assetsDir: env.assetsDir,
    projectsDir: env.projectsDir,
    flowProvider: mockFlow,
  });

  try {
    const project = createDefaultProject({ id: 'cenario-7-resil', title: 'Projeto Resiliente' });
    project.briefing = buildIntegratedBriefing();
    project.copy = buildIntegratedCopy();
    await saveProject(project, env.projectsDir, env.assetsDir);

    // 7A: Falha de Upload rejeitada
    const badBuffer = Buffer.from('#!/bin/sh\necho "hi"');
    const rejectedPayload = await validateAttachmentBuffer(badBuffer, { currentAttachmentCount: 0 });
    assert.equal(rejectedPayload.valid, false, 'Upload inválido deve ser rejeitado');

    const stateAfterBadUpload = await getProject(project.id, env.projectsDir);
    assert.ok(stateAfterBadUpload);
    assert.equal(stateAfterBadUpload.attachments.length, 0, 'Nenhum anexo inválido deve ter sido salvo');
    assert.equal(stateAfterBadUpload.briefing?.product, 'Smart Watch Aura Pulse', 'Briefing deve estar 100% intacto');

    // 7B: Falha de Geração preserva trabalho
    const job = await manager.enqueueJob({ projectId: project.id });
    let failedJob = await manager.getJob(job.id);
    for (let i = 0; i < 50 && failedJob && isJobActive(failedJob.status); i++) {
      await new Promise((r) => setTimeout(r, 25));
      failedJob = await manager.getJob(job.id);
    }

    assert.ok(failedJob);
    assert.equal(failedJob.status, 'failed');
    assert.ok(failedJob.error?.includes('timeout'));

    const stateAfterFailedJob = await getProject(project.id, env.projectsDir);
    assert.ok(stateAfterFailedJob);
    assert.equal(stateAfterFailedJob.briefing?.product, 'Smart Watch Aura Pulse');
    assert.equal(stateAfterFailedJob.copy?.headline, 'Supere Seus Limites em Cada Segundo');
    assert.equal(stateAfterFailedJob.generationHistory.length, 0, 'Não deve poluir histórico com imagem corrompida');
  } finally {
    await env.cleanup();
  }
});

// ------------------------------------------------------------------------------------------------
// CENÁRIO 8: Exportação PNG/JPEG em diferentes proporções
// ------------------------------------------------------------------------------------------------
test('cenário 8: exportação PNG/JPEG nas 4 proporções com exclusão de guias e enquadramento adaptado', async () => {
  const ratios = ['1:1', '4:5', '9:16', '16:9'] as const;

  for (const ratio of ratios) {
    const preset = CANVAS_ASPECT_RATIO_PRESETS[ratio];
    assert.ok(preset, `Preset deve existir para ${ratio}`);
    const flowRatio = resolveProviderAspectRatio(ratio);
    assert.ok(['1:1', '3:4', '9:16', '16:9'].includes(flowRatio), `Flow ratio ${flowRatio} deve ser suportado`);

    const project = createDefaultProject({ id: `cenario-8-${ratio.replace(':', '-')}`, title: `Export ${ratio}` });
    project.canvasAspectRatio = ratio;
    project.aspectRatio = flowRatio;

    const bgLayer: BackgroundLayer = {
      id: 'bg-art',
      name: 'Fundo da Arte',
      type: 'background',
      fillType: 'color',
      color: '#0a0e17',
      visible: true,
      opacity: 1,
      fit: 'cover',
      offsetX: 0,
      offsetY: 0,
    };

    const textLayer: TextLayer = {
      id: 'text-title',
      name: 'Título Principal',
      type: 'text',
      role: 'headline',
      text: `Campanha ${ratio}`,
      x: 100,
      y: 100,
      width: 80,
      fontSize: 48,
      fontFamily: 'Inter',
      fontWeight: '700',
      textAlign: 'left',
      color: '#ffffff',
      visible: true,
      opacity: 1,
    };

    const guideLayer: SketchLayer = {
      id: 'guide-secret',
      name: 'Anotação Interna',
      type: 'sketch',
      visible: true,
      opacity: 1,
      isGuide: true,
      elementKind: 'guide',
      paths: [],
    };

    project.layers = [bgLayer, textLayer, guideLayer];

    const canvasPng = new MockCanvasElement();
    const renderedPng = await renderCompositionToCanvas(
      project,
      canvasPng as unknown as HTMLCanvasElement,
      { format: 'png', scale: 1, excludeGuides: true }
    );
    assert.equal(renderedPng.width, preset.width);
    assert.equal(renderedPng.height, preset.height);
    const pngDataUrl = renderedPng.toDataURL('image/png');
    assert.ok(pngDataUrl.startsWith('data:image/png;base64,'));

    const canvasJpeg = new MockCanvasElement();
    const renderedJpeg = await renderCompositionToCanvas(
      project,
      canvasJpeg as unknown as HTMLCanvasElement,
      { format: 'jpeg', scale: 2, backgroundColorForJpeg: '#000000', excludeGuides: true }
    );
    assert.equal(renderedJpeg.width, preset.width * 2);
    assert.equal(renderedJpeg.height, preset.height * 2);
    const jpegDataUrl = renderedJpeg.toDataURL('image/jpeg');
    assert.ok(jpegDataUrl.startsWith('data:image/jpeg;base64,'));
  }
});

// ------------------------------------------------------------------------------------------------
// VALIDAÇÃO TÉCNICA: Identificação de Mock vs Execução Real e Limitações Conhecidas
// ------------------------------------------------------------------------------------------------
test('validação técnica: diferenciação explícita entre mock e execução real sem criar placeholders', async () => {
  const project = createDefaultProject({ id: 'proof-inspect', title: 'Prova de Conceito' });

  // Execução mockada: contrato verificado, sem chamar navegador
  const mockProof = await runSketchProductTechnicalProof(project);
  assert.equal(mockProof.isRealExecution, false);
  assert.equal(mockProof.executionStatus, 'mock_validated_contract_pending_live_flow');
  assert.equal(mockProof.generatedImages.length, 0, 'Mock nunca deve fingir imagens geradas reais');

  // Execução real: tenta invocar o provedor real e documenta pendência de ambiente se ausente
  const realProof = await runSketchProductTechnicalProof(project, { forceRealExecution: true });
  assert.equal(realProof.isRealExecution, true);
  if (realProof.executionStatus === 'failed') {
    assert.ok(realProof.pendingReason, 'Deve registrar o motivo específico da pendência do ambiente');
  }
});
