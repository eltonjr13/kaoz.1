export const MAX_TOOL_RESULT_CHARS = 20_000;
export function truncateToolResult(value: unknown, max = MAX_TOOL_RESULT_CHARS): unknown { const text = typeof value === "string" ? value : JSON.stringify(value); return text.length <= max ? value : `${text.slice(0, max)}\n[resultado truncado]`; }
