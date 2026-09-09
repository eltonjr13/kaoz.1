import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  BackgroundLayer,
  ExportCompositionOptions,
  ImageLayer,
  ShapeLayer,
  SketchProjectData,
  TextLayer,
} from '../types/sketch.ts';
import {
  downloadComposition,
  exportCompositionBlob,
  exportCompositionDataUrl,
  renderCompositionToCanvas,
  resolveCanvasDimensionPreset,
} from '../lib/sketch/sketch-exporter.ts';

// Mock minimal DOM Canvas and Context for Node test environment
class MockCanvasRenderingContext2D {
  public operations: Array<{ type: string; args: any[] }> = [];
  public fillStyle: string = '#000000';
  public strokeStyle: string = '#000000';
  public lineWidth: number = 1;
  public globalAlpha: number = 1;
  public font: string = '10px sans-serif';
  public textAlign: string = 'left';
  public textBaseline: string = 'alphabetic';

  save() {
    this.operations.push({ type: 'save', args: [] });
  }
  restore() {
    this.operations.push({ type: 'restore', args: [] });
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.operations.push({ type: 'fillRect', args: [x, y, w, h, this.fillStyle] });
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    this.operations.push({ type: 'strokeRect', args: [x, y, w, h, this.strokeStyle] });
  }
  drawImage(img: any, ...args: number[]) {
    this.operations.push({ type: 'drawImage', args: [img, ...args] });
  }
  fillText(text: string, x: number, y: number) {
    this.operations.push({ type: 'fillText', args: [text, x, y, this.fillStyle, this.font] });
  }
  measureText(text: string) {
    return { width: text.length * 10 };
  }
  beginPath() {
    this.operations.push({ type: 'beginPath', args: [] });
  }
  closePath() {
    this.operations.push({ type: 'closePath', args: [] });
  }
  moveTo(x: number, y: number) {
    this.operations.push({ type: 'moveTo', args: [x, y] });
  }
  lineTo(x: number, y: number) {
    this.operations.push({ type: 'lineTo', args: [x, y] });
  }
  ellipse(...args: number[]) {
    this.operations.push({ type: 'ellipse', args });
  }
  roundRect(x: number, y: number, w: number, h: number, r: number) {
    this.operations.push({ type: 'roundRect', args: [x, y, w, h, r] });
  }
  stroke() {
    this.operations.push({ type: 'stroke', args: [] });
  }
  fill() {
    this.operations.push({ type: 'fill', args: [] });
  }
  translate(x: number, y: number) {
    this.operations.push({ type: 'translate', args: [x, y] });
  }
  rotate(rad: number) {
    this.operations.push({ type: 'rotate', args: [rad] });
  }
}

class MockHTMLCanvasElement {
  public width = 0;
  public height = 0;
  public ctx = new MockCanvasRenderingContext2D();

  getContext(contextId: string) {
    if (contextId === '2d') return this.ctx;
    return null;
  }

  toBlob(callback: (b: Blob | null) => void, mimeType = 'image/png') {
    const dummyBlob = {
      size: 1024,
      type: mimeType,
      arrayBuffer: async () => new ArrayBuffer(1024),
    } as unknown as Blob;
    callback(dummyBlob);
  }

  toDataURL(mimeType = 'image/png', _quality?: number) {
    return `data:${mimeType};base64,mockCanvasDataUrl`;
  }
}

function createSampleProject(aspectRatio: '1:1' | '4:5' | '9:16' | '16:9' = '1:1'): SketchProjectData {
  const bg: BackgroundLayer = {
    id: 'layer-bg-1',
    name: 'Fundo do Anúncio',
    type: 'background',
    fillType: 'color',
    color: '#1a1f2c',
    visible: true,
    opacity: 1,
  };

  const textHeadline: TextLayer = {
    id: 'layer-headline-1',
    name: 'Título Principal',
    type: 'text',
    role: 'headline',
    text: 'Sérum Renovador Glow',
    x: 10,
    y: 15,
    width: 80,
    fontSize: 48,
    fontFamily: 'Montserrat, sans-serif',
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'left',
    visible: true,
    opacity: 1,
  };

  const textCta: TextLayer = {
    id: 'layer-cta-1',
    name: 'Botão CTA',
    type: 'text',
    role: 'cta',
    text: 'Compre com 30% OFF',
    x: 10,
    y: 80,
    width: 60,
    fontSize: 28,
    fontFamily: 'Inter, sans-serif',
    fontWeight: '600',
    color: '#ffffff',
    backgroundColor: '#4f46e5',
    backgroundPadding: 16,
    borderRadius: 12,
    textAlign: 'center',
    visible: true,
    opacity: 1,
  };

  const guideLayer: ShapeLayer = {
    id: 'layer-guide-1',
    name: 'Guia de Terços',
    type: 'shape',
    shapeType: 'rect',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    strokeColor: '#38bdf8',
    strokeWidth: 2,
    visible: true,
    opacity: 0.5,
    isGuide: true,
    elementKind: 'guide',
  };

  const annotationLayer: TextLayer = {
    id: 'layer-annot-1',
    name: 'Nota Criativa',
    type: 'text',
    role: 'custom',
    text: 'Anotação: Manter produto iluminado no centro',
    x: 20,
    y: 50,
    width: 60,
    fontSize: 20,
    fontFamily: 'sans-serif',
    fontWeight: '400',
    color: '#facc15',
    textAlign: 'left',
    visible: true,
    opacity: 1,
    isGuide: true,
    elementKind: 'annotation',
  };

  return {
    schemaVersion: 1,
    version: '1.0.0',
    id: 'proj-export-test',
    title: 'Campanha Sérum Verão 2026',
    canvasAspectRatio: aspectRatio,
    aspectRatio: aspectRatio === '4:5' ? '3:4' : aspectRatio,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    briefing: {
      product: 'Sérum Facial',
      productDescription: 'Sérum hidratante premium com vitamina C e ácido hialurônico.',
      objective: 'Conversão',
    },
    copy: {
      headline: 'Sérum Renovador Glow',
      subheadline: 'Pele iluminada e radiante em 7 dias',
      cta: 'Compre com 30% OFF',
      badge: '30% OFF',
    },
    description: 'Campanha de teste para exportação',
    prompt: 'Campanha de Sérum',
    useSketchAsReference: false,
    layers: [bg, textHeadline, textCta, guideLayer, annotationLayer],
    attachments: [],
    generationHistory: [],
    snapshots: [],
  };
}

test('pranchetas 1:1, 4:5, 9:16 e 16:9 inicializam dimensões exatas e mapeamento', () => {
  const p1 = createSampleProject('1:1');
  const d1 = resolveCanvasDimensionPreset(p1);
  assert.equal(d1.width, 1080);
  assert.equal(d1.height, 1080);

  const p2 = createSampleProject('4:5');
  const d2 = resolveCanvasDimensionPreset(p2);
  assert.equal(d2.width, 1080);
  assert.equal(d2.height, 1350);

  const p3 = createSampleProject('9:16');
  const d3 = resolveCanvasDimensionPreset(p3);
  assert.equal(d3.width, 1080);
  assert.equal(d3.height, 1920);

  const p4 = createSampleProject('16:9');
  const d4 = resolveCanvasDimensionPreset(p4);
  assert.equal(d4.width, 1920);
  assert.equal(d4.height, 1080);
});

test('renderCompositionToCanvas renderiza dimensões nativas e com escala (upscale 2x e 0.5x)', async () => {
  const project = createSampleProject('4:5');

  // 1x Native
  const canvas1 = new MockHTMLCanvasElement();
  await renderCompositionToCanvas(project, canvas1 as any, { scale: 1 });
  assert.equal(canvas1.width, 1080);
  assert.equal(canvas1.height, 1350);

  // 2x Upscale
  const canvas2 = new MockHTMLCanvasElement();
  await renderCompositionToCanvas(project, canvas2 as any, { scale: 2 });
  assert.equal(canvas2.width, 2160);
  assert.equal(canvas2.height, 2700);

  // 0.5x Preview
  const canvasHalf = new MockHTMLCanvasElement();
  await renderCompositionToCanvas(project, canvasHalf as any, { scale: 0.5 });
  assert.equal(canvasHalf.width, 540);
  assert.equal(canvasHalf.height, 675);
});

test('exclusão estrita de guias e anotações na exportação da arte final', async () => {
  const project = createSampleProject('1:1');
  const canvas = new MockHTMLCanvasElement();

  await renderCompositionToCanvas(project, canvas as any, { excludeGuides: true });

  const fillTextOps = canvas.ctx.operations.filter((op) => op.type === 'fillText');
  const textContents = fillTextOps.map((op) => op.args[0]);

  // Deve conter o título e o CTA
  assert.ok(textContents.includes('Sérum Renovador Glow'));
  assert.ok(textContents.includes('Compre com 30% OFF'));

  // NÃO deve conter anotação de guia
  assert.ok(!textContents.some((t: string) => t.includes('Anotação: Manter produto iluminado')));

  // NÃO deve conter o retângulo de guia de terços
  const guideRectOps = canvas.ctx.operations.filter(
    (op) => op.type === 'strokeRect' && op.args[4] === '#38bdf8'
  );
  assert.equal(guideRectOps.length, 0, 'Nenhum strokeRect de guia deve ser renderizado');
});

test('tratamento explícito de transparência no formato JPEG preenche fundo sólido para evitar artefatos pretos', async () => {
  const project = createSampleProject('1:1');
  const canvas = new MockHTMLCanvasElement();

  // Exportar como JPEG
  await renderCompositionToCanvas(project, canvas as any, {
    format: 'jpeg',
    backgroundColorForJpeg: '#ffffff',
  });

  const firstOp = canvas.ctx.operations[0];
  assert.equal(firstOp.type, 'save');
  const fillRectOp = canvas.ctx.operations[1];
  assert.equal(fillRectOp.type, 'fillRect');
  assert.equal(fillRectOp.args[4], '#ffffff', 'Primeira operação do JPEG deve preencher fundo sólido');
});

test('camadas de texto renderizam estilo de CTA (fundo, padding e cantos arredondados)', async () => {
  const project = createSampleProject('1:1');
  const canvas = new MockHTMLCanvasElement();

  await renderCompositionToCanvas(project, canvas as any);

  // Deve ter desenhado o fundo do CTA com roundRect
  const roundRectOps = canvas.ctx.operations.filter((op) => op.type === 'roundRect');
  assert.ok(roundRectOps.length >= 1, 'Deve executar roundRect para o fundo do CTA');
  assert.equal(roundRectOps[0].args[4], 12, 'Raio da borda deve ser 12px');
});

test('edição de copy e preço sem nova geração preserva a composição e reflete na exportação', async () => {
  const project = createSampleProject('1:1');

  // Usuário altera preço e chamada do CTA
  const ctaLayer = project.layers.find((l) => l.type === 'text' && (l as TextLayer).role === 'cta') as TextLayer;
  ctaLayer.text = 'Agora por R$ 89,90 - Frete Grátis';

  const canvas = new MockHTMLCanvasElement();
  await renderCompositionToCanvas(project, canvas as any);

  const fillTextOps = canvas.ctx.operations.filter((op) => op.type === 'fillText');
  const texts = fillTextOps.map((op) => op.args[0]);

  assert.ok(texts.includes('Agora por R$ 89,90 - Frete Grátis'), 'Novo texto de preço deve estar na exportação');
});

test('downloadComposition utiliza saveFile do Electron quando disponível no ambiente desktop', async () => {
  const project = createSampleProject('4:5');
  let saveFileCalled = false;
  let saveFilePayload: any = null;

  // Mock global window com Electron bridge
  const originalWindow = (globalThis as any).window;
  (globalThis as any).window = {
    kaoz1Desktop: {
      saveFile: async (payload: any) => {
        saveFileCalled = true;
        saveFilePayload = payload;
        return { savedPath: 'C:\\Users\\User\\Downloads\\anuncio.png' };
      },
    },
  };

  // Mock document.createElement para evitar chamadas de fallback
  const originalDoc = (globalThis as any).document;
  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') return new MockHTMLCanvasElement();
      return {};
    },
  };

  try {
    await downloadComposition(project, { format: 'png', scale: 1 });
    assert.equal(saveFileCalled, true, 'Deve ter chamado saveFile do Electron');
    assert.ok(saveFilePayload.defaultName.includes('campanha-serum-verao-2026'));
    assert.ok(saveFilePayload.buffer instanceof ArrayBuffer);
  } finally {
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDoc;
  }
});
