import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(".github/workflows/release-windows.yml", "utf8");
const preparer = fs.readFileSync("scripts/prepare-whisper-cpp-runtime.mjs", "utf8");

test("release prepara Vulkan SDK verificado antes de compilar o whisper.cpp", () => {
  assert.match(workflow, /Preparar Vulkan SDK/);
  assert.match(workflow, /Get-FileHash[^\n]+SHA256/);
  assert.match(workflow, /REQUIRE_WHISPER_VULKAN=1/);
  assert.match(workflow, /VULKAN_SDK=\$sdkRoot/);
});

test("preparador exige Vulkan no CI e permite fallback CPU em build local", () => {
  assert.match(preparer, /Vulkan_GLSLC_EXECUTABLE/);
  assert.match(preparer, /REQUIRE_WHISPER_VULKAN === "1"/);
  assert.match(preparer, /fallback CPU/);
});
