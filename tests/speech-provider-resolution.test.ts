import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveServerSpeechProvider,
  resolveSpeechProvider,
} from "../services/speech/speech-provider-resolution.ts";

test("keeps Web Speech for live recognition in the browser", () => {
  assert.equal(resolveSpeechProvider("webspeech", "web"), "webspeech");
});

test("uses local Whisper for server-side files when Web Speech is selected", () => {
  assert.equal(resolveServerSpeechProvider("webspeech", "web"), "whisper-speed");
});

test("keeps the configured local provider for server-side Web files", () => {
  assert.equal(resolveServerSpeechProvider("whisper", "web"), "whisper");
  assert.equal(resolveServerSpeechProvider("parakeet", "web"), "parakeet");
});

test("uses Parakeet for server-side files in the desktop runtime", () => {
  assert.equal(resolveServerSpeechProvider("webspeech", "desktop"), "parakeet");
  assert.equal(resolveServerSpeechProvider("whisper", "desktop"), "parakeet");
});
