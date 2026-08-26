"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { Info, HelpCircle } from "lucide-react";

interface InfoTooltipProps {
  /** The descriptive text or element to display inside the tooltip */
  text: ReactNode;
  /** Custom icon type: 'info' (default) or 'help' */
  variant?: "info" | "help";
  /** Icon size in pixels (default: 12) */
  size?: number;
  /** Custom CSS classes for the container/trigger */
  className?: string;
  /** Custom CSS classes for the tooltip popover */
  tooltipClassName?: string;
  /** Preferred placement: 'top' | 'bottom' | 'left' | 'right' (default: 'top') */
  placement?: "top" | "bottom" | "left" | "right";
  /** If provided, renders custom trigger instead of default icon */
  children?: ReactNode;
}

export function InfoTooltip({
  text,
  variant = "info",
  size = 12,
  className = "",
  tooltipClassName = "",
  placement = "top",
  children,
}: InfoTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const calculatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const gap = 6;

    let top = 0;
    let left = 0;

    switch (placement) {
      case "bottom":
        top = rect.bottom + gap;
        left = rect.left + rect.width / 2;
        break;
      case "left":
        top = rect.top + rect.height / 2;
        left = rect.left - gap;
        break;
      case "right":
        top = rect.top + rect.height / 2;
        left = rect.right + gap;
        break;
      case "top":
      default:
        top = rect.top - gap;
        left = rect.left + rect.width / 2;
        break;
    }

    setCoords({ top, left });
  };

  useEffect(() => {
    if (isOpen) {
      calculatePosition();
      const handleScrollOrResize = () => calculatePosition();
      window.addEventListener("scroll", handleScrollOrResize, true);
      window.addEventListener("resize", handleScrollOrResize);
      return () => {
        window.removeEventListener("scroll", handleScrollOrResize, true);
        window.removeEventListener("resize", handleScrollOrResize);
      };
    }
  }, [isOpen, placement]);

  const IconComponent = variant === "help" ? HelpCircle : Info;

  return (
    <span
      ref={triggerRef}
      className={`inline-flex items-center align-middle relative ${className}`}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      onFocus={() => setIsOpen(true)}
      onBlur={() => setIsOpen(false)}
      tabIndex={0}
      role="button"
      aria-label={typeof text === "string" ? text : "Informações adicionais"}
    >
      {children || (
        <span className="inline-flex cursor-help items-center justify-center text-[#8B92A1] hover:text-[#A99FFF] transition-colors duration-150 p-0.5 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-[#7C6CF2]">
          <IconComponent size={size} strokeWidth={2} />
        </span>
      )}

      {isOpen && coords && (
        <span
          role="tooltip"
          className={`fixed z-[9999] pointer-events-none rounded-lg border border-[#383D49]/70 bg-[#13161C]/95 px-3 py-2 text-[11px] font-normal leading-relaxed text-[#D5D8E0] shadow-2xl backdrop-blur-md max-w-[260px] sm:max-w-xs transition-opacity duration-150 ${
            placement === "bottom"
              ? "-translate-x-1/2"
              : placement === "left"
              ? "-translate-y-1/2 -translate-x-full"
              : placement === "right"
              ? "-translate-y-1/2"
              : "-translate-x-1/2 -translate-y-full"
          } ${tooltipClassName}`}
          style={{
            top: `${coords.top}px`,
            left: `${coords.left}px`,
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

export default InfoTooltip;
