import { NextResponse } from 'next/server';
import { JsonStorageProvider } from '@/lib/cognitive-memory/storage/JsonStorageProvider';
import type { GraphNode, GraphEdge } from '@/lib/cognitive-memory/types/graph';

export async function GET() {
  try {
    const storage = new JsonStorageProvider();
    const data = await storage.readMemory();

    let nodes: GraphNode[] = data.semantic.nodes || [];
    let edges: GraphEdge[] = data.semantic.edges || [];

    // Se o grafo estiver vazio, insere dados padrões de semente ("seed")
    if (nodes.length === 0) {
      nodes = [
        {
          id: 'concept:react-ugc-studio',
          label: 'Mr. Chicken UGC Studio',
          type: 'concept',
          description: 'Núcleo central de criação autônoma de vídeo e criativos de imagem do Mr. Chicken.',
          confidenceScore: 1.0,
          lastObserved: new Date().toISOString(),
          metadata: { system: true }
        },
        {
          id: 'concept:model-gemini',
          label: 'Gemini 2.5 Flash',
          type: 'entity',
          description: 'Modelo de linguagem de alto desempenho para planejamento, análise de roteiro e classificação de intenções.',
          confidenceScore: 0.98,
          lastObserved: new Date().toISOString(),
          metadata: {}
        },
        {
          id: 'concept:model-veo',
          label: 'VideoFX Veo 3.1',
          type: 'entity',
          description: 'Modelo gerador de vídeos cinematográficos curtos de fundo.',
          confidenceScore: 0.92,
          lastObserved: new Date().toISOString(),
          metadata: {}
        },
        {
          id: 'concept:model-imagefx',
          label: 'ImageFX Imagen 3',
          type: 'entity',
          description: 'Modelo gerador de imagens publicitárias e turnaround de personagens 3D.',
          confidenceScore: 0.95,
          lastObserved: new Date().toISOString(),
          metadata: {}
        },
        {
          id: 'concept:lipsync-musetalk',
          label: 'Lipsync MuseTalk',
          type: 'entity',
          description: 'Engine de processamento de sincronização labial baseado em marcos faciais.',
          confidenceScore: 0.88,
          lastObserved: new Date().toISOString(),
          metadata: {}
        },
        {
          id: 'concept:audio-tts',
          label: 'Omnivoice TTS',
          type: 'entity',
          description: 'Provedor de síntese de voz neural e geração de áudios de experts.',
          confidenceScore: 0.94,
          lastObserved: new Date().toISOString(),
          metadata: {}
        },
        {
          id: 'concept:playwright-automation',
          label: 'Playwright Browser Automation',
          type: 'concept',
          description: 'Orquestrador de automação de navegador para interação e download de mídias do Google Flow.',
          confidenceScore: 0.90,
          lastObserved: new Date().toISOString(),
          metadata: {}
        },
        {
          id: 'concept:script-writing',
          label: 'Roteirização de UGC',
          type: 'concept',
          description: 'Geração de roteiros de alta retenção baseada na análise multimodal de vídeos.',
          confidenceScore: 0.92,
          lastObserved: new Date().toISOString(),
          metadata: {}
        },
        {
          id: 'concept:ad-creatives',
          label: 'Criativos Publicitários',
          type: 'concept',
          description: 'Geração automatizada de criativos de anúncios em escala para tráfego pago.',
          confidenceScore: 0.95,
          lastObserved: new Date().toISOString(),
          metadata: {}
        }
      ];

      edges = [
        {
          id: 'edge:react-ugc-studio->model-gemini',
          source: 'concept:react-ugc-studio',
          target: 'concept:model-gemini',
          relation: 'uses_model',
          weight: 0.95,
          confidenceScore: 1.0,
          occurrences: 1,
          lastReinforced: new Date().toISOString()
        },
        {
          id: 'edge:react-ugc-studio->model-veo',
          source: 'concept:react-ugc-studio',
          target: 'concept:model-veo',
          relation: 'uses_model',
          weight: 0.90,
          confidenceScore: 1.0,
          occurrences: 1,
          lastReinforced: new Date().toISOString()
        },
        {
          id: 'edge:react-ugc-studio->model-imagefx',
          source: 'concept:react-ugc-studio',
          target: 'concept:model-imagefx',
          relation: 'uses_model',
          weight: 0.92,
          confidenceScore: 1.0,
          occurrences: 1,
          lastReinforced: new Date().toISOString()
        },
        {
          id: 'edge:react-ugc-studio->lipsync-musetalk',
          source: 'concept:react-ugc-studio',
          target: 'concept:lipsync-musetalk',
          relation: 'uses_tool',
          weight: 0.85,
          confidenceScore: 1.0,
          occurrences: 1,
          lastReinforced: new Date().toISOString()
        },
        {
          id: 'edge:react-ugc-studio->audio-tts',
          source: 'concept:react-ugc-studio',
          target: 'concept:audio-tts',
          relation: 'uses_tool',
          weight: 0.88,
          confidenceScore: 1.0,
          occurrences: 1,
          lastReinforced: new Date().toISOString()
        },
        {
          id: 'edge:model-gemini->script-writing',
          source: 'concept:model-gemini',
          target: 'concept:script-writing',
          relation: 'supports',
          weight: 0.92,
          confidenceScore: 0.98,
          occurrences: 1,
          lastReinforced: new Date().toISOString()
        },
        {
          id: 'edge:model-imagefx->ad-creatives',
          source: 'concept:model-imagefx',
          target: 'concept:ad-creatives',
          relation: 'supports',
          weight: 0.95,
          confidenceScore: 0.95,
          occurrences: 1,
          lastReinforced: new Date().toISOString()
        },
        {
          id: 'edge:playwright-automation->model-veo',
          source: 'concept:playwright-automation',
          target: 'concept:model-veo',
          relation: 'controls',
          weight: 0.90,
          confidenceScore: 0.90,
          occurrences: 1,
          lastReinforced: new Date().toISOString()
        },
        {
          id: 'edge:playwright-automation->model-imagefx',
          source: 'concept:playwright-automation',
          target: 'concept:model-imagefx',
          relation: 'controls',
          weight: 0.92,
          confidenceScore: 0.90,
          occurrences: 1,
          lastReinforced: new Date().toISOString()
        }
      ];
    }

    return NextResponse.json({ nodes, edges });
  } catch (err: any) {
    console.error("[Graph API] Falha ao retornar dados do grafo de córtex:", err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
