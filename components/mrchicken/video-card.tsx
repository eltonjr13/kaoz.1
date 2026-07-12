"use client";

import { Heart, MessageCircle, Play, Share2, X } from "lucide-react";

interface VideoCardProps {
  title: string;
  avatarUrl?: string;
  likes: string;
  comments: string;
  shares: string;
  thumbnailUrl?: string;
}

export function VideoCard({
  title,
  avatarUrl,
  likes,
  comments,
  shares,
  thumbnailUrl,
}: VideoCardProps) {
  return (
    <div className="group bg-[var(--bg-soft)] border border-[var(--line)] rounded-lg overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)] flex flex-col hover:-translate-y-[1px] hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] transition-all duration-150 ease-in-out h-full min-h-[360px]">
      <div className="relative flex-1 bg-zinc-950 overflow-hidden flex flex-col justify-between p-3.5">
        {/* Background Grayscale Video Simulation */}
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover filter grayscale opacity-75 group-hover:scale-102 transition-transform duration-300 ease-out"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-900 via-zinc-800 to-zinc-950 flex items-center justify-center opacity-90">
            {/* Grayscale vertical lines or abstract shapes simulating a video */}
            <div className="absolute inset-y-0 left-1/3 right-1/3 border-x border-white/5 bg-white/2"></div>
            <div className="absolute w-24 h-24 rounded-full border border-white/5 bg-white/2 animate-pulse"></div>
          </div>
        )}

        {/* Gradual overlay shade for readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/75 pointer-events-none z-10"></div>

        {/* Header Overlay */}
        <div className="flex justify-between items-center w-full z-20">
          <span className="text-[10px] font-medium tracking-wide uppercase text-white/90 font-mono">
            {title}
          </span>
          <button className="text-white/70 hover:text-white transition-colors duration-150">
            <X size={12} />
          </button>
        </div>

        {/* Play Button Overlay (Centered) */}
        <div className="absolute inset-0 flex items-center justify-center z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <button className="w-12 h-12 flex items-center justify-center rounded-full bg-white/90 text-black hover:scale-105 transition-transform duration-150 shadow-lg">
            <Play size={18} fill="currentColor" className="ml-1" />
          </button>
        </div>

        {/* Right side floating action buttons */}
        <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3.5 z-20 text-white">
          {/* Avatar button */}
          <div className="w-7 h-7 rounded-full bg-white/20 border border-white/40 overflow-hidden shadow-md cursor-pointer hover:scale-105 transition-transform duration-150">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-zinc-700 flex items-center justify-center text-[10px] font-bold">
                AI
              </div>
            )}
          </div>

          {/* Likes */}
          <button className="flex flex-col items-center group/btn cursor-pointer">
            <div className="w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center hover:bg-white hover:text-black transition-colors duration-150">
              <Heart size={13} className="group-hover/btn:fill-current" />
            </div>
            <span className="text-[9px] font-mono mt-1 font-semibold">{likes}</span>
          </button>

          {/* Comments */}
          <button className="flex flex-col items-center group/btn cursor-pointer">
            <div className="w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center hover:bg-white hover:text-black transition-colors duration-150">
              <MessageCircle size={13} />
            </div>
            <span className="text-[9px] font-mono mt-1 font-semibold">{comments}</span>
          </button>

          {/* Shares */}
          <button className="flex flex-col items-center group/btn cursor-pointer">
            <div className="w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center hover:bg-white hover:text-black transition-colors duration-150">
              <Share2 size={13} />
            </div>
            <span className="text-[9px] font-mono mt-1 font-semibold">{shares}</span>
          </button>
        </div>

        {/* Bottom Overlay Info (Watermark & interactions detail) */}
        <div className="mt-auto w-full z-20 flex justify-between items-end text-white/95">
          <div className="text-[10px] font-mono opacity-80">
            Interactions <span className="text-blue-400">&gt;</span>
          </div>

          {/* TikTok Icon SVG */}
          <svg className="w-3.5 h-3.5 fill-current opacity-85" viewBox="0 0 24 24">
            <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.02 1.59 4.23.99 1.13 2.37 1.93 3.86 2.22.01 1.25.01 2.5.01 3.75-.76-.08-1.52-.3-2.24-.62-.97-.43-1.83-1.07-2.5-1.89-.01 2.36-.01 4.72-.01 7.08-.12 2.44-1.37 4.79-3.4 6.13-2.12 1.48-5.06 1.76-7.39.73-2.4-1.02-4.04-3.54-4.03-6.17.02-2.82 2.03-5.46 4.81-6.04.83-.17 1.69-.19 2.52-.06v3.91c-.55-.07-1.12-.04-1.65.13-1.04.33-1.83 1.26-1.95 2.36-.18 1.48.88 2.87 2.37 3.05 1.47.16 2.88-.81 3.09-2.29.05-.33.05-.67.05-1.01V0h-2.52Z" />
          </svg>
        </div>
      </div>
    </div>
  );
}
