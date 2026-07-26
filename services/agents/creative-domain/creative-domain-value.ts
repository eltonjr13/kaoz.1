export type CreativeData =
  | null
  | boolean
  | number
  | string
  | readonly CreativeData[]
  | { readonly [key: string]: CreativeData };

export function freezeCreativeData(
  value: CreativeData | undefined,
): CreativeData {
  return freezeValue(value ?? {});
}

export function freezeTexts(
  values: readonly string[],
  label: string,
): readonly string[] {
  if (!Array.isArray(values)) {
    throw new Error(`${label} must be an array.`);
  }
  return Object.freeze(
    values.map((value) => requireCreativeText(value, label)),
  );
}

export function freezeUniqueTexts(
  values: readonly string[],
  label: string,
): readonly string[] {
  const normalized = freezeTexts(values, label);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} values must be unique.`);
  }
  return normalized;
}

export function requireCreativeText(
  value: string,
  label: string,
): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}

export function normalizeCreativeVersion(
  value: number,
  label: string,
): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

export function normalizeCreativeTimestamp(
  value: string,
  label: string,
): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
  return timestamp.toISOString();
}

function freezeValue(value: CreativeData): CreativeData {
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((entry) => freezeValue(entry)),
    );
  }
  if (value && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          freezeValue(entry),
        ]),
      ),
    ) as { readonly [key: string]: CreativeData };
  }
  if (
    typeof value === "number" &&
    !Number.isFinite(value)
  ) {
    throw new Error("Creative data numbers must be finite.");
  }
  return value;
}
