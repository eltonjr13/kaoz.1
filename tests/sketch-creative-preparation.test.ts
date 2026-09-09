import test from 'node:test';
import assert from 'node:assert/strict';
import {
  type SketchProjectData,
  type SketchBriefingData,
  type SketchCopyData,
  type SketchLayer,
  type SketchAttachment,
  SKETCH_SCHEMA_VERSION,
} from '../types/sketch.ts';
import {
  compileCreativeGenerationPrompt,
  validateCreativePrompt,
  extractCopyZones,
  extractSubjectPlacements,
  extractCompositionGuides,
  compileCreativeGenerationRequest,
} from '../lib/sketch/sketch-prompt-compiler.ts';
import {
  prepareFlowImagePrompt,
  buildFlowImagePromptInstructions,
} from '../lib/ai/image-prompt-engineering.ts';

function createSampleBriefing(): SketchBriefingData {
  return {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    productDescription: 'Fone de ouvido sem fio over-ear com cancelamento ativo de ruído.',
    product: 'Fone de ouvido sem fio over-ear',
    brandName: 'Aura Sound',
    targetAudience: 'Profissionais remotos e apreciadores de áudio de alta fidelidade',
    objective: 'Geração de vendas diretas no e-commerce',
    offer: 'Frete Grátis para todo o Brasil',
    keyBenefits: ['Cancelamento ativo de ruído de 40dB', 'Bateria com 50 horas de autonomia', 'Áudio espacial 360'],
    tone: 'Sofisticado, confiável e tecnológico',
    visualStyle: 'Fotografia comercial de estúdio em fundo escuro minimalista',
    colorPalette: ['#0f111a', '#6366f1', '#f8fafc'],
    suggestedVisualPrompt: 'Studio advertising shot of matte black premium headphones on a dark pedestal with soft indigo rim lighting.',
  };
}

function createSampleCopy(): SketchCopyData {
  return {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    headline: 'Silêncio Absoluto. Som Perfeito.',
    subheadline: 'O novo fone Aura Sound com cancelamento adaptativo de 40dB para você ouvir apenas o essencial.',
    cta: 'Compre com Frete Grátis',
    badge: 'Lançamento Exclusivo',
    disclaimer: 'Consulte condições de entrega para a sua região.',
  };
}

function createSampleLayers(): SketchLayer[] {
  return [
    {
      id: 'bg-1',
      name: 'Fundo Studio Escuro',
      type: 'background',
      fillType: 'color',
      color: '#0f111a',
      visible: true,
      opacity: 1,
    },
    {
      id: 'img-product-1',
      name: 'Fone de Ouvido Aura',
      type: 'image',
      attachmentId: 'att-headphones',
      imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      role: 'product',
      x: 35,
      y: 30,
      width: 45,
      height: 50,
      visible: true,
      opacity: 1,
    },
    {
      id: 'text-headline',
      name: 'Camada Headline',
      type: 'text',
      role: 'headline',
      text: 'Silêncio Absoluto. Som Perfeito.',
      x: 10,
      y: 8,
      width: 80,
      height: 12,
      fontSize: 36,
      fontFamily: 'Inter, sans-serif',
      fontWeight: 'bold',
      color: '#ffffff',
      textAlign: 'center',
      visible: true,
      opacity: 1,
    },
    {
      id: 'text-cta',
      name: 'Camada Botão CTA',
      type: 'text',
      role: 'cta',
      text: 'Compre com Frete Grátis',
      x: 30,
      y: 84,
      width: 40,
      height: 8,
      fontSize: 18,
      fontFamily: 'Inter, sans-serif',
      fontWeight: 'semibold',
      color: '#ffffff',
      backgroundColor: '#6366f1',
      textAlign: 'center',
      visible: true,
      opacity: 1,
    },
    {
      id: 'guide-lighting',
      name: 'Anotação: Luz lateral suave vindo da esquerda',
      type: 'shape',
      shapeType: 'line',
      isGuide: true,
      elementKind: 'annotation',
      x: 5,
      y: 40,
      width: 20,
      height: 10,
      strokeColor: '#f59e0b',
      strokeWidth: 2,
      visible: true,
      opacity: 0.8,
    },
    {
      id: 'sketch-layout',
      name: 'Rascunho de Enquadramento',
      type: 'sketch',
      visible: true,
      opacity: 0.9,
      paths: [
        {
          id: 'path-focal',
          tool: 'brush',
          color: '#6366f1',
          size: 3,
          opacity: 1,
          points: [{ x: 300, y: 300 }, { x: 700, y: 700 }],
        },
        {
          id: 'guide-text-box',
          tool: 'box',
          color: '#f59e0b',
          size: 2,
          opacity: 0.6,
          isGuide: true,
          boxLabel: 'ÁREA DE TEXTO PROTEGIDA NO TOPO',
          boxRect: { x: 100, y: 50, width: 800, height: 150 },
          points: [],
        },
      ],
    },
  ];
}

function createSampleAttachments(): SketchAttachment[] {
  return [
    {
      id: 'att-headphones',
      name: 'aura-headphones-black.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      role: 'product',
      width: 1000,
      height: 1000,
      createdAt: new Date().toISOString(),
    },
  ];
}

function createSampleProject(): SketchProjectData {
  return {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    id: 'creative-prep-proj-01',
    title: 'Campanha Fone Aura Sound',
    description: 'Anúncio estático de alta conversão',
    aspectRatio: '1:1',
    canvasAspectRatio: '1:1',
    prompt: 'Commercial advertising photography of sleek over-ear headphones on a pedestal.',
    useSketchAsReference: true,
    compositionIntent: 'follow',
    textRenderingStrategy: 'layer',
    briefing: createSampleBriefing(),
    copy: createSampleCopy(),
    attachments: createSampleAttachments(),
    layers: createSampleLayers(),
    generationHistory: [],
    updatedAt: new Date().toISOString(),
  };
}

test('briefing criativo expandido possui todos os campos estruturados sem perda de dados', () => {
  const briefing = createSampleBriefing();
  assert.ok(briefing.productDescription, 'Produto deve existir');
  assert.ok(briefing.objective, 'Objetivo deve existir');
  assert.ok(briefing.targetAudience, 'Público deve existir');
  assert.ok(briefing.offer, 'Oferta deve existir');
  assert.ok(briefing.keyBenefits && briefing.keyBenefits.length >= 3, 'Benefícios devem existir');
  assert.ok(briefing.tone, 'Tom deve existir');
  assert.ok(briefing.visualStyle, 'Estilo visual deve existir');
  assert.ok(briefing.colorPalette && briefing.colorPalette.length > 0, 'Paleta de cores deve existir');
});

test('compilação de zonas de copy reserva espaço negativo limpo no modo layer padrão', () => {
  const layers = createSampleLayers();
  const zones = extractCopyZones(layers);

  assert.equal(zones.length, 2, 'Deve identificar as 2 camadas de texto (headline e cta)');
  const headlineZone = zones.find((z) => z.role === 'headline');
  const ctaZone = zones.find((z) => z.role === 'cta');

  assert.ok(headlineZone, 'Zona de headline deve existir');
  assert.ok(ctaZone, 'Zona de cta deve existir');
  assert.ok(headlineZone.zoneDescription.includes('upper'), 'Headline no topo deve ser classificada como upper');
  assert.ok(ctaZone.zoneDescription.includes('lower'), 'CTA na base deve ser classificado como lower');

  const project = createSampleProject();
  project.textRenderingStrategy = 'layer';
  const compiled = compileCreativeGenerationRequest(project);

  assert.equal(compiled.textRenderingStrategy, 'layer');
  assert.match(compiled.preparedPrompt, /clean, low-clutter, copy-safe negative space/i);
  assert.match(compiled.preparedPrompt, /Do NOT render, generate, or burn any typography/i);
});

test('modo explícito baked inclui a copy aprovada literalmente entre aspas no prompt', () => {
  const project = createSampleProject();
  project.textRenderingStrategy = 'baked';

  const compiled = compileCreativeGenerationRequest(project);
  assert.equal(compiled.textRenderingStrategy, 'baked');

  assert.match(compiled.preparedPrompt, /Headline: "Silêncio Absoluto\. Som Perfeito\."/);
  assert.match(compiled.preparedPrompt, /CTA: "Compre com Frete Grátis"/);
  assert.match(compiled.preparedPrompt, /Badge: "Lançamento Exclusivo"/);
  assert.match(compiled.preparedPrompt, /Preserve every character inside quotes exactly as written/i);
});

test('instruções qualitativas Seguir vs Explorar composição não inventam porcentagens fictícias', () => {
  const projectFollow = createSampleProject();
  projectFollow.compositionIntent = 'follow';
  const compiledFollow = compileCreativeGenerationRequest(projectFollow);

  assert.match(compiledFollow.preparedPrompt, /Follow composition/i);
  assert.match(compiledFollow.preparedPrompt, /Adhere strictly to the spatial placement, framing boundaries/i);
  assert.doesNotMatch(compiledFollow.preparedPrompt, /%|\b0\.\d+\b|percentage|fidelity/i);

  const projectExplore = createSampleProject();
  projectExplore.compositionIntent = 'explore';
  const compiledExplore = compileCreativeGenerationRequest(projectExplore);

  assert.match(compiledExplore.preparedPrompt, /Explore composition/i);
  assert.match(compiledExplore.preparedPrompt, /flexible creative guidance for camera framing/i);
  assert.doesNotMatch(compiledExplore.preparedPrompt, /%|\b0\.\d+\b|percentage|fidelity/i);
});

test('anotações e guias orientam composição e são estritamente proibidas de virar texto impresso', () => {
  const layers = createSampleLayers();
  const guides = extractCompositionGuides(layers);

  assert.ok(guides.length >= 2, 'Deve extrair guia de camada e guia de sketch');
  const lightingGuide = guides.find((g) => g.instruction.includes('Luz lateral'));
  assert.ok(lightingGuide, 'Deve incluir anotação de luz lateral');

  const project = createSampleProject();
  const compiled = compileCreativeGenerationRequest(project);

  assert.match(compiled.preparedPrompt, /Composition direction notes:/i);
  assert.match(compiled.preparedPrompt, /Luz lateral suave vindo da esquerda/i);
  assert.match(compiled.preparedPrompt, /strictly NOT be rendered as printed text, handwriting, arrows, labels, or visible words/i);
});

test('separação estrita entre sketch de layout, referência de produto e edição de imagem pronta', () => {
  // 1. Sketch de layout: framing e posicionamento sem rabiscos
  const sketchPrompt = prepareFlowImagePrompt({
    prompt: 'A commercial advertisement scene for headphones',
    operation: 'reference',
    referenceKind: 'sketch',
  });
  assert.match(sketchPrompt, /layout sketch and spatial composition guide/i);
  assert.match(sketchPrompt, /do not keep or reproduce rough sketch lines, scribbles, pencil marks, or wireframe boxes/i);
  assert.doesNotMatch(sketchPrompt, /Edit the attached source image/i);

  // 2. Referência de produto: preservação de identidade e materiais
  const identityPrompt = prepareFlowImagePrompt({
    prompt: 'Place the product bottle on an illuminated marble counter',
    operation: 'reference',
    referenceKind: 'identity',
  });
  assert.match(identityPrompt, /visual reference for the main subject or product/i);
  assert.match(identityPrompt, /Preserve its identity, silhouette, proportions, colors, materials, and defining details/i);
  assert.doesNotMatch(identityPrompt, /sketch lines|pencil marks/i);

  // 3. Edição de imagem pronta: preservação de detalhes não alterados
  const editPrompt = prepareFlowImagePrompt({
    prompt: 'change the headphones color from black to metallic silver',
    operation: 'edit',
  });
  assert.match(editPrompt, /^Edit the attached source image\. Apply this requested change:/i);
  assert.match(editPrompt, /Keep every unrequested subject identity, pose, camera angle, crop, composition/i);
  assert.doesNotMatch(editPrompt, /layout sketch|wireframe boxes/i);
});

test('mandato de integridade proíbe alucinação de preços, descontos falsos ou depoimentos', () => {
  const project = createSampleProject();
  const compiled = compileCreativeGenerationRequest(project);

  assert.match(compiled.preparedPrompt, /INTEGRITY MANDATE/i);
  assert.match(compiled.preparedPrompt, /Do not hallucinate, invent, or add non-existent product features, unstated prices, unauthorized discounts, or fictitious testimonials/i);
  assert.match(compiled.preparedPrompt, /Frete Grátis para todo o Brasil/);
});

test('validador de prompt detecta e sinaliza contradições sem truncar briefing crítico', () => {
  const layerContradictionPrompt = 'A commercial ad. Headline: "Compre Já", Subheadline: "Melhor Oferta". Do not render text.';
  const layerIssues = validateCreativePrompt(layerContradictionPrompt, 'layer');
  assert.ok(layerIssues.length > 0, 'Deve acusar contradição quando modo layer contém diretiva explícita de texto impresso');

  const bakedContradictionPrompt = 'A commercial ad with no text and without text in the background.';
  const bakedIssues = validateCreativePrompt(bakedContradictionPrompt, 'baked');
  assert.ok(bakedIssues.length > 0, 'Deve acusar contradição quando modo baked proíbe texto');

  const validPrompt = 'A commercial ad of premium headphones with clean negative space. Text rendering strategy: Layered typography overlay. No unrequested text.';
  const validIssues = validateCreativePrompt(validPrompt, 'layer');
  assert.equal(validIssues.length, 0, 'Prompt válido em camadas não deve apresentar erros');
});
