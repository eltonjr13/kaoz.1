"use client";

import { useState } from "react";
import { TrendCard } from "@/components/mrchicken/trend-card";
import { ScoreCard } from "@/components/mrchicken/score-card";
import { VideoCard } from "@/components/mrchicken/video-card";
import { MetricCard } from "@/components/mrchicken/metric-card";
import { RightAnalysisPanel } from "@/components/mrchicken/right-analysis-panel";
import { BottomGenerationBar } from "@/components/mrchicken/bottom-generation-bar";

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<"Platform" | "Interactions">("Platform");

  // Mock data matching the design reference image
  const trendsColumn1 = [
    {
      title: "AI Trend Scanner",
      timestamp: "9:20w ago",
      topic: "Key Trend Analysis",
      bullets: [
        "Hypnotic comeback storytelling trend",
        "Video curiosity snippets",
      ],
      thumbnailUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=300&h=200&grayscale=1",
    },
    {
      title: "Mangubolar",
      timestamp: "9:20w ago",
      topic: "Key Trend analysis",
      bullets: [
        "Key trend analysis for puts",
        "Key trend analysis in points",
      ],
      thumbnailUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=300&h=200&grayscale=1",
    },
    {
      title: "Nacent Rahrane",
      timestamp: "9:20w ago",
      topic: "Key Trend analysis",
      bullets: [
        "Reaction engine outputs",
      ],
      thumbnailUrl: "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&q=80&w=300&h=200&grayscale=1",
    },
  ];

  const trendsColumn3 = [
    {
      title: "Audience Match",
      description: "AI in-place outflowers wide success",
    },
    {
      title: "Reaction Engine",
      description: "Estimated video scores and outputs by reactions engine",
    },
    {
      title: "Avatar Status",
      description: "Avatar Status motor ignited could-gin avatar compatibility status.",
      chips: ["All", "thatmonctimesion", "hils", "ai"],
      linkText: "Interactions >",
      likes: 38,
    },
    {
      title: "Ywntefniist",
      description: "Video output renders by target segments",
    },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Upper Area: Feed Grid + Right Analysis Panel */}
      <div className="flex-1 flex flex-col xl:flex-row min-h-0 overflow-hidden">
        {/* Main Feed Section (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Title and Tabs Header */}
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-black tracking-tight text-zinc-950 dark:text-white font-sans uppercase">
              AI Viral Feed
            </h1>

            {/* Small Tabs */}
            <div className="flex bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-0.5 rounded-md text-[10px] font-mono">
              <button
                onClick={() => setActiveTab("Platform")}
                className={`px-3 py-1 rounded transition-all duration-150 cursor-pointer ${
                  activeTab === "Platform"
                    ? "bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white font-bold border border-zinc-200 dark:border-zinc-700 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                Platform
              </button>
              <button
                onClick={() => setActiveTab("Interactions")}
                className={`px-3 py-1 rounded transition-all duration-150 cursor-pointer ${
                  activeTab === "Interactions"
                    ? "bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white font-bold border border-zinc-200 dark:border-zinc-700 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                Interactions
              </button>
            </div>
          </div>

          {/* Grid Central: Col 1, Col 2, Col 3 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Column 1: Trend Scanner Cards */}
            <div className="space-y-4">
              {trendsColumn1.map((card, idx) => (
                <TrendCard
                  key={idx}
                  title={card.title}
                  timestamp={card.timestamp}
                  topic={card.topic}
                  bullets={card.bullets}
                  thumbnailUrl={card.thumbnailUrl}
                />
              ))}
            </div>

            {/* Column 2: Score Card & Tall Video Card */}
            <div className="space-y-4">
              <ScoreCard
                score={94}
                title="Virality Score"
                topic="Key trend Analysis"
                bullets={["Most proven viral restorations", "Key trend imitators"]}
                likes={40}
              />
              <VideoCard
                title="AI Trend Analysis"
                likes="18.5K"
                comments="39K"
                shares="268"
                thumbnailUrl="https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&q=80&w=300&h=500&grayscale=1"
              />
            </div>

            {/* Column 3: Audience Match, Reaction Engine, Avatar Status */}
            <div className="space-y-4 md:col-span-2 lg:col-span-1">
              {trendsColumn3.map((card, idx) => (
                <MetricCard
                  key={idx}
                  title={card.title}
                  description={card.description}
                  chips={card.chips}
                  linkText={card.linkText}
                  likes={card.likes}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Column 4: Right Fixed Analysis Panel */}
        <RightAnalysisPanel />
      </div>

      {/* 5. Bottom Generation Bar */}
      <BottomGenerationBar />
    </div>
  );
}
