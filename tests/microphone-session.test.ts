import assert from "node:assert/strict";
import test from "node:test";
import { acquireMicrophoneSession } from "../lib/speech/microphone-session.ts";

test("allows only one microphone owner at a time", () => {
  const first = acquireMicrophoneSession();
  assert.throws(() => acquireMicrophoneSession(), /microfone ja esta sendo usado/i);

  first.release();
  const second = acquireMicrophoneSession();
  second.release();
});

test("release is idempotent and cannot release a newer owner", () => {
  const first = acquireMicrophoneSession();
  first.release();
  const second = acquireMicrophoneSession();

  first.release();
  assert.throws(() => acquireMicrophoneSession(), /microfone ja esta sendo usado/i);
  second.release();
});
