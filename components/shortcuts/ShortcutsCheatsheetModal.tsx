"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Keyboard, X, Search, Sparkles, Video, Compass, Layers } from "lucide-react";
import { useShortcuts } from "@/lib/shortcuts/ShortcutContext";
import { SHORTCUT_CATEGORIES, ShortcutCategory } from "@/lib/shortcuts/shortcut-definitions";
import { KbdBadge } from "./KbdBadge";

const categoryIcons: Record<ShortcutCategory, React.ElementType> = {
  global: Layers,
  navigation: Compass,
  chat: Sparkles,
  video: Video,
};

export function ShortcutsCheatsheetModal() {
  const { isCheatsheetOpen, closeCheatsheet, definitions } = useShortcuts();
  const [filter, setFilter] = useState("");

  const filteredDefinitions = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return definitions;
    return definitions.filter((def) => {
      return (
        def.label.toLowerCase().includes(term) ||
        def.description.toLowerCase().includes(term) ||
        def.displayKey.toLowerCase().includes(term)
      );
    });
  }, [definitions, filter]);

  const groupedShortcuts = useMemo(() => {
    const map = new Map<ShortcutCategory, typeof definitions>();
    for (const cat of SHORTCUT_CATEGORIES) {
      map.set(cat.id, []);
    }
    for (const def of filteredDefinitions) {
      const list = map.get(def.category) || [];
      list.push(def);
      map.set(def.category, list);
    }
    return map;
  }, [filteredDefinitions]);

  return (
    <AnimatePresence>
      {isCheatsheetOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/65 backdrop-blur-md"
            onClick={closeCheatsheet}
          />

          {/* Modal Content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#12141A] shadow-2xl text-white flex flex-col max-h-[85vh]"
            style={{
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.08)",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#7C6CF2]/15 text-[#A99FFF] border border-[#7C6CF2]/20">
                  <Keyboard className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">Atalhos de Teclado</h2>
                  <p className="text-xs text-[#8B92A1]">Guia de produtividade do Kaoz.1</p>
                </div>
              </div>

              <button
                type="button"
                onClick={closeCheatsheet}
                className="rounded-lg p-1.5 text-[#8B92A1] transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Fechar guia de atalhos"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Filter Search */}
            <div className="border-b border-white/5 bg-white/[0.02] px-6 py-2.5">
              <div className="relative flex items-center">
                <Search className="absolute left-3 h-4 w-4 text-[#8B92A1]" />
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filtrar atalhos por ação ou tecla..."
                  className="w-full rounded-xl bg-white/[0.04] border border-white/10 pl-9 pr-4 py-1.5 text-xs text-white placeholder-[#8B92A1] outline-none focus:border-[#7C6CF2]/50 focus:bg-white/[0.06] transition-all"
                />
              </div>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">
              {filteredDefinitions.length === 0 ? (
                <div className="py-12 text-center text-sm text-[#8B92A1]">
                  Nenhum atalho encontrado para &quot;{filter}&quot;.
                </div>
              ) : (
                SHORTCUT_CATEGORIES.map((cat) => {
                  const items = groupedShortcuts.get(cat.id) || [];
                  if (items.length === 0) return null;
                  const Icon = categoryIcons[cat.id] || Layers;

                  return (
                    <div key={cat.id} className="space-y-2.5">
                      <div className="flex items-center gap-2 text-xs font-semibold text-[#A99FFF] uppercase tracking-wider">
                        <Icon className="h-3.5 w-3.5" />
                        <span>{cat.label}</span>
                      </div>

                      <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
                        {items.map((def) => (
                          <div
                            key={def.id}
                            className="flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02] transition-colors"
                          >
                            <div className="min-w-0 pr-4">
                              <span className="text-xs font-medium text-white block">
                                {def.label}
                              </span>
                              <span className="text-[11px] text-[#8B92A1] block truncate">
                                {def.description}
                              </span>
                            </div>
                            <div className="shrink-0">
                              <KbdBadge keys={def.displayKey} size="md" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-white/10 bg-white/[0.02] px-6 py-3 text-xs text-[#8B92A1]">
              <span>Pressione <KbdBadge keys="?" size="sm" /> em qualquer lugar para abrir este guia</span>
              <button
                type="button"
                onClick={closeCheatsheet}
                className="rounded-lg bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/15 transition-colors"
              >
                Entendi
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
