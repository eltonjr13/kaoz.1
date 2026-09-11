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
