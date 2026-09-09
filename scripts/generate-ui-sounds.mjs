import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const OUTPUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public/sounds/ui",
);

function seededNoise(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

function createSound(duration) {
  return {
    duration,
    frames: new Float64Array(Math.ceil(duration * SAMPLE_RATE) * CHANNELS),
  };
}

function envelope(time, duration, attack = 0.008, release = 0.08) {
  const fadeIn = Math.min(1, time / attack);
  const fadeOut = Math.min(1, (duration - time) / release);
  return Math.max(0, Math.min(fadeIn, fadeOut));
}

function panGains(pan) {
  const angle = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return [Math.cos(angle), Math.sin(angle)];
}

function addTone(sound, options) {
  const {
    start = 0,
    duration,
    from,
    to = from,
    gain = 0.2,
    attack = 0.008,
    release = 0.08,
    panFrom = 0,
    panTo = panFrom,
    wave = "sine",
  } = options;
  const firstFrame = Math.floor(start * SAMPLE_RATE);
  const frameCount = Math.floor(duration * SAMPLE_RATE);
  let phase = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const index = firstFrame + frame;
    if (index >= sound.frames.length / CHANNELS) break;
    const time = frame / SAMPLE_RATE;
    const progress = frameCount <= 1 ? 1 : frame / (frameCount - 1);
    const frequency = from * Math.pow(to / from, progress);
    phase += (2 * Math.PI * frequency) / SAMPLE_RATE;
    const oscillator = wave === "triangle"
      ? (2 / Math.PI) * Math.asin(Math.sin(phase))
      : Math.sin(phase);
    const amplitude = gain * envelope(time, duration, attack, release);
    const [left, right] = panGains(panFrom + (panTo - panFrom) * progress);
    sound.frames[index * CHANNELS] += oscillator * amplitude * left;
    sound.frames[index * CHANNELS + 1] += oscillator * amplitude * right;
  }
}

function addNoise(sound, options) {
  const {
    start = 0,
    duration,
    gain = 0.08,
    attack = 0.002,
    release = 0.06,
    cutoff = 2_400,
    panFrom = 0,
    panTo = panFrom,
    seed = 1,
  } = options;
  const random = seededNoise(seed);
  const coefficient = 1 - Math.exp((-2 * Math.PI * cutoff) / SAMPLE_RATE);
  const firstFrame = Math.floor(start * SAMPLE_RATE);
  const frameCount = Math.floor(duration * SAMPLE_RATE);
  let filtered = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const index = firstFrame + frame;
    if (index >= sound.frames.length / CHANNELS) break;
    const time = frame / SAMPLE_RATE;
    const progress = frameCount <= 1 ? 1 : frame / (frameCount - 1);
    filtered += coefficient * (random() - filtered);
    const amplitude = gain * envelope(time, duration, attack, release);
    const [left, right] = panGains(panFrom + (panTo - panFrom) * progress);
    sound.frames[index * CHANNELS] += filtered * amplitude * left;
    sound.frames[index * CHANNELS + 1] += filtered * amplitude * right;
  }
}

function finalize(sound, targetPeak) {
  const dc = sound.frames.reduce((sum, sample) => sum + sample, 0) / sound.frames.length;
  let peak = 0;
  for (let index = 0; index < sound.frames.length; index += 1) {
    sound.frames[index] -= dc;
    peak = Math.max(peak, Math.abs(sound.frames[index]));
  }
  const scale = peak > 0 ? targetPeak / peak : 1;
  for (let index = 0; index < sound.frames.length; index += 1) {
    sound.frames[index] *= scale;
  }
  return sound;
}

function encodeWave(sound) {
  const bytesPerSample = 2;
  const dataSize = sound.frames.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * bytesPerSample, 28);
  buffer.writeUInt16LE(CHANNELS * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  sound.frames.forEach((sample, index) => {
    const pcm = Math.round(Math.max(-1, Math.min(1, sample)) * 32_767);
    buffer.writeInt16LE(pcm, 44 + index * bytesPerSample);
  });
  return buffer;
}

const builders = {
  "send.wav": () => {
    const sound = createSound(0.14);
    addTone(sound, { duration: 0.12, from: 760, to: 430, gain: 0.32, release: 0.055, panFrom: -0.18, panTo: 0.18 });
    addTone(sound, { start: 0.015, duration: 0.08, from: 1_520, to: 980, gain: 0.08, release: 0.04, panFrom: -0.1, panTo: 0.28 });
    addNoise(sound, { duration: 0.045, gain: 0.035, cutoff: 3_800, release: 0.035, seed: 101 });
    return finalize(sound, 0.4);
  },
  "receive.wav": () => {
    const sound = createSound(0.26);
    addTone(sound, { start: 0.015, duration: 0.15, from: 523.25, gain: 0.22, release: 0.09, panFrom: -0.22, panTo: 0 });
    addTone(sound, { start: 0.085, duration: 0.15, from: 783.99, gain: 0.19, release: 0.09, panFrom: 0, panTo: 0.22 });
    addTone(sound, { start: 0.1, duration: 0.12, from: 1_567.98, gain: 0.045, release: 0.08, panFrom: 0.08, panTo: 0.3 });
    return finalize(sound, 0.38);
  },
  "success.wav": () => {
    const sound = createSound(0.46);
    [587.33, 739.99, 880].forEach((frequency, index) => {
      addTone(sound, { start: 0.035 + index * 0.055, duration: 0.29, from: frequency, gain: 0.15, release: 0.2, panFrom: -0.3 + index * 0.3, panTo: 0.18 });
      addTone(sound, { start: 0.05 + index * 0.055, duration: 0.2, from: frequency * 2, gain: 0.03, release: 0.16, panFrom: 0.2, panTo: -0.12 + index * 0.12 });
    });
    addNoise(sound, { start: 0.12, duration: 0.18, gain: 0.025, cutoff: 6_500, release: 0.16, panFrom: -0.45, panTo: 0.45, seed: 202 });
    return finalize(sound, 0.48);
  },
  "attention.wav": () => {
    const sound = createSound(0.5);
    [0.025, 0.245].forEach((start, index) => {
      addTone(sound, { start, duration: 0.18, from: 440, to: 466.16, gain: 0.22, attack: 0.012, release: 0.11, panFrom: index ? 0.12 : -0.12, panTo: 0 });
      addTone(sound, { start: start + 0.015, duration: 0.145, from: 659.25, gain: 0.08, attack: 0.012, release: 0.1, panFrom: 0, panTo: index ? -0.16 : 0.16 });
    });
    return finalize(sound, 0.42);
  },
  "error.wav": () => {
    const sound = createSound(0.34);
    addTone(sound, { start: 0.01, duration: 0.3, from: 174.61, to: 103.83, gain: 0.32, attack: 0.004, release: 0.19, wave: "triangle" });
    addTone(sound, { start: 0.03, duration: 0.24, from: 261.63, to: 146.83, gain: 0.11, release: 0.16, panFrom: 0.14, panTo: -0.14 });
    addNoise(sound, { start: 0.005, duration: 0.11, gain: 0.075, cutoff: 900, release: 0.09, seed: 303 });
    return finalize(sound, 0.46);
  },
  "mic-on.wav": () => {
    const sound = createSound(0.2);
    addTone(sound, { start: 0.01, duration: 0.17, from: 310, to: 840, gain: 0.27, attack: 0.006, release: 0.07, panFrom: -0.28, panTo: 0.28 });
    addTone(sound, { start: 0.08, duration: 0.09, from: 1_680, to: 1_940, gain: 0.055, release: 0.065, panFrom: 0.08, panTo: 0.32 });
    return finalize(sound, 0.38);
  },
  "mic-off.wav": () => {
    const sound = createSound(0.2);
    addTone(sound, { start: 0.01, duration: 0.17, from: 840, to: 310, gain: 0.27, attack: 0.006, release: 0.07, panFrom: 0.28, panTo: -0.28 });
    addTone(sound, { start: 0.015, duration: 0.09, from: 1_940, to: 1_320, gain: 0.05, release: 0.06, panFrom: 0.3, panTo: 0 });
    return finalize(sound, 0.38);
  },
  "task-complete.wav": () => {
    const sound = createSound(0.72);
    addTone(sound, { duration: 0.28, from: 146.83, to: 110, gain: 0.25, attack: 0.003, release: 0.2, wave: "triangle" });
    addNoise(sound, { duration: 0.13, gain: 0.07, cutoff: 1_700, release: 0.11, panFrom: -0.2, panTo: 0.2, seed: 404 });
    [293.66, 440, 587.33, 739.99].forEach((frequency, index) => {
      const start = 0.065 + index * 0.08;
      addTone(sound, { start, duration: 0.43 - index * 0.035, from: frequency, gain: 0.13, release: 0.28, panFrom: -0.32 + index * 0.2, panTo: 0.18 - index * 0.1 });
      addTone(sound, { start: start + 0.018, duration: 0.28, from: frequency * 2, gain: 0.025, release: 0.22, panFrom: 0.2, panTo: -0.2 });
    });
    addTone(sound, { start: 0.31, duration: 0.35, from: 1_174.66, to: 1_320, gain: 0.055, attack: 0.02, release: 0.3, panFrom: -0.42, panTo: 0.42 });
    return finalize(sound, 0.52);
  },
};

const descriptions = {
  "send.wav": "Pulso curto para confirmar o envio de uma acao.",
  "receive.wav": "Duas notas leves para indicar uma nova resposta.",
  "success.wav": "Acorde ascendente para uma operacao concluida.",
  "attention.wav": "Dois pulsos para uma decisao ou aprovacao pendente.",
  "error.wav": "Impacto grave e amortecido para uma falha definitiva.",
  "mic-on.wav": "Varredura ascendente para o inicio da captura de voz.",
  "mic-off.wav": "Varredura descendente para o fim da captura de voz.",
  "task-complete.wav": "Assinatura sonora para o encerramento de tarefas importantes.",
};

await mkdir(OUTPUT_DIR, { recursive: true });
const files = [];
for (const [name, build] of Object.entries(builders)) {
  const sound = build();
  const wav = encodeWave(sound);
  await writeFile(path.join(OUTPUT_DIR, name), wav);
  files.push({
    name,
    event: name.replace(".wav", "").replaceAll("-", "."),
    description: descriptions[name],
    durationMs: Math.round(sound.duration * 1_000),
    sha256: createHash("sha256").update(wav).digest("hex"),
  });
}

const manifest = {
  collection: "Kaoz.1 Sonic Identity — Dark Tech",
  version: "1.0.0",
  author: "Kaoz.1",
  generatedOn: "2026-09-09",
  method: "Sintese procedural original e deterministica",
  generator: "scripts/generate-ui-sounds.mjs",
  generatorVersion: "1.0.0",
  thirdPartySamples: false,
  license: "Proprietary — Kaoz.1",
  format: { container: "WAV", encoding: "PCM signed 16-bit", sampleRate: SAMPLE_RATE, channels: CHANNELS },
  files,
};

await writeFile(
  path.join(OUTPUT_DIR, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(`Generated ${files.length} original UI sounds in ${OUTPUT_DIR}`);
