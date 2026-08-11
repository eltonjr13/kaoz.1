import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WHISPER_CPP_MODEL_ID,
  PARAKEET_MODEL_ID,
  SPEECH_MODEL_CATALOG,
  getSpeechModelDefinition,
} from "../services/speech/speech-model.catalog.ts";

test("speech catalog exposes unique downloadable local models", () => {
  assert.equal(new Set(SPEECH_MODEL_CATALOG.map((model) => model.id)).size, SPEECH_MODEL_CATALOG.length);
  assert.ok(SPEECH_MODEL_CATALOG.length >= 10);
  for (const model of SPEECH_MODEL_CATALOG) {
    assert.match(model.id, /^[a-z0-9][a-z0-9-]*$/);
    assert.ok(model.sizeBytes > 0);
    if (model.engine === "whisper-cpp") {
      assert.match(model.downloadUrl || "", /^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/main\//);
      assert.ok(model.checksum);
      assert.equal(model.checksum?.value.length, model.checksum?.algorithm === "sha1" ? 40 : 64);
    }
  }
});

test("speech catalog keeps recommended Whisper and Parakeet entries", () => {
  assert.equal(getSpeechModelDefinition(DEFAULT_WHISPER_CPP_MODEL_ID)?.recommended, true);
  assert.equal(getSpeechModelDefinition(PARAKEET_MODEL_ID)?.engine, "parakeet");
});
