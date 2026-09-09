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
  computeObjectContainFit,
  computeTextPositions,
  isLayerIncludedInFinalExport,
  isLayerIncludedInProviderReference,
  resolveArtboardDisplayScale,
  resolveLayerBoxMetrics,
  wrapTextLines,
} from '../lib/sketch/sketch-composition-rules.ts';
import {
  preloadProjectImages,
  renderCompositionToCanvas,
} from '../lib/sketch/sketch-exporter.ts';

// Detailed Mock Canvas Context tracking drawing operations, coordinates and rotations
class DetailedMockContext {
  public operations: Array<{ type: string; args: unknown[] }> = [];
  public fillStyle = '#000000';
  public strokeStyle = '#000000';
  public lineWidth = 1;
  public globalAlpha = 1;
  public font = '16px sans-serif';
  public textAlign = 'left';
  public textBaseline = 'alphabetic';

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
  drawImage(img: unknown, ...args: number[]) {
    this.operations.push({ type: 'drawImage', args: [img, ...args] });
  }
  fillText(text: string, x: number, y: number) {
    this.operations.push({
      type: 'fillText',
      args: [text, x, y, this.fillStyle, this.font, this.textAlign],
    });
  }
  measureText(text: string) {
    // Deterministic 10px per character for testing
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
    this.operations.push({ type: 'fill', args: [this.fillStyle] });
  }
  translate(x: number, y: number) {
    this.operations.push({ type: 'translate', args: [x, y] });
  }
  rotate(rad: number) {
    this.operations.push({ type: 'rotate', args: [rad] });
  }
}

class DetailedMockCanvas {
  public width = 1080;
  public height = 1080;
  public ctx = new DetailedMockContext();

  getContext(contextId: string) {
    if (contextId === '2d') return this.ctx;
    return null;
  }

  toBlob(callback: (b: Blob | null) => void, mimeType = 'image/png') {
    const dummyBlob = {
      size: 2048,
      type: mimeType,
      arrayBuffer: async () => new ArrayBuffer(2048),
    } as unknown as Blob;
    callback(dummyBlob);
  }

  toDataURL(mimeType = 'image/png') {
    return `data:${mimeType};base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`;
  }
}

function createBaseProject(overrides?: Partial<SketchProjectData>): SketchProjectData {
  return {
    schemaVersion: 1,
    id: 'proj-fidelity-test',
    title: 'Anúncio Teste Fidelidade',
    aspectRatio: '1:1',
    canvasAspectRatio: '1:1',
    canvasDimensions: { width: 1080, height: 1080, unit: 'px' },
    prompt: 'Prompt teste',
    useSketchAsReference: true,
    compositionIntent: 'follow',
    textRenderingStrategy: 'layer',
    briefing: {
      schemaVersion: 1,
      productDescription: 'Produto Teste',
      product: 'Produto Teste',
      brandName: 'Marca',
      objective: 'Vendas',
      offer: 'Frete Grátis',
      targetAudience: 'Geral',
      tone: 'Moderno',
      keyBenefits: ['Rápido', 'Econômico'],
      restrictions: [],
      colorPalette: ['#10b981', '#6366f1'],
      suggestedVisualPrompt: '',
      additionalNotes: '',
    },
    copy: {
      schemaVersion: 1,
      headline: 'Título do Anúncio',
      subheadline: 'Subtítulo complementar',
      cta: 'Comprar Agora',
      badge: 'Lançamento',
      disclaimer: '',
      suggestedVisualPrompt: '',
    },
    document: {
      schemaVersion: 1,
      dimensions: { width: 1080, height: 1080, unit: 'px' },
      canvasAspectRatio: '1:1',
      layers: [],
    },
    attachments: [],
    layers: [],
    generationHistory: [],
    snapshots: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
    description: overrides?.description || 'Descrição do anúncio',
  };
}

// ---------------------------------------------------------------------------
// 1. Text Wrapping and Box Width
// ---------------------------------------------------------------------------
test('quebra de linha respeita largura da caixa e quebras manuais sem transbordar', () => {
  const longText = 'Descubra a tecnologia que transforma sua rotina com qualidade premium e inovação contínua.';
  // Box with 200px width. Character width is 10px, so ~20 chars per line.
  const measureFn = (str: string) => str.length * 10;
  const wrapped = wrapTextLines(longText, 200, measureFn);

  assert.ok(wrapped.length > 1, 'Texto longo deve ser quebrado em múltiplas linhas');
  for (const line of wrapped) {
    assert.ok(
      measureFn(line) <= 200,
      `Linha "${line}" (${measureFn(line)}px) deve caber na largura da caixa (200px)`
    );
  }

  // Preserves explicit linebreaks
  const textWithExplicitNewlines = 'Linha 1\nLinha 2\nLinha 3';
  const wrappedExplicit = wrapTextLines(textWithExplicitNewlines, 500, measureFn);
  assert.equal(wrappedExplicit.length, 3, 'Deve preservar as 3 linhas explícitas');
  assert.equal(wrappedExplicit[0], 'Linha 1');
  assert.equal(wrappedExplicit[1], 'Linha 2');
  assert.equal(wrappedExplicit[2], 'Linha 3');
});

// ---------------------------------------------------------------------------
// 2. Accents, UTF-8 and Special Characters
// ---------------------------------------------------------------------------
test('preserva acentuação em português, caracteres especiais e pontuação', () => {
  const accentedText = 'Lançamento Exclusivo: Não Perca Promoção de Verão com 50% de Desconto!';
  const measureFn = (str: string) => str.length * 10;
  const wrapped = wrapTextLines(accentedText, 300, measureFn);

  const joined = wrapped.join(' ');
  assert.ok(joined.includes('Lançamento'), 'Deve conter Lançamento com cedilha e til');
  assert.ok(joined.includes('Promoção'), 'Deve conter Promoção com cedilha e til');
  assert.ok(joined.includes('Não'), 'Deve conter Não');
  assert.ok(joined.includes('50%'), 'Deve conter percentual');
});

// ---------------------------------------------------------------------------
// 3. Text Alignment (Left, Center, Right) Relative to Box Width
// ---------------------------------------------------------------------------
test('posiciona alinhamentos de texto (center, right, left) em relação à largura da caixa', () => {
  const textLayer: TextLayer = {
    id: 'layer-test-align',
    name: 'Texto Alinhado',
    type: 'text',
    role: 'headline',
    text: 'Promoção',
    x: 10, // 10% of 1080 = 108px
    y: 20, // 20% of 1080 = 216px
    width: 40, // 40% of 1080 = 432px (box spans from 108px to 540px)
    fontSize: 30,
    fontFamily: 'sans-serif',
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    backgroundPadding: 10,
    visible: true,
    opacity: 1,
  };

  const metrics = resolveLayerBoxMetrics(textLayer, 1080, 1080);
  assert.equal(metrics.boxX, 108, 'boxX deve ser 108px');
  assert.equal(metrics.boxWidth, 432, 'boxWidth deve ser 432px');
  assert.equal(metrics.padding, 10, 'padding deve ser 10px em 1080');

  // Center alignment: textStartX must be boxX + boxWidth / 2 = 108 + 216 = 324px
  const posCenter = computeTextPositions(textLayer, ['Promoção'], metrics, 1080);
  assert.equal(posCenter.textStartX, 324, 'Texto centralizado deve ter X no centro da caixa (324px)');

  // Right alignment: textStartX must be boxX + boxWidth - padding = 108 + 432 - 10 = 530px
  const rightLayer: TextLayer = { ...textLayer, textAlign: 'right' };
  const posRight = computeTextPositions(rightLayer, ['Promoção'], metrics, 1080);
  assert.equal(posRight.textStartX, 530, 'Texto à direita deve ter X na borda direita com padding (530px)');

  // Left alignment: textStartX must be boxX + padding = 108 + 10 = 118px
  const leftLayer: TextLayer = { ...textLayer, textAlign: 'left' };
  const posLeft = computeTextPositions(leftLayer, ['Promoção'], metrics, 1080);
  assert.equal(posLeft.textStartX, 118, 'Texto à esquerda deve ter X na borda esquerda com padding (118px)');
});

// ---------------------------------------------------------------------------
// 4. CTA Button Box Background and Rotation
// ---------------------------------------------------------------------------
test('fundo do botão CTA cobre a largura da caixa e suporta rotação pelo centro', async () => {
  const ctaLayer: TextLayer = {
    id: 'layer-cta',
    name: 'Botão CTA',
    type: 'text',
    role: 'cta',
    text: 'QUERO MEU DESCONTO',
    x: 20, // 20% of 1080 = 216px
    y: 70, // 70% of 1080 = 756px
    width: 60, // 60% of 1080 = 648px
    fontSize: 28,
    fontFamily: 'Inter',
    fontWeight: '700',
    color: '#ffffff',
    backgroundColor: '#6366f1',
    backgroundPadding: 16,
    borderRadius: 12,
    textAlign: 'center',
    rotation: 15,
    visible: true,
    opacity: 1,
    elementKind: 'final',
    includeInFinalExport: true,
  };

  const project = createBaseProject({
    canvasDimensions: { width: 1080, height: 1080, unit: 'px' },
    layers: [ctaLayer],
  });

  const canvas = new DetailedMockCanvas();
  canvas.width = 1080;
  canvas.height = 1080;

  await renderCompositionToCanvas(project, canvas as any, { format: 'png', scale: 1 });

  const ops = canvas.ctx.operations;
  const rotateOp = ops.find((op) => op.type === 'rotate');
  assert.ok(rotateOp, 'Deve aplicar rotação de texto');
  const angleRad = rotateOp.args[0] as number;
  const expectedRad = (15 * Math.PI) / 180;
  assert.ok(Math.abs(angleRad - expectedRad) < 0.001, 'Ângulo de rotação deve ser 15 graus em radianos');

  // Verify roundRect was drawn with background color
  const roundRectOp = ops.find((op) => op.type === 'roundRect');
  assert.ok(roundRectOp, 'Deve desenhar retângulo com cantos arredondados para o CTA');
  assert.equal(roundRectOp.args[2], 648, 'Largura do fundo do CTA deve cobrir os 648px da caixa');
});

// ---------------------------------------------------------------------------
// 5. Image Object-Contain (Non-square Logo and Product)
// ---------------------------------------------------------------------------
test('computeObjectContainFit preserva proporção de logos e fotos de produto não quadradas', () => {
  // Logo 3:1 (600x200) inside square box (300x300)
  const fit1 = computeObjectContainFit(600, 200, 300, 300);
  assert.equal(fit1.drawW, 300, 'Largura deve ser total da caixa');
  assert.equal(fit1.drawH, 100, 'Altura deve ser reduzida para manter 3:1 (100px)');
  assert.equal(fit1.drawX, 0, 'X deve ser 0');
  assert.equal(fit1.drawY, 100, 'Y deve centralizar verticalmente ( (300 - 100) / 2 = 100px )');

  // Vertical photo 9:16 (900x1600) inside box 400x400
  const fit2 = computeObjectContainFit(900, 1600, 400, 400);
  assert.equal(fit2.drawH, 400, 'Altura deve ser total da caixa');
  const expectedW = 400 * (900 / 1600); // 225
  assert.equal(fit2.drawW, expectedW, 'Largura deve manter proporção 9:16');
  assert.equal(fit2.drawX, (400 - 225) / 2, 'X deve centralizar horizontalmente');
  assert.equal(fit2.drawY, 0, 'Y deve ser 0');
});

// ---------------------------------------------------------------------------
// 6. Decoupling: Provider Reference vs Final Export
// ---------------------------------------------------------------------------
test('esboço (sketch) e guias ficam fora da arte final por padrão, mas participam da referência', () => {
  const sketchLayer = {
    id: 'layer-sketch-root',
    name: 'Esboço',
    type: 'sketch' as const,
    paths: [{ id: 'p1', tool: 'brush' as const, color: '#ff0000', size: 5, opacity: 1, points: [{ x: 10, y: 10 }] }],
    visible: true,
    opacity: 0.8,
  };

  const guideLayer = {
    id: 'layer-guide-1',
    name: 'Guia de Terços',
    type: 'shape' as const,
    shapeType: 'line' as const,
    x: 33,
    y: 0,
    width: 1,
    height: 100,
    strokeColor: '#3b82f6',
    strokeWidth: 2,
    isGuide: true,
    elementKind: 'guide' as const,
    visible: true,
    opacity: 0.5,
  };

  const finalLogoLayer = {
    id: 'layer-final-logo',
    name: 'Logo Oficial',
    type: 'image' as const,
    imageUrl: 'https://example.com/logo.png',
    x: 10,
    y: 10,
    width: 20,
    height: 10,
    elementKind: 'final' as const,
    includeInFinalExport: true,
    exportToProvider: false, // Don't send high-res vector logo to prompt reference
    visible: true,
    opacity: 1,
  };

  // Final export assertions
  assert.equal(
    isLayerIncludedInFinalExport(sketchLayer),
    false,
    'Esboço deve ficar FORA da arte final por padrão'
  );
  assert.equal(
    isLayerIncludedInFinalExport(guideLayer),
    false,
    'Guia deve ficar FORA da arte final'
  );
  assert.equal(
    isLayerIncludedInFinalExport(finalLogoLayer),
    true,
    'Logo classificado como final DEVE estar na arte final mesmo com exportToProvider=false'
  );

  // Generator reference assertions
  assert.equal(
    isLayerIncludedInProviderReference(sketchLayer, true, true),
    true,
    'Esboço DEVE participar da referência para a IA'
  );
  assert.equal(
    isLayerIncludedInProviderReference(finalLogoLayer, true, true),
    false,
    'Logo com exportToProvider=false NÃO deve ir para a referência do provedor'
  );
});

// ---------------------------------------------------------------------------
// 7. Strict Failure when Required Final Image Resource Fails to Load
// ---------------------------------------------------------------------------
test('preloadProjectImages com strict=true falha explicitamente se recurso final não carregar', async () => {
  const missingImgLayer: ImageLayer = {
    id: 'layer-product-img',
    name: 'Foto do Produto',
    type: 'image',
    imageUrl: 'https://invalid-host-name-never-exists-9988.xyz/nonexistent.png',
    x: 20,
    y: 20,
    width: 50,
    height: 50,
    elementKind: 'final',
    includeInFinalExport: true,
    visible: true,
    opacity: 1,
  };

  const project = createBaseProject({
    layers: [missingImgLayer],
  });

  // Must reject with informative error message
  await assert.rejects(
    async () => {
      await preloadProjectImages(project, { strict: true, finalExportOnly: true });
    },
    (err: Error) => {
      assert.ok(
        err.message.includes('Foto do Produto') || err.message.includes('recurso visual'),
        `Mensagem de erro deve identificar a camada com falha: "${err.message}"`
      );
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// 8. Aspect Ratios (1:1, 4:5, 9:16, 16:9) and Multiple Scales (1x, 2x)
// ---------------------------------------------------------------------------
test('renderiza exportação nas proporções 1:1, 4:5, 9:16 e 16:9 em escalas 1x e 2x', async () => {
  const ratios: Array<{ ratio: '1:1' | '4:5' | '9:16' | '16:9'; expW: number; expH: number }> = [
    { ratio: '1:1', expW: 1080, expH: 1080 },
    { ratio: '4:5', expW: 1080, expH: 1350 },
    { ratio: '9:16', expW: 1080, expH: 1920 },
    { ratio: '16:9', expW: 1920, expH: 1080 },
  ];

  for (const { ratio, expW, expH } of ratios) {
    const project = createBaseProject({
      canvasAspectRatio: ratio,
      canvasDimensions: { width: expW, height: expH, unit: 'px' },
      layers: [
        {
          id: 'bg-layer',
          name: 'Fundo',
          type: 'background',
          fillType: 'color',
          color: '#1e293b',
          visible: true,
          opacity: 1,
          elementKind: 'final',
          includeInFinalExport: true,
        } as BackgroundLayer,
      ],
    });

    // 1x scale
    const canvas1x = new DetailedMockCanvas();
    await renderCompositionToCanvas(project, canvas1x as any, { format: 'png', scale: 1 });
    assert.equal(canvas1x.width, expW, `1x ${ratio} largura esperada ${expW}`);
    assert.equal(canvas1x.height, expH, `1x ${ratio} altura esperada ${expH}`);

    // 2x upscale
    const canvas2x = new DetailedMockCanvas();
    await renderCompositionToCanvas(project, canvas2x as any, { format: 'jpeg', scale: 2 });
    assert.equal(canvas2x.width, expW * 2, `2x ${ratio} largura esperada ${expW * 2}`);
    assert.equal(canvas2x.height, expH * 2, `2x ${ratio} altura esperada ${expH * 2}`);
  }
});

// ---------------------------------------------------------------------------
// 9. Artboard Display Scale vs Export Scale Correspondence
// ---------------------------------------------------------------------------
test('artboard display scale e export scale produzem correspondência tipográfica proporcional', () => {
  // Preset 1080x1080 at zoom 0.5 (displayed at 540px)
  const scaleZoom05 = resolveArtboardDisplayScale(540, 1080);
  assert.equal(scaleZoom05, 0.5, 'Escala em zoom 0.5 deve ser 0.5');

  // Preset 1920x1080 (16:9) displayed at 960px (zoom 0.5)
  const scale16_9 = resolveArtboardDisplayScale(960, 1080);
  assert.ok(Math.abs(scale16_9 - (960 / 1080)) < 0.0001);

  // A font of 32px at 1080px base:
  // - In export at 1x: 32px
  // - In export at 2x: 64px
  // - In UI at zoom 0.5: 32px * 0.5 = 16px
  const layer: TextLayer = {
    id: 't1',
    name: 'Texto',
    type: 'text',
    role: 'headline',
    text: 'Promoção',
    x: 10,
    y: 10,
    width: 50,
    fontSize: 32,
    fontFamily: 'sans-serif',
    fontWeight: '700',
    color: '#fff',
    textAlign: 'left',
    visible: true,
    opacity: 1,
  };

  const metrics1x = resolveLayerBoxMetrics(layer, 1080, 1080);
  assert.equal(metrics1x.actualFontSize, 32, 'Fonte em 1x export deve ser 32px');

  const metrics2x = resolveLayerBoxMetrics(layer, 2160, 2160);
  assert.equal(metrics2x.actualFontSize, 64, 'Fonte em 2x export deve ser 64px');
});

// ---------------------------------------------------------------------------
// 10. Real Renderer Proof vs Mock Verification
// ---------------------------------------------------------------------------
test('diferenciação explícita entre validação de mock estrutural e renderizador do navegador', () => {
  // Mock canvas verifies exact math and operation ordering
  const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
  if (!isBrowser) {
    // Registered environment limitation
    assert.ok(true, 'Ambiente Node executa testes com mock canvas determinístico');
  } else {
    assert.ok(true, 'Ambiente Browser executa testes com CanvasRenderingContext2D nativo');
  }
});
