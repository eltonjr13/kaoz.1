import test from 'node:test';
import assert from 'node:assert/strict';
import { describeIterationLabel } from '../lib/sketch/sketch-iteration-label.ts';

test('rótulos do fluxo simples descrevem a iteração pedida', () => {
  assert.equal(describeIterationLabel('new_concept', 2), 'Outra ideia (v2)');
  assert.equal(describeIterationLabel('refine_text', 3), 'Ajuste pedido (v3)');
  assert.equal(describeIterationLabel('refine_visual', 4), 'Ajuste visual (v4)');
  assert.equal(describeIterationLabel(undefined, 1), 'Versão original (v1)');
});

test('rótulos do fluxo de prancheta continuam iguais', () => {
  assert.equal(describeIterationLabel('initial', 1), 'Versão original (v1)');
  assert.equal(describeIterationLabel('text_adjustment', 5), 'Ajuste de texto (v5)');
  assert.equal(describeIterationLabel('visual_adjustment', 6), 'Ajuste visual (v6)');
  assert.equal(describeIterationLabel('new_concept', undefined), 'Outra ideia (v1)');
});
