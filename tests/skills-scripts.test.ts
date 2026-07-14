import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();

test("gerador-de-hashtags slices final array to respect limite", () => {
  const scriptPath = path.join(root, "skills", "gerador-de-hashtags", "scripts", "generate-hashtags.ts");
  const args = {
    tema: "marketing",
    plataforma: "instagram",
    limite: 2
  };

  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", scriptPath],
    {
      env: {
        ...process.env,
        KAOZ_SKILL_ARGS: JSON.stringify(args)
      }
    }
  );

  assert.equal(result.status, 0, `Script failed: ${result.stderr?.toString() || ""}`);
  const output = JSON.parse(result.stdout.toString().trim());
  assert.equal(output.sucesso, true);
  
  const tags = output.formattedList.trim().split(/\s+/).filter(Boolean);
  assert.ok(tags.length <= 2, `Expected at most 2 hashtags, got: ${tags.join(" ")}`);
});

test("analisador-de-metricas throws error if tempoRetencaoMedio > duracaoSegundos", () => {
  const scriptPath = path.join(root, "skills", "analisador-de-metricas", "scripts", "analyze-metrics.ts");
  const args = {
    visualizacoes: 1000,
    curtidas: 100,
    comentarios: 10,
    compartilhamentos: 5,
    salvamentos: 15,
    duracaoSegundos: 30,
    tempoRetencaoMedio: 35
  };

  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", scriptPath],
    {
      env: {
        ...process.env,
        KAOZ_SKILL_ARGS: JSON.stringify(args)
      }
    }
  );

  assert.equal(result.status, 1, "Expected script to fail");
  const errorMsg = result.stderr.toString().trim();
  assert.match(errorMsg, /O tempo de retenção médio não pode ser maior que a duração do vídeo/);
});

import { systemHandlers } from "../services/orchestrator/adapters/system.adapter.ts";

test("system:run-code executes python code and returns output", async () => {
  const handler = systemHandlers["system:run-code"];
  assert.ok(handler, "system:run-code handler is not registered");

  const context = { planId: "test", runId: "test", stepId: "test", signal: new AbortController().signal };

  try {
    const res = await handler({
      language: "python",
      code: "import sys, json\nargs = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}\nprint(json.dumps({'fatorial': 120, 'input': args}))",
      args: { value: 5 }
    }, context);

    const output = res.output as any;
    assert.equal(output.success, true);
    assert.equal(output.stdout.fatorial, 120);
    assert.equal(output.stdout.input.value, 5);
  } catch (err: any) {
    if (err.message.includes("ENOENT") || err.message.includes("not found") || err.message.includes("python")) {
      console.warn("Python não encontrado no ambiente local. Pulando teste de Python.");
    } else {
      throw err;
    }
  }
});

test("system:run-code executes javascript code and returns output", async () => {
  const handler = systemHandlers["system:run-code"];
  assert.ok(handler, "system:run-code handler is not registered");

  const context = { planId: "test", runId: "test", stepId: "test", signal: new AbortController().signal };

  const res = await handler({
    language: "javascript",
    code: "const args = JSON.parse(process.argv[2] || '{}'); console.log(JSON.stringify({ soma: args.a + args.b }));",
    args: { a: 10, b: 20 }
  }, context);

  const output = res.output as any;
  assert.equal(output.success, true);
  assert.equal(output.stdout.soma, 30);
});
