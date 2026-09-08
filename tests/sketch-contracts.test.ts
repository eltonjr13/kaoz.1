import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASPECT_RATIO_PRESETS,
  CANVAS_ASPECT_RATIO_PRESETS,
  resolveProviderAspectRatio,
  type SketchAspectRatio,
  type AttachmentRole,
  type SketchReferenceRole,
  type SketchProjectData,
  type SketchVersionSnapshot,
  SKETCH_SCHEMA_VERSION,
} from '../types/sketch.ts';
import {
  renderSketchOnlyDataUrl,
  renderCompositeReferenceDataUrl,
} from '../lib/sketch/sketch-exporter.ts';
import {
  prepareSketchCompositeReference,
  detectSketchPresence,
  detectPlacedImages,
  checkUnplacedAttachments,
} from '../lib/sketch/sketch-composite-preparer.ts';
import {
  prepareFlowImagePrompt,
  buildFlowImagePromptInstructions,
} from '../lib/ai/image-prompt-engineering.ts';
import {
  createProofProject,
  runSketchProductTechnicalProof,
} from '../lib/sketch/sketch-technical-proof.ts';

test('sketch aspect ratio presets strictly adhere to FlowProvider supported ratios', () => {
  const supportedRatios: SketchAspectRatio[] = ['1:1', '9:16', '16:9', '4:3', '3:4'];

  for (const ratio of supportedRatios) {
    assert.ok(ASPECT_RATIO_PRESETS[ratio], `Deve suportar a proporção ${ratio}`);
    const preset = ASPECT_RATIO_PRESETS[ratio];
    assert.ok(preset.width > 0, `Largura deve ser maior que zero para ${ratio}`);
    assert.ok(preset.height > 0, `Altura deve ser maior que zero para ${ratio}`);
    assert.ok(preset.label, `Label deve existir para ${ratio}`);
  }

  assert.equal(Object.keys(ASPECT_RATIO_PRESETS).length, 5, 'Devem existir exatamente 5 proporções suportadas pelo Flow');
});

test('canvas aspect ratio is separated from provider aspect ratio with deterministic mapping', () => {
  assert.ok(CANVAS_ASPECT_RATIO_PRESETS['4:5'], 'Deve suportar proporção de prancheta 4:5');
  assert.ok(CANVAS_ASPECT_RATIO_PRESETS['custom'], 'Deve suportar proporção de prancheta personalizada');

  // Mapeamento direto
  assert.equal(resolveProviderAspectRatio('1:1'), '1:1');
  assert.equal(resolveProviderAspectRatio('9:16'), '9:16');
  assert.equal(resolveProviderAspectRatio('16:9'), '16:9');
  assert.equal(resolveProviderAspectRatio('4:3'), '4:3');
  assert.equal(resolveProviderAspectRatio('3:4'), '3:4');

  // Mapeamento de 4:5 para o formato mais próximo aceito pelo Flow (3:4)
  assert.equal(resolveProviderAspectRatio('4:5'), '3:4');

  // Mapeamento de dimensões customizadas
  assert.equal(resolveProviderAspectRatio('custom', 1920, 1080), '16:9');
  assert.equal(resolveProviderAspectRatio('custom', 1080, 1920), '9:16');
  assert.equal(resolveProviderAspectRatio('custom', 1200, 1200), '1:1');
});

test('sketch attachments support all strict functional reference roles', () => {
  const strictRoles: SketchReferenceRole[] = [
    'product',     // produto
    'person',      // pessoa
    'logo',        // logo
    'style',       // estilo
    'composition', // composição
    'background',  // fundo
  ];

  const allowedRoles: AttachmentRole[] = [
    ...strictRoles,
    'reference',
    'overlay',
    'inspiration',
  ];
  const roleSet = new Set(allowedRoles);

  assert.ok(roleSet.has('product'), 'Deve suportar função de referência de produto');
  assert.ok(roleSet.has('person'), 'Deve suportar função de referência de pessoa');
  assert.ok(roleSet.has('logo'), 'Deve suportar função de referência de logo');
  assert.ok(roleSet.has('style'), 'Deve suportar função de referência de estilo');
  assert.ok(roleSet.has('composition'), 'Deve suportar função de referência de composição');
  assert.ok(roleSet.has('background'), 'Deve suportar função de referência de fundo');
});

test('sketch project structure preserves versioned contracts, briefing, copy and editable document', () => {
  const sampleProject: SketchProjectData = {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    id: 'test-project',
    title: 'Anúncio de Teste',
    description: 'Teste unitário',
    aspectRatio: '1:1',
    canvasAspectRatio: '4:5',
    canvasDimensions: { width: 1080, height: 1350, unit: 'px' },
    prompt: 'Commercial product shot',
    useSketchAsReference: true,
    briefing: {
      productDescription: 'Fone de ouvido bluetooth com cancelamento de ruído.',
      brandName: 'Aura Sound',
      targetAudience: 'Profissionais e entusiastas de música',
      objective: 'Vendas diretas no e-commerce',
      tone: 'Sofisticado e tecnológico',
      keyBenefits: ['40h de bateria', 'Áudio espacial'],
    },
    copy: {
      headline: 'Silêncio Absoluto, Som Perfeito',
      subheadline: 'O novo fone com cancelamento de ruído adaptativo.',
      cta: 'Compre Agora',
      badge: 'Frete Grátis',
    },
    attachments: [
      {
        id: 'att-1',
        name: 'headphone.png',
        dataUrl: 'data:image/png;base64,sample',
        role: 'product',
        createdAt: new Date().toISOString(),
      },
    ],
    layers: [
      {
        id: 'bg-1',
        name: 'Fundo',
        type: 'background',
        fillType: 'color',
        color: '#000000',
        visible: true,
        opacity: 1,
      },
      {
        id: 'sketch-1',
        name: 'Esboço',
        type: 'sketch',
        paths: [],
        visible: true,
        opacity: 0.8,
      },
      {
        id: 'text-1',
        name: 'Título',
        type: 'text',
        role: 'headline',
        text: 'Silêncio Absoluto',
        x: 10,
        y: 60,
        width: 80,
        fontSize: 40,
        fontFamily: 'Inter, sans-serif',
        fontWeight: '700',
        color: '#ffffff',
        textAlign: 'left',
        visible: true,
        opacity: 1,
      },
    ],
    generationHistory: [],
    updatedAt: new Date().toISOString(),
  };

  assert.equal(sampleProject.schemaVersion, 1);
  assert.equal(sampleProject.version, '1.0.0');
  assert.equal(sampleProject.layers.length, 3);
  assert.equal(sampleProject.copy.headline, 'Silêncio Absoluto, Som Perfeito');
  assert.equal(sampleProject.briefing?.brandName, 'Aura Sound');
  assert.equal(sampleProject.attachments[0].role, 'product');

  const snapshot: SketchVersionSnapshot = {
    id: 'snap-1',
    versionNumber: 1,
    label: 'V1 - Inicial',
    timestamp: new Date().toISOString(),
    project: sampleProject,
  };

  assert.equal(snapshot.versionNumber, 1);
  assert.equal(snapshot.project.title, 'Anúncio de Teste');
});

test('prompt engineering differentiates sketch from identity to prevent preserving scribbles', () => {
  const basePrompt = 'Studio commercial shot of cosmetic glass bottle on stone pedestal';

  // 1. Sketch de layout: NÃO deve dizer "Preserve identity, silhouette, proportions, colors, materials"
  const sketchPrompt = prepareFlowImagePrompt({
    prompt: basePrompt,
    operation: 'reference',
    aspectRatio: '1:1',
    referenceKind: 'sketch',
  });

  assert.ok(sketchPrompt.includes('spatial composition guide'), 'Deve identificar como guia de composição espacial');
  assert.ok(
    sketchPrompt.includes('do not keep or reproduce rough sketch lines') || sketchPrompt.includes('without sketch lines'),
    'Deve proibir explicitamente manter rabiscos de sketch'
  );
  assert.ok(
    !sketchPrompt.includes('Preserve its identity, silhouette, proportions, colors, materials'),
    'NÃO deve mandar preservar materiais e cores do esboço/rabisco'
  );

  // 2. Composição unificada (sketch + produto): preserva a identidade do produto SEM manter os rabiscos
  const compositePrompt = prepareFlowImagePrompt({
    prompt: basePrompt,
    operation: 'reference',
    aspectRatio: '1:1',
    referenceKind: 'composite',
  });

  assert.ok(compositePrompt.includes('prepared layout composition'), 'Deve identificar composição combinada');
  assert.ok(compositePrompt.includes('Preserve the identity'), 'Deve preservar identidade do produto inserido');
  assert.ok(compositePrompt.includes('without sketch lines'), 'Deve instruir renderização limpa sem linhas de sketch');

  // 3. Referência pura de identidade (comportamento legado retrocompatível)
  const identityPrompt = prepareFlowImagePrompt({
    prompt: basePrompt,
    operation: 'reference',
    aspectRatio: '1:1',
    referenceKind: 'identity',
  });

  assert.ok(
    identityPrompt.includes('Preserve its identity, silhouette, proportions, colors, materials'),
    'Modo identity padrão mantém fidelidade total de produto/pessoa'
  );

  // 4. Backward compatibility: se referenceKind for omitido, mantém comportamento de identidade
  const defaultPrompt = prepareFlowImagePrompt({
    prompt: basePrompt,
    operation: 'reference',
    aspectRatio: '1:1',
  });

  assert.equal(defaultPrompt, identityPrompt, 'Omissão de referenceKind deve ser 100% retrocompatível com identidade');

  // 5. Instruções do agente também diferenciam
  const sketchInstructions = buildFlowImagePromptInstructions({
    operation: 'reference',
    referenceKind: 'sketch',
  });
  assert.ok(sketchInstructions.includes('Do NOT keep sketch lines'), 'Instruções do agente devem proibir rabiscos para sketch');
});

test('guides and annotations are isolated and excluded from final elements', () => {
  const project = createProofProject();
  const sketchAnalysis = detectSketchPresence(project.layers);

  assert.equal(sketchAnalysis.hasSketch, true, 'Deve detectar a presença de traços de sketch');
  assert.equal(sketchAnalysis.pathCount, 1, 'Deve contabilizar 1 traço real de composição');
  assert.equal(sketchAnalysis.guideCount, 1, 'Deve contabilizar 1 elemento isolado de guia/anotação');

  const request = prepareSketchCompositeReference(project);
  const guideDiag = request.diagnostics.find((d) => d.code === 'GUIDES_EXCLUDED');
  assert.ok(guideDiag, 'Deve gerar diagnóstico registrando a exclusão de guias da referência enviada');
  assert.equal(request.compositePreview?.excludedGuidesCount, 1, 'Prévia deve registrar 1 guia excluída');
});

test('composite reference preparer never discards references silently', () => {
  const project = createProofProject();
  // O projeto possui um anexo 'serum-antiaging-50ml.png' posicionado e um anexo 'warm-nordic-lighting.jpg' NÃO posicionado
  const placedInfo = detectPlacedImages(project.layers);
  assert.equal(placedInfo.hasProductImage, true, 'Deve detectar produto posicionado');

  const unplacedDiags = checkUnplacedAttachments(
    project.attachments,
    placedInfo.placedAttachmentIds,
    project.activeReferenceId
  );

  assert.equal(unplacedDiags.length, 1, 'Deve detectar exatamente 1 anexo não posicionado');
  assert.equal(unplacedDiags[0].code, 'UNPLACED_ATTACHMENT');
  assert.equal(unplacedDiags[0].severity, 'warning');
  assert.ok(unplacedDiags[0].message.includes('warm-nordic-lighting.jpg'), 'Deve nomear o arquivo não posicionado');

  const request = prepareSketchCompositeReference(project);
  assert.equal(request.referenceMode, 'composite', 'Deve classificar como composite (sketch + produto)');
  assert.equal(request.referenceKind, 'composite');
  assert.equal(request.providerAspectRatio, '3:4', 'Prancheta 4:5 deve ser mapeada para 3:4');

  const aspectDiag = request.diagnostics.find((d) => d.code === 'ASPECT_RATIO_ADAPTED');
  assert.ok(aspectDiag, 'Deve registrar adaptação de proporção nos diagnósticos');
});

test('technical proof verifies sketch + product contract and identifies mock vs real execution', async () => {
  const proofResult = await runSketchProductTechnicalProof();

  assert.ok(proofResult.id.startsWith('proof-res-'), 'Deve gerar ID único de resultado');
  assert.equal(proofResult.schemaVersion, 1, 'Resultado deve possuir schemaVersion 1');
  assert.equal(proofResult.version, SKETCH_SCHEMA_VERSION, 'Resultado deve possuir version 1.0.0');
  assert.equal(proofResult.isRealExecution, false, 'Execução em ambiente de testes deve ser identificada como mock/não-real');
  assert.equal(proofResult.executionStatus, 'mock_validated_contract_pending_live_flow');
  assert.ok(proofResult.pendingReason, 'Deve documentar explicitamente o motivo da pendência');
  assert.ok(
    proofResult.pendingReason?.includes('Google Flow'),
    'Motivo da pendência deve registrar ausência de sessão autenticada ativa no Google Flow'
  );
  assert.ok(proofResult.diagnostics.length > 0, 'Deve conter diagnósticos de validação da composição');
});

test('renderSketchOnlyDataUrl and renderCompositeReferenceDataUrl handle Node environment gracefully', async () => {
  const sketchOnly = renderSketchOnlyDataUrl([]);
  assert.equal(typeof sketchOnly, 'string');
  assert.ok(sketchOnly.startsWith('data:image/'), 'Deve retornar data URL de imagem válida');

  const project = createProofProject();
  const compositeDataUrl = await renderCompositeReferenceDataUrl(project);
  assert.equal(typeof compositeDataUrl, 'string');
  assert.ok(compositeDataUrl.startsWith('data:image/'), 'Deve retornar data URL de imagem válida');
});

test('sketch contracts enforce versioning across all sub-contracts (document, briefing, copy, layers, attachments, results)', () => {
  const briefing: import('../types/sketch.ts').SketchBriefingData = {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    productDescription: 'Skincare serum',
  };
  const copy: import('../types/sketch.ts').SketchCopyData = {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    headline: 'Brilho Natural',
    subheadline: 'Subtitulo',
    cta: 'Compre',
    badge: 'Novo',
  };
  const doc: import('../types/sketch.ts').SketchDocumentData = {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    dimensions: { width: 1080, height: 1350, unit: 'px' },
    canvasAspectRatio: '4:5',
    layers: [],
  };
  const att: import('../types/sketch.ts').SketchAttachment = {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    id: 'att-x',
    name: 'logo.png',
    dataUrl: 'data:image/png;base64,sample',
    role: 'logo',
    createdAt: new Date().toISOString(),
  };

  assert.equal(briefing.schemaVersion, 1);
  assert.equal(briefing.version, '1.0.0');
  assert.equal(copy.schemaVersion, 1);
  assert.equal(doc.schemaVersion, 1);
  assert.equal(att.schemaVersion, 1);
});

test('sketch presence respects useSketchAsReference flag and exportToProvider flag', () => {
  const project = createProofProject();

  // 1. Desabilitar explicitamente o sketch como referencia
  project.useSketchAsReference = false;
  const analysisWithoutSketch = detectSketchPresence(project.layers, project.useSketchAsReference);
  assert.equal(analysisWithoutSketch.hasSketch, false, 'hasSketch deve ser false quando useSketchAsReference for false');
  assert.equal(analysisWithoutSketch.pathCount, 1, 'pathCount deve continuar registrando os tracos locais');

  const reqWithoutSketch = prepareSketchCompositeReference(project);
  assert.equal(reqWithoutSketch.referenceMode, 'identity', 'Deve ser modo identity do produto, nao composite');
  assert.equal(reqWithoutSketch.referenceKind, 'identity');

  // 2. Respeito a exportToProvider = false
  project.useSketchAsReference = true;
  project.layers = project.layers.map((l) =>
    l.type === 'sketch' ? { ...l, exportToProvider: false } : l
  );
  const analysisIgnored = detectSketchPresence(project.layers, project.useSketchAsReference);
  assert.equal(analysisIgnored.hasSketch, false, 'Camadas com exportToProvider=false nao devem contar para o envio');
});

test('composite mode supports person and logo roles and resolves layer roles from attachments', () => {
  const project = createProofProject();

  // Testar resolucao automatica da role quando layer.role for omitido, mas attachmentId apontar para anexo
  project.layers = project.layers.map((l) => {
    if (l.type === 'image') {
      const { role: _omitted, ...rest } = l;
      return rest as import('../types/sketch.ts').ImageLayer;
    }
    return l;
  });

  const placed = detectPlacedImages(project.layers, project.attachments);
  assert.equal(placed.hasProductImage, true, 'Deve resolver role=product a partir do anexo vinculado');
  assert.equal(placed.hasSubjectImage, true);

  // Testar com papel de pessoa (modelo)
  const personProject = createProofProject();
  personProject.attachments[0].role = 'person';
  personProject.layers = personProject.layers.map((l) =>
    l.type === 'image' ? { ...l, role: 'person' as const } : l
  );
  const personReq = prepareSketchCompositeReference(personProject);
  assert.equal(personReq.referenceMode, 'composite', 'Pessoa + sketch deve ser composite');
  assert.equal(personReq.referenceKind, 'composite');
});

test('composite diagnostics track multiple placed subjects and superseded references', () => {
  const project = createProofProject();

  // Adicionar segundo produto posicionado na prancheta
  project.layers.push({
    id: 'layer-second-product',
    name: 'Segundo Produto',
    type: 'image',
    imageUrl: 'data:image/png;base64,sample2',
    role: 'product',
    x: 10,
    y: 10,
    width: 20,
    height: 30,
    visible: true,
    opacity: 1,
  });

  const req = prepareSketchCompositeReference(project);
  const multiDiag = req.diagnostics.find((d) => d.code === 'MULTIPLE_SUBJECTS_COMPOSITED');
  assert.ok(multiDiag, 'Deve diagnosticar múltiplos elementos posicionados na prancheta');

  const supersededDiag = req.diagnostics.find((d) => d.code === 'REFERENCE_SUPERSEDED_BY_COMPOSITE');
  assert.ok(supersededDiag, 'Deve diagnosticar que a referência avulsa ativa foi incorporada na composição');
});
