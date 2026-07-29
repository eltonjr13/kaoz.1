import type {
  IntelligentCourseIdentity,
  IntelligentCourseLayout,
  IntelligentEditPlan,
  IntelligentEditTextVariant,
  TimedTranscriptSegment,
} from "./intelligent-edit.types";

type LessonInput = Pick<IntelligentEditPlan, "moduleName" | "transcript">;

type AgentIdentity = {
  title?: unknown;
  eyebrow?: unknown;
  promise?: unknown;
  layout?: unknown;
  lessons?: unknown;
};

export type NarrativeHighlight = {
  time: number;
  text: string;
  variant: IntelligentEditTextVariant;
};

const GENERIC_COURSE_NAMES = /^(curso|videos?\s+curso|m[oó]dulo\s*\d*)$/i;

function clean(value: unknown, limit: number) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, limit)
    : "";
}

function titleCase(value: string) {
  const stopwords = new Set(["a", "as", "da", "das", "de", "do", "dos", "e", "em", "para"]);
  return value
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .map((word, index) =>
      index > 0 && stopwords.has(word)
        ? word
        : word.replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase("pt-BR")),
    )
    .join(" ");
}

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

export function cleanLessonTitle(value: string) {
  const candidates = value
    .split(/\s+[—–]\s+/)
    .map((part) => part.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
  const unique = candidates.filter(
    (candidate, index) =>
      candidates.findIndex((other) => normalized(other) === normalized(candidate)) === index,
  );
  const title = unique.at(-1) || value;
  return titleCase(
    title.replace(
      /^(semana\s+\d+)\s+(?![-–—:·])/i,
      "$1 · ",
    ),
  ).slice(0, 72);
}

export function lessonSubtitle(title: string, transcript: string) {
  const heading = normalized(title);
  const corpus = normalized(`${title}\n${transcript}`);
  if (/consistencia/.test(heading)) {
    return "Transforme os primeiros resultados em consistência";
  }
  if (/evolucao/.test(heading)) {
    return "Recapitule o caminho e consolide sua evolução";
  }
  if (/depois dos 30 dias/.test(heading)) {
    return "Transforme o plano em um estilo de vida";
  }
  if (/limpeza|adaptacao/.test(heading)) {
    return "Prepare o ambiente e atravesse a fase de adaptação";
  }
  if (/consistencia|comodismo/.test(corpus)) {
    return "Transforme os primeiros resultados em consistência";
  }
  if (/evolucao|ultima semana/.test(corpus)) {
    return "Recapitule o caminho e consolide sua evolução";
  }
  if (/depois dos 30 dias|estilo de vida|para sempre/.test(corpus)) {
    return "Transforme o plano em um estilo de vida";
  }
  if (/limpeza|adaptacao/.test(corpus)) {
    return "Prepare o ambiente e atravesse a fase de adaptação";
  }
  return `Entenda e aplique: ${title}`.slice(0, 96);
}

function inferredCollection(input: {
  courseName?: string;
  folderName?: string;
  lessons: LessonInput[];
}) {
  const corpus = normalized([
    input.courseName,
    input.folderName,
    ...input.lessons.map((lesson) => lesson.moduleName),
    ...input.lessons.map((lesson) => lesson.transcript.map((segment) => segment.text).join(" ")),
  ].filter(Boolean).join("\n"));
  const isThirtyDayPlan = /30 dias/.test(corpus) && /semana/.test(corpus);
  const title = isThirtyDayPlan
    ? "Plano de 30 Dias"
    : input.courseName && !GENERIC_COURSE_NAMES.test(input.courseName)
      ? titleCase(input.courseName)
      : "Jornada de Aprendizado";
  const folderModule = clean(input.folderName, 36);
  const moduleNumber = folderModule.match(/m[oó]dulo\s*(\d+)/i)?.[1];
  const eyebrow = moduleNumber
    ? `Módulo ${moduleNumber}`
    : "Série do curso";
  const promise = isThirtyDayPlan
    ? "Da adaptação à evolução, uma semana de cada vez"
    : "Um caminho claro da compreensão à prática";
  return {
    title,
    eyebrow,
    promise,
    layout: (isThirtyDayPlan ? "roadmap" : "framework") as IntelligentCourseLayout,
  };
}

function fallbackIdentity(input: {
  courseName?: string;
  folderName?: string;
  lessons: LessonInput[];
}): IntelligentCourseIdentity {
  const collection = inferredCollection(input);
  return {
    ...collection,
    source: "deterministic-fallback",
    lessons: input.lessons.map((lesson, index) => ({
      index: index + 1,
      title: cleanLessonTitle(lesson.moduleName),
      subtitle: lessonSubtitle(
        lesson.moduleName,
        lesson.transcript.map((segment) => segment.text).join(" "),
      ),
    })),
  };
}

function extractJson(output: string) {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1);
  if (!candidate.trim()) return null;
  try {
    return JSON.parse(candidate) as AgentIdentity;
  } catch {
    return null;
  }
}

function validLayout(value: unknown): value is IntelligentCourseLayout {
  return value === "roadmap" || value === "framework" || value === "editorial";
}

function agentLessons(value: unknown, fallback: IntelligentCourseIdentity["lessons"]) {
  if (!Array.isArray(value) || value.length !== fallback.length) return fallback;
  return fallback.map((lesson, index) => {
    const candidate = value[index] as Record<string, unknown> | undefined;
    return {
      index: lesson.index,
      title: clean(candidate?.title, 72) || lesson.title,
      subtitle: clean(candidate?.subtitle, 96) || lesson.subtitle,
    };
  });
}

export async function analyzeCourseIdentity(input: {
  courseName?: string;
  folderName?: string;
  lessons: LessonInput[];
  useAgent: boolean;
}) {
  const fallback = fallbackIdentity(input);
  if (!input.useAgent) return fallback;
  const lessonContext = input.lessons.map((lesson, index) => ({
    index: index + 1,
    currentTitle: lesson.moduleName,
    transcript: lesson.transcript.map((segment) => segment.text).join(" ").slice(0, 3_500),
  }));
  const prompt = [
    "Você é diretor de edição de um curso em vídeo.",
    "Analise o conjunto inteiro como uma série, não cada aula isoladamente.",
    "Crie uma identidade semântica curta, específica e reutilizável em todas as aulas.",
    "Evite nomes de pasta, nomes genéricos e repetição. Preserve a progressão narrativa.",
    "Retorne SOMENTE JSON válido neste formato:",
    '{"title":"tema central em 2 a 5 palavras","eyebrow":"módulo ou série","promise":"promessa em até 10 palavras","layout":"roadmap|framework|editorial","lessons":[{"index":1,"title":"título curto","subtitle":"promessa específica da aula"}]}',
    `Curso informado: ${input.courseName || "não informado"}`,
    `Pasta: ${input.folderName || "não informada"}`,
    JSON.stringify(lessonContext),
  ].join("\n");
  try {
    const {
      getConfiguredAgentIdentity,
      queryConfiguredAgentCli,
    } = await import("@/services/agent-llm/agent-llm.service");
    const output = await queryConfiguredAgentCli(prompt, { useExternalTools: false });
    await getConfiguredAgentIdentity();
    return resolvedAgentIdentity(output, fallback);
  } catch {
    return fallback;
  }
}

function resolvedAgentIdentity(
  output: string | null,
  fallback: IntelligentCourseIdentity,
) {
  const decision = output ? extractJson(output) : null;
  if (!decision) return fallback;
  return {
    title: clean(decision.title, 52) || fallback.title,
    eyebrow: clean(decision.eyebrow, 36) || fallback.eyebrow,
    promise: clean(decision.promise, 96) || fallback.promise,
    layout: validLayout(decision.layout) ? decision.layout : fallback.layout,
    source: "agent" as const,
    lessons: agentLessons(decision.lessons, fallback.lessons),
  };
}

const HIGHLIGHT_RULES: Array<{
  pattern: RegExp;
  text: string;
  variant: IntelligentEditTextVariant;
}> = [
  { pattern: /30 dias/, text: "30 dias de evolução", variant: "stat" },
  { pattern: /limp(e|a).*casa|jog(a|ue).*fora/, text: "Prepare o ambiente", variant: "action" },
  { pattern: /comida de verdade/, text: "Comida de verdade", variant: "concept" },
  { pattern: /consist[eê]ncia|comodismo/, text: "Consistência sem comodismo", variant: "action" },
  { pattern: /primeira semana|primeiros dias/, text: "A adaptação exige firmeza", variant: "quote" },
  { pattern: /resultado/, text: "Proteja seus resultados", variant: "action" },
  { pattern: /estilo de vida|para sempre/, text: "Um estilo de vida", variant: "concept" },
  { pattern: /h[aá]bito/, text: "Construa o hábito", variant: "action" },
];

function matchingHighlights(segments: TimedTranscriptSegment[]) {
  const used = new Set<string>();
  return segments.flatMap((segment) => {
    const match = HIGHLIGHT_RULES.find(
      (rule) => rule.pattern.test(segment.text.toLocaleLowerCase("pt-BR")) && !used.has(rule.text),
    );
    if (!match) return [];
    used.add(match.text);
    return [{ time: segment.start, text: match.text, variant: match.variant }];
  });
}

export function narrativeHighlights(
  segments: TimedTranscriptSegment[],
  duration: number,
): NarrativeHighlight[] {
  const matched = matchingHighlights(segments);
  if (matched.length >= 2) return matched.slice(0, 5);
  const fallbackTimes = [duration * 0.32, duration * 0.68];
  return [
    ...matched,
    ...fallbackTimes.slice(0, 2 - matched.length).map((time, index) => ({
      time,
      text: index === 0 ? "Ideia central" : "Próximo passo",
      variant: index === 0 ? "concept" as const : "action" as const,
    })),
  ];
}
