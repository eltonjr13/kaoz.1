import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  createDefaultProject,
  createProject,
  getProject,
  saveProject,
  renameProject,
  listProjects,
  deleteProject,
  getProjectFilePath,
  getAssetFilePath,
  isValidProjectId,
  isValidAssetFilename,
  normalizeProject,
  saveAssetFromBuffer,
} from '../lib/sketch/sketch-storage.ts';
import {
  SKETCH_SCHEMA_VERSION,
  type SketchProjectData,
  resolveProviderAspectRatio,
} from '../types/sketch.ts';
import { resolveCanvasDimensionPreset } from '../lib/sketch/sketch-exporter.ts';

async function createTestEnv() {
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'sketch-test-'));
  const projectsDir = path.join(tmpBase, 'projects');
  const assetsDir = path.join(tmpBase, 'assets');
  await fsp.mkdir(projectsDir, { recursive: true });
  await fsp.mkdir(assetsDir, { recursive: true });

  const cleanup = async () => {
    await fsp.rm(tmpBase, { recursive: true, force: true }).catch(() => {});
  };

  return { tmpBase, projectsDir, assetsDir, cleanup };
}

function assertBriefingIdentity(briefing: NonNullable<SketchProjectData['briefing']>) {
  assert.equal(briefing.productDescription, 'Sérum com Vitamina C pura a 15%');
  assert.equal(briefing.brandName, 'Aura Glow');
  assert.equal(briefing.targetAudience, 'Mulheres e homens que buscam luminosidade na pele');
  assert.equal(briefing.objective, 'Lançamento de produto para e-commerce');
  assert.equal(briefing.tone, 'Elegante, acolhedor e científico');
}

function assertBriefingDetails(briefing: NonNullable<SketchProjectData['briefing']>) {
  assert.equal(briefing.keyBenefits?.length, 3);
  assert.equal(briefing.keyBenefits?.[0], 'Clareamento de manchas');
  assert.equal(briefing.restrictions?.[0], 'Não citar promessas médicas milagrosas');
  assert.equal(
    briefing.suggestedVisualPrompt,
    'Macro bottle with golden droplets, morning soft studio sunlight'
  );
}

test('sketch project creation stamps schemaVersion and version across all contracts', async () => {
  const { projectsDir, cleanup } = await createTestEnv();
  try {
    const project = await createProject({ title: 'Campanha de Verão' }, projectsDir);

    assert.equal(project.title, 'Campanha de Verão');
    assert.equal(project.schemaVersion, 1);
    assert.equal(project.version, SKETCH_SCHEMA_VERSION);
    assert.ok(project.id.startsWith('sketch-'));
    assert.ok(project.createdAt);
    assert.ok(project.updatedAt);

    // Sub-contracts
    assert.equal(project.briefing?.schemaVersion, 1);
    assert.equal(project.briefing?.version, SKETCH_SCHEMA_VERSION);
    assert.equal(project.copy.schemaVersion, 1);
    assert.equal(project.copy.version, SKETCH_SCHEMA_VERSION);
    assert.equal(project.document?.schemaVersion, 1);
    assert.equal(project.document?.version, SKETCH_SCHEMA_VERSION);

    // Saved to disk
    const reloaded = await getProject(project.id, projectsDir);
    assert.ok(reloaded);
    assert.equal(reloaded.id, project.id);
    assert.equal(reloaded.title, 'Campanha de Verão');
  } finally {
    await cleanup();
  }
});

test('sketch project list, open, rename, and delete lifecycle works seamlessly', async () => {
  const { projectsDir, cleanup } = await createTestEnv();
  try {
    const p1 = await createProject({ id: 'proj-1', title: 'Projeto Um' }, projectsDir);
    const p2 = await createProject({ id: 'proj-2', title: 'Projeto Dois' }, projectsDir);

    const list = await listProjects(projectsDir);
    assert.equal(list.length, 2);
    assert.ok(list.some((p) => p.id === 'proj-1'));
    assert.ok(list.some((p) => p.id === 'proj-2'));

    // Rename p1
    const renamed = await renameProject('proj-1', 'Projeto Um Atualizado', projectsDir);
    assert.equal(renamed.title, 'Projeto Um Atualizado');

    const reloadedP1 = await getProject('proj-1', projectsDir);
    assert.equal(reloadedP1?.title, 'Projeto Um Atualizado');

    // Delete p2
    const deleted = await deleteProject('proj-2', projectsDir);
    assert.equal(deleted, true);

    const afterDeleteList = await listProjects(projectsDir);
    assert.equal(afterDeleteList.length, 1);
    assert.equal(afterDeleteList[0].id, 'proj-1');

    const nonExistent = await getProject('proj-2', projectsDir);
    assert.equal(nonExistent, null);
  } finally {
    await cleanup();
  }
});

test('briefing fill, navigation cycle simulation, and data recovery', async () => {
  const { projectsDir, cleanup } = await createTestEnv();
  try {
    const proj = await createProject({ id: 'briefing-proj', title: 'Cosmético Facial' }, projectsDir);

    const modified: SketchProjectData = {
      ...proj,
      canvasAspectRatio: '4:5',
      aspectRatio: resolveProviderAspectRatio('4:5'),
      briefing: {
        schemaVersion: 1,
        version: SKETCH_SCHEMA_VERSION,
        productDescription: 'Sérum com Vitamina C pura a 15%',
        brandName: 'Aura Glow',
        targetAudience: 'Mulheres e homens que buscam luminosidade na pele',
        objective: 'Lançamento de produto para e-commerce',
        tone: 'Elegante, acolhedor e científico',
        keyBenefits: ['Clareamento de manchas', 'Antioxidante potente', 'Textura ultra leve'],
        restrictions: ['Não citar promessas médicas milagrosas'],
        colorPalette: ['#f59e0b', '#ffffff', '#1e293b'],
        suggestedVisualPrompt: 'Macro bottle with golden droplets, morning soft studio sunlight',
      },
    };

    await saveProject(modified, projectsDir);

    const recovered = await getProject('briefing-proj', projectsDir);
    assert.ok(recovered);
    assert.ok(recovered.briefing);
    assertBriefingIdentity(recovered.briefing);
    assertBriefingDetails(recovered.briefing);
    assert.equal(recovered.canvasAspectRatio, '4:5');
    assert.equal(recovered.aspectRatio, '3:4');
  } finally {
    await cleanup();
  }
});

test('anti-path traversal and strict ID validation reject malicious inputs', async () => {
  const { projectsDir, assetsDir, cleanup } = await createTestEnv();
  try {
    assert.equal(isValidProjectId('../escape'), false);
    assert.equal(isValidProjectId('proj/sub'), false);
    assert.equal(isValidProjectId('proj\\sub'), false);
    assert.equal(isValidProjectId('proj:1'), false);
    assert.equal(isValidProjectId(''), false);
    assert.equal(isValidProjectId('valid-project_id-123'), true);

    assert.equal(isValidAssetFilename('../../secret.txt'), false);
    assert.equal(isValidAssetFilename('.hidden'), false);
    assert.equal(isValidAssetFilename('valid_image-01.png'), true);

    assert.throws(
      () => getProjectFilePath('../malicious', projectsDir),
      /Invalid project ID/
    );

    assert.throws(
      () => getAssetFilePath('../../../etc/passwd', assetsDir),
      /Invalid asset filename/
    );
  } finally {
    await cleanup();
  }
});

test('base64 image attachments are persisted to runtime disk assets and replaced with URLs', async () => {
  const { projectsDir, assetsDir, cleanup } = await createTestEnv();
  try {
    const proj = createDefaultProject({ id: 'asset-test-proj' });

    const samplePngBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    proj.attachments.push({
      schemaVersion: 1,
      version: SKETCH_SCHEMA_VERSION,
      id: 'att-logo-1',
      name: 'logo.png',
      dataUrl: samplePngBase64,
      role: 'logo',
      createdAt: new Date().toISOString(),
    });

    proj.layers.push({
      id: 'layer-logo',
      name: 'Logo',
      type: 'image',
      attachmentId: 'att-logo-1',
      imageUrl: samplePngBase64,
      role: 'logo',
      visible: true,
      opacity: 1,
      x: 10,
      y: 10,
      width: 20,
      height: 20,
    });

    const saved = await saveProject(proj, projectsDir, assetsDir);

    assert.ok(!saved.attachments[0].dataUrl.startsWith('data:image/'), 'dataUrl must not be base64');
    assert.ok(saved.attachments[0].dataUrl.startsWith('/api/sketch/assets/att-logo-1.png'));

    const savedImgLayer = saved.layers.find((l) => l.id === 'layer-logo');
    assert.equal(savedImgLayer?.type, 'image');
    assert.ok(!((savedImgLayer as any).imageUrl as string).startsWith('data:image/'));
    assert.ok(((savedImgLayer as any).imageUrl as string).includes('att-logo-1.png'));

    const diskAssetPath = path.join(assetsDir, 'att-logo-1.png');
    const fileStat = await fsp.stat(diskAssetPath);
    assert.ok(fileStat.isFile());
    assert.ok(fileStat.size > 0);

    const rawFile = await fsp.readFile(path.join(projectsDir, 'asset-test-proj.json'), 'utf-8');
    assert.ok(!rawFile.includes('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'));
  } finally {
    await cleanup();
  }
});

test('saveAssetFromBuffer writes binary file and returns valid endpoint URL', async () => {
  const { assetsDir, cleanup } = await createTestEnv();
  try {
    const buffer = Buffer.from('fake-png-content');
    const res = await saveAssetFromBuffer('att-upload-123', buffer, 'image/png', 'test.png', assetsDir);

    assert.equal(res.assetId, 'att-upload-123');
    assert.equal(res.filename, 'att-upload-123.png');
    assert.equal(res.url, '/api/sketch/assets/att-upload-123.png');
    assert.equal(res.mimeType, 'image/png');

    const onDisk = await fsp.readFile(path.join(assetsDir, 'att-upload-123.png'));
    assert.equal(onDisk.toString(), 'fake-png-content');
  } finally {
    await cleanup();
  }
});

test('serialized writes prevent corruption under concurrent save operations', async () => {
  const { projectsDir, cleanup } = await createTestEnv();
  try {
    const proj = await createProject({ id: 'concurrent-proj', title: 'Original' }, projectsDir);

    const promises = Array.from({ length: 10 }, (_, i) => {
      const update: SketchProjectData = {
        ...proj,
        title: `Edição Concorrente ${i}`,
        prompt: `Prompt versão ${i}`,
        updatedAt: new Date(Date.now() + i * 100).toISOString(),
      };
      return saveProject(update, projectsDir);
    });

    await Promise.all(promises);

    const final = await getProject('concurrent-proj', projectsDir);
    assert.ok(final);
    assert.ok(final.title.startsWith('Edição Concorrente '));
    assert.ok(final.prompt.startsWith('Prompt versão '));

    const raw = await fsp.readFile(path.join(projectsDir, 'concurrent-proj.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.id, 'concurrent-proj');
  } finally {
    await cleanup();
  }
});

test('safe handling when write operation fails preserves prior valid state', async () => {
  const { projectsDir, cleanup } = await createTestEnv();
  try {
    const proj = await createProject({ id: 'fail-test-proj', title: 'Estado Inicial Valido' }, projectsDir);

    const blockingFile = path.join(projectsDir, 'blocker');
    await fsp.writeFile(blockingFile, 'blocking content');
    const badTargetDir = path.join(blockingFile, 'subprojects');

    await assert.rejects(
      async () => {
        await saveProject(proj, badTargetDir);
      }
    );

    const reloaded = await getProject('fail-test-proj', projectsDir);
    assert.ok(reloaded);
    assert.equal(reloaded.title, 'Estado Inicial Valido');
  } finally {
    await cleanup();
  }
});

test('schema versioning normalizes legacy or partial project payloads without failure', () => {
  const legacyData = {
    id: 'legacy-project-01',
    title: 'Projeto Antigo sem Versionamento',
    aspectRatio: '1:1',
    copy: {
      headline: 'Título Antigo',
    },
    layers: [],
  };

  const normalized = normalizeProject(legacyData);
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.version, SKETCH_SCHEMA_VERSION);
  assert.equal(normalized.title, 'Projeto Antigo sem Versionamento');
  assert.ok(normalized.briefing);
  assert.equal(normalized.briefing.schemaVersion, 1);
  assert.equal(normalized.briefing.version, SKETCH_SCHEMA_VERSION);
  assert.ok(normalized.copy);
  assert.equal(normalized.copy.headline, 'Título Antigo');
  assert.equal(normalized.copy.schemaVersion, 1);
  assert.ok(normalized.document);
  assert.equal(normalized.document.schemaVersion, 1);
});

test('root directory path containment correctly handles root directories without false positives', () => {
  const rootDir = path.resolve(path.parse(process.cwd()).root);
  const projPath = getProjectFilePath('test-project-123', rootDir);
  assert.equal(projPath, path.join(rootDir, 'test-project-123.json'));

  const assetPath = getAssetFilePath('test-asset-123.png', rootDir);
  assert.equal(assetPath, path.join(rootDir, 'test-asset-123.png'));
});

test('background layer with base64 image is automatically debased and persisted to runtime asset disk', async () => {
  const { projectsDir, assetsDir, cleanup } = await createTestEnv();
  try {
    const proj = createDefaultProject({ id: 'bg-asset-proj' });
    const samplePngBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    proj.layers = proj.layers.map((l) => {
      if (l.type === 'background') {
        return { ...l, fillType: 'image', imageUrl: samplePngBase64 };
      }
      return l;
    });

    const saved = await saveProject(proj, projectsDir, assetsDir);
    const bgLayer = saved.layers.find((l) => l.type === 'background') as import('../types/sketch.ts').BackgroundLayer;
    assert.ok(bgLayer);
    assert.ok(bgLayer.imageUrl?.startsWith('/api/sketch/assets/'));
    assert.ok(!bgLayer.imageUrl?.startsWith('data:image/'));

    const rawFile = await fsp.readFile(path.join(projectsDir, 'bg-asset-proj.json'), 'utf-8');
    assert.ok(!rawFile.includes('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'));
  } finally {
    await cleanup();
  }
});

test('canvas aspect ratio 4:5 initializes dimensions to 1080x1350 and maps exporter preset to 4:5', () => {
  const proj45 = createDefaultProject({ canvasAspectRatio: '4:5' });
  assert.equal(proj45.canvasAspectRatio, '4:5');
  assert.equal(proj45.canvasDimensions?.width, 1080);
  assert.equal(proj45.canvasDimensions?.height, 1350);

  const preset = resolveCanvasDimensionPreset(proj45);
  assert.equal(preset.width, 1080);
  assert.equal(preset.height, 1350);

  const proj916 = createDefaultProject({ canvasAspectRatio: '9:16' });
  const preset916 = resolveCanvasDimensionPreset(proj916);
  assert.equal(preset916.width, 1080);
  assert.equal(preset916.height, 1920);

  const proj169 = createDefaultProject({ canvasAspectRatio: '16:9' });
  const preset169 = resolveCanvasDimensionPreset(proj169);
  assert.equal(preset169.width, 1920);
  assert.equal(preset169.height, 1080);
});

test('empty state lifecycle: deleting all projects leaves empty list', async () => {
  const { projectsDir, cleanup } = await createTestEnv();
  try {
    const initialList = await listProjects(projectsDir);
    assert.equal(initialList.length, 0);

    const p1 = await createProject({ id: 'ep-1', title: 'P1' }, projectsDir);
    const afterCreate = await listProjects(projectsDir);
    assert.equal(afterCreate.length, 1);

    const deleted = await deleteProject(p1.id, projectsDir);
    assert.equal(deleted, true);

    const finalList = await listProjects(projectsDir);
    assert.equal(finalList.length, 0);
  } finally {
    await cleanup();
  }
});
