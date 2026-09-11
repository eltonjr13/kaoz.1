import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDefaultAttachmentRole } from '../lib/sketch/sketch-attachment-roles.ts';
import { normalizeSketchRole } from '../lib/sketch/sketch-reference-builder.ts';

test('novo anexo entra como sujeito a preservar, nunca como estilo', () => {
  assert.equal(resolveDefaultAttachmentRole('image.png'), 'product');
  assert.equal(resolveDefaultAttachmentRole('3D_version_of_character.jpeg'), 'product');
  assert.equal(resolveDefaultAttachmentRole('foto-da-pessoa.jpg'), 'product');
  assert.equal(resolveDefaultAttachmentRole(undefined), 'product');
});

test('arquivo com nome de logo já entra marcado como logo', () => {
  assert.equal(resolveDefaultAttachmentRole('logo-kaoz.png'), 'logo');
  assert.equal(resolveDefaultAttachmentRole('minha-marca.svg'), 'logo');
});

test('papéis legados do contrato antigo são normalizados para papéis de sujeito', () => {
  assert.equal(normalizeSketchRole('reference'), 'product');
  assert.equal(normalizeSketchRole('overlay'), 'product');
  assert.equal(normalizeSketchRole('inspiration'), 'product');
  assert.equal(normalizeSketchRole('person'), 'person');
  assert.equal(normalizeSketchRole('style'), 'style');
  assert.equal(normalizeSketchRole(undefined), 'product');
});
