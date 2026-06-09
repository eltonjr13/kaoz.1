"use client";

import React, { useState } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ViralFeedPage } from "./ViralFeedPage";
import { RightAnalysisPanel } from "./RightAnalysisPanel";
import { BottomGenerationBar } from "./BottomGenerationBar";
import { ShieldAlert } from "lucide-react";

type NavItemKey =
  | "feed"
  | "discovery"
  | "projects"
  | "avatar"
  | "generation"
  | "library"
  | "analytics"
  | "settings";

export function AppShell() {
  const [activeTab, setActiveTab] = useState<NavItemKey>("feed");

  // Render content based on active tab
  const renderContent = () => {
    switch (activeTab) {
      case "feed":
        return <ViralFeedPage />;
      default:
        return (
          <div className="flex-grow p-6 flex flex-col items-center justify-center bg-[#f5f5f3] text-center select-none">
            <div className="w-12 h-12 rounded-full bg-white border border-mr-border flex items-center justify-center mb-3 mr-shadow-sm">
              <ShieldAlert className="w-5 h-5 text-mr-text-secondary" />
            </div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-mr-text-primary mb-1">
              {activeTab} Module
            </h2>
            <p className="text-xs text-mr-text-secondary max-w-[280px]">
              This section is currently running in autonomous background analysis. Switch back to the Feed tab to review trending indicators.
            </p>
          </div>
        );
    }
  };

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden bg-mr-bg text-mr-text-primary font-sans antialiased">
      {/* 1. Top Header */}
      <TopBar />

      {/* Main body area below Header */}
      <div className="flex-grow flex flex-row overflow-hidden w-full">
        {/* 2. Left Sidebar (Fixed width) */}
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

        {/* 3. Main Area Container (takes up remaining space) */}
        <div className="flex-grow flex flex-col overflow-hidden h-full">
          {/* Main workspace section */}
          <div className="flex-grow flex flex-row overflow-hidden w-full h-[calc(100%-130px)]">
            {/* Scrollable central content */}
            <div className="flex-grow overflow-y-auto h-full flex flex-col">
              {renderContent()}
            </div>

            {/* 4. Right Fixed Analysis Panel */}
            {activeTab === "feed" && <RightAnalysisPanel />}
          </div>

          {/* 5. Bottom Generation Bar (Fixed height) */}
          <BottomGenerationBar />
        </div>
      </div>
    </div>
  );
}
