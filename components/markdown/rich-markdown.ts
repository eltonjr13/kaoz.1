const MOJIBAKE_REPAIRS: ReadonlyArray<readonly [string, string]> = [
  ["computa��o", "computação"], ["cria��o", "criação"], ["produ��o", "produção"],
  ["configura��o", "configuração"], ["valida��o", "validação"], ["revis��o", "revisão"],
  ["convers��o", "conversão"], ["atra��o", "atração"], ["reten��o", "retenção"],
  ["aprova��o", "aprovação"], ["recomenda��o", "recomendação"], ["comunica��o", "comunicação"],
  ["precis��o", "precisão"], ["a��o", "ação"],
];

function repairMojibake(content: string): string {
  return MOJIBAKE_REPAIRS.reduce(
    (result, [broken, repaired]) => result.replaceAll(broken, repaired),
    content,
  ).replace(/�+/g, "");
}

function isSectionBoundary(line: string): boolean {
  return /^(?:#{1,4}\s+|\d+\.\s+[A-ZÀ-Ú]|[A-Z]\.|Componentes[- ]Chave|Checklist|Conclusão|Recomendações)/i.test(line.trim());
}

function formatPlainLine(line: string): string[] {
  if (/^(\d+)\.\s+([A-ZÀ-Ú].{4,})$/.test(line)) return ["", `## ${line}`, ""];
  if (/^[A-Z]\.\s+[A-ZÀ-Ú]/.test(line)) return ["", `### ${line}`, ""];
  if (/^(Componentes[- ]Chave|Checklist|Conclusão|Recomendações)(.*):?$/i.test(line)) {
    return ["", `## ${line.replace(/:$/, "")}`, ""];
  }
  return [line];
}

function parseMermaidStart(line: string): { starts: boolean; firstLine?: string } {
  if (line.toLowerCase() === "mermaid") return { starts: true };
  const match = line.match(/^mermaid\s+(flowchart|graph|sequenceDiagram|classDiagram)(.*)$/i);
  return match ? { starts: true, firstLine: `${match[1]}${match[2]}` } : { starts: false };
}

export function normalizeRichMarkdown(content: string): string {
  const lines = repairMojibake(content).replace(/\r\n?/g, "\n").split("\n");
  const normalized: string[] = [];
  let inMermaid = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    const mermaidStart = parseMermaidStart(trimmed);

    if (!inMermaid && mermaidStart.starts) {
      normalized.push("", "```mermaid");
      if (mermaidStart.firstLine) normalized.push(mermaidStart.firstLine);
      inMermaid = true;
      continue;
    }
    if (inMermaid && isSectionBoundary(trimmed)) {
      normalized.push("```", "");
      inMermaid = false;
    }
    normalized.push(...(inMermaid ? [line] : formatPlainLine(trimmed)));
  }

  if (inMermaid) normalized.push("```");
  return normalized.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
