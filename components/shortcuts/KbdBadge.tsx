"use client";

import React from "react";

interface KbdBadgeProps {
  keys: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function KbdBadge({ keys, size = "sm", className = "" }: KbdBadgeProps) {
  const sizeClasses = {
    sm: "px-1.5 py-0.5 text-[10px] min-w-[18px]",
    md: "px-2 py-0.5 text-xs min-w-[22px]",
    lg: "px-2.5 py-1 text-sm min-w-[26px]",
  };

  const keyParts = keys.split(/(\+|\s\+\s)/).filter(p => p.trim() !== "" && p.trim() !== "+");

  return (
    <span className={`inline-flex items-center gap-1 font-mono select-none ${className}`}>
      {keyParts.map((part, index) => (
        <kbd
          key={index}
          className={`inline-flex items-center justify-center font-semibold rounded-[4px] border border-white/10 bg-white/[0.06] text-white/70 shadow-[inset_0_-1px_0_rgba(255,255,255,0.1)] leading-none ${sizeClasses[size]}`}
        >
          {part.trim()}
        </kbd>
      ))}
    </span>
  );
}
