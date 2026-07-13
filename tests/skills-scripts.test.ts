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
