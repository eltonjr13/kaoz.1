const naturalCollator = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
});

export function sortCourseVideoPaths(paths: string[]) {
  return [...paths].sort((left, right) =>
    naturalCollator.compare(
      left.replaceAll("\\", "/"),
      right.replaceAll("\\", "/"),
    ),
  );
}
