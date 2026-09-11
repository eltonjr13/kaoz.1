import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { createDefaultProject } from '../lib/sketch/sketch-storage.ts';
import {
  buildSketchProviderReference,
  collectProviderSketchPaths,
} from '../lib/sketch/sketch-reference-builder.ts';
import {
  compileCreativeGenerationPrompt,
  checkIdeaPreservation,
  compileCreativeGenerationRequest,
} from '../lib/sketch/sketch-prompt-compiler.ts';
import { SKETCH_PROMPT_MAX_WORDS } from '../lib/sketch/sketch-composite-preparer.ts';
import type { SketchAttachment, SketchProjectData } from '../types/sketch.ts';

async function pngDataUrl(background: string, size = 128): Promise<string> {
  const buffer = await sharp({ create: { width: size, height: size, channels: 3, background } }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function attachment(id: string, dataUrl: string, role: SketchAttachment['role']): SketchAttachment {
  return { id, name: `${id}.png`, dataUrl, role, createdAt: new Date().toISOString() };
}

function withOrder(project: SketchProjectData, references: { attachmentId: string; role?: SketchAttachment['role'] }[]): SketchProjectData {
  project.currentOrder = {
    schemaVersion: 1,
    version: '1.0.0',
    id: `order-${project.id}`,
    prompt: project.prompt,
    aspectRatio: project.aspectRatio,
    selectedReferences: references.map((reference) => ({
      attachmentId: reference.attachmentId,
      role: reference.role as never,
    })),
    createdAt: new Date().toISOString(),
  };
  return project;
}

function sketchLayer(paths = [{ x: 200, y: 200 }, { x: 800, y: 800 }]) {
  return {
    id: 'layer-sketch-root',
    name: 'Esboço de Composição',
    type: 'sketch' as const,
    visible: true,
    opacity: 0.85,
    paths: [
      {
        id: 'path-1',
        tool: 'brush' as const,
        color: '#111111',
        size: 6,
        opacity: 1,
        points: paths,
        isGuide: false,
      },
    ],
  };
}

function textLayer(text: string) {
  return {
    id: 'layer-text-1',
    name: 'Título (Headline)',
    type: 'text' as const,
    role: 'headline' as const,
    text,
    x: 10,
    y: 8,
    width: 80,
    height: 12,
    visible: true,
    opacity: 1,
  };
}

function simpleFlowProject(id: string, prompt: string) {
  const project = createDefaultProject({ id, title: 'Fluxo simples' });
  project.prompt = prompt;
  project.compositionIntent = 'follow';
  project.textRenderingStrategy = 'layer';
  project.copy = {
    schemaVersion: 1,
    version: '1.0.0',
    headline: 'O Futuro Chegou Hoje',
    subheadline: 'Descubra a tecnologia que transforma sua rotina.',
    cta: 'Garanta o Seu Agora',
    badge: 'Lançamento Exclusivo',
  };
  project.layers = [sketchLayer() as never, textLayer('O Futuro Chegou Hoje') as never];
  return project;
}

test('fluxo simples usa o esboço como guia e descarta a copy residual da campanha antiga', async () => {
  const project = simpleFlowProject('proj-simple-prompt-1', 'venda desse action figure estremamente limitado');
  project.attachments = [attachment('att-1', await pngDataUrl('#334155'), 'product')];
  withOrder(project, [{ attachmentId: 'att-1', role: 'product' }]);

  const request = compileCreativeGenerationRequest(project);

  assert.equal(request.compositionIntent, 'explore', 'Rascunho com anexos deve ser guia, não cópia');
  assert.equal(request.textRenderingStrategy, 'layer');
  assert.ok(request.preparedPrompt.includes('Reference handling:'), 'Deve instruir o tratamento do guia');
  assert.ok(request.preparedPrompt.includes('Single-scene rule:'), 'Deve exigir cena única');
  assert.ok(request.preparedPrompt.includes('Referenced subjects:'), 'Deve declarar o papel de cada anexo');
  assert.ok(request.preparedPrompt.includes('preserve the exact product design'));
  assert.equal(request.preparedPrompt.includes('O Futuro Chegou Hoje'), false, 'Copy antiga não pode entrar no prompt');
  assert.equal(/headline in .*area/i.test(request.preparedPrompt), false, 'Sem zonas reservadas para copy inexistente');
  assert.equal(request.creativeCompilation?.copy.headline, '');
  assert.equal(request.creativeCompilation?.reservedCopyZones.length, 0);
  assert.equal(
    request.diagnostics.some((item) => item.code === 'PROMPT_QUALITY_ISSUE' && item.message.includes('truncamento')),
    false
  );
  assert.ok(request.preparedPrompt.split(/\s+/).filter(Boolean).length <= SKETCH_PROMPT_MAX_WORDS);
});

test('papéis de pessoa e produto entram no prompt com instruções distintas', async () => {
  const project = simpleFlowProject('proj-simple-roles-1', 'venda desse action figure estremamente limitado');
  project.attachments = [
    attachment('att-person', await pngDataUrl('#1f2937'), 'person'),
    attachment('att-product', await pngDataUrl('#b91c1c'), 'product'),
  ];
  withOrder(project, [
    { attachmentId: 'att-person', role: 'person' },
    { attachmentId: 'att-product', role: 'product' },
  ]);

  const request = compileCreativeGenerationRequest(project);

  assert.ok(request.preparedPrompt.includes('person (att-person.png): preserve the human identity, face and body'));
  assert.ok(request.preparedPrompt.includes('product (att-product.png): preserve the exact product design'));
});

test('frase entre aspas é renderizada na imagem; pedido de CTA sem frase gera aviso', async () => {
  const withWording = simpleFlowProject(
    'proj-simple-prompt-2',
    'ele esta vendendo um produto encapsulado para quem nao dorme, o nome dele e "DURMA NAO PAINHO"'
  );
  withWording.attachments = [attachment('att-1', await pngDataUrl('#7c2d12'), 'product')];
  withOrder(withWording, [{ attachmentId: 'att-1', role: 'product' }]);

  const bakedRequest = compileCreativeGenerationRequest(withWording);
  assert.equal(bakedRequest.textRenderingStrategy, 'baked');
  assert.ok(bakedRequest.preparedPrompt.includes('Headline: "DURMA NAO PAINHO"'));
  assert.ok(bakedRequest.preparedPrompt.includes('Preserve every character inside quotes exactly as written'));

  const withoutWording = simpleFlowProject(
    'proj-simple-prompt-3',
    'venda desse action figure estremamente limitado pode usar uma chamada de ação para isso'
  );
  withoutWording.attachments = [attachment('att-1', await pngDataUrl('#0f172a'), 'product')];
  withOrder(withoutWording, [{ attachmentId: 'att-1', role: 'product' }]);

  const silentRequest = compileCreativeGenerationRequest(withoutWording);
  assert.equal(silentRequest.textRenderingStrategy, 'layer');
  assert.ok(silentRequest.diagnostics.some((item) => item.code === 'TEXT_WORDING_REQUIRED'));
  assert.ok(silentRequest.preparedPrompt.includes('No text in the image'));
});

test('anexo único sem esboço vira a própria referência de identidade', async () => {
  const attachmentBytes = await sharp({ create: { width: 200, height: 140, channels: 3, background: '#c05621' } })
    .png()
    .toBuffer();
  const project = createDefaultProject({ id: 'proj-identity-1', title: 'Identidade' });
  project.attachments = [attachment('att-1', `data:image/png;base64,${attachmentBytes.toString('base64')}`, 'product')];
  withOrder(project, [{ attachmentId: 'att-1', role: 'product' }]);

  const built = await buildSketchProviderReference({ project, providerAspectRatio: '1:1' });

  assert.equal(built.mode, 'identity');
  assert.equal(built.kind, 'identity');
  assert.deepEqual(built.attachmentIds, ['att-1']);
  assert.deepEqual(built.includedRoles, ['product']);
  const decoded = Buffer.from(built.dataUrl!.split(',')[1], 'base64');
  assert.ok(decoded.equals(attachmentBytes), 'Identidade deve preservar os bytes originais do anexo');
});

test('vários anexos sem esboço formam uma única prancha composta', async () => {
  const project = createDefaultProject({ id: 'proj-board-1', title: 'Prancha' });
  project.attachments = [
    attachment('att-1', await pngDataUrl('#2b6cb0'), 'product'),
    attachment('att-2', await pngDataUrl('#276749'), 'style'),
  ];
  withOrder(project, [
    { attachmentId: 'att-1', role: 'product' },
    { attachmentId: 'att-2', role: 'style' },
  ]);

  const built = await buildSketchProviderReference({ project, providerAspectRatio: '9:16' });

  assert.equal(built.mode, 'composite');
  assert.equal(built.kind, 'composite');
  assert.deepEqual(built.attachmentIds, ['att-1', 'att-2']);
  assert.ok(built.includedRoles.includes('product'));
  assert.ok(built.includedRoles.includes('style'));
  const metadata = await sharp(Buffer.from(built.dataUrl!.split(',')[1], 'base64')).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1920);
});

async function pixelAt(dataUrl: string, x: number, y: number): Promise<{ r: number; g: number; b: number; a: number }> {
  const { data, info } = await sharp(Buffer.from(dataUrl.split(',')[1], 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return { r: data[offset], g: data[offset + 1], b: data[offset + 2], a: data[offset + 3] };
}

test('a prancha não deixa faixas brancas nem caixas de foto colada', async () => {
  const project = createDefaultProject({ id: 'proj-fullbleed-1', title: 'Sem tarjas' });
  project.attachments = [
    attachment('att-a', await pngDataUrl('#1d4ed8'), 'person'),
    attachment('att-b', await pngDataUrl('#dc2626'), 'product'),
  ];
  withOrder(project, [
    { attachmentId: 'att-a', role: 'person' },
    { attachmentId: 'att-b', role: 'product' },
  ]);

  const built = await buildSketchProviderReference({ project, providerAspectRatio: '9:16' });

  // O quadro inteiro vem da própria referência (base desfocada), nunca de um
  // fundo branco de prancheta.
  const corner = await pixelAt(built.dataUrl!, 4, 4);
  assert.ok(corner.r < 250 || corner.g < 250 || corner.b < 250, 'O canto não pode ser branco puro da prancheta');

  // O segundo sujeito é composto com transparência sobre a base, então o
  // vermelho puro do arquivo nunca aparece cru na prancha.
  const subject = await pixelAt(built.dataUrl!, 800, 960);
  assert.ok(subject.r < 250, 'A foto não pode entrar opaca como colagem');
  assert.ok(subject.b > 0, 'O sujeito deve se misturar com a base da cena');
});

test('esboço salvo é re-renderizado no servidor sobre os sujeitos', async () => {
  const project = createDefaultProject({ id: 'proj-strokes-1', title: 'Traços no servidor' });
  project.layers = [sketchLayer() as never];
  project.attachments = [attachment('att-1', await pngDataUrl('#0f766e'), 'product')];
  withOrder(project, [{ attachmentId: 'att-1', role: 'product' }]);

  const built = await buildSketchProviderReference({ project, providerAspectRatio: '1:1' });

  assert.equal(built.mode, 'composite');
  assert.ok(built.diagnostics.some((item) => item.code === 'SKETCH_RENDERED_ON_SERVER'));
  assert.deepEqual(built.includedRoles, ['composition', 'product']);
});

test('esboço somado ao anexo mantém as duas coisas na referência e é determinístico', async () => {
  const project = createDefaultProject({ id: 'proj-composite-1', title: 'Composto' });
  project.prompt = 'Café coado servido na varanda ao nascer do sol';
  project.layers = [sketchLayer() as never];
  project.attachments = [attachment('att-1', await pngDataUrl('#975a16'), 'product')];
  withOrder(project, [{ attachmentId: 'att-1', role: 'product' }]);

  const first = await buildSketchProviderReference({
    project,
    providerAspectRatio: '1:1',
    clientSketchDataUrl: await pngDataUrl('#ffffff', 256),
  });
  const second = await buildSketchProviderReference({
    project,
    providerAspectRatio: '1:1',
    clientSketchDataUrl: await pngDataUrl('#ffffff', 256),
  });

  assert.equal(first.mode, 'composite');
  assert.equal(first.kind, 'composite');
  assert.equal(first.hasSketch, true);
  assert.deepEqual(first.includedRoles, ['composition', 'product']);
  assert.equal(first.dataUrl, second.dataUrl, 'A composição deve ser reprodutível para o mesmo projeto');
  assert.ok(first.diagnostics.some((item) => item.code === 'COMPOSITE_REFERENCE_BUILT'));

  const boardStats = await sharp(Buffer.from(first.dataUrl!.split(',')[1], 'base64')).stats();
  const colors = boardStats.channels.map((channel) => Math.round(channel.mean));
  assert.ok(colors.some((mean) => mean < 250), 'A prancha deve conter os pixels do anexo, não apenas fundo branco');
});

test('projeto sem esboço e sem anexo continua sendo geração simples', async () => {
  const project = createDefaultProject({ id: 'proj-simple-1', title: 'Simples' });
  const built = await buildSketchProviderReference({ project, providerAspectRatio: '1:1' });

  assert.equal(built.mode, 'none');
  assert.equal(built.kind, undefined);
  assert.equal(built.dataUrl, undefined);
  assert.equal(built.diagnostics.some((item) => item.severity === 'error'), false);
});

test('anexo persistido em disco é lido pelo filePath e entra na referência', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'sketch-ref-assets-'));
  try {
    const bytes = await sharp({ create: { width: 120, height: 120, channels: 3, background: '#1a365d' } }).png().toBuffer();
    await fsp.writeFile(path.join(directory, 'att-file.png'), bytes);

    const project = createDefaultProject({ id: 'proj-file-1', title: 'Arquivo' });
    project.attachments = [
      {
        id: 'att-file',
        name: 'att-file.png',
        dataUrl: '/api/sketch/assets/att-file.png',
        filePath: 'att-file.png',
        role: 'product',
        createdAt: new Date().toISOString(),
      },
    ];
    withOrder(project, [{ attachmentId: 'att-file', role: 'product' }]);

    const built = await buildSketchProviderReference({
      project,
      providerAspectRatio: '1:1',
      assetsDir: directory,
    });

    assert.equal(built.mode, 'identity');
    const decoded = Buffer.from(built.dataUrl!.split(',')[1], 'base64');
    assert.ok(decoded.equals(bytes));
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('a ideia do usuário abre o prompt e o texto genérico não existe mais', () => {
  const idea = 'Cachorro vira-lata caramelo usando óculos escuros num píer de madeira ao entardecer';
  const project = createDefaultProject({ id: 'proj-prompt-1', title: 'Prompt' });
  project.prompt = idea;
  project.layers = [sketchLayer() as never];

  const compiled = compileCreativeGenerationPrompt({
    prompt: project.prompt,
    briefing: project.briefing,
    copy: project.copy,
    layers: project.layers,
    attachments: project.attachments,
    hasSketch: true,
  });

  assert.ok(compiled.startsWith('Primary creative idea (highest priority):'));
  assert.ok(compiled.includes(idea), 'A ideia deve aparecer na íntegra no prompt compilado');
  assert.equal(/featured commercial product/i.test(compiled), false, 'O marcador genérico não pode voltar');

  const request = compileCreativeGenerationRequest(project);
  assert.ok(request.preparedPrompt.includes(idea));
  assert.equal(
    request.diagnostics.some((item) => item.code === 'PROMPT_IDEA_NOT_PRESERVED'),
    false
  );
});

test('o guardião de ideias detecta perda silenciosa de conteúdo', () => {
  const idea = 'Bicicleta elétrica dobrando a esquina de uma rua molhada pela chuva';
  assert.deepEqual(checkIdeaPreservation(`Qualquer coisa antes ${idea} e depois`, idea), []);
  assert.equal(checkIdeaPreservation('Apenas um prompt genérico de produto', idea).length, 1);
  assert.deepEqual(checkIdeaPreservation('curto demais', 'oi'), []);
});

test('os traços do esboço são coletados ignorando guias e camadas desativadas', () => {
  const project = createDefaultProject({ id: 'proj-paths-1', title: 'Traços' });
  project.layers = [
    sketchLayer() as never,
    {
      id: 'layer-sketch-off',
      name: 'Desativado',
      type: 'sketch',
      visible: true,
      opacity: 1,
      exportToProvider: false,
      paths: [{ id: 'path-off', tool: 'brush', color: '#000', size: 2, opacity: 1, points: [{ x: 1, y: 1 }], isGuide: false }],
    } as never,
  ];

  const paths = collectProviderSketchPaths(project.layers);
  assert.equal(paths.length, 1);
  assert.equal(paths[0].id, 'path-1');
});
