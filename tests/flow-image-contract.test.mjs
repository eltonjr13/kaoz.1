import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

import {
  resolveReferenceAttachmentStrategy,
  resolveImageGenerationOperation,
  resolveTurnaroundReferencePolicy,
  resolveVisualReference,
} from '../src/providers/flow/ImageGenerationContract.ts';
import {
  cleanupTemporaryReference,
  saveBase64ReferenceImage,
} from '../lib/flow/reference-files.ts';

test('classifica os quatro modos de imagem sem misturar referencia', () => {
  assert.equal(resolveImageGenerationOperation({}), 'simple');
  assert.equal(resolveImageGenerationOperation({ referenceImage: 'data:image/png;base64,AA==' }), 'reference');
  assert.equal(resolveImageGenerationOperation({ editSourceImagePath: 'storage/generated/source.png' }), 'edit');
  assert.equal(resolveImageGenerationOperation({ imagePackageMode: 'turnaround3d' }), 'turnaround3d');
});

test('geracao simples nunca recebe avatar nem upload como referencia visual', () => {
  assert.equal(resolveVisualReference({
    operation: 'simple',
    inputReferenceImage: 'upload.png',
    avatarReferenceImage: 'avatar.png',
    useAvatarVisualReference: true,
  }), undefined);
});

test('upload tem prioridade e avatar exige opt-in explicito', () => {
  assert.equal(resolveVisualReference({
    operation: 'reference',
    inputReferenceImage: 'upload.png',
    avatarReferenceImage: 'avatar.png',
    useAvatarVisualReference: true,
  }), 'upload.png');
  assert.equal(resolveVisualReference({
    operation: 'reference',
    avatarReferenceImage: 'avatar.png',
    useAvatarVisualReference: false,
  }), undefined);
  assert.equal(resolveVisualReference({
    operation: 'reference',
    avatarReferenceImage: 'avatar.png',
    useAvatarVisualReference: true,
  }), 'avatar.png');
});

test('pacote 3D envia a referencia uma vez e reutiliza nos demais angulos', () => {
  assert.deepEqual(resolveTurnaroundReferencePolicy(0, false), {
    forceReferenceUpload: true,
    useExistingFlowReference: false,
  });
  assert.deepEqual(resolveTurnaroundReferencePolicy(1, false), {
    forceReferenceUpload: false,
    useExistingFlowReference: true,
  });
  assert.deepEqual(resolveTurnaroundReferencePolicy(2, false), {
    forceReferenceUpload: false,
    useExistingFlowReference: true,
  });
  assert.deepEqual(resolveTurnaroundReferencePolicy(0, true), {
    forceReferenceUpload: false,
    useExistingFlowReference: true,
  });
});

test('referencia existente e reutilizada sem criar outro upload no Flow', () => {
  assert.equal(resolveReferenceAttachmentStrategy({
    alreadyAttached: true,
    useExistingFlowReference: true,
    forceReferenceUpload: false,
  }), 'reuse-attached');
  assert.equal(resolveReferenceAttachmentStrategy({
    alreadyAttached: false,
    useExistingFlowReference: true,
    forceReferenceUpload: false,
  }), 'select-existing');
  assert.equal(resolveReferenceAttachmentStrategy({
    alreadyAttached: false,
    useExistingFlowReference: false,
    forceReferenceUpload: true,
  }), 'upload');
});

test('arquivo temporario de referencia e validado e removido', () => {
  const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const saved = saveBase64ReferenceImage(onePixelPng, 'contract_test');
  assert.equal(existsSync(saved.filePath), true);
  cleanupTemporaryReference(saved.filePath);
  assert.equal(existsSync(saved.filePath), false);
});
