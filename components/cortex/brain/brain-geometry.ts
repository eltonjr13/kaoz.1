/**
 * Geometria pura do desenho do cérebro.
 *
 * Vive fora do componente de propósito: é lógica determinística, testável sem
 * DOM, e o runner do projeto (`--experimental-strip-types`) não processa JSX.
 */

export interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
}

/** Projeção 2,5D determinística: leve rotação em Y para dar profundidade. */
export function projectNodes(positions: ArrayLike<number>, count: number): ProjectedPoint[] {
  const angle = 0.55;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const out: ProjectedPoint[] = [];
  for (let index = 0; index < count; index++) {
    const x = positions[index * 3] ?? 0.5;
    const y = positions[index * 3 + 1] ?? 0.5;
    const z = positions[index * 3 + 2] ?? 0.5;
    const cx = x - 0.5;
    const cz = z - 0.5;
    out.push({
      x: 0.5 + (cx * cos - cz * sin) * 0.8,
      y: 0.5 - (y - 0.5) * 0.8,
      depth: cx * sin + cz * cos,
    });
  }
  return out;
}

/**
 * Leva posições do enquadramento do RECORTE para o da ANATOMIA.
 *
 * Os dois artefatos normalizam para [0,1] sobre bounding boxes diferentes: o
 * pacote do motor usa o retângulo do próprio recorte, a anatomia usa o do CNS
 * inteiro. Desenhar um sobre o outro sem converter estica o recorte por todo o
 * canvas — sugerindo que o motor cobre o CNS, que é justamente o que não ocorre.
 *
 * Eixo com extensão zero (recorte plano) usa span 1 para não gerar divisão por
 * zero: o valor cru passa direto para o enquadramento da anatomia.
 */
export function mapToAnatomyFrame(
  positions: ArrayLike<number>,
  motorMin: number[],
  motorMax: number[],
  anatomyMin: number[],
  anatomyMax: number[]
): Float32Array {
  const out = new Float32Array(positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const motorSpan = motorMax[axis] - motorMin[axis] || 1;
      const anatomySpan = anatomyMax[axis] - anatomyMin[axis] || 1;
      const raw = (positions[index + axis] ?? 0.5) * motorSpan + motorMin[axis];
      out[index + axis] = (raw - anatomyMin[axis]) / anatomySpan;
    }
  }
  return out;
}
