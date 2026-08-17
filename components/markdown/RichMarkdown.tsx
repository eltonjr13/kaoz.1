"use client";

import ReactMarkdown from "react-markdown";

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

export function normalizeRichMarkdown(content: string): string {
  const lines = repairMojibake(content).replace(/\r\n?/g, "\n").split("\n");
  const normalized: string[] = [];
  let inMermaid = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    const mermaidStart = trimmed.match(/^mermaid\s+(flowchart|graph|sequenceDiagram|classDiagram)(.*)$/i);

    if (!inMermaid && (trimmed.toLowerCase() === "mermaid" || mermaidStart)) {
      normalized.push("", "```mermaid");
      if (mermaidStart) normalized.push(`${mermaidStart[1]}${mermaidStart[2]}`);
      inMermaid = true;
      continue;
    }
    if (inMermaid && isSectionBoundary(trimmed)) {
      normalized.push("```", "");
      inMermaid = false;
    }
    if (!inMermaid && /^(\d+)\.\s+([A-ZÀ-Ú].{4,})$/.test(trimmed)) {
      normalized.push("", `## ${trimmed}`, "");
      continue;
    }
    if (!inMermaid && /^[A-Z]\.\s+[A-ZÀ-Ú]/.test(trimmed)) {
      normalized.push("", `### ${trimmed}`, "");
      continue;
    }
    if (!inMermaid && /^(Componentes[- ]Chave|Checklist|Conclusão|Recomendações)(.*):?$/i.test(trimmed)) {
      normalized.push("", `## ${trimmed.replace(/:$/, "")}`, "");
      continue;
    }
    normalized.push(line);
  }

  if (inMermaid) normalized.push("```");
  return normalized.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function RichMarkdown({ content, className = "" }: { content: string; className?: string }) {
  return (
    <div className={`rich-markdown ${className}`}>
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h1 className="mb-4 mt-1 text-2xl font-semibold tracking-tight text-white">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-7 border-b border-white/10 pb-2 text-base font-semibold tracking-tight text-white first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-5 text-sm font-semibold text-violet-200">{children}</h3>,
          p: ({ children }) => <p className="my-2 text-[13px] leading-6 text-zinc-300 sm:text-sm">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-zinc-50">{children}</strong>,
          em: ({ children }) => <em className="text-zinc-200">{children}</em>,
          ul: ({ children }) => <ul className="my-3 list-disc space-y-2 pl-6 marker:text-violet-400">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 list-decimal space-y-2 pl-6 marker:text-violet-400">{children}</ol>,
          li: ({ children }) => <li className="pl-1 text-[13px] leading-6 text-zinc-300 sm:text-sm">{children}</li>,
          blockquote: ({ children }) => <blockquote className="my-4 rounded-r-xl border-l-2 border-violet-400 bg-violet-400/[0.07] px-4 py-2 text-zinc-200">{children}</blockquote>,
          hr: () => <hr className="my-6 border-white/10" />,
          pre: ({ children }) => <pre className="my-4 overflow-x-auto rounded-xl border border-white/10 bg-black/50 p-4 text-xs leading-5 text-zinc-200 shadow-inner">{children}</pre>,
          code: ({ className: codeClassName, children }) => codeClassName ? (
            <code className={`${codeClassName} whitespace-pre font-mono text-[12px] text-cyan-100`}>{children}</code>
          ) : (
            <code className="rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.88em] text-cyan-200">{children}</code>
          ),
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="font-medium text-violet-300 underline decoration-violet-400/40 underline-offset-4 hover:text-violet-200">{children}</a>,
        }}
      >
        {normalizeRichMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}
