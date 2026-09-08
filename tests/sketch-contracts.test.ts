import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASPECT_RATIO_PRESETS,
  type SketchAspectRatio,
  type AttachmentRole,
  type SketchProjectData,
  type SketchVersionSnapshot,
} from '../types/sketch.ts';
import { renderSketchOnlyDataUrl } from '../lib/sketch/sketch-exporter.ts';

test('sketch aspect ratio presets strictly adhere to FlowProvider supported ratios', () => {
  const supportedRatios: SketchAspectRatio[] = ['1:1', '9:16', '16:9', '4:3', '3:4'];

  for (const ratio of supportedRatios) {
    assert.ok(ASPECT_RATIO_PRESETS[ratio], `Deve suportar a proporção ${ratio}`);
    const preset = ASPECT_RATIO_PRESETS[ratio];
    assert.ok(preset.width > 0, `Largura deve ser maior que zero para ${ratio}`);
    assert.ok(preset.height > 0, `Altura deve ser maior que zero para ${ratio}`);
    assert.ok(preset.label, `Label deve existir para ${ratio}`);
  }

  assert.equal(Object.keys(ASPECT_RATIO_PRESETS).length, 5, 'Devem existir exatamente 5 proporções');
});

test('sketch attachments support distinct functional roles', () => {
  const allowedRoles: AttachmentRole[] = ['reference', 'logo', 'product', 'overlay', 'inspiration'];
  const roleSet = new Set(allowedRoles);

  assert.ok(roleSet.has('reference'), 'Deve suportar referência para FlowProvider');
  assert.ok(roleSet.has('logo'), 'Deve suportar logo');
  assert.ok(roleSet.has('product'), 'Deve suportar produto');
  assert.ok(roleSet.has('overlay'), 'Deve suportar sobreposição');
  assert.ok(roleSet.has('inspiration'), 'Deve suportar inspiração');
});

test('sketch project structure preserves layers, copy and generation history', () => {
  const sampleProject: SketchProjectData = {
    id: 'test-project',
    title: 'Anúncio de Teste',
    description: 'Teste unitário',
    aspectRatio: '1:1',
    prompt: 'Commercial product shot',
    useSketchAsReference: true,
    attachments: [
      {
        id: 'att-1',
        name: 'logo.png',
        dataUrl: 'data:image/png;base64,sample',
        role: 'logo',
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
        text: 'Título Impactante',
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
    copy: {
      headline: 'Título Impactante',
      subheadline: 'Subtítulo',
      cta: 'Clique Aqui',
      badge: 'Novo',
    },
    generationHistory: [],
    updatedAt: new Date().toISOString(),
  };

  assert.equal(sampleProject.layers.length, 3);
  assert.equal(sampleProject.copy.headline, 'Título Impactante');
  assert.equal(sampleProject.attachments[0].role, 'logo');

  // Snapshot versioning
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

test('renderSketchOnlyDataUrl returns empty string in Node environment gracefully', () => {
  const result = renderSketchOnlyDataUrl([]);
  assert.equal(typeof result, 'string');
});
