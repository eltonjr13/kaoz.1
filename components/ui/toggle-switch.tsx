"use client";

import { type ReactNode, useId } from "react";
import { InfoTooltip } from "./info-tooltip";

export interface ToggleSwitchProps {
  /** Checked state */
  checked: boolean;
  /** Callback on toggle */
  onChange: (checked: boolean) => void;
  /** Primary label text or ReactNode */
  label?: ReactNode;
  /** Optional secondary helper / tooltip text (automatically renders InfoTooltip) */
  tooltip?: ReactNode;
  /** Optional description text displayed beneath the label */
  description?: ReactNode;
  /** Disabled state */
  disabled?: boolean;
  /** Position of the switch relative to the label ("left" or "right") - defaults to "left" */
  switchPosition?: "left" | "right";
  /** Size variant */
  size?: "sm" | "md";
  /** Optional custom container class */
  className?: string;
  /** Accessible label when no text label is provided */
  ariaLabel?: string;
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
  tooltip,
  description,
  disabled = false,
  switchPosition = "left",
  size = "sm",
  className = "",
  ariaLabel,
}: ToggleSwitchProps) {
  const id = useId();

  const handleToggle = () => {
    if (!disabled) {
      onChange(!checked);
    }
  };

  const isSmall = size === "sm";

  // Sharp, clean dimensions without blur
  const pillClass = isSmall ? "w-7 h-4" : "w-9 h-5";
  const knobClass = isSmall ? "h-3 w-3" : "h-4 w-4";
  const knobTranslate = isSmall ? "translate-x-3.5" : "translate-x-4.5";

  const switchButton = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={label ? id : undefined}
      aria-label={typeof label === "string" ? label : ariaLabel || "Alternar opção"}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        handleToggle();
      }}
      className={`relative inline-flex ${pillClass} shrink-0 cursor-pointer items-center rounded-full transition-colors duration-150 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C6CF2] focus-visible:ring-offset-1 focus-visible:ring-offset-[#090A0D] disabled:cursor-not-allowed disabled:opacity-40 ${
        checked
          ? "bg-[#7C6CF2] border border-[#8E7EF4]"
          : "bg-[#20242D] border border-white/15 hover:bg-[#2A2F3B] hover:border-white/25"
      }`}
    >
      <span
        className={`pointer-events-none inline-block ${knobClass} transform rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.35)] transition-transform duration-150 ease-in-out ${
          checked ? knobTranslate : "translate-x-0.5"
        }`}
      />
    </button>
  );

  if (!label && !description) {
    return switchButton;
  }

  if (switchPosition === "right") {
    return (
      <div
        onClick={handleToggle}
        className={`flex cursor-pointer items-center justify-between gap-3 rounded-[6px] px-2 py-1.5 text-[#D5D8E0] transition-colors hover:bg-white/[0.04] select-none ${
          disabled ? "opacity-40 pointer-events-none" : ""
        } ${className}`}
      >
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span id={id} className="text-[11px] font-semibold text-zinc-100 truncate">
              {label}
            </span>
            {tooltip && <InfoTooltip text={tooltip} />}
          </div>
          {description && (
            <span className="text-[10px] text-zinc-400 leading-tight mt-0.5">
              {description}
            </span>
          )}
        </div>
        <div className="shrink-0 flex items-center">
          {switchButton}
        </div>
      </div>
    );
  }

  // Default: Left-aligned switch (like a modern checkbox switch)
  return (
    <div
      onClick={handleToggle}
      className={`inline-flex w-full cursor-pointer items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-[#D5D8E0] transition-colors hover:bg-white/[0.04] select-none ${
        disabled ? "opacity-40 pointer-events-none" : ""
      } ${className}`}
    >
      <div className="shrink-0 flex items-center">
        {switchButton}
      </div>
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span id={id} className="text-[11px] font-semibold text-zinc-100">
            {label}
          </span>
          {tooltip && <InfoTooltip text={tooltip} />}
        </div>
        {description && (
          <span className="text-[10px] text-zinc-400 leading-tight mt-0.5">
            {description}
          </span>
        )}
      </div>
    </div>
  );
}

export default ToggleSwitch;
