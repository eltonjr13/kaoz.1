import assert from "node:assert/strict";
import test from "node:test";
import {
  compileFishAudioSpeech,
  createFishExpressionReplyState,
  type VoiceExpressionContext
} from "../lib/ai/agent-voice.ts";

const expression = (mode: VoiceExpressionContext["mode"]): VoiceExpressionContext => ({
  mode,
  energy: mode === "playful" ? 0.82 : 0.5,
  warmth: mode === "supportive" ? 0.9 : 0.68,
  seriousness: mode === "focused" ? 0.92 : 0.35,
  playfulness: mode === "playful" ? 0.9 : 0.1,
  explicitLayers: [],
  explicit: false
});

test("aplica expressao acolhedora sem poluir o transcript", () => {
  const output = compileFishAudioSpeech("Eu entendo como isso pode ser difícil.", expression("supportive"));
  assert.match(output.speechText, /^\[empathetic\]\[soft tone\]/);
  assert.equal(output.transcriptText, "Eu entendo como isso pode ser difícil.");
  assert.doesNotMatch(output.transcriptText, /\[/);
});

test("mantem o tom focado para respostas técnicas", () => {
  const output = compileFishAudioSpeech("Esse erro urgente precisa ser resolvido pela raiz.", expression("focused"));
  assert.match(output.speechText, /^\[serious\]/);
  assert.doesNotMatch(output.speechText, /chuckling|Heh/i);
});

test("permite somente uma risada por resposta", () => {
  const state = createFishExpressionReplyState();
  const output = compileFishAudioSpeech("Essa piada foi boa. Essa outra piada também foi engraçada.", expression("playful"), "expressive", "s2.1-pro-free", state);
  assert.equal((output.speechText.match(/\[chuckling\]/g) || []).length, 1);
  assert.equal((output.speechText.match(/Heh, heh/g) || []).length, 1);
});

test("usa parenteses para o modelo S1 legado", () => {
  const output = compileFishAudioSpeech("Que ótima notícia!", expression("playful"), "natural", "s1");
  assert.match(output.speechText, /^\(delighted\)|^\(amused\)/);
  assert.doesNotMatch(output.speechText, /\[/);
});

test("expressividade desligada retorna apenas texto limpo", () => {
  const output = compileFishAudioSpeech("Que ótima notícia...", expression("playful"), "off");
  assert.equal(output.speechText, "Que ótima notícia...");
  assert.equal(output.transcriptText, "Que ótima notícia...");
});
