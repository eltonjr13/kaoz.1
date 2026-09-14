/**
 * tests/cortex-anatomy-frame.test.ts
 *
 * O recorte do motor e a anatomia completa normalizam para [0,1] sobre retângulos
 * DIFERENTES: o pacote usa o bounding box do próprio recorte, a anatomia usa o do
 * CNS inteiro. Sobrepor um ao outro sem converter estica o recorte por todo o
 * canvas — e a imagem passa a sugerir que o motor cobre o CNS, que é exatamente o
 * que não acontece.
 *
 * Estes testes fixam a conversão e os casos de borda que já apareceram.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { mapToAnatomyFrame } from "../components/cortex/brain/brain-geometry.ts";

/** Valores reais do artefato construído (ver cortex:build-anatomy). */
const ANATOMY_MIN = [2468, 4758, 10154];
const ANATOMY_MAX = [93668, 68996, 134531];

test("o canto mínimo do recorte cai na fração correta do CNS", () => {
  const motorMin = [10000, 20000, 30000];
  const motorMax = [50000, 60000, 80000];
  // Um único ponto no canto mínimo do recorte: normalizado no recorte, é (0,0,0).
  const out = mapToAnatomyFrame(
    [0, 0, 0],
    motorMin,
    motorMax,
    ANATOMY_MIN,
    ANATOMY_MAX
  );
  for (let axis = 0; axis < 3; axis++) {
    const esperado =
      (motorMin[axis] - ANATOMY_MIN[axis]) / (ANATOMY_MAX[axis] - ANATOMY_MIN[axis]);
    assert.ok(
      Math.abs(out[axis] - esperado) < 1e-6,
      `eixo ${axis}: esperado ${esperado}, obtido ${out[axis]}`
    );
  }
});

test("o canto máximo do recorte cai na fração correta do CNS", () => {
  const motorMin = [10000, 20000, 30000];
  const motorMax = [50000, 60000, 80000];
  const out = mapToAnatomyFrame([1, 1, 1], motorMin, motorMax, ANATOMY_MIN, ANATOMY_MAX);
  for (let axis = 0; axis < 3; axis++) {
    const esperado =
      (motorMax[axis] - ANATOMY_MIN[axis]) / (ANATOMY_MAX[axis] - ANATOMY_MIN[axis]);
    assert.ok(
      Math.abs(out[axis] - esperado) < 1e-6,
      `eixo ${axis}: esperado ${esperado}, obtido ${out[axis]}`
    );
  }
});

test("recorte igual ao CNS inteiro passa sem distorção", () => {
  // Se os dois retângulos coincidem, converter não pode mudar nada.
  const entrada = [0, 0.25, 0.5, 0.75, 1, 0.1];
  const out = mapToAnatomyFrame(entrada, ANATOMY_MIN, ANATOMY_MAX, ANATOMY_MIN, ANATOMY_MAX);
  for (let i = 0; i < entrada.length; i++) {
    assert.ok(Math.abs(out[i] - entrada[i]) < 1e-6, `índice ${i}: ${out[i]}`);
  }
});

test("recorte NÃO é esticado a [0,1] — o defeito que isto previne", () => {
  // Retângulo real do recorte: cobre parte do CNS. Normalizado no próprio espaço
  // ele ocupa [0,1] inteiro; no espaço do CNS tem que ficar DENTRO, não esticado.
  const motorMin = [30000, 25000, 90000];
  const motorMax = [80000, 60000, 120000];
  const out = mapToAnatomyFrame([0, 0, 0, 1, 1, 1], motorMin, motorMax, ANATOMY_MIN, ANATOMY_MAX);
  const minX = out[0];
  const maxX = out[3];
  const minY = out[1];
  const maxY = out[4];
  // Sem conversão isto seria exatamente 0..1 em todos os eixos.
  assert.ok(minX > 0 || minY > 0, "o recorte não pode começar em (0,0) do CNS");
  assert.ok(maxX < 1 || maxY < 1, "o recorte não pode terminar em (1,1) do CNS");
  assert.ok(maxX > minX, "o retângulo tem que preservar a ordem");
  assert.ok(maxY > minY, "o retângulo tem que preservar a ordem");
});

test("dimensão degenerada não produz NaN nem Infinity", () => {
  // Recorte plano num eixo (span zero) não pode gerar divisão por zero.
  const motorMin = [10000, 4758, 30000];
  const motorMax = [10000, 4758, 30000];
  const out = mapToAnatomyFrame([0.5, 0.5, 0.5], motorMin, motorMax, ANATOMY_MIN, ANATOMY_MAX);
  for (const valor of out) {
    assert.ok(Number.isFinite(valor), `valor não finito: ${valor}`);
  }
});

test("preserva o número de coordenadas e a ordem x,y,z", () => {
  const entrada = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
  const out = mapToAnatomyFrame(entrada, ANATOMY_MIN, ANATOMY_MAX, ANATOMY_MIN, ANATOMY_MAX);
  assert.equal(out.length, entrada.length, "não pode perder nem criar coordenadas");
  assert.equal(out.length % 3, 0, "precisa continuar múltiplo de 3");
});
