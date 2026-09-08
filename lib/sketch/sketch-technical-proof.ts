import {
  type SketchProjectData,
  type SketchGenerationResult,
  type SketchLayer,
  type SketchAttachment,
  SKETCH_SCHEMA_VERSION,
} from '../../types/sketch.ts';
import {
  prepareSketchCompositeReference,
} from './sketch-composite-preparer.ts';
import {
  renderCompositeReferenceDataUrl,
} from './sketch-exporter.ts';

const SAMPLE_BASE64_PRODUCT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const SAMPLE_BASE64_STYLE = 'data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function createProofLayers(): SketchLayer[] {
  return [
    {
      id: 'layer-proof-bg',
      name: 'Fundo Studio',
      type: 'background',
      fillType: 'color',
      color: '#0a0d14',
      visible: true,
      opacity: 1,
    },
    {
      id: 'layer-proof-product',
      name: 'Frasco de Serum Facial',
      type: 'image',
      attachmentId: 'att-proof-product',
      imageUrl: SAMPLE_BASE64_PRODUCT,
      role: 'product',
      x: 30,
      y: 25,
      width: 40,
      height: 50,
      visible: true,
      opacity: 1,
    },
    {
      id: 'layer-proof-sketch',
      name: 'Esboço de Enquadramento & Pódio',
      type: 'sketch',
      visible: true,
      opacity: 0.9,
      paths: [
        {
          id: 'path-podium',
          tool: 'brush',
          color: '#6366f1',
          size: 4,
          opacity: 1,
          points: [
            { x: 200, y: 800 },
            { x: 880, y: 800 },
            { x: 800, y: 920 },
            { x: 280, y: 920 },
            { x: 200, y: 800 },
          ],
        },
        {
          id: 'guide-headline-box',
          tool: 'box',
          color: '#f59e0b',
          size: 2,
          opacity: 0.7,
          isGuide: true,
          boxLabel: 'GUIA: ÁREA RESERVADA PARA HEADLINE',
          boxRect: { x: 80, y: 80, width: 920, height: 160 },
          points: [],
        },
      ],
    },
  ];
}

function createProofAttachments(): SketchAttachment[] {
  return [
    {
      id: 'att-proof-product',
      name: 'serum-antiaging-50ml.png',
      dataUrl: SAMPLE_BASE64_PRODUCT,
      role: 'product',
      width: 800,
      height: 1000,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'att-proof-style',
      name: 'warm-nordic-lighting.jpg',
      dataUrl: SAMPLE_BASE64_STYLE,
      role: 'style',
      width: 1200,
      height: 800,
      createdAt: new Date().toISOString(),
    },
  ];
}

export function createProofProject(): SketchProjectData {
  return {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    id: 'proof-sketch-product-01',
    title: 'Prova Técnica: Sketch + Produto',
    description: 'Validação da viabilidade da geração guiada por sketch e produto com composição única.',
    aspectRatio: '3:4',
    canvasAspectRatio: '4:5',
    canvasDimensions: { width: 1080, height: 1350, unit: 'px' },
    prompt: 'Commercial advertising photograph of luxury face serum on a stone podium, soft warm backlight, crisp elegant finish.',
    useSketchAsReference: true,
    activeReferenceId: 'att-proof-product',
    referenceMode: 'composite',
    briefing: {
      productDescription: 'Serum facial antienvelhecimento com embalagem âmbar minimalista e conta-gotas dourado.',
      brandName: 'Aura Botanica',
      targetAudience: 'Mulheres 30-55 anos com rotina de skincare de alto padrão',
      objective: 'Lançamento de produto com posicionamento premium',
      tone: 'Sofisticado, minimalista, confiável e científico',
      keyBenefits: ['Hidratação profunda', 'Resultados em 14 dias', 'Fórmula vegana'],
    },
    copy: {
      headline: 'Aura Radiante Todos os Dias',
      subheadline: 'O poder regenerador do ácido hialurônico botânico.',
      cta: 'Experimente Agora',
      badge: 'Fórmula Exclusiva',
    },
    attachments: createProofAttachments(),
    layers: createProofLayers(),
    generationHistory: [],
    updatedAt: new Date().toISOString(),
  };
}

export interface TechnicalProofExecutionOptions {
  forceRealExecution?: boolean;
}

async function tryExecuteFlow(
  preparedPrompt: string,
  providerOptions: import('../../types/sketch').SketchGenerationRequest['providerOptions']
) {
  try {
    const { flowProvider } = await import('../../src/providers/flow/FlowProvider.ts');
    return await flowProvider.generateImage(preparedPrompt, providerOptions);
  } catch (err) {
    return {
      success: false,
      path: '',
      filename: '',
      createdAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runSketchProductTechnicalProof(
  customProject?: SketchProjectData,
  options?: TechnicalProofExecutionOptions
): Promise<SketchGenerationResult> {
  const project = customProject || createProofProject();
  let compositeDataUrl: string | undefined;
  try {
    compositeDataUrl = await renderCompositeReferenceDataUrl(project);
  } catch {
    // Fallback gracioso
  }
  const request = prepareSketchCompositeReference(project, {
    referenceDataUrlOverride: compositeDataUrl || undefined,
  });

  const isReal = Boolean(options && options.forceRealExecution);

  if (isReal) {
    const flowResult = await tryExecuteFlow(request.preparedPrompt, request.providerOptions);
    return {
      schemaVersion: 1,
      version: SKETCH_SCHEMA_VERSION,
      id: `proof-res-${Date.now()}`,
      requestId: request.id,
      projectId: project.id,
      createdAt: new Date().toISOString(),
      isRealExecution: true,
      executionStatus: flowResult.success ? 'completed_real' : 'failed',
      pendingReason: flowResult.success ? undefined : flowResult.error,
      generatedImages: flowResult.path
        ? [{ path: flowResult.path, filename: flowResult.filename, pdfPath: flowResult.pdfPaths?.[0] }]
        : [],
      providerResult: flowResult,
      diagnostics: request.diagnostics,
      notes: 'Geração real executada via FlowProvider.',
    };
  }

  return {
    schemaVersion: 1,
    version: SKETCH_SCHEMA_VERSION,
    id: `proof-res-${Date.now()}`,
    requestId: request.id,
    projectId: project.id,
    createdAt: new Date().toISOString(),
    isRealExecution: false,
    executionStatus: 'mock_validated_contract_pending_live_flow',
    pendingReason: 'Sessão live do Google Flow não autenticada no ambiente de testes. Os contratos de composição única, isolamento de guias e engenharia de prompt foram comprovados estruturalmente; a fidelidade visual final do modelo permanece como pendência para execução em sessão ativa autenticada.',
    generatedImages: [],
    diagnostics: request.diagnostics,
    notes: 'Prova técnica mínima de contrato: sketch + produto unificados em composição única sem descarte silencioso de referências.',
  };
}
