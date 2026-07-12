"use client";

import { Heart } from "lucide-react";

interface ScoreCardProps {
  score: number;
  maxScore?: number;
  title: string;
  topic: string;
  bullets: string[];
  likes: number;
}

export function ScoreCard({
  score,
  maxScore = 100,
  title,
  topic,
  bullets,
  likes,
}: ScoreCardProps) {
  // Speedometer circular path variables
  const percentage = (score / maxScore) * 100;
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="bg-[var(--bg-soft)] border border-[var(--line)] rounded-lg overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)] p-4 flex flex-col justify-between hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] transition-all duration-150 ease-in-out h-full">
      <div>
        {/* Top score section */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <span className="text-[10px] font-mono text-[var(--muted)] uppercase tracking-wide">
              {title}
            </span>
            <div className="flex items-baseline mt-1">
              <span className="text-3xl font-extrabold tracking-tight text-[var(--text)]">
                {score}
              </span>
              <span className="text-sm font-medium text-[var(--muted)] ml-0.5">
                /{maxScore}
              </span>
            </div>
          </div>

          {/* Speedometer Gauge */}
          <div className="relative w-14 h-14 flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 60 60">
              {/* Background circle */}
              <circle
                cx="30"
                cy="30"
                r={radius}
                className="stroke-zinc-100 dark:stroke-zinc-800"
                strokeWidth="4"
                fill="transparent"
              />
              {/* Foreground progress circle */}
              <circle
                cx="30"
                cy="30"
                r={radius}
                className="stroke-zinc-950 dark:stroke-white"
                strokeWidth="4.5"
                fill="transparent"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
              />
            </svg>
            {/* Speedometer needle representation or center text */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100"></div>
            </div>
          </div>
        </div>

        {/* Bullet analysis section */}
        <div className="border-t border-[var(--line)] pt-3.5 mb-3">
          <h4 className="text-[12px] font-bold uppercase tracking-wide text-[var(--text)] mb-2">
            {topic}
          </h4>
          <ul className="space-y-1">
            {bullets.map((bullet, idx) => (
              <li
                key={idx}
                className="text-[11px] text-[var(--muted)] flex items-start gap-1.5 leading-relaxed"
              >
                <span className="text-zinc-400 select-none">•</span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-between items-center pt-2 border-t border-[var(--line)] mt-auto text-zinc-400">
        <div className="flex items-center gap-1.5 text-[11px] font-mono hover:text-red-500 transition-colors duration-150 cursor-pointer">
          <Heart size={12} className="fill-current text-red-500" />
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">{likes}</span>
        </div>

        {/* TikTok Watermark SVG */}
        <svg
          className="w-3.5 h-3.5 fill-current hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors duration-150"
          viewBox="0 0 24 24"
        >
          <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.02 1.59 4.23.99 1.13 2.37 1.93 3.86 2.22.01 1.25.01 2.5.01 3.75-.76-.08-1.52-.3-2.24-.62-.97-.43-1.83-1.07-2.5-1.89-.01 2.36-.01 4.72-.01 7.08-.12 2.44-1.37 4.79-3.4 6.13-2.12 1.48-5.06 1.76-7.39.73-2.4-1.02-4.04-3.54-4.03-6.17.02-2.82 2.03-5.46 4.81-6.04.83-.17 1.69-.19 2.52-.06v3.91c-.55-.07-1.12-.04-1.65.13-1.04.33-1.83 1.26-1.95 2.36-.18 1.48.88 2.87 2.37 3.05 1.47.16 2.88-.81 3.09-2.29.05-.33.05-.67.05-1.01V0h-2.52Z" />
        </svg>
      </div>
    </div>
  );
}
