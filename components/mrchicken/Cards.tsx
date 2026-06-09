"use client";

import React from "react";
import {
  MoreHorizontal,
  Gauge,
  Heart,
  MessageSquare,
  Share2,
  Play,
  X,
  PlayCircle,
} from "lucide-react";

// Helper for TikTok icon (since Lucide doesn't have it, we'll draw a simple SVG)
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.62 2.89 2.89 0 0 1 2.31-4.51c.32 0 .63.06.92.17V9.52a6.3 6.3 0 0 0-3.23-.88A6.34 6.34 0 0 0 1 14.98a6.34 6.34 0 0 0 10.86 4.5V11.2a8.27 8.27 0 0 0 4.28 1.48V9.23a4.83 4.83 0 0 1 3.45-2.54V6.69z" />
    </svg>
  );
}

// 1. TrendCard (AI Trend Scanner)
interface TrendCardProps {
  title: string;
  subtitle: string;
  bullets: string[];
}

export function TrendCard({ title, subtitle, bullets }: TrendCardProps) {
  return (
    <div className="bg-white border border-mr-border rounded-lg mr-shadow-sm overflow-hidden transition-all duration-150 hover:-translate-y-[1.5px] hover:shadow-md flex flex-col h-full">
      {/* Dark B&W Thumbnail */}
      <div className="relative h-28 w-full bg-gradient-to-br from-zinc-800 to-zinc-950 flex items-center justify-center p-3">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:12px_12px]" />
        <div className="z-10 flex flex-col items-center">
          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center border border-white/20 mr-shadow-sm">
            <Play className="w-3.5 h-3.5 text-white fill-white ml-0.5" />
          </div>
          <span className="text-[10px] text-zinc-400 mt-2 font-mono uppercase tracking-widest">
            SCANNING SOURCE
          </span>
        </div>
        <div className="absolute top-2 right-2">
          <X className="w-4 h-4 text-zinc-400 cursor-pointer hover:text-white" />
        </div>
      </div>

      {/* Info Container */}
      <div className="p-4 flex-grow flex flex-col justify-between">
        <div>
          <div className="flex justify-between items-start mb-2">
            <h3 className="text-xs font-bold text-mr-text-primary uppercase tracking-wider font-sans">
              {title}
            </h3>
            <button className="text-mr-text-secondary hover:text-mr-text-primary p-0.5 rounded transition-colors duration-150">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>

          <h4 className="text-xs font-semibold text-mr-text-primary mb-2">
            {subtitle}
          </h4>

          <ul className="space-y-1.5">
            {bullets.map((bullet, idx) => (
              <li key={idx} className="text-[11px] text-mr-text-secondary flex items-start gap-1.5 leading-normal">
                <span className="text-mr-text-primary select-none mt-0.5">•</span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// 2. ScoreCard (Virality Score)
interface ScoreCardProps {
  title: string;
  score: number;
  maxScore?: number;
  subtitle: string;
  bullets: string[];
  likes: number;
}

export function ScoreCard({
  title,
  score,
  maxScore = 100,
  subtitle,
  bullets,
  likes,
}: ScoreCardProps) {
  return (
    <div className="bg-white border border-mr-border rounded-lg mr-shadow-sm overflow-hidden transition-all duration-150 hover:-translate-y-[1.5px] hover:shadow-md flex flex-col h-full justify-between">
      {/* Metric Block */}
      <div className="p-4 pb-3 flex-grow">
        <div className="flex justify-between items-start mb-3">
          <h3 className="text-xs font-bold text-mr-text-primary uppercase tracking-wider font-sans">
            {title}
          </h3>
          <Gauge className="w-4 h-4 text-mr-text-secondary" />
        </div>

        <div className="flex items-baseline gap-1 mb-4">
          <span className="text-3xl font-extrabold text-mr-text-primary tracking-tighter">
            {score}
          </span>
          <span className="text-xs font-semibold text-mr-text-secondary">
            /{maxScore}
          </span>
        </div>

        <h4 className="text-xs font-semibold text-mr-text-primary mb-2">
          {subtitle}
        </h4>

        <ul className="space-y-1.5 mb-2">
          {bullets.map((bullet, idx) => (
            <li key={idx} className="text-[11px] text-mr-text-secondary flex items-start gap-1.5 leading-normal">
              <span className="text-mr-text-primary select-none mt-0.5">•</span>
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Footer engagement */}
      <div className="border-t border-mr-border px-4 py-2.5 bg-mr-bg flex items-center gap-1.5 select-none">
        <Heart className="w-3.5 h-3.5 text-mr-text-secondary fill-mr-text-secondary/10" />
        <span className="text-[11px] font-medium text-mr-text-secondary">{likes}</span>
      </div>
    </div>
  );
}

// 3. VideoCard (AI Trend Analysis - Vertical Mockup)
interface VideoCardProps {
  title: string;
  avatarText?: string;
  likes: string;
  comments: string;
  shares: string;
}

export function VideoCard({
  title,
  avatarText = "AI",
  likes,
  comments,
  shares,
}: VideoCardProps) {
  return (
    <div className="bg-white border border-mr-border rounded-lg mr-shadow-sm overflow-hidden transition-all duration-150 hover:-translate-y-[1.5px] hover:shadow-md flex flex-col h-full justify-between">
      <div className="p-3 pb-1.5">
        <h3 className="text-xs font-bold text-mr-text-primary uppercase tracking-wider font-sans mb-2">
          {title}
        </h3>
      </div>

      {/* Tall Vertical B&W Video Simulator */}
      <div className="flex-grow px-3 pb-3">
        <div className="relative aspect-[9/16] w-full bg-gradient-to-b from-zinc-700 via-zinc-800 to-zinc-900 rounded-md overflow-hidden flex items-center justify-center border border-mr-border">
          {/* Subtle tech grid backdrop */}
          <div className="absolute inset-0 opacity-10 bg-[linear-gradient(to_right,#808080_1px,transparent_1px),linear-gradient(to_bottom,#808080_1px,transparent_1px)] [background-size:14px_24px]" />
          
          {/* Abstract B&W overlay - a futuristic vector silhouette mockup */}
          <div className="absolute w-[60%] h-[60%] rounded-full bg-white/5 blur-2xl top-[20%] left-[20%]" />
          <div className="absolute w-24 h-24 border border-white/10 rounded-full" />
          <div className="absolute w-16 h-16 border border-white/5 rounded-full" />

          {/* Video Metadata Header */}
          <div className="absolute top-2.5 left-2.5 right-2.5 flex justify-between items-center text-white z-10 select-none">
            <span className="text-[9px] font-medium tracking-wide bg-black/40 backdrop-blur-sm px-1.5 py-0.5 rounded border border-white/10">
              PREVIEW #2841
            </span>
            <X className="w-4 h-4 text-white/70 hover:text-white cursor-pointer" />
          </div>

          {/* Central Play Button */}
          <button className="z-10 w-12 h-12 rounded-full bg-white flex items-center justify-center mr-shadow-md hover:scale-105 active:scale-95 transition-transform duration-100 border border-zinc-200">
            <Play className="w-5 h-5 text-zinc-950 fill-zinc-950 ml-0.5" />
          </button>

          {/* Right Side Control Bar */}
          <div className="absolute right-2 bottom-12 flex flex-col items-center gap-3 z-10 select-none">
            {/* Avatar Bubble */}
            <div className="w-7 h-7 rounded-full bg-white border border-zinc-300 p-0.5 flex items-center justify-center mr-shadow-sm hover:scale-105 cursor-pointer transition-transform">
              <div className="w-full h-full rounded-full bg-mr-text-primary flex items-center justify-center text-[8px] font-bold text-white uppercase font-sans">
                {avatarText}
              </div>
            </div>

            {/* Like */}
            <button className="flex flex-col items-center group">
              <div className="w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm border border-white/10 flex items-center justify-center text-white hover:bg-black/60 transition-colors">
                <Heart className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
              </div>
              <span className="text-[9px] text-white font-semibold mt-0.5 font-sans shadow-sm">
                {likes}
              </span>
            </button>

            {/* Comments */}
            <button className="flex flex-col items-center group">
              <div className="w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm border border-white/10 flex items-center justify-center text-white hover:bg-black/60 transition-colors">
                <MessageSquare className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
              </div>
              <span className="text-[9px] text-white font-semibold mt-0.5 font-sans shadow-sm">
                {comments}
              </span>
            </button>

            {/* Share */}
            <button className="flex flex-col items-center group">
              <div className="w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm border border-white/10 flex items-center justify-center text-white hover:bg-black/60 transition-colors">
                <Share2 className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
              </div>
              <span className="text-[9px] text-white font-semibold mt-0.5 font-sans shadow-sm">
                {shares}
              </span>
            </button>
          </div>

          {/* Bottom Indicators */}
          <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between z-10 text-white select-none">
            {/* Timestamp */}
            <span className="text-[9px] font-mono tracking-wider bg-black/40 backdrop-blur-sm px-1.5 py-0.5 rounded border border-white/10">
              00:15
            </span>

            {/* TikTok Icon */}
            <TikTokIcon className="w-4 h-4 text-white drop-shadow" />
          </div>
        </div>
      </div>
    </div>
  );
}

// 4. MetricCard (Audience Match & Reaction Engine)
interface MetricCardProps {
  title: string;
  text: string;
  showMenu?: boolean;
}

export function MetricCard({ title, text, showMenu = false }: MetricCardProps) {
  return (
    <div className="bg-white border border-mr-border rounded-lg mr-shadow-sm p-4 transition-all duration-150 hover:-translate-y-[1.5px] hover:shadow-md flex flex-col justify-between min-h-[96px] h-full">
      <div className="flex justify-between items-start mb-2">
        <h3 className="text-xs font-bold text-mr-text-primary uppercase tracking-wider font-sans">
          {title}
        </h3>
        {showMenu && (
          <button className="text-mr-text-secondary hover:text-mr-text-primary p-0.5 rounded transition-colors duration-150">
            <MoreHorizontal className="w-4 h-4" />
          </button>
        )}
      </div>
      <p className="text-[11px] font-semibold text-mr-text-primary leading-normal mt-1 flex-grow">
        {text}
      </p>
    </div>
  );
}

// 5. AvatarStatusCard (Avatar Status)
interface AvatarStatusCardProps {
  title: string;
  text: string;
  chips: string[];
  likes: number;
}

export function AvatarStatusCard({
  title,
  text,
  chips,
  likes,
}: AvatarStatusCardProps) {
  return (
    <div className="bg-white border border-mr-border rounded-lg mr-shadow-sm overflow-hidden transition-all duration-150 hover:-translate-y-[1.5px] hover:shadow-md flex flex-col justify-between h-full">
      <div className="p-4 flex-grow flex flex-col justify-between">
        <div>
          <h3 className="text-xs font-bold text-mr-text-primary uppercase tracking-wider font-sans mb-3">
            {title}
          </h3>

          <p className="text-[11px] text-mr-text-secondary leading-normal mb-4">
            {text}
          </p>

          {/* Chips */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {chips.map((chip, idx) => (
              <span
                key={idx}
                className="px-2 py-0.5 bg-mr-bg border border-mr-border text-[9px] font-bold text-mr-text-secondary uppercase rounded hover:bg-zinc-100 hover:text-mr-text-primary cursor-pointer transition-colors"
              >
                {chip}
              </span>
            ))}
          </div>

          {/* Link */}
          <button className="text-[10px] font-bold text-mr-text-primary uppercase tracking-wider hover:underline flex items-center gap-1 select-none">
            Interactions &gt;
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-mr-border px-4 py-2.5 bg-mr-bg flex items-center gap-1.5 select-none">
        <Heart className="w-3.5 h-3.5 text-mr-text-secondary fill-mr-text-secondary/10" />
        <span className="text-[11px] font-medium text-mr-text-secondary">{likes}</span>
      </div>
    </div>
  );
}
