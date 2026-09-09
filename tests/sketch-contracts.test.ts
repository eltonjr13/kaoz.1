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
  type SketchSimpleOrder,
  type SketchCreativePlan,
  type SketchCreativeResult,
  type SketchChangeIntent,
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

test('SketchSimpleOrder versioned contract serializes and validates complete order structure', () => {
  const sampleOrder: SketchSimpleOrder = {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    id: 'order-sample-01',
    prompt: 'Anúncio de tênis esportivo amortecimento dinâmico estilo minimalista',
    aspectRatio: '1:1',
    canvasAspectRatio: '1:1',
    canvasDimensions: { width: 1080, height: 1080, unit: 'px' },
    selectedReferences: [
      {
        attachmentId: 'att-shoe-1',
        role: 'product',
        name: 'tenis-preto.png',
        filePath: 'att-shoe-1.png',
      },
    ],
    sketchDrawing: {
      paths: [
        {
          id: 'path-1',
          tool: 'brush',
          color: '#ffffff',
          size: 6,
          opacity: 1,
          points: [
            { x: 100, y: 150 },
            { x: 200, y: 250 },
          ],
        },
      ],
      dataUrl: 'data:image/png;base64,drawingfake',
      hasDrawing: true,
    },
    createdAt: '2026-09-09T22:00:00.000Z',
  };

  const serialized = JSON.stringify(sampleOrder);
  const deserialized: SketchSimpleOrder = JSON.parse(serialized);

  assert.equal(deserialized.schemaVersion, 1);
  assert.equal(deserialized.version, '1.0.0');
  assert.equal(deserialized.id, 'order-sample-01');
  assert.equal(deserialized.prompt, 'Anúncio de tênis esportivo amortecimento dinâmico estilo minimalista');
  assert.equal(deserialized.aspectRatio, '1:1');
  assert.equal(deserialized.selectedReferences.length, 1);
  assert.equal(deserialized.selectedReferences[0].role, 'product');
  assert.equal(deserialized.sketchDrawing?.hasDrawing, true);
  assert.equal(deserialized.sketchDrawing?.paths.length, 1);
  assert.equal(deserialized.sketchDrawing?.paths[0].points.length, 2);
});

test('SketchCreativePlan separates literal user facts from AI inferred creative choices', () => {
  const samplePlan: SketchCreativePlan = {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    id: 'plan-sample-01',
    orderId: 'order-sample-01',
    providedFacts: {
      productOrService: 'Sérum Facial Vitamina C',
      brandName: 'Aura Skin',
      targetAudience: 'Público 25-45 anos interessado em skincare',
      explicitOffer: 'Frete Grátis na Primeira Compra',
      explicitPrice: 'R$ 149,90',
      mandatoryRestrictions: ['Não usar luz neon', 'Sem promessas médicas milagrosas'],
      rawUserPrompt: 'Quero um anúncio elegante para meu Sérum Facial Vitamina C da Aura Skin por R$ 149,90 com Frete Grátis na Primeira Compra',
    },
    inferredCreativeDecisions: {
      selectedAngle: 'demonstration',
      angleRationale: 'Destacar o brilho e textura líquida da fórmula',
      alternativeConcepts: [
        {
          id: 'concept-1',
          angle: 'desire',
          title: 'Glow Radiante',
          description: 'Aura dourada e frescor matinal',
          visualHook: 'Gotas iluminadas refletindo o nascer do sol',
        },
        {
          id: 'concept-2',
          angle: 'objection',
          title: 'Cuidado sem Oleosidade',
          description: 'Absorção instantânea em pele real',
          visualHook: 'Textura leve que desaparece ao toque',
        },
        {
          id: 'concept-3',
          angle: 'demonstration',
          title: 'Pureza em Cada Gota',
          description: 'Close macro no frasco de vidro âmbar',
          visualHook: 'Pedra de mármore e reflexos aquáticos sutis',
        },
      ],
      visualConcept: 'Frasco âmbar premium sobre pedestal mineral com luz suave de estúdio',
      copy: {
        headline: 'Luminosidade Natural em Cada Gota',
        subheadline: 'Sérum com Vitamina C pura que revitaliza sua pele instantaneamente.',
        cta: 'Garanta o Seu com Frete Grátis',
        badge: 'R$ 149,90',
        disclaimer: 'Oferta válida por tempo limitado.',
      },
      artDirection: {
        colorPalette: ['#f59e0b', '#fef3c7', '#1e293b'],
        lighting: 'Soft directional studio lighting from upper left',
        mood: 'Sophisticated, clean and organic',
        backgroundStyle: 'Warm neutral textured stone podium',
        avoidCliches: true,
      },
      composition: {
        layoutType: 'rule_of_thirds',
        reservedCopyZones: [
          {
            role: 'headline',
            label: 'Zona do Título',
            zoneDescription: 'Espaço negativo no topo',
            x: 10,
            y: 10,
            width: 80,
          },
        ],
        subjectPlacements: [
          {
            role: 'product',
            label: 'Frasco do Sérum',
            zoneDescription: 'Centro inferior direito',
            x: 50,
            y: 40,
            width: 40,
            height: 50,
          },
        ],
        textRenderingStrategy: 'layer',
      },
    },
    compiledPrompt: 'Studio commercial photography of amber glass dropper bottle on warm stone pedestal, soft sunlight, clean negative space at top.',
    validationIssues: [],
    createdAt: '2026-09-09T22:01:00.000Z',
  };

  const serialized = JSON.stringify(samplePlan);
  const deserialized: SketchCreativePlan = JSON.parse(serialized);

  // Verificação de preservação literal dos fatos
  assert.equal(deserialized.providedFacts.explicitOffer, 'Frete Grátis na Primeira Compra');
  assert.equal(deserialized.providedFacts.explicitPrice, 'R$ 149,90');
  assert.equal(deserialized.providedFacts.brandName, 'Aura Skin');
  assert.equal(deserialized.providedFacts.mandatoryRestrictions.length, 2);

  // Verificação das inferências criativas
  assert.equal(deserialized.inferredCreativeDecisions.selectedAngle, 'demonstration');
  assert.equal(deserialized.inferredCreativeDecisions.alternativeConcepts?.length, 3);
  assert.equal(deserialized.inferredCreativeDecisions.artDirection.avoidCliches, true);
  assert.equal(deserialized.inferredCreativeDecisions.copy.cta, 'Garanta o Seu com Frete Grátis');
  assert.equal(deserialized.inferredCreativeDecisions.composition.layoutType, 'rule_of_thirds');
});

test('SketchCreativeResult encapsulates final asset, adjustment resources, and version lineage', () => {
  const sampleResult: SketchCreativeResult = {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    id: 'res-sample-01',
    projectId: 'proj-sample-01',
    originOrderId: 'order-sample-01',
    planId: 'plan-sample-01',
    lineage: {
      versionNumber: 1,
      iterationType: 'initial',
      timestamp: '2026-09-09T22:05:00.000Z',
    },
    creativePlan: {
      schemaVersion: 1,
      version: SKETCH_SCHEMA_VERSION,
      id: 'plan-sample-01',
      orderId: 'order-sample-01',
      providedFacts: {
        productOrService: 'Tênis de Corrida',
        mandatoryRestrictions: [],
        rawUserPrompt: 'Tênis de corrida veloz',
      },
      inferredCreativeDecisions: {
        selectedAngle: 'desire',
        angleRationale: 'Apelo à performance',
        visualConcept: 'Pista de atletismo ao entardecer',
        copy: {
          headline: 'Supere Seus Limites',
          subheadline: 'Amortecimento responsivo para treinos diários.',
          cta: 'Compre Agora',
        },
        artDirection: {
          colorPalette: ['#ef4444', '#18181b'],
          lighting: 'Golden hour dramatic backlight',
          mood: 'Energetic and focused',
          backgroundStyle: 'Red running track with motion blur',
          avoidCliches: true,
        },
        composition: {
          layoutType: 'diagonal_dynamic',
          reservedCopyZones: [],
          subjectPlacements: [],
          textRenderingStrategy: 'layer',
        },
      },
      compiledPrompt: 'Sport shoe suspended above track during sunset',
      validationIssues: [],
      createdAt: '2026-09-09T22:02:00.000Z',
    },
    finalAsset: {
      imageUrl: '/api/sketch/assets/final-shoe-ad.png',
      filePath: 'final-shoe-ad.png',
      width: 1080,
      height: 1080,
      aspectRatio: '1:1',
      fileSizeBytes: 524288,
      mimeType: 'image/png',
      format: 'png',
    },
    resourcesForAdjustments: {
      baseImageUrl: '/api/sketch/assets/base-shoe-clean.png',
      textLayers: [
        {
          id: 'text-headline',
          name: 'Título',
          type: 'text',
          role: 'headline',
          text: 'Supere Seus Limites',
          x: 10,
          y: 70,
          width: 80,
          fontSize: 42,
          fontFamily: 'Inter, sans-serif',
          fontWeight: '800',
          color: '#ffffff',
          textAlign: 'left',
          visible: true,
          opacity: 1,
        },
      ],
      usedReferencePaths: ['tenis-preto.png'],
      flowMediaPath: 'gs://flow-storage/shoe-media.png',
    },
    status: 'ready',
    createdAt: '2026-09-09T22:05:00.000Z',
  };

  const serialized = JSON.stringify(sampleResult);
  const deserialized: SketchCreativeResult = JSON.parse(serialized);

  assert.equal(deserialized.id, 'res-sample-01');
  assert.equal(deserialized.lineage.versionNumber, 1);
  assert.equal(deserialized.lineage.iterationType, 'initial');
  assert.equal(deserialized.finalAsset.format, 'png');
  assert.equal(deserialized.finalAsset.width, 1080);
  assert.equal(deserialized.resourcesForAdjustments.baseImageUrl, '/api/sketch/assets/base-shoe-clean.png');
  assert.equal(deserialized.resourcesForAdjustments.textLayers?.length, 1);
  assert.equal(deserialized.status, 'ready');
});

test('SketchChangeIntent formalizes text adjustment, visual adjustment, and new concept types', () => {
  const textAdjustmentIntent: SketchChangeIntent = {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    id: 'intent-text-01',
    type: 'refine_text',
    targetResultId: 'res-sample-01',
    userFeedback: 'Mudar o título para "Alcance Sua Melhor Marca"',
    keepBaseImage: true,
    createdAt: '2026-09-09T22:10:00.000Z',
  };

  const visualEditIntent: SketchChangeIntent = {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    id: 'intent-visual-01',
    type: 'refine_visual',
    targetResultId: 'res-sample-01',
    userFeedback: 'Trocar o fundo para um parque urbano arborizado',
    keepBaseImage: false,
    createdAt: '2026-09-09T22:12:00.000Z',
  };

  const newConceptIntent: SketchChangeIntent = {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    id: 'intent-concept-01',
    type: 'new_concept',
    targetResultId: 'res-sample-01',
    userFeedback: 'Outra ideia explorando superação de chuva e lama',
    keepBaseImage: false,
    createdAt: '2026-09-09T22:15:00.000Z',
  };

  assert.equal(textAdjustmentIntent.type, 'refine_text');
  assert.equal(textAdjustmentIntent.keepBaseImage, true);
  assert.equal(visualEditIntent.type, 'refine_visual');
  assert.equal(visualEditIntent.keepBaseImage, false);
  assert.equal(newConceptIntent.type, 'new_concept');
  assert.equal(newConceptIntent.keepBaseImage, false);
});

