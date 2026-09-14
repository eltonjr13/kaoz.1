"use client";

/**
 * Renderer da anatomia do recorte.
 *
 * Regras de fidelidade visual (plano, seção 10):
 *  - posições vêm de somaLocation real, normalizado; a transformação é exibida;
 *  - o que é anatomia presente no MODELO é visualmente distinto do contexto;
 *  - cores de atividade representam valores numéricos do motor, normalizados
 *    segundo escala registrada — NÃO são medições biológicas;
 *  - sem atividade observada, o estado é estático: nada pulsa para fingir
 *    trabalho;
 *  - pausa quando a aba está oculta ou inativa e respeita prefers-reduced-motion.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ActivitySample, ConnectomeNode } from "@/services/cortex-engine/cortex-engine.types";
import {
  mapToAnatomyFrame,
  projectNodes,
  type ProjectedPoint,
} from "./brain-geometry";

export interface BrainCanvasProps {
  nodes: ConnectomeNode[];
  /** Posições normalizadas [0,1] por eixo, 3 por nó. */
  positions: number[];
  /**
   * Anatomia COMPLETA do CNS, apenas como fundo de referência.
   *
   * Conjunto separado do motor (141.781 pontos contra os 1.536 do recorte).
   * Desenhada esmaecida para dar a forma anatômica sem sugerir que participa do
   * cálculo — o recorte destacado por cima mostra onde o motor realmente opera.
   */
  backgroundPositions?: Float32Array | null;
  /**
   * Enquadramento para alinhar o recorte com a anatomia.
   *
   * Obrigatório quando `backgroundPositions` é usado: sem ele o recorte seria
   * desenhado no próprio sistema de coordenadas e pareceria cobrir o CNS todo.
   */
  frame?: {
    motorMin: number[];
    motorMax: number[];
    anatomyMin: number[];
    anatomyMax: number[];
  } | null;
  /** Amostras reais de atividade; ausentes = estado estático. */
  samples?: ActivitySample[];
  isActive?: boolean;
  selectedIndex?: number | null;
  onSelectNode?: (index: number | null) => void;
  className?: string;
}

const BACKGROUND_DENSITY = 0.35;
const MAX_EDGES_DRAWN = 400;
/** Cor do fundo anatômico: presente, mas claramente fora de foco. */
const COLOR_ANATOMY_BACKGROUND = "rgba(138,150,182,0.30)";

/**
 * Decide o sistema de coordenadas do recorte.
 *
 * Com anatomia de fundo E enquadramento, o recorte é convertido para o
 * enquadramento da anatomia. Sem qualquer um dos dois, mantém-se o
 * comportamento anterior (recorte no próprio sistema).
 */
function resolveDisplayPositions(
  positions: number[],
  frame: BrainCanvasProps["frame"],
  backgroundPositions: Float32Array | null
): ArrayLike<number> {
  if (!frame || !backgroundPositions) return positions;
  return mapToAnatomyFrame(
    positions,
    frame.motorMin,
    frame.motorMax,
    frame.anatomyMin,
    frame.anatomyMax
  );
}

/**
 * Rasteriza o fundo anatômico em um canvas próprio.
 *
 * São dezenas de milhares de pontos; redesenhá-los a cada movimento do mouse
 * custaria caro. O fundo vira imagem e o desenho só a sobrepõe.
 */
function buildBackgroundLayer(
  backgroundPositions: Float32Array | null | undefined,
  width: number,
  height: number
): HTMLCanvasElement | null {
  if (!backgroundPositions || backgroundPositions.length < 3) return null;
  if (width === 0 || height === 0) return null;
  const off = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  off.width = Math.floor(width * dpr);
  off.height = Math.floor(height * dpr);
  const ctx = off.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pontos = Math.floor(backgroundPositions.length / 3);
  drawAnatomyBackground(ctx, width, height, projectNodes(backgroundPositions, pontos));
  return off;
}

/**
 * Prepara o canvas para desenho e devolve o contexto.
 *
 * Extraído do efeito para concentrar aqui as guardas de tamanho e a escala por
 * devicePixelRatio (sem ela o desenho fica borrado em telas 4K).
 */
function prepareCanvas(
  canvas: HTMLCanvasElement | null,
  size: { width: number; height: number }
): CanvasRenderingContext2D | null {
  if (!canvas) return null;
  if (size.width === 0 || size.height === 0) return null;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.floor(size.width * dpr);
  canvas.height = Math.floor(size.height * dpr);
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return context;
}

/** Quantos pontos de fundo desenhar; `undefined` quando não há anatomia. */
function countBackgroundPoints(
  backgroundPositions: Float32Array | null | undefined
): number | undefined {
  return backgroundPositions ? Math.floor(backgroundPositions.length / 3) : undefined;
}

/**
 * Observa o tamanho do container.
 *
 * ResizeObserver em vez de `window.resize`: o sidebar pode colapsar sem que a
 * janela mude de tamanho.
 */
function useContainerSize(
  ref: React.RefObject<HTMLDivElement | null>
): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function BrainCanvas({
  nodes,
  positions,
  backgroundPositions = null,
  frame = null,
  samples,
  isActive = true,
  selectedIndex = null,
  onSelectNode,
  className = "",
}: BrainCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const size = useContainerSize(containerRef);
  const [hovered, setHovered] = useState<number | null>(null);

  const reducedMotion = usePrefersReducedMotion();
  const visible = usePageVisibility();

  // Alinhamento ao fundo: o recorte sai do próprio enquadramento e entra no da
  // anatomia ANTES de projetar, para que desenho e teste de clique usem a mesma
  // geometria.
  const displayPositions = useMemo(
    () => resolveDisplayPositions(positions, frame, backgroundPositions),
    [positions, frame, backgroundPositions]
  );

  // A geometria é projetada uma única vez: a projeção 2,5D é determinística.
  const projected = useMemo(
    () => projectNodes(displayPositions, nodes.length),
    [displayPositions, nodes.length]
  );
  const magnitudeByNode = useMemo(() => buildMagnitudeMap(samples), [samples]);
  const backgroundPointCount = countBackgroundPoints(backgroundPositions);

  // Fundo anatômico: rasterizado uma vez por tamanho/dados. Mesma convenção
  // [0,1] da anatomia, então o recorte já convertido cai na região certa.
  const backgroundLayer = useMemo(
    () => buildBackgroundLayer(backgroundPositions, size.width, size.height),
    [backgroundPositions, size.width, size.height]
  );

  useEffect(() => {
    const context = prepareCanvas(canvasRef.current, size);
    if (!context) return;
    draw(context, {
      width: size.width,
      height: size.height,
      projected,
      backgroundLayer,
      nodes,
      magnitudeByNode,
      selectedIndex: selectedIndex ?? hovered,
      reducedMotion,
    });
  }, [
    size,
    projected,
    backgroundLayer,
    backgroundPositions,
    nodes,
    magnitudeByNode,
    selectedIndex,
    hovered,
    reducedMotion,
  ]);

  // Pausa total quando a aba está oculta ou a seção inativa.
  const running = isActive && visible;

  function nodeAt(clientX: number, clientY: number): number | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: number | null = null;
    let bestDistance = 12;
    projected.forEach((point, index) => {
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  return (
    <div ref={containerRef} className={`relative h-full w-full ${className}`}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={describeAnatomy(nodes.length, backgroundPointCount)}
        className="h-full w-full cursor-crosshair outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal-bright)]"
        tabIndex={0}
        onMouseMove={(event) => setHovered(nodeAt(event.clientX, event.clientY))}
        onMouseLeave={() => setHovered(null)}
        onClick={(event) => onSelectNode?.(nodeAt(event.clientX, event.clientY))}
        onKeyDown={(event) => handleCanvasKeys(event, selectedIndex, nodes.length, onSelectNode)}
      />
      {!running && (
        <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-[var(--panel)]/90 px-2 py-1 text-[10px] text-[var(--muted)]">
          Renderização pausada (aba inativa)
        </p>
      )}
      {/* Alternativa textual acessível da anatomia. */}
      <p className="sr-only">
        {nodes.length} neurônios reais do recorte.{" "}
        {samples?.length
          ? `Atividade numérica amostrada em ${samples.length} passos.`
          : "Sem atividade observada: exibição estática."}
      </p>
    </div>
  );
}


function buildMagnitudeMap(samples?: ActivitySample[]): Map<number, number> {
  const map = new Map<number, number>();
  if (!samples?.length) return map;
  const last = samples[samples.length - 1];
  last.nodeIndices.forEach((nodeIndex, slot) => {
    map.set(nodeIndex, Math.abs(last.magnitudes[slot] ?? 0));
  });
  return map;
}

interface DrawOptions {
  width: number;
  height: number;
  projected: ProjectedPoint[];
  /** Camada de fundo já rasterizada; ver comentário no componente. */
  backgroundLayer: HTMLCanvasElement | null;
  nodes: ConnectomeNode[];
  magnitudeByNode: Map<number, number>;
  selectedIndex: number | null;
  reducedMotion: boolean;
}

function draw(context: CanvasRenderingContext2D, options: DrawOptions): void {
  const {
    width,
    height,
    projected,
    backgroundLayer,
    nodes,
    magnitudeByNode,
    selectedIndex,
    reducedMotion,
  } = options;
  context.clearRect(0, 0, width, height);

  // Contorno anatômico apenas contextual: eixos e limites do recorte.
  drawAxes(context, width, height);

  // Fundo: anatomia COMPLETA do CNS, já rasterizada em canvas próprio. Não é o
  // conjunto do motor — dá a forma anatômica ao recorte destacado por cima.
  if (backgroundLayer) {
    context.drawImage(backgroundLayer, 0, 0, width, height);
  }

  const hasActivity = magnitudeByNode.size > 0;
  projected.forEach((point, index) => {
    const node = nodes[index];
    if (!node) return;
    const magnitude = magnitudeByNode.get(index);
    const isSelected = selectedIndex === index;
    // Sem atividade observada, TODOS os nós ficam com o mesmo peso visual:
    // nada é animado para simular processamento.
    const emphasis = hasActivity && magnitude !== undefined ? Math.min(1, magnitude) : 0;
    const base = 1.6 + emphasis * 2.4;
    const radius = isSelected ? base + 2.5 : base;
    context.beginPath();
    context.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
    context.fillStyle = nodeColor(node, emphasis, isSelected);
    context.globalAlpha = isSelected ? 1 : 0.55 + emphasis * 0.45;
    context.fill();
    context.globalAlpha = 1;
  });

  // Densidade de arestas limitada: desenha apenas uma amostra determinística.
  drawEdgeHints(context, width, height, projected, reducedMotion);
}

/**
 * Cores literais: o canvas 2D não resolve variáveis CSS. Os valores espelham os
 * tokens do projeto para que a atividade seja legível no tema escuro.
 */
const COLOR_SELECTED = "rgb(120 220 232)";
const COLOR_ACTIVE = "rgb(96 190 210)";
const COLOR_MALE_SPECIFIC = "rgb(196 128 255)";
const COLOR_DIMORPHIC = "rgb(255 168 96)";
const COLOR_IDLE = "rgb(150 170 210)";

function nodeColor(node: ConnectomeNode, emphasis: number, isSelected: boolean): string {
  if (isSelected) return COLOR_SELECTED;
  // Dimorfismo vem do dataset e é destacado: informação real, não decoração.
  if (node.dimorphism === "male-specific") return COLOR_MALE_SPECIFIC;
  if (node.dimorphism === "sexually dimorphic") return COLOR_DIMORPHIC;
  if (emphasis > 0.45) return COLOR_ACTIVE;
  return COLOR_IDLE;
}

/**
 * Desenha a anatomia completa como fundo estático.
 *
 * `fillRect` de 1 px em vez de `arc`: são dezenas de milhares de pontos e o
 * arco custa caro. O fundo é desenhado uma vez por mudança de dados, não por
 * quadro, então não há animação fingindo atividade.
 */
function drawAnatomyBackground(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  projected: ProjectedPoint[]
): void {
  if (!projected.length) return;
  context.fillStyle = COLOR_ANATOMY_BACKGROUND;
  for (const point of projected) {
    context.fillRect(point.x * width, point.y * height, 1, 1);
  }
}

function drawAxes(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.strokeStyle = "rgba(255,255,255,0.06)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.moveTo(width / 2, 0);
  context.lineTo(width / 2, height);
  context.stroke();
}

function drawEdgeHints(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  projected: ProjectedPoint[],
  reducedMotion: boolean
): void {
  if (reducedMotion) return;
  const step = Math.max(1, Math.floor(projected.length / MAX_EDGES_DRAWN));
  context.strokeStyle = "rgba(150,170,210,0.05)";
  context.lineWidth = 0.5;
  context.beginPath();
  for (let index = 0; index + step < projected.length; index += step) {
    const from = projected[index];
    const to = projected[index + step];
    const strength = (from.depth + to.depth) / 2;
    if (strength < BACKGROUND_DENSITY) continue;
    context.moveTo(from.x * width, from.y * height);
    context.lineTo(to.x * width, to.y * height);
  }
  context.stroke();
}

function describeAnatomy(count: number, backgroundPoints?: number): string {
  const fundo = backgroundPoints
    ? `Ao fundo, a referência anatômica do CNS completo com ${backgroundPoints} neurônios, apenas para orientação visual. O motor não computa sobre ela. `
    : "";
  return `${fundo}Em destaque, o recorte que o motor usa: ${count} neurônios reais do conectoma MaleCNS. Use as setas para navegar entre neurônios e Enter para inspecionar.`;
}

function handleCanvasKeys(
  event: React.KeyboardEvent,
  selected: number | null,
  count: number,
  onSelect: ((index: number | null) => void) | undefined
): void {
  if (!onSelect) return;
  const current = selected ?? 0;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    event.preventDefault();
    onSelect(Math.min(count - 1, current + 1));
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    event.preventDefault();
    onSelect(Math.max(0, current - 1));
  } else if (event.key === "Home") {
    event.preventDefault();
    onSelect(0);
  } else if (event.key === "End") {
    event.preventDefault();
    onSelect(count - 1);
  } else if (event.key === "Escape") {
    event.preventDefault();
    onSelect(null);
  }
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
  return reduced;
}

function usePageVisibility(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const listener = () => setVisible(document.visibilityState === "visible");
    listener();
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  }, []);
  return visible;
}
