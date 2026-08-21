import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveServerSpeechProvider,
  resolveSpeechProvider,
} from "../services/speech/speech-provider-resolution.ts";

test("keeps Web Speech for live recognition in the browser", () => {
  assert.equal(resolveSpeechProvider("webspeech", "web"), "webspeech");
  assert.equal(resolveSpeechProvider("whisper", "web"), "webspeech");
  assert.equal(resolveSpeechProvider("parakeet", "web"), "webspeech");
});

test("forces Web/API transcription for server-side files received from the browser", () => {
  assert.equal(resolveServerSpeechProvider("webspeech", "web"), "webspeech");
  assert.equal(resolveServerSpeechProvider("whisper", "web"), "webspeech");
  assert.equal(resolveServerSpeechProvider("parakeet", "web"), "webspeech");
});

test("keeps the configured provider in the desktop runtime", () => {
  assert.equal(resolveSpeechProvider("whisper", "desktop"), "whisper");
  assert.equal(resolveSpeechProvider("parakeet", "desktop"), "parakeet");
  assert.equal(resolveServerSpeechProvider("webspeech", "desktop"), "whisper-speed");
  assert.equal(resolveServerSpeechProvider("whisper", "desktop"), "whisper");
  assert.equal(resolveServerSpeechProvider("parakeet", "desktop"), "parakeet");
});
