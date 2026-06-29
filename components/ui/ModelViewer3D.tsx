/* eslint-disable complexity */
"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  RotateCcw,
  Play,
  Pause,
  Maximize2,
  Minimize2,
  Download,
  Loader2,
  X,
  Box
} from "lucide-react";

interface ModelViewer3DProps {
  src: string;
  alt?: string;
  title?: string;
}

export default function ModelViewer3D({ src, alt = "Objeto 3D", title }: ModelViewer3DProps) {
  const viewerRef = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const fullscreenViewerRef = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  // Load model-viewer script from CDN client-side
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (customElements.get("model-viewer")) {
        setTimeout(() => setScriptLoaded(true), 0);
        return;
      }

      const script = document.createElement("script");
      script.type = "module";
      script.src = "https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js";
      script.onload = () => {
        setTimeout(() => setScriptLoaded(true), 0);
      };
      document.head.appendChild(script);
    }
  }, []);

  // Monitor loading events on the custom element
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const handleLoad = () => {
      setIsLoading(false);
    };

    const handleError = () => {
      setIsLoading(false);
    };

    viewer.addEventListener("load", handleLoad);
    viewer.addEventListener("error", handleError);

    return () => {
      viewer.removeEventListener("load", handleLoad);
      viewer.removeEventListener("error", handleError);
    };
  }, [scriptLoaded]);

  const handleResetCamera = () => {
    const activeViewer = isFullscreen ? fullscreenViewerRef.current : viewerRef.current;
    if (activeViewer) {
      activeViewer.cameraOrbit = "0deg 75deg auto";
      activeViewer.cameraTarget = "auto auto auto";
      activeViewer.fieldOfView = "auto";
    }
  };

  const handleToggleAutoRotate = () => {
    setAutoRotate((prev) => !prev);
  };

  const handleToggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
  };

  const mouseDownCoords = useRef({ x: 0, y: 0 });
  const mouseDownTime = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    mouseDownCoords.current = { x: e.clientX, y: e.clientY };
    mouseDownTime.current = Date.now();
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const dragDistance = Math.sqrt(
      Math.pow(e.clientX - mouseDownCoords.current.x, 2) +
      Math.pow(e.clientY - mouseDownCoords.current.y, 2)
    );
    const clickDuration = Date.now() - mouseDownTime.current;

    if (dragDistance < 5 && clickDuration < 250) {
      const target = e.target as HTMLElement;
      if (!target.closest(".controls-bar")) {
        setIsFullscreen(true);
      }
    }
  };

  const renderViewerElement = (ref: typeof viewerRef) => scriptLoaded ? (
    <model-viewer
      ref={ref}
      src={src}
      alt={alt}
      camera-controls
      auto-rotate={autoRotate ? "" : undefined}
      auto-rotate-delay="0"
      rotation-per-second="10deg"
      camera-orbit="0deg 75deg auto"
      shadow-intensity="1"
      exposure="1"
      interaction-prompt="auto"
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "transparent",
        "--poster-color": "transparent"
      } as React.CSSProperties}
    />
  ) : null;

  return (
    <>
      {/* Standard Embed View */}
      <div
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        className="relative group w-full rounded-2xl overflow-hidden border border-white/10 bg-[#0a0a0f]/90 aspect-square flex flex-col items-center justify-center cursor-pointer"
      >
        {/* Title Tag */}
        {title && (
          <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/60 border border-white/5 text-[10px] font-semibold text-white/80 backdrop-blur-sm">
            <Box size={10} className="text-[#9D7CFF]" />
            {title}
          </div>
        )}

        {/* Hover Expand Overlay */}
        {scriptLoaded && !isLoading && (
          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center pointer-events-none z-10">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/70 border border-white/10 text-white/90 text-[10px] font-semibold backdrop-blur-md shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-all duration-300">
              <Maximize2 size={11} className="text-[#9D7CFF]" />
              <span>Clique para expandir</span>
            </div>
          </div>
        )}

        {/* Loading Spinner */}
        {(isLoading || !scriptLoaded) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-20 gap-2 backdrop-blur-sm transition-all duration-300">
            <Loader2 className="w-8 h-8 text-[#9D7CFF] animate-spin" />
            <span className="text-[11px] font-medium text-white/80">Carregando objeto 3D...</span>
          </div>
        )}

        {/* 3D Canvas */}
        <div className="w-full h-full flex-1">
          {renderViewerElement(viewerRef)}
        </div>

        {/* Floating Controls Bar */}
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="controls-bar absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/75 backdrop-blur-md border border-white/10 shadow-lg opacity-90 group-hover:opacity-100 transition-opacity duration-300"
        >
          <button
            type="button"
            onClick={handleToggleAutoRotate}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              autoRotate ? "text-[#9D7CFF] hover:bg-[#9D7CFF]/15" : "text-white/60 hover:bg-white/10"
            }`}
            title={autoRotate ? "Pausar rotação" : "Iniciar rotação"}
          >
            {autoRotate ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button
            type="button"
            onClick={handleResetCamera}
            className="p-1.5 rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
            title="Resetar câmera"
          >
            <RotateCcw size={13} />
          </button>
          <button
            type="button"
            onClick={handleToggleFullscreen}
            className="p-1.5 rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
            title="Ver em tela cheia"
          >
            <Maximize2 size={13} />
          </button>
          <div className="h-4 w-px bg-white/10" />
          <a
            href={`${src}${src.includes("?") ? "&" : "?"}download=true`}
            download
            className="p-1.5 rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
            title="Baixar GLB"
          >
            <Download size={13} />
          </a>
        </div>
      </div>

      {/* Fullscreen Inspect Modal */}
      {isFullscreen && mounted && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 backdrop-blur-md p-4 animate-in fade-in duration-200">
          {/* Close Area / Esc Key Fallback */}
          <button
            type="button"
            onClick={handleToggleFullscreen}
            className="absolute top-5 right-5 z-50 p-2.5 rounded-full bg-white/5 border border-white/10 text-white/70 hover:bg-white/15 hover:text-white transition-all cursor-pointer shadow-lg hover:scale-105"
            title="Fechar"
          >
            <X size={20} />
          </button>

          {/* Centered Large 3D Viewport */}
          <div className="relative w-full max-w-4xl h-[80vh] rounded-3xl border border-white/10 bg-[#07070a]/50 flex items-center justify-center overflow-hidden">
            {/* Model Title */}
            <div className="absolute top-5 left-5 z-10 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/50 border border-white/5 text-xs font-semibold text-white/90 backdrop-blur-md">
              <Box size={14} className="text-[#9D7CFF]" />
              {title || "Visualização do Objeto 3D"}
            </div>

            {/* Load indicator in fullscreen */}
            {isLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 z-20 gap-2">
                <Loader2 className="w-10 h-10 text-[#9D7CFF] animate-spin" />
                <span className="text-xs font-medium text-white/80">Carregando detalhes...</span>
              </div>
            )}

            {/* Large 3D Element */}
            <div className="w-full h-full">
              {renderViewerElement(fullscreenViewerRef)}
            </div>

            {/* Fullscreen controls */}
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2.5 px-4 py-2 rounded-2xl bg-black/80 backdrop-blur-md border border-white/10 shadow-2xl">
              <button
                type="button"
                onClick={handleToggleAutoRotate}
                className={`p-2 rounded-xl transition-all cursor-pointer ${
                  autoRotate ? "text-[#9D7CFF] bg-[#9D7CFF]/10 hover:bg-[#9D7CFF]/20" : "text-white/70 hover:bg-white/10"
                }`}
                title={autoRotate ? "Pausar rotação" : "Iniciar rotação"}
              >
                {autoRotate ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <button
                type="button"
                onClick={handleResetCamera}
                className="p-2 rounded-xl text-white/70 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
                title="Resetar câmera"
              >
                <RotateCcw size={15} />
              </button>
              <button
                type="button"
                onClick={handleToggleFullscreen}
                className="p-2 rounded-xl text-[#9D7CFF] bg-[#9D7CFF]/10 hover:bg-[#9D7CFF]/20 transition-all cursor-pointer"
                title="Fechar tela cheia"
              >
                <Minimize2 size={15} />
              </button>
              <div className="h-6 w-px bg-white/10" />
              <a
                href={`${src}${src.includes("?") ? "&" : "?"}download=true`}
                download
                className="p-2 rounded-xl text-white/70 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
                title="Baixar arquivo GLB"
              >
                <Download size={15} />
              </a>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
