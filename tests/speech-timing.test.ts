import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { normalizeSpeechTiming } from "../services/speech/speech-timing.ts";
import {
  approximateTimedWords,
  captionsFromTranscript,
  remapCaptionOverrides,
  transcriptTimingPrecision,
} from "../services/davinci-free/caption-timing.ts";
import { transactionalWrite } from "../services/davinci-free/transactional-write.ts";

test("normaliza palavras e segmentos temporizados dos motores de fala", () => {
  const timing = normalizeSpeechTiming({
    timingPrecision: "precise",
    segments: [{
      start: 1,
      end: 2.4,
      text: "Olá mundo",
      words: [
        { start: 1.05, end: 1.42, word: "Olá", probability: 0.97 },
        { start: 1.58, end: 2.2, word: "mundo", probability: 0.94 },
      ],
    }],
  });
  assert.equal(timing.timingPrecision, "precise");
  assert.deepEqual(timing.words.map(({ start, end, text }) => ({ start, end, text })), [
    { start: 1.05, end: 1.42, text: "Olá" },
    { start: 1.58, end: 2.2, text: "mundo" },
  ]);
});

test("aceita o verbose JSON do whisper.cpp com offsets em milissegundos", () => {
  const timing = normalizeSpeechTiming({
    transcription: [{ offsets: { from: 500, to: 1_900 }, text: "trecho reconhecido" }],
  });
  assert.deepEqual(timing.segments, [{ start: 0.5, end: 1.9, text: "trecho reconhecido" }]);
  assert.equal(timing.timingPrecision, "approximate");
});

test("segmenta timestamps precisos por pausas, pontuação e no máximo sete palavras", () => {
  const words = [
    [0.2, 0.5, "Bem-vindo"], [0.55, 0.8, "ao"], [0.82, 1.1, "curso."],
    [1.7, 1.95, "Agora"], [2, 2.2, "vamos"], [2.22, 2.5, "começar"],
  ].map(([start, end, text]) => ({ start: Number(start), end: Number(end), text: String(text) }));
  const transcript = [{
    start: 0.2, end: 2.5, text: words.map((word) => word.text).join(" "), source: "local-asr" as const,
    words, timingPrecision: "precise" as const,
  }];
  const captions = captionsFromTranscript(transcript, 3);
  assert.equal(captions.length, 2);
  assert.ok(captions.every((caption) => caption.words!.length <= 7));
  assert.ok(captions[0].start <= words[0].start && words[0].start - captions[0].start <= 0.181);
  assert.ok(captions[0].end <= captions[1].start);
  assert.ok(captions[1].start < words[3].start);
  assert.ok(words[3].start - captions[1].start <= 0.181);
  assert.equal(transcriptTimingPrecision(transcript), "precise");
});

test("antecipa a troca entre blocos contínuos sem criar sobreposição", () => {
  const words = [
    [0.2, 0.5, "Uma"], [0.5, 0.8, "frase"], [0.8, 1.1, "termina."],
    [1.1, 1.4, "Outra"], [1.4, 1.7, "começa"], [1.7, 2, "agora"],
  ].map(([start, end, text]) => ({ start: Number(start), end: Number(end), text: String(text) }));
  const captions = captionsFromTranscript([{
    start: 0.2, end: 2, text: words.map((word) => word.text).join(" "), source: "local-asr",
    words, timingPrecision: "precise",
  }], 2.2);
  assert.equal(captions.length, 2);
  assert.ok(captions[1].start < words[3].start);
  assert.ok(words[3].start - captions[1].start <= 0.141);
  assert.equal(captions[0].end, captions[1].start);
});

test("fallback web distribui 62 segundos somente pelas regiões com voz", () => {
  const intervals = [
    { start: 0.4, end: 12 },
    { start: 13.2, end: 31 },
    { start: 32.1, end: 49 },
    { start: 50.2, end: 62.37 },
  ];
  const text = Array.from({ length: 96 }, (_, index) => `palavra${index + 1}`).join(" ");
  const words = approximateTimedWords(text, 0, 62.37, intervals);
  const transcript = [{
    start: 0, end: 62.37, text, source: "webspeech" as const, words, timingPrecision: "approximate" as const,
  }];
  const captions = captionsFromTranscript(transcript, 62.37, intervals);
  assert.ok(captions.length > 12);
  assert.ok(captions.every((caption) => caption.words!.length <= 7));
  for (const silence of [[12, 13.2], [31, 32.1], [49, 50.2]]) {
    assert.ok(captions.every((caption) => !(caption.start < silence[0] && caption.end > silence[1])));
  }
  assert.equal(transcriptTimingPrecision(transcript), "approximate");
});

test("resincronização remapeia texto e visibilidade, mas descarta tempos manuais", () => {
  const oldCaptions = [
    { start: 0, end: 3, text: "voce tomou a decisao correta" },
    { start: 3, end: 6, text: "vamos comecar agora" },
  ];
  const newCaptions = [
    { start: 0.4, end: 2.5, text: "você tomou a decisão correta" },
    { start: 3.4, end: 5.4, text: "vamos começar agora" },
  ];
  const result = remapCaptionOverrides(oldCaptions, newCaptions, [
    { index: 0, text: "Você tomou a decisão correta.", start: 1, end: 4 },
    { index: 1, enabled: false },
  ]);
  assert.equal(result.unmatched, 0);
  assert.deepEqual(result.overrides, [
    { index: 0, text: "Você tomou a decisão correta." },
    { index: 1, enabled: false },
  ]);
});

test("gravação transacional restaura todos os artefatos quando uma substituição falha", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kaoz-caption-transaction-"));
  const first = path.join(directory, "plan.json");
  const second = path.join(directory, "captions.srt");
  await writeFile(first, "plano antigo", "utf8");
  await writeFile(second, "legendas antigas", "utf8");
  await assert.rejects(
    transactionalWrite([
      { target: first, content: "plano novo" },
      { target: second, content: "legendas novas" },
    ], (index) => {
      if (index === 1) throw new Error("falha simulada");
    }),
    /falha simulada/,
  );
  assert.equal(await readFile(first, "utf8"), "plano antigo");
  assert.equal(await readFile(second, "utf8"), "legendas antigas");
  await rm(directory, { recursive: true, force: true });
});
