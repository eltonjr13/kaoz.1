"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { 
  Maximize2, 
  Minus, 
  Plus, 
  RotateCcw, 
  Search, 
  X, 
  HelpCircle, 
  Sliders, 
  Brain,
  AlertTriangle,
  Award,
  Layers,
  Activity
} from "lucide-react";

interface NodeData {
  id: string;
  label: string;
  type: 'concept' | 'entity' | 'tool-outcome' | 'error-pattern';
  description: string;
  confidenceScore: number;
  lastObserved: string;
  metadata?: Record<string, any>;
  
  // Coordenadas e velocidades para simulação física
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  radius?: number;
}

interface EdgeData {
  id: string;
  source: string;
  target: string;
  relation: string;
  weight: number;
  confidenceScore: number;
  occurrences: number;
  lastReinforced: string;
}

export function CortexGraphClient() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [nodes, setNodes] = useState<NodeData[]>([]);
  const [edges, setEdges] = useState<EdgeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  // Parâmetros da simulação física ajustáveis
  const [repulsionForce, setRepulsionForce] = useState(600);
  const [attractionForce, setAttractionForce] = useState(0.04);
  const [centerGravity, setCenterGravity] = useState(0.03);

  // Estado de Visualização (Pan e Zoom)
  const [zoom, setZoom] = useState(1.0);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  // Estado de arraste
  const draggedNodeRef = useRef<NodeData | null>(null);
  const isPanningRef = useRef(false);
  const startPanXRef = useRef(0);
  const startPanYRef = useRef(0);

  // Carrega dados da API
  async function fetchGraphData() {
    try {
      setLoading(true);
      const res = await fetch("/api/memory/graph");
      const data = await res.json();
      
      // Inicializa posições dos nós de forma circular se não existirem
      const initializedNodes = (data.nodes || []).map((node: NodeData, index: number, arr: NodeData[]) => {
        const angle = (index / arr.length) * Math.PI * 2;
        const radius = 180 + Math.random() * 50;
        return {
          ...node,
          x: node.x ?? (window.innerWidth / 2 - 124 + Math.cos(angle) * radius),
          y: node.y ?? (300 + Math.sin(angle) * radius),
          vx: 0,
          vy: 0,
          radius: 12 // Padrão
        };
      }) as NodeData[];

      // Calcula os raios dinamicamente com base no número de conexões (grau)
      initializedNodes.forEach((node) => {
        const degree = (data.edges || []).filter(
          (e: EdgeData) => e.source === node.id || e.target === node.id
        ).length;
        node.radius = Math.min(26, 10 + degree * 2);
      });

      setNodes(initializedNodes);
      setEdges(data.edges || []);
    } catch (err) {
      console.error("Falha ao carregar grafo de córtex:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchGraphData();
  }, []);

  // Centraliza o grafo na tela
  const handleResetLayout = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    
    // Distribui em círculo centrado
    const updatedNodes = nodes.map((node, index, arr) => {
      const angle = (index / arr.length) * Math.PI * 2;
      const dist = 180 + Math.random() * 40;
      return {
        ...node,
        x: canvas.width / 2 + Math.cos(angle) * dist,
        y: canvas.height / 2 + Math.sin(angle) * dist,
        vx: 0,
        vy: 0
      };
    });

    setNodes(updatedNodes);
    setZoom(1.0);
    setPanX(0);
    setPanY(0);
  };

  // Simulação física e renderização (Loop requestAnimationFrame)
  useEffect(() => {
    if (loading || nodes.length === 0) return;

    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Redimensiona o canvas para caber no container
    const resizeCanvas = () => {
      const container = containerRef.current;
      if (container) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
      }
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Loop da animação
    const tick = () => {
      // 1. APLICA FORÇAS DA SIMULAÇÃO
      const currentNodes = [...nodes];
      const n = currentNodes.length;

      // 1.A. Repulsão entre pares de nós (Fórmula eletrostática simplificada)
      for (let i = 0; i < n; i++) {
        const u = currentNodes[i];
        for (let j = i + 1; j < n; j++) {
          const v = currentNodes[j];
          if (u.x === undefined || u.y === undefined || v.x === undefined || v.y === undefined) continue;

          const dx = v.x - u.x;
          const dy = v.y - u.y;
          const distSq = dx * dx + dy * dy || 1;
          const dist = Math.sqrt(distSq);

          if (dist < 400) {
            // Força inversamente proporcional à distância
            const force = repulsionForce / distSq;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            if (draggedNodeRef.current?.id !== u.id) {
              u.vx = (u.vx || 0) - fx;
              u.vy = (u.vy || 0) - fy;
            }
            if (draggedNodeRef.current?.id !== v.id) {
              v.vx = (v.vx || 0) + fx;
              v.vy = (v.vy || 0) + fy;
            }
          }
        }
      }

      // 1.B. Atração ao longo das arestas (Lei de Hooke simplificada)
      for (const edge of edges) {
        const sourceNode = currentNodes.find((x) => x.id === edge.source);
        const targetNode = currentNodes.find((x) => x.id === edge.target);

        if (!sourceNode || !targetNode) continue;
        if (sourceNode.x === undefined || sourceNode.y === undefined || targetNode.x === undefined || targetNode.y === undefined) continue;

        const dx = targetNode.x - sourceNode.x;
        const dy = targetNode.y - sourceNode.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        
        // Distância de repouso confortável
        const restLength = 120;
        const displacement = dist - restLength;
        const force = displacement * attractionForce * edge.weight;

        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (draggedNodeRef.current?.id !== sourceNode.id) {
          sourceNode.vx = (sourceNode.vx || 0) + fx;
          sourceNode.vy = (sourceNode.vy || 0) + fy;
        }
        if (draggedNodeRef.current?.id !== targetNode.id) {
          targetNode.vx = (targetNode.vx || 0) - fx;
          targetNode.vy = (targetNode.vy || 0) - fy;
        }
      }

      // 1.C. Gravidade centralizada e atualização de posições
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      for (const node of currentNodes) {
        if (node.x === undefined || node.y === undefined) continue;

        if (draggedNodeRef.current?.id === node.id) {
          // Mantém as velocidades zeradas enquanto arrasta
          node.vx = 0;
          node.vy = 0;
          continue;
        }

        // Puxa levemente para o centro da tela
        const dx = centerX - node.x;
        const dy = centerY - node.y;
        node.vx = (node.vx || 0) + dx * centerGravity;
        node.vy = (node.vy || 0) + dy * centerGravity;

        // Atualiza posição + fricção
        node.x += node.vx;
        node.y += node.vy;
        node.vx *= 0.82;
        node.vy *= 0.82;
      }

      // 2. RENDERIZAÇÃO DO CANVAS
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      // Aplica Panning e Zooming
      ctx.translate(canvas.width / 2 + panX, canvas.height / 2 + panY);
      ctx.scale(zoom, zoom);
      ctx.translate(-canvas.width / 2, -canvas.height / 2);

      // 2.A. Desenha a grade de fundo (dots) baseada na câmera virtual
      ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
      const gridSize = 40;
      // Calcula limites da tela visível pós-transformação
      const startX = -panX / zoom - canvas.width;
      const endX = -panX / zoom + canvas.width * 2;
      const startY = -panY / zoom - canvas.height;
      const endY = -panY / zoom + canvas.height * 2;

      for (let x = Math.floor(startX / gridSize) * gridSize; x < endX; x += gridSize) {
        for (let y = Math.floor(startY / gridSize) * gridSize; y < endY; y += gridSize) {
          ctx.beginPath();
          ctx.arc(x, y, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Filtro de Busca Ativo
      const q = searchQuery.toLowerCase().trim();

      // 2.B. Desenha as Arestas (Edges)
      for (const edge of edges) {
        const sourceNode = currentNodes.find((x) => x.id === edge.source);
        const targetNode = currentNodes.find((x) => x.id === edge.target);

        if (!sourceNode || !targetNode) continue;
        if (sourceNode.x === undefined || sourceNode.y === undefined || targetNode.x === undefined || targetNode.y === undefined) continue;

        // Opacidade diminui se houver query e os nós não baterem com o filtro
        let opacity = 0.15 + edge.weight * 0.45;
        if (q && !sourceNode.label.toLowerCase().includes(q) && !targetNode.label.toLowerCase().includes(q)) {
          opacity = 0.04;
        }

        ctx.strokeStyle = `rgba(157, 124, 255, ${opacity})`;
        ctx.lineWidth = 1 + edge.weight * 3;
        ctx.beginPath();
        ctx.moveTo(sourceNode.x, sourceNode.y);
        ctx.lineTo(targetNode.x, targetNode.y);
        ctx.stroke();

        // Rótulo da relação (desenhado apenas se zoom for grande)
        if (zoom > 0.8 && !q) {
          const midX = (sourceNode.x + targetNode.x) / 2;
          const midY = (sourceNode.y + targetNode.y) / 2;
          ctx.fillStyle = "rgba(184, 184, 192, 0.4)";
          ctx.font = "8px 'Inter', sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(edge.relation, midX, midY - 4);
        }
      }

      // 2.C. Desenha os Nós (Nodes)
      for (const node of currentNodes) {
        if (node.x === undefined || node.y === undefined || node.radius === undefined) continue;

        const isHighlighted = q && node.label.toLowerCase().includes(q);
        const isSelected = selectedNode?.id === node.id;
        const isFaded = q && !isHighlighted;

        let nodeColor = "#a855f7"; // default violet
        if (node.type === 'entity') nodeColor = "#06b6d4";      // cyan
        if (node.type === 'error-pattern') nodeColor = "#ef4444"; // red
        if (node.type === 'tool-outcome') nodeColor = "#10b981";  // green

        ctx.save();

        // Efeito de brilho/glow
        ctx.shadowColor = nodeColor;
        ctx.shadowBlur = isSelected ? 18 : isHighlighted ? 12 : 6;

        // Radial gradient para dar efeito 3D esfereificado
        const grad = ctx.createRadialGradient(
          node.x - node.radius * 0.25,
          node.y - node.radius * 0.25,
          node.radius * 0.1,
          node.x,
          node.y,
          node.radius
        );
        grad.addColorStop(0, "#ffffff");
        grad.addColorStop(0.2, nodeColor);
        grad.addColorStop(1, "rgba(0, 0, 0, 0.85)");

        ctx.fillStyle = grad;
        ctx.globalAlpha = isFaded ? 0.25 : 1.0;
        
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fill();

        // Borda circular do nó
        ctx.strokeStyle = isSelected ? "#ffffff" : "rgba(255,255,255,0.15)";
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.stroke();

        ctx.restore();

        // Desenha Rótulo de Texto
        let showLabel = zoom > 0.6 || isSelected || isHighlighted;
        if (showLabel) {
          ctx.fillStyle = isSelected ? "#ffffff" : isHighlighted ? nodeColor : "#B8B8C0";
          ctx.font = isSelected ? "bold 11px 'Inter', sans-serif" : "10px 'Inter', sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(node.label, node.x, node.y + node.radius + 14);
        }
      }

      ctx.restore();

      // Solicita o próximo frame
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [nodes, edges, loading, repulsionForce, attractionForce, centerGravity, zoom, panX, panY, searchQuery, selectedNode]);

  // Filtro inteligente de nós no painel lateral
  const connectedEdges = useMemo(() => {
    if (!selectedNode) return [];
    return edges.filter(
      (e) => e.source === selectedNode.id || e.target === selectedNode.id
    );
  }, [selectedNode, edges]);

  const connectedNodes = useMemo(() => {
    if (!selectedNode) return [];
    return connectedEdges.map((e) => {
      const neighborId = e.source === selectedNode.id ? e.target : e.source;
      const neighbor = nodes.find((n) => n.id === neighborId);
      return {
        node: neighbor,
        relation: e.relation,
        weight: e.weight
      };
    }).filter((x) => x.node !== undefined) as Array<{ node: NodeData; relation: string; weight: number }>;
  }, [connectedEdges, selectedNode, nodes]);

  // EVENTOS MOUSE E GESTOS (Canvas interaction)
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Traduz coordenadas de tela para coordenadas virtuais (Canvas transform)
    const virtualX = (mouseX - canvas.width / 2 - panX) / zoom + canvas.width / 2;
    const virtualY = (mouseY - canvas.height / 2 - panY) / zoom + canvas.height / 2;

    // Verifica se colidiu com algum nó (clique sobre esfera)
    let clickedNode: NodeData | null = null;
    for (const node of nodes) {
      if (node.x === undefined || node.y === undefined || node.radius === undefined) continue;
      const dx = virtualX - node.x;
      const dy = virtualY - node.y;
      if (dx * dx + dy * dy < node.radius * node.radius) {
        clickedNode = node;
        break;
      }
    }

    if (clickedNode) {
      draggedNodeRef.current = clickedNode;
      setSelectedNode(clickedNode);
    } else {
      // Inicia Panning no fundo
      isPanningRef.current = true;
      startPanXRef.current = e.clientX - panX;
      startPanYRef.current = e.clientY - panY;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (draggedNodeRef.current) {
      // Movendo nó arrastado
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Converte para espaço virtual
      const virtualX = (mouseX - canvas.width / 2 - panX) / zoom + canvas.width / 2;
      const virtualY = (mouseY - canvas.height / 2 - panY) / zoom + canvas.height / 2;

      const draggedId = draggedNodeRef.current.id;
      setNodes((prevNodes) =>
        prevNodes.map((n) =>
          n.id === draggedId ? { ...n, x: virtualX, y: virtualY, vx: 0, vy: 0 } : n
        )
      );
    } else if (isPanningRef.current) {
      // Movendo a câmera virtual
      setPanX(e.clientX - startPanXRef.current);
      setPanY(e.clientY - startPanYRef.current);
    }
  };

  const handleMouseUp = () => {
    draggedNodeRef.current = null;
    isPanningRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomIntensity = 0.05;
    const scrollDelta = e.deltaY;
    
    setZoom((prevZoom) => {
      let nextZoom = prevZoom - scrollDelta * zoomIntensity * 0.01;
      nextZoom = Math.max(0.15, Math.min(4.0, nextZoom)); // limitador de escala
      return nextZoom;
    });
  };

  return (
    <div 
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "calc(100vh - 160px)",
        borderRadius: "16px",
        overflow: "hidden",
        background: "#09090b",
        border: "1px solid rgba(255,255,255,0.06)",
        fontFamily: "'Inter', sans-serif"
      }}
    >
      {/* Canvas principal */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          cursor: isPanningRef.current ? "grabbing" : "grab"
        }}
      />

      {/* Rótulo de instrução de navegação */}
      <div style={{
        position: "absolute",
        bottom: "16px",
        left: "16px",
        fontSize: "11px",
        color: "rgba(255,255,255,0.35)",
        display: "flex",
        alignItems: "center",
        gap: "4px",
        pointerEvents: "none"
      }}>
        <HelpCircle size={12} />
        Arraste nós para mover. Arraste o fundo para navegar. Use Scroll para zoom.
      </div>

      {/* Barra de Ferramentas Flutuante Superior Esquerda */}
      <div style={{
        position: "absolute",
        top: "16px",
        left: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        zIndex: 5
      }}>
        {/* Controle de Zoom */}
        <div style={{
          display: "flex",
          background: "rgba(18, 18, 24, 0.8)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "10px",
          padding: "4px",
          gap: "2px"
        }}>
          <button
            onClick={() => setZoom(z => Math.max(0.15, z - 0.1))}
            style={{ border: "none", background: "none", color: "#fff", cursor: "pointer", padding: "6px", borderRadius: "6px", display: "flex" }}
            title="Diminuir zoom"
          >
            <Minus size={14} />
          </button>
          <span style={{ fontSize: "11px", color: "var(--muted)", alignSelf: "center", minWidth: "32px", textAlign: "center" }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(z => Math.min(4.0, z + 0.1))}
            style={{ border: "none", background: "none", color: "#fff", cursor: "pointer", padding: "6px", borderRadius: "6px", display: "flex" }}
            title="Aumentar zoom"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Botão de reset de layout */}
        <button
          onClick={handleResetLayout}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            background: "rgba(18, 18, 24, 0.8)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "#fff",
            borderRadius: "10px",
            padding: "8px 12px",
            fontSize: "12px",
            cursor: "pointer",
            transition: "all 0.2s"
          }}
          title="Recentralizar e simular layout circular"
        >
          <RotateCcw size={13} />
          Recentralizar
        </button>

        {/* Botão para abrir configuração de forças */}
        <button
          onClick={() => setShowConfig(!showConfig)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            background: showConfig ? "rgba(157, 124, 255, 0.15)" : "rgba(18, 18, 24, 0.8)",
            backdropFilter: "blur(8px)",
            border: showConfig ? "1px solid rgba(157, 124, 255, 0.3)" : "1px solid rgba(255,255,255,0.08)",
            color: showConfig ? "#9D7CFF" : "#fff",
            borderRadius: "10px",
            padding: "8px 12px",
            fontSize: "12px",
            cursor: "pointer",
            transition: "all 0.2s"
          }}
        >
          <Sliders size={13} />
          Simulação
        </button>
      </div>

      {/* Caixa de Ajustes Físicos da Simulação */}
      {showConfig && (
        <div style={{
          position: "absolute",
          top: "120px",
          left: "16px",
          width: "220px",
          background: "rgba(18, 18, 24, 0.9)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "12px",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          zIndex: 5
        }}>
          <h4 style={{ margin: 0, fontSize: "12px", color: "#fff", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "6px" }}>Físicas do Córtex</h4>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--muted)" }}>
              <span>Repulsão</span>
              <span>{repulsionForce}</span>
            </div>
            <input 
              type="range" 
              min="100" 
              max="1500" 
              value={repulsionForce}
              onChange={(e) => setRepulsionForce(Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--muted)" }}>
              <span>Atração (Mola)</span>
              <span>{attractionForce.toFixed(3)}</span>
            </div>
            <input 
              type="range" 
              min="0.005" 
              max="0.1" 
              step="0.005"
              value={attractionForce}
              onChange={(e) => setAttractionForce(Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--muted)" }}>
              <span>Gravidade Central</span>
              <span>{centerGravity.toFixed(3)}</span>
            </div>
            <input 
              type="range" 
              min="0.005" 
              max="0.1" 
              step="0.005"
              value={centerGravity}
              onChange={(e) => setCenterGravity(Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </div>
        </div>
      )}

      {/* Barra de pesquisa superior direita */}
      <div style={{
        position: "absolute",
        top: "16px",
        right: "16px",
        width: "280px",
        display: "flex",
        background: "rgba(18, 18, 24, 0.8)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "10px",
        padding: "4px 8px",
        alignItems: "center",
        gap: "6px",
        zIndex: 5
      }}>
        <Search size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Buscar no Córtex..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            background: "none",
            border: "none",
            color: "#fff",
            fontSize: "12px",
            width: "100%",
            outline: "none"
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            style={{ border: "none", background: "none", color: "var(--muted)", cursor: "pointer", display: "flex", padding: 2 }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Legenda inferior direita */}
      <div style={{
        position: "absolute",
        bottom: "16px",
        right: "16px",
        background: "rgba(18, 18, 24, 0.8)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "10px",
        padding: "10px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        pointerEvents: "none"
      }}>
        <div style={{ fontSize: "10px", fontWeight: "bold", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "2px" }}>Estrutura Cognitiva</div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#8b5cf6" }} />
          <span>Conceito</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#06b6d4" }} />
          <span>Entidade / Modelo</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981" }} />
          <span>Sucesso</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ef4444" }} />
          <span>Assinatura de Erro</span>
        </div>
      </div>

      {/* PAINEL LATERAL DE DETALHES DO NÓ SELECIONADO (Obsidian style) */}
      {selectedNode && (
        <div style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: "360px",
          background: "rgba(18, 18, 24, 0.85)",
          backdropFilter: "blur(16px)",
          borderLeft: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "-10px 0 25px rgba(0,0,0,0.5)",
          zIndex: 10,
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          color: "#fff",
          overflowY: "auto"
        }}>
          {/* Header do painel */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {selectedNode.type === 'concept' && <Brain size={18} className="text-[#a855f7]" />}
              {selectedNode.type === 'entity' && <Layers size={18} className="text-[#06b6d4]" />}
              {selectedNode.type === 'tool-outcome' && <Award size={18} className="text-[#10b981]" />}
              {selectedNode.type === 'error-pattern' && <AlertTriangle size={18} className="text-[#ef4444]" />}
              <span style={{ 
                fontSize: "10px", 
                textTransform: "uppercase", 
                color: "var(--muted)", 
                fontWeight: "bold",
                letterSpacing: "0.05em"
              }}>
                {selectedNode.type === 'concept' && 'Conceito'}
                {selectedNode.type === 'entity' && 'Entidade/Modelo'}
                {selectedNode.type === 'tool-outcome' && 'Sucesso'}
                {selectedNode.type === 'error-pattern' && 'Falha'}
              </span>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              style={{
                background: "none",
                border: "none",
                color: "var(--muted)",
                cursor: "pointer",
                padding: "4px",
                display: "flex",
                borderRadius: "50%",
                transition: "background 0.2s"
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "none"}
            >
              <X size={16} />
            </button>
          </div>

          <div>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "1.25rem", fontWeight: 800 }}>{selectedNode.label}</h3>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)", lineHeight: 1.5 }}>
              {selectedNode.description || "Nenhuma descrição disponível para este conceito."}
            </p>
          </div>

          {/* Métricas e Confiança */}
          <div style={{
            background: "rgba(255,255,255,0.03)",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.06)",
            padding: "14px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px"
          }}>
            <div>
              <div style={{ fontSize: "10px", color: "var(--muted)", display: "flex", alignItems: "center", gap: 3 }}>
                <Activity size={10} />
                CONFIANÇA
              </div>
              <div style={{ fontSize: "16px", fontWeight: "bold", marginTop: "2px", color: selectedNode.confidenceScore >= 0.7 ? "#10b981" : "#ef4444" }}>
                {Math.round(selectedNode.confidenceScore * 100)}%
              </div>
            </div>
            <div>
              <div style={{ fontSize: "10px", color: "var(--muted)" }}>OBSERVADO EM</div>
              <div style={{ fontSize: "11px", fontWeight: "medium", marginTop: "4px", color: "#fff" }}>
                {new Date(selectedNode.lastObserved).toLocaleDateString("pt-BR")}
              </div>
            </div>
          </div>

          {/* Nós Conectados */}
          <div>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", textTransform: "uppercase", color: "var(--muted)", letterSpacing: "0.05em" }}>Relações no Córtex</h4>
            {connectedNodes.length === 0 ? (
              <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>Conceito isolado sem relacionamentos ativos.</span>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {connectedNodes.map((neighbor, idx) => {
                  let badgeBg = "rgba(168, 85, 247, 0.1)";
                  let badgeBorder = "rgba(168, 85, 247, 0.2)";
                  let badgeText = "#a855f7";

                  if (neighbor.node.type === 'entity') {
                    badgeBg = "rgba(6, 182, 212, 0.1)";
                    badgeBorder = "rgba(6, 182, 212, 0.2)";
                    badgeText = "#06b6d4";
                  } else if (neighbor.node.type === 'error-pattern') {
                    badgeBg = "rgba(239, 68, 68, 0.1)";
                    badgeBorder = "rgba(239, 68, 68, 0.2)";
                    badgeText = "#ef4444";
                  } else if (neighbor.node.type === 'tool-outcome') {
                    badgeBg = "rgba(16, 185, 129, 0.1)";
                    badgeBorder = "rgba(16, 185, 129, 0.2)";
                    badgeText = "#10b981";
                  }

                  return (
                    <div 
                      key={idx}
                      onClick={() => setSelectedNode(neighbor.node)}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(255,255,255,0.04)",
                        borderRadius: "8px",
                        padding: "8px 12px",
                        cursor: "pointer",
                        transition: "all 0.2s"
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                        e.currentTarget.style.borderColor = badgeBorder;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                        e.currentTarget.style.borderColor = "rgba(255,255,255,0.04)";
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <span style={{ fontSize: "12px", fontWeight: "bold" }}>{neighbor.node.label}</span>
                        <span style={{ fontSize: "10px", color: "var(--muted)" }}>{neighbor.relation}</span>
                      </div>
                      <span style={{
                        fontSize: "9px",
                        fontWeight: "bold",
                        background: badgeBg,
                        border: `1px solid ${badgeBorder}`,
                        color: badgeText,
                        padding: "2px 6px",
                        borderRadius: "4px"
                      }}>
                        {neighbor.node.type === 'concept' && 'Conceito'}
                        {neighbor.node.type === 'entity' && 'Entidade'}
                        {neighbor.node.type === 'error-pattern' && 'Falha'}
                        {neighbor.node.type === 'tool-outcome' && 'Sucesso'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          
          {/* Metadata Extra */}
          {selectedNode.metadata && Object.keys(selectedNode.metadata).length > 0 && (
            <div>
              <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", textTransform: "uppercase", color: "var(--muted)", letterSpacing: "0.05em" }}>Metadados Operacionais</h4>
              <div style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                background: "rgba(255,255,255,0.02)",
                borderRadius: "8px",
                padding: "10px"
              }}>
                {Object.entries(selectedNode.metadata).map(([key, val]) => (
                  <div key={key} style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", paddingBottom: "4px", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                    <span style={{ color: "var(--muted)", textTransform: "capitalize" }}>{key.replace(/([A-Z])/g, ' $1')}</span>
                    <span style={{ color: "#fff", fontWeight: "bold", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={String(val)}>
                      {String(val)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
