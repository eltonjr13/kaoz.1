import assert from "node:assert/strict";
import test from "node:test";
import { overallFromChecks, overallSummary } from "../services/system-health/system-health.summary.ts";

test("system health summary gives precedence to errors", () => {
  const overall = overallFromChecks([
    { id: "ffmpeg", label: "FFmpeg", state: "healthy", detail: "Local." },
    { id: "models", label: "Modelos", state: "warning", detail: "Nenhum modelo." },
    { id: "mcp", label: "MCP", state: "error", detail: "Desconectado." },
  ]);

  assert.equal(overall, "error");
  assert.equal(overallSummary(overall), "Há componentes necessários que precisam de atenção.");
});

test("system health summary accepts informational checks", () => {
  const overall = overallFromChecks([
    { id: "desktop", label: "Desktop", state: "info", detail: "Modo web." },
    { id: "ffmpeg", label: "FFmpeg", state: "healthy", detail: "Local." },
  ]);

  assert.equal(overall, "healthy");
  assert.equal(overallSummary(overall), "Ambiente pronto para uso.");
});
