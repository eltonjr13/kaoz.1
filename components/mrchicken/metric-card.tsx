"use client";

import { Heart, MoreHorizontal } from "lucide-react";

interface MetricCardProps {
  title: string;
  description: string;
  chips?: string[];
  linkText?: string;
  likes?: number;
  showMore?: boolean;
}

export function MetricCard({
  title,
  description,
  chips = [],
  linkText,
  likes,
  showMore = true,
}: MetricCardProps) {
  return (
    <div className="bg-[var(--bg-soft)] border border-[var(--line)] rounded-lg overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)] p-4 flex flex-col justify-between hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] transition-all duration-150 ease-in-out h-full min-h-[140px]">
      <div>
        {/* Header */}
        <div className="flex justify-between items-start mb-2">
          <span className="text-[10px] font-mono text-[var(--muted)] uppercase tracking-wide">
            {title}
          </span>
          {showMore && (
            <button className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 p-0.5 rounded transition-colors duration-150">
              <MoreHorizontal size={14} />
            </button>
          )}
        </div>

        {/* Description */}
        <p className="text-[12px] font-medium text-[var(--text)] leading-relaxed mb-3">
          {description}
        </p>

        {/* Chips */}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {chips.map((chip, idx) => (
              <span
                key={idx}
                className={`text-[9px] font-mono px-2 py-0.5 rounded border ${
                  idx === 0
                    ? "bg-zinc-950 text-white border-zinc-950 dark:bg-white dark:text-black dark:border-white"
                    : "bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-800 dark:hover:bg-zinc-800"
                } transition-colors duration-150`}
              >
                {chip}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Footer / Extra link */}
      {(linkText || likes !== undefined) && (
        <div className="flex justify-between items-center pt-2.5 border-t border-[var(--line)] mt-auto text-zinc-400 text-[10px]">
          {linkText ? (
            <a
              href="#"
              className="text-[10px] font-mono font-semibold text-[var(--text)] hover:underline flex items-center gap-0.5"
            >
              {linkText}
            </a>
          ) : (
            <div></div>
          )}

          {likes !== undefined && (
            <div className="flex items-center gap-1 font-mono text-red-500 hover:opacity-80 transition-opacity duration-150 cursor-pointer">
              <Heart size={11} className="fill-current text-red-500" />
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">{likes}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
