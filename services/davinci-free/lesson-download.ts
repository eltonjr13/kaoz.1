export type LessonDownloadIdentity = {
  lessonNumber?: string;
  lessonName?: string;
  moduleName: string;
};

function safeFilePart(value: string) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120);
}

export function formattedLessonNumber(value?: string) {
  const cleaned = safeFilePart(value || "");
  return /^\d+$/.test(cleaned) ? cleaned.padStart(2, "0") : cleaned;
}

export function lessonDownloadStem(identity: LessonDownloadIdentity) {
  const number = formattedLessonNumber(identity.lessonNumber);
  const title = safeFilePart(identity.lessonName || identity.moduleName) || "Aula";
  return [number, title].filter(Boolean).join(" - ");
}

export function lessonDownloadFileName(
  identity: LessonDownloadIdentity,
  kind: "video" | "transcript",
  extension = ".mp4",
) {
  const suffix = kind === "transcript" ? " - transcrição.txt" : extension;
  return `${lessonDownloadStem(identity)}${suffix}`;
}
