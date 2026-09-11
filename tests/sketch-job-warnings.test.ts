import test from 'node:test';
import assert from 'node:assert/strict';
import { collectJobWarnings } from '../lib/sketch/sketch-job-warnings.ts';
import type { SketchJobSnapshot, SketchReferenceDiagnostic } from '../types/sketch.ts';

function snapshot(diagnostics: SketchReferenceDiagnostic[]): Pick<SketchJobSnapshot, 'diagnostics'> {
  return { diagnostics };
}

test('avisos acionáveis chegam para a pessoa que está usando o estúdio', () => {
  const warnings = collectJobWarnings(
    snapshot([
      {
        code: 'TEXT_WORDING_REQUIRED',
        severity: 'warning',
        message: 'A ideia pede texto ou chamada de ação, mas nenhuma frase exata foi informada.',
      },
      {
        code: 'REFERENCE_DROPPED',
        severity: 'warning',
        message: 'Não foi possível ler a imagem "produto.png".',
      },
    ])
  );

  assert.equal(warnings.length, 2);
  assert.equal(warnings[0].code, 'TEXT_WORDING_REQUIRED');
  assert.equal(warnings[1].code, 'REFERENCE_DROPPED');
});

test('notas internas de qualidade não viram aviso na tela', () => {
  const warnings = collectJobWarnings(
    snapshot([
      { code: 'PROMPT_QUALITY_ISSUE', severity: 'warning', message: 'Alerta de truncamento: 400 palavras.' },
      { code: 'ASPECT_RATIO_ADAPTED', severity: 'info', message: 'Proporção adaptada.' },
      { code: 'COMPOSITE_REFERENCE_BUILT', severity: 'info', message: 'Referências unificadas.' },
    ])
  );

  assert.deepEqual(warnings, []);
});

test('mensagens repetidas aparecem uma única vez e sem snapshot não quebra', () => {
  const repeated: SketchReferenceDiagnostic = {
    code: 'SKETCH_RENDER_FAILED',
    severity: 'warning',
    message: 'Não foi possível rasterizar o esboço salvo.',
  };

  assert.equal(collectJobWarnings(snapshot([repeated, { ...repeated }])).length, 1);
  assert.deepEqual(collectJobWarnings(null), []);
  assert.deepEqual(collectJobWarnings(undefined), []);
});
