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
          label: 'Kaoz.1 UGC Studio',
          type: 'concept',
          description: 'Núcleo central de criação autônoma de vídeo e criativos de imagem do Kaoz.1.',
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

      // Persiste os dados de semente no arquivo para futuras edições
      const storage2 = new JsonStorageProvider();
      const seedData = await storage2.readMemory();
      seedData.semantic.nodes = nodes;
      seedData.semantic.edges = edges;
      await storage2.writeMemory(seedData);
    }

    return NextResponse.json({ nodes, edges });
  } catch (err: any) {
    console.error("[Graph API] Falha ao retornar dados do grafo de córtex:", err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}

// POST — Salva (upsert) um nó ou uma aresta no grafo semântico
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const storage = new JsonStorageProvider();
    const data = await storage.readMemory();

    if (body.type === 'node') {
      const node: GraphNode = body.data;
      if (!node.id || !node.label || !node.type) {
        return NextResponse.json({ error: 'Campos obrigatórios: id, label, type' }, { status: 400 });
      }

      node.lastObserved = new Date().toISOString();
      node.metadata = node.metadata || {};

      const existingIdx = data.semantic.nodes.findIndex((n) => n.id === node.id);
      if (existingIdx >= 0) {
        data.semantic.nodes[existingIdx] = { ...data.semantic.nodes[existingIdx], ...node };
      } else {
        data.semantic.nodes.push(node);
      }

      await storage.writeMemory(data);
      return NextResponse.json({ ok: true, node });
    }

    if (body.type === 'edge') {
      const edge: GraphEdge = body.data;
      if (!edge.id || !edge.source || !edge.target || !edge.relation) {
        return NextResponse.json({ error: 'Campos obrigatórios: id, source, target, relation' }, { status: 400 });
      }

      edge.lastReinforced = new Date().toISOString();

      const existingIdx = data.semantic.edges.findIndex((e) => e.id === edge.id);
      if (existingIdx >= 0) {
        const existing = data.semantic.edges[existingIdx];
        const alpha = 0.15;
        const newWeight = Math.min(1.0, existing.weight + alpha * (1.0 - existing.weight));
        data.semantic.edges[existingIdx] = {
          ...existing,
          ...edge,
          weight: newWeight,
          occurrences: existing.occurrences + 1
        };
      } else {
        data.semantic.edges.push(edge);
      }

      await storage.writeMemory(data);
      return NextResponse.json({ ok: true, edge });
    }

    return NextResponse.json({ error: 'type deve ser "node" ou "edge"' }, { status: 400 });
  } catch (err: any) {
    console.error("[Graph API POST] Erro ao salvar dados do grafo:", err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}

// DELETE — Remove um nó (e arestas conectadas) ou uma aresta pelo ID
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const entityType = searchParams.get('type') || 'node'; // 'node' | 'edge'

    if (!id) {
      return NextResponse.json({ error: 'Parâmetro "id" é obrigatório.' }, { status: 400 });
    }

    const storage = new JsonStorageProvider();
    const data = await storage.readMemory();

    if (entityType === 'node') {
      // Remove o nó e todas as arestas conectadas a ele
      data.semantic.nodes = data.semantic.nodes.filter((n) => n.id !== id);
      data.semantic.edges = data.semantic.edges.filter(
        (e) => e.source !== id && e.target !== id
      );
    } else if (entityType === 'edge') {
      data.semantic.edges = data.semantic.edges.filter((e) => e.id !== id);
    } else {
      return NextResponse.json({ error: 'type deve ser "node" ou "edge"' }, { status: 400 });
    }

    await storage.writeMemory(data);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[Graph API DELETE] Erro ao remover dados do grafo:", err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}

// PATCH — Marca um nó de erro como resolvido (muda type para 'concept')
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, action } = body;

    if (!id) {
      return NextResponse.json({ error: 'Parâmetro "id" é obrigatório.' }, { status: 400 });
    }

    const storage = new JsonStorageProvider();
    const data = await storage.readMemory();
    const nodeIdx = data.semantic.nodes.findIndex((n) => n.id === id);

    if (nodeIdx < 0) {
      return NextResponse.json({ error: 'Nó não encontrado.' }, { status: 404 });
    }

    if (action === 'resolve') {
      data.semantic.nodes[nodeIdx] = {
        ...data.semantic.nodes[nodeIdx],
        type: 'concept',
        confidenceScore: 0.5,
        lastObserved: new Date().toISOString(),
        metadata: {
          ...data.semantic.nodes[nodeIdx].metadata,
          resolvedAt: new Date().toISOString()
        }
      };
    } else if (action === 'update') {
      const updates = body.updates || {};
      data.semantic.nodes[nodeIdx] = {
        ...data.semantic.nodes[nodeIdx],
        ...updates,
        lastObserved: new Date().toISOString()
      };
    }

    await storage.writeMemory(data);
    return NextResponse.json({ ok: true, node: data.semantic.nodes[nodeIdx] });
  } catch (err: any) {
    console.error("[Graph API PATCH] Erro ao atualizar nó:", err);
    return NextResponse.json({ error: err.message || 'Erro interno.' }, { status: 500 });
  }
}
