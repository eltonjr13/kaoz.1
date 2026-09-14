/**
 * Leitura da anatomia completa do CNS — camada de VISUALIZAÇÃO.
 *
 * Separação deliberada: o motor computa sobre um recorte de 1.536 neurônios,
 * enquanto este artefato reúne todos os neurônios com posição real (141.781) e
 * existe só para desenhar a referência anatômica. Nada aqui participa de
 * pontuação, ranking ou decisão.
 *
 * O manifesto declara `purpose: "visualizacao"` e traz o aviso de escopo, para
 * que a interface nunca apresente esta camada como se fosse o conjunto ativo.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { defaultAnatomyDir } from "./engine-status.ts";

export interface AnatomySuperclass {
  index: number;
  name: string;
  count: number;
}

export interface AnatomyMotorFrame {
  neuronCount: number;
  min: number[];
  max: number[];
  missingPosition: number;
  /** Fração do CNS que o recorte ocupa em cada eixo. */
  extentOfCns: number[];
}

export interface AnatomyLevel {
  level: number;
  stride: number;
  count: number;
}

export interface AnatomyManifest {
  artifactId: string;
  artifactVersion: string;
  datasetId: string;
  datasetVersion: string;
  license: string;
  attribution: string;
  purpose: "visualizacao";
  purposeNotice: string;
  transform: {
    inputUnits: string;
    method: string;
    min: number[];
    max: number[];
  };
  points: number;
  levels: AnatomyLevel[];
  motorFrame: AnatomyMotorFrame | null;
  superclasses: AnatomySuperclass[];
  files: { positions: string; superclass: string; bodyIds: string };
}

export class AnatomyError extends Error {
  public readonly reason: "anatomy-missing" | "anatomy-invalid";

  constructor(reason: "anatomy-missing" | "anatomy-invalid", message: string) {
    super(message);
    this.reason = reason;
    this.name = "AnatomyError";
  }
}

/** Manifesto público: só o que a interface precisa para desenhar com honestidade. */
export async function readAnatomyManifest(
  dir = defaultAnatomyDir()
): Promise<AnatomyManifest> {
  try {
    const raw = await fs.readFile(path.join(dir, "manifest.json"), "utf8");
    return JSON.parse(raw) as AnatomyManifest;
  } catch (error) {
    throw new AnatomyError(
      "anatomy-missing",
      `anatomia completa indisponível em ${dir}: ${(error as Error).message}`
    );
  }
}

/**
 * Lê as posições e devolve um subconjunto determinístico.
 *
 * O passo é ancorado na ordem canônica do arquivo (sem amostragem aleatória),
 * então o mesmo nível devolve sempre os mesmos pontos — a anatomia não "pula"
 * entre carregamentos.
 */
export async function readAnatomyPositions(
  level: number,
  dir = defaultAnatomyDir()
): Promise<{ positions: Float32Array; points: number; level: number; stride: number }> {
  const manifest = await readAnatomyManifest(dir);
  const escolhido =
    manifest.levels.find((entry) => entry.level === level) ?? manifest.levels[0];
  if (!escolhido) {
    throw new AnatomyError("anatomy-invalid", "manifesto sem níveis definidos");
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(path.join(dir, manifest.files.positions));
  } catch (error) {
    throw new AnatomyError(
      "anatomy-missing",
      `posições ausentes: ${(error as Error).message}`
    );
  }

  const total = Math.floor(buffer.byteLength / (3 * 4));
  if (total !== manifest.points) {
    throw new AnatomyError(
      "anatomy-invalid",
      `posições com ${total} pontos, manifesto declara ${manifest.points}`
    );
  }

  const tudo = new Float32Array(buffer.buffer, buffer.byteOffset, total * 3);
  if (escolhido.stride <= 1) {
    return { positions: tudo, points: total, level: escolhido.level, stride: 1 };
  }

  const pontos = Math.ceil(total / escolhido.stride);
  const reduzido = new Float32Array(pontos * 3);
  let destino = 0;
  for (let origem = 0; origem < total; origem += escolhido.stride) {
    reduzido[destino * 3] = tudo[origem * 3];
    reduzido[destino * 3 + 1] = tudo[origem * 3 + 1];
    reduzido[destino * 3 + 2] = tudo[origem * 3 + 2];
    destino++;
  }
  return {
    positions: reduzido,
    points: destino,
    level: escolhido.level,
    stride: escolhido.stride,
  };
}
