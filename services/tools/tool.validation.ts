type JsonSchema = { type?: unknown; required?: unknown; properties?: unknown; additionalProperties?: unknown };

export function assertToolArguments(schema: unknown, args: Record<string, unknown>): void {
  if (!isRecord(schema)) return;
  const rule = schema as JsonSchema;
  if (rule.type && rule.type !== "object") throw new Error("O schema raiz da ferramenta deve ser um objeto.");
  assertRequired(rule.required, args);
  assertProperties(rule, args);
}

function assertRequired(required: unknown, args: Record<string, unknown>) {
  if (!Array.isArray(required)) return;
  for (const key of required) {
    if (typeof key === "string" && !(key in args)) throw new Error(`Argumento obrigatório ausente: ${key}`);
  }
}

function assertProperties(rule: JsonSchema, args: Record<string, unknown>) {
  if (!isRecord(rule.properties)) return;
  for (const [key, value] of Object.entries(args)) {
    const property = rule.properties[key];
    if (!property && rule.additionalProperties === false) throw new Error(`Argumento não permitido: ${key}`);
    if (property) assertValueType(key, value, property);
  }
}

function assertValueType(key: string, value: unknown, schema: unknown) {
  if (!isRecord(schema) || typeof schema.type !== "string") return;
  if (!matchesType(value, schema.type)) throw new Error(`Tipo inválido para ${key}: esperado ${schema.type}.`);
}

function matchesType(value: unknown, type: string) {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isRecord(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number";
  if (type === "null") return value === null;
  return typeof value === type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
