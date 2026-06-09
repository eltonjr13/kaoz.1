"use client";

import React from "react";
import { Search } from "lucide-react";

export function TopBar() {
  return (
    <header className="h-[80px] bg-mr-bg border-b border-mr-border flex items-center justify-between px-6 select-none flex-shrink-0">
      {/* Brand logo */}
      <div className="flex items-baseline gap-2.5">
        <h1 className="text-2xl font-[900] tracking-tighter text-mr-text-primary uppercase font-sans">
          MRCHICKEN
        </h1>
        <span className="text-[11px] text-mr-text-secondary tracking-normal font-sans font-medium">
          by KHAOZ Studio.
        </span>
      </div>

      {/* Utilities: AI Active, Credits, Search, Profile */}
      <div className="flex items-center gap-4">
        {/* AI Active Pill */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-mr-border rounded-full mr-shadow-sm text-[11px] font-semibold text-mr-text-primary tracking-wide">
          <span className="w-1.5 h-1.5 rounded-full bg-mr-text-primary animate-pulse" />
          <span>AI ACTIVE</span>
          <span className="w-2.5 h-2.5 bg-blue-600 rounded-[2px]" />
        </div>

        {/* Credits Pill */}
        <div className="px-3 py-1.5 bg-white border border-mr-border rounded-full mr-shadow-sm text-[11px] font-semibold text-mr-text-primary tracking-wide">
          <span className="text-mr-text-secondary">Credits:</span> 4,500 / 5,000
        </div>

        {/* Search Input */}
        <div className="relative w-[180px] md:w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mr-text-secondary stroke-[1.5]" />
          <input
            type="text"
            placeholder="Search"
            className="w-full h-8 pl-9 pr-3 bg-white border border-mr-border rounded-lg text-[13px] text-mr-text-primary placeholder-mr-text-tertiary focus:outline-none focus:border-mr-text-primary transition-all duration-150 mr-shadow-sm"
          />
        </div>

        {/* Profile Avatar Card */}
        <div className="w-8 h-8 rounded-lg bg-white border border-mr-border p-[3px] flex items-center justify-center mr-shadow-sm hover:scale-[1.02] cursor-pointer transition-transform duration-150">
          <div className="w-full h-full rounded-[5px] bg-mr-text-primary flex items-center justify-center text-[11px] font-bold text-white uppercase">
            MC
          </div>
        </div>
      </div>
    </header>
  );
}
