export type QuickIntent =
  | { kind: "note"; content: string }
  | { kind: "open"; targetId: string }
  | { kind: "project"; idea: string; openInCode: boolean }
  | { kind: "unsupported-local-action" }
  | { kind: "chat" };

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function detectNoteIntent(original: string): QuickIntent | null {
  const note = original.match(/^(?:por favor[,\s]*)?(?:anote|anota|registre|registra)(?:\s+(?:a\s+)?(?:minha\s+)?ideia)?\s*[:,-]\s*([\s\S]+)$/i);
  if (note?.[1]?.trim()) return { kind: "note", content: note[1].trim() };
  return null;
}

function detectProjectIntent(original: string): QuickIntent | null {
  const project = original.match(/^(?:por favor[,\s]*)?(?:inicie|inicia|crie|cria|comece|começa)\s+(?:um\s+)?projeto\s+(?:para|sobre)\s+([\s\S]+)$/i);
  if (project?.[1]?.trim()) {
    const codeSuffix = /(?:,?\s+e\s+abra\s+(?:(?:o|no)\s+)?(?:vs code|vscode|visual studio code))\s*[.!?]?$/i;
    const openInCode = codeSuffix.test(project[1]);
    const idea = project[1].replace(codeSuffix, "").trim().replace(/[.!?]+$/, "");
    if (idea) return { kind: "project", idea, openInCode };
  }
  return null;
}

function detectOpenIntent(original: string): QuickIntent {
  const command = normalize(original)
    .replace(/^(?:por favor[,\s]*)/, "")
    .replace(/[.!?]+$/, "")
    .replace(/\s+por favor$/, "");
  const opening = command.match(/^(?:abra|abre|abrir|inicie|inicia|iniciar|execute|executa|executar)\s+(?:o\s+|a\s+)?(.+)$/);
  if (!opening) return { kind: "chat" };

  const target = opening[1];
  if (["bloco de notas", "notepad"].includes(target)) return { kind: "open", targetId: "notepad" };
  if (["calculadora", "calculator"].includes(target)) return { kind: "open", targetId: "calculator" };
  if (["explorador de arquivos", "explorador", "pasta de trabalho", "workspace"].includes(target)) {
    return { kind: "open", targetId: "workspace-explorer" };
  }
  if (["vs code", "vscode", "visual studio code", "projeto no vs code", "projeto no vscode"].includes(target)) {
    return { kind: "open", targetId: "workspace-vscode" };
  }
  return { kind: "unsupported-local-action" };
}

export function detectQuickIntent(input: string): QuickIntent {
  const original = input.trim();
  return detectNoteIntent(original) ?? detectProjectIntent(original) ?? detectOpenIntent(original);
}

export function noteTitle(content: string): string {
  const firstLine = content.split(/\r?\n/)[0].trim();
  return firstLine.length > 64 ? `${firstLine.slice(0, 61)}...` : firstLine || "Nova nota";
}
