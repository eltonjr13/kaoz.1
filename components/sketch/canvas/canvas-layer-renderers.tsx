"use client";

import React from 'react';
import type { ImageLayer, ShapeLayer, TextLayer } from '@/types/sketch';

export function ImageOverlay({
  layer,
  isCleanPreview,
  onSelect,
}: {
  layer: ImageLayer;
  isCleanPreview: boolean;
  onSelect: () => void;
}) {
  const isGuide = Boolean(layer.isGuide || layer.elementKind === 'guide' || layer.elementKind === 'annotation');
  if (isCleanPreview && isGuide) return null;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className="absolute pointer-events-auto"
      style={{
        left: `${layer.x}%`,
        top: `${layer.y}%`,
        width: `${layer.width}%`,
        height: `${layer.height}%`,
        opacity: layer.opacity,
        transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
        transformOrigin: 'center center',
      }}
    >
      <img
        src={layer.imageUrl}
        alt={layer.name}
        className="h-full w-full object-contain pointer-events-none select-none"
      />
    </div>
  );
}

export function TextOverlay({
  layer,
  isCleanPreview,
  onSelect,
}: {
  layer: TextLayer;
  isCleanPreview: boolean;
  onSelect: () => void;
}) {
  const isGuide = Boolean(layer.isGuide || layer.elementKind === 'guide' || layer.elementKind === 'annotation');
  if (isCleanPreview && isGuide) return null;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className="absolute pointer-events-auto whitespace-pre-line select-none"
      style={{
        left: `${layer.x}%`,
        top: `${layer.y}%`,
        width: `${layer.width}%`,
        opacity: layer.opacity,
        color: layer.color,
        fontSize: `calc(${layer.fontSize}px * 0.45)`,
        fontFamily: layer.fontFamily,
        fontWeight: layer.fontWeight,
        textAlign: layer.textAlign,
        backgroundColor: layer.backgroundColor || 'transparent',
        padding: layer.backgroundPadding ? `calc(${layer.backgroundPadding}px * 0.45)` : undefined,
        borderRadius: layer.borderRadius ? `${layer.borderRadius}px` : undefined,
        textTransform: layer.textTransform,
        lineHeight: 1.25,
        transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
        transformOrigin: 'center center',
      }}
    >
      {layer.text}
    </div>
  );
}

function SvgLineShape({ layer, strokeW }: { layer: ShapeLayer; strokeW: number }) {
  const isHoriz = layer.rotation !== undefined || layer.height <= 8;
  const y1 = isHoriz ? '50%' : '2%';
  const y2 = isHoriz ? '50%' : '98%';
  return <line x1="2%" y1={y1} x2="98%" y2={y2} stroke={layer.strokeColor} strokeWidth={strokeW} />;
}

function SvgArrowShape({ layer, strokeW, markerId }: { layer: ShapeLayer; strokeW: number; markerId: string }) {
  const isHoriz = layer.rotation !== undefined || layer.height <= 8;
  const y1 = isHoriz ? '50%' : '4%';
  const y2 = isHoriz ? '50%' : '94%';
  return (
    <line
      x1="2%"
      y1={y1}
      x2="92%"
      y2={y2}
      stroke={layer.strokeColor}
      strokeWidth={strokeW}
      markerEnd={`url(#${markerId})`}
    />
  );
}

function SvgCircleShape({ layer, strokeW, fill }: { layer: ShapeLayer; strokeW: number; fill: string }) {
  return (
    <ellipse
      cx="50%"
      cy="50%"
      rx="48%"
      ry="48%"
      fill={fill}
      stroke={layer.strokeColor}
      strokeWidth={strokeW}
    />
  );
}

function SvgRectShape({ layer, strokeW, fill }: { layer: ShapeLayer; strokeW: number; fill: string }) {
  return (
    <rect
      x="1%"
      y="1%"
      width="98%"
      height="98%"
      fill={fill}
      stroke={layer.strokeColor}
      strokeWidth={strokeW}
      rx={4}
    />
  );
}

function SvgShapeContent({
  layer,
  markerId,
}: {
  layer: ShapeLayer;
  markerId: string;
}) {
  const strokeW = Math.max(1, layer.strokeWidth * 0.5);
  const fill = layer.fillColor || 'transparent';

  if (layer.shapeType === 'circle') {
    return <SvgCircleShape layer={layer} strokeW={strokeW} fill={fill} />;
  }
  if (layer.shapeType === 'line') {
    return <SvgLineShape layer={layer} strokeW={strokeW} />;
  }
  if (layer.shapeType === 'arrow') {
    return <SvgArrowShape layer={layer} strokeW={strokeW} markerId={markerId} />;
  }
  return <SvgRectShape layer={layer} strokeW={strokeW} fill={fill} />;
}

export function ShapeOverlay({
  layer,
  isCleanPreview,
  onSelect,
}: {
  layer: ShapeLayer;
  isCleanPreview: boolean;
  onSelect: () => void;
}) {
  const isGuide = Boolean(layer.isGuide || layer.elementKind === 'guide' || layer.elementKind === 'annotation');
  if (isCleanPreview && isGuide) return null;

  const markerId = `arrow-head-${layer.id}`;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className="absolute pointer-events-auto select-none"
      style={{
        left: `${layer.x}%`,
        top: `${layer.y}%`,
        width: `${layer.width}%`,
        height: `${layer.height}%`,
        opacity: layer.opacity,
        transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
        transformOrigin: 'center center',
      }}
    >
      <svg className="h-full w-full overflow-visible pointer-events-none">
        {layer.shapeType === 'arrow' && (
          <defs>
            <marker
              id={markerId}
              markerWidth="10"
              markerHeight="10"
              refX="6"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L0,6 L9,3 z" fill={layer.strokeColor} />
            </marker>
          </defs>
        )}
        <SvgShapeContent layer={layer} markerId={markerId} />
      </svg>
    </div>
  );
}
