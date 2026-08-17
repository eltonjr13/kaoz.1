import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { synthesizeRealSpeechToFile } from "../services/tts/speech-synthesizer.ts";

test("sintetiza arquivo de voz real em arquivo de áudio WAV", async () => {
  const testOut = path.resolve("./.generated/test-speech-out.wav");
  if (existsSync(testOut)) unlinkSync(testOut);

  const result = await synthesizeRealSpeechToFile(
    "Teste de locução em português para validação do pipeline multimídia Kaoz.",
    testOut,
    { durationSeconds: 3, provider: "local" }
  );

  assert.equal(result.success, true);
  assert.ok(result.bytes > 100);
  assert.ok(existsSync(testOut));

  // Limpeza
  if (existsSync(testOut)) unlinkSync(testOut);
});
