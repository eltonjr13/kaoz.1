import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { getLocalDataDir } from "@/lib/runtime-paths";
import { INTELLIGENT_COURSE_THEME_PRESETS } from "./intelligent-edit.design";
import type {
  IntelligentCourseThemeKey,
  IntelligentCourseThemeProfile,
} from "./intelligent-edit.types";

const ROOT = path.join(
  getLocalDataDir(),
  "davinci-resolve-free",
  "course-themes",
);

function normalizedCourseName(courseName: string) {
  return courseName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function courseId(courseName: string) {
  return crypto
    .createHash("sha256")
    .update(normalizedCourseName(courseName))
    .digest("hex")
    .slice(0, 16);
}

function legacyCourseId(courseName: string) {
  return crypto
    .createHash("sha256")
    .update(courseName.trim().toLocaleLowerCase("pt-BR"))
    .digest("hex")
    .slice(0, 16);
}

function validThemeKey(value: unknown): value is IntelligentCourseThemeKey {
  return (
    typeof value === "string" &&
    value in INTELLIGENT_COURSE_THEME_PRESETS
  );
}

function inferThemeKey(text: string): IntelligentCourseThemeKey {
  const normalized = text.toLocaleLowerCase("pt-BR");
  if (/(ancestral|natureza|natural|tribo|movimento|raiz|origem)/.test(normalized)) {
    return "ancestral";
  }
  if (/(saúde|bem-estar|equilíbrio|mente|terapia|cuidado)/.test(normalized)) {
    return "wellness";
  }
  if (/(performance|treino|músculo|disciplina|resultado|esporte)/.test(normalized)) {
    return "performance";
  }
  if (/(negócio|venda|empresa|gestão|liderança|estratégia)/.test(normalized)) {
    return "business";
  }
  if (/(tecnologia|software|código|dados|inteligência artificial|automação)/.test(normalized)) {
    return "technology";
  }
  return "creative";
}

export async function resolveCourseTheme(input: {
  courseName?: string;
  transcript: string;
  suggestedKey?: unknown;
  rationale?: string;
  tone?: string;
  reuse: boolean;
}) {
  const courseName = input.courseName?.trim() || "Curso sem nome";
  const id = courseId(courseName);
  const filePath = path.join(ROOT, `${id}.json`);
  if (input.reuse && input.courseName) {
    const legacyPath = path.join(ROOT, `${legacyCourseId(courseName)}.json`);
    const existing = await Promise.all(
      [filePath, legacyPath].map((candidate) =>
        readFile(candidate, "utf8")
          .then((raw) => JSON.parse(raw) as IntelligentCourseThemeProfile)
          .catch(() => null),
      ),
    ).then((candidates) => candidates.find(Boolean) || null);
    if (
      existing &&
      validThemeKey(existing.key)
    ) {
      const profile = existing.id === id
        ? existing
        : {
            ...existing,
            id,
            courseName,
            updatedAt: new Date().toISOString(),
          };
      if (existing.id !== id) {
        await mkdir(ROOT, { recursive: true });
        await writeFile(filePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
      }
      return { profile, reused: true };
    }
  }

  const key = validThemeKey(input.suggestedKey)
    ? input.suggestedKey
    : inferThemeKey(`${courseName}\n${input.transcript}`);
  const preset = INTELLIGENT_COURSE_THEME_PRESETS[key];
  const now = new Date().toISOString();
  const profile: IntelligentCourseThemeProfile = {
    id,
    courseName,
    key,
    label: preset.label,
    rationale:
      input.rationale?.trim().slice(0, 240) ||
      `Identidade escolhida a partir do tema e da linguagem recorrente do curso ${courseName}.`,
    tone: input.tone?.trim().slice(0, 120) || preset.tone,
    createdAt: now,
    updatedAt: now,
    colors: { ...preset.colors },
  };
  if (input.reuse && input.courseName) {
    await mkdir(ROOT, { recursive: true });
    await writeFile(filePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  }
  return { profile, reused: false };
}
