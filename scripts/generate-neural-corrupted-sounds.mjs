import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/sounds/neural-corrupted");

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0xffffffff;
  };
}

function createSound(duration) {
  return { duration, frames: new Float64Array(Math.ceil(duration * SAMPLE_RATE) * CHANNELS) };
}

function smoothstep(value) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function shapedEnvelope(time, duration, attack, release, curve = 1.5) {
  if (time < 0 || time > duration) return 0;
  const fadeIn = smoothstep(time / Math.max(attack, 0.0001));
  const fadeOut = smoothstep((duration - time) / Math.max(release, 0.0001));
  return Math.pow(Math.min(fadeIn, fadeOut), curve);
}

function panGains(pan) {
  const angle = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return [Math.cos(angle), Math.sin(angle)];
}

function writeStereo(sound, frame, value, pan) {
  if (frame < 0 || frame >= sound.frames.length / CHANNELS) return;
  const [left, right] = panGains(pan);
  sound.frames[frame * CHANNELS] += value * left;
  sound.frames[frame * CHANNELS + 1] += value * right;
}

function addFmVoice(sound, options) {
  const {
    start = 0, duration, carrierFrom, carrierTo = carrierFrom, modRatio = 1.414,
    indexFrom = 1, indexTo = 0.15, gain = 0.15, attack = 0.012,
    release = 0.18, panFrom = 0, panTo = panFrom, sub = 0,
  } = options;
  const firstFrame = Math.floor(start * SAMPLE_RATE);
  const frameCount = Math.floor(duration * SAMPLE_RATE);
  let carrierPhase = 0;
  let modPhase = 0;
  let subPhase = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / SAMPLE_RATE;
    const progress = frameCount <= 1 ? 1 : frame / (frameCount - 1);
    const frequency = carrierFrom * Math.pow(carrierTo / carrierFrom, progress);
    carrierPhase += (2 * Math.PI * frequency) / SAMPLE_RATE;
    modPhase += (2 * Math.PI * frequency * modRatio) / SAMPLE_RATE;
    subPhase += (Math.PI * frequency) / SAMPLE_RATE;
    const modulationIndex = indexFrom + (indexTo - indexFrom) * smoothstep(progress);
    const body = Math.sin(carrierPhase + Math.sin(modPhase) * modulationIndex);
    const subBody = sub > 0 ? Math.sin(subPhase) * sub : 0;
    const envelope = shapedEnvelope(time, duration, attack, release);
    const pan = panFrom + (panTo - panFrom) * smoothstep(progress);
    writeStereo(sound, firstFrame + frame, (body + subBody) * gain * envelope, pan);
  }
}

function addModalImpact(sound, options) {
  const {
    start = 0, base, gain = 0.25, pan = 0, seed = 1,
    modes = [[1, 1, 0.18], [1.713, 0.55, 0.12], [2.418, 0.3, 0.09], [3.937, 0.14, 0.06]],
  } = options;
  const random = seededRandom(seed);
  const duration = Math.max(...modes.map(([, , decay]) => decay * 7));
  const firstFrame = Math.floor(start * SAMPLE_RATE);
  const frameCount = Math.floor(duration * SAMPLE_RATE);
  const phases = modes.map(() => random() * Math.PI * 2);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / SAMPLE_RATE;
    let sample = 0;
    modes.forEach(([ratio, amplitude, decay], index) => {
      const instability = 1 + Math.sin(time * 19 + index) * 0.0018;
      const phase = phases[index] + 2 * Math.PI * base * ratio * instability * time;
      sample += Math.sin(phase) * amplitude * Math.exp(-time / decay);
    });
    const transient = frame < 90 ? (random() * 2 - 1) * Math.exp(-frame / 24) * 0.6 : 0;
    writeStereo(sound, firstFrame + frame, (sample + transient) * gain, pan);
  }
}

function addGranularCloud(sound, options) {
  const {
    start = 0, duration, grains = 24, frequency = 1_100, spread = 0.7,
    gain = 0.055, seed = 1, reverseDensity = false,
  } = options;
  const random = seededRandom(seed);
  for (let grain = 0; grain < grains; grain += 1) {
    const position = reverseDensity ? 1 - Math.pow(random(), 2.3) : random();
    const grainStart = start + position * duration;
    const grainDuration = 0.012 + random() * 0.045;
    const grainFrequency = frequency * Math.pow(2, (random() * 2 - 1) * spread);
    const pan = random() * 1.4 - 0.7;
    const firstFrame = Math.floor(grainStart * SAMPLE_RATE);
    const frameCount = Math.floor(grainDuration * SAMPLE_RATE);
    const phaseOffset = random() * Math.PI * 2;
    const wobble = 7 + random() * 31;
    for (let frame = 0; frame < frameCount; frame += 1) {
      const progress = frame / Math.max(1, frameCount - 1);
      const window = Math.pow(Math.sin(Math.PI * progress), 2);
      const phase = phaseOffset + 2 * Math.PI * grainFrequency * (frame / SAMPLE_RATE)
        + Math.sin(progress * Math.PI * 2 * wobble) * 0.09;
      const dirt = (random() * 2 - 1) * 0.26;
      writeStereo(sound, firstFrame + frame, (Math.sin(phase) + dirt) * window * gain, pan);
    }
  }
}

function addSpectralSwell(sound, options) {
  const {
    start = 0, duration, gain = 0.08, lowCut = 500, highCut = 4_600,
    panFrom = -0.45, panTo = 0.45, seed = 1,
  } = options;
  const random = seededRandom(seed);
  const firstFrame = Math.floor(start * SAMPLE_RATE);
  const frameCount = Math.floor(duration * SAMPLE_RATE);
  const fastCoefficient = 1 - Math.exp((-2 * Math.PI * highCut) / SAMPLE_RATE);
  const slowCoefficient = 1 - Math.exp((-2 * Math.PI * lowCut) / SAMPLE_RATE);
  let fast = 0;
  let slow = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const progress = frame / Math.max(1, frameCount - 1);
    const noise = random() * 2 - 1;
    fast += fastCoefficient * (noise - fast);
    slow += slowCoefficient * (noise - slow);
    const envelope = Math.pow(smoothstep(progress), 2.1) * smoothstep((1 - progress) / 0.08);
    const pan = panFrom + (panTo - panFrom) * smoothstep(progress);
    writeStereo(sound, firstFrame + frame, (fast - slow) * gain * envelope, pan);
  }
}

function addDigitalFractures(sound, options) {
  const { start = 0, duration, count = 8, gain = 0.05, seed = 1 } = options;
  const random = seededRandom(seed);
  for (let fracture = 0; fracture < count; fracture += 1) {
    const firstFrame = Math.floor((start + random() * duration) * SAMPLE_RATE);
    const frameCount = Math.floor((0.002 + random() * 0.009) * SAMPLE_RATE);
    const frequency = 700 + random() * 3_800;
    const heldFrames = 3 + Math.floor(random() * 9);
    const pan = random() * 1.5 - 0.75;
    let heldValue = 0;
    for (let frame = 0; frame < frameCount; frame += 1) {
      if (frame % heldFrames === 0) {
        heldValue = Math.sin((2 * Math.PI * frequency * frame) / SAMPLE_RATE) * (random() * 0.6 + 0.4);
      }
      writeStereo(sound, firstFrame + frame, heldValue * gain * Math.pow(1 - frame / frameCount, 2), pan);
    }
  }
}

function applyCrossEcho(sound, taps) {
  const dry = sound.frames.slice();
  taps.forEach(({ delay, gain, cross = 0.5 }) => {
    const delayFrames = Math.floor(delay * SAMPLE_RATE);
    for (let frame = delayFrames; frame < sound.frames.length / CHANNELS; frame += 1) {
      const source = (frame - delayFrames) * CHANNELS;
      const target = frame * CHANNELS;
      sound.frames[target] += (dry[source] * (1 - cross) + dry[source + 1] * cross) * gain;
      sound.frames[target + 1] += (dry[source + 1] * (1 - cross) + dry[source] * cross) * gain;
    }
  });
}

function finalize(sound, targetPeak, drive = 1.5) {
  const tailFrames = Math.floor(0.025 * SAMPLE_RATE);
  const frameCount = sound.frames.length / CHANNELS;
  for (let frame = Math.max(0, frameCount - tailFrames); frame < frameCount; frame += 1) {
    const fade = smoothstep((frameCount - frame) / tailFrames);
    sound.frames[frame * CHANNELS] *= fade;
    sound.frames[frame * CHANNELS + 1] *= fade;
  }
  const dc = sound.frames.reduce((sum, sample) => sum + sample, 0) / sound.frames.length;
  const driveScale = Math.tanh(drive);
  let peak = 0;
  for (let index = 0; index < sound.frames.length; index += 1) {
    sound.frames[index] = Math.tanh((sound.frames[index] - dc) * drive) / driveScale;
    peak = Math.max(peak, Math.abs(sound.frames[index]));
  }
  const scale = peak > 0 ? targetPeak / peak : 1;
  for (let index = 0; index < sound.frames.length; index += 1) sound.frames[index] *= scale;
  return sound;
}

function encodeWave(sound) {
  const dataSize = sound.frames.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * 2, 28);
  buffer.writeUInt16LE(CHANNELS * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  sound.frames.forEach((sample, index) => {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32_767), 44 + index * 2);
  });
  return buffer;
}

const builders = {
  "app-open.wav": () => {
    const sound = createSound(1.62);
    addSpectralSwell(sound, { start: 0.03, duration: 0.82, gain: 0.095, lowCut: 310, highCut: 5_200, seed: 101 });
    addGranularCloud(sound, { start: 0.08, duration: 0.92, grains: 48, frequency: 980, spread: 1.15, gain: 0.028, seed: 102, reverseDensity: true });
    addModalImpact(sound, { start: 0.48, base: 73.42, gain: 0.28, pan: -0.05, seed: 103, modes: [[1, 1, 0.31], [1.497, 0.42, 0.23], [2.731, 0.24, 0.16], [4.119, 0.13, 0.1]] });
    addFmVoice(sound, { start: 0.55, duration: 0.72, carrierFrom: 146.83, carrierTo: 155.56, modRatio: 1.618, indexFrom: 4.8, indexTo: 0.45, gain: 0.15, attack: 0.035, release: 0.45, panFrom: -0.38, panTo: 0.08, sub: 0.28 });
    addFmVoice(sound, { start: 0.78, duration: 0.67, carrierFrom: 207.65, carrierTo: 220, modRatio: 2.414, indexFrom: 3.3, indexTo: 0.25, gain: 0.11, attack: 0.028, release: 0.43, panFrom: 0.32, panTo: -0.08 });
    addFmVoice(sound, { start: 1.01, duration: 0.53, carrierFrom: 329.63, carrierTo: 311.13, modRatio: 1.337, indexFrom: 2.1, indexTo: 0.12, gain: 0.08, attack: 0.022, release: 0.4, panFrom: -0.12, panTo: 0.34 });
    addDigitalFractures(sound, { start: 0.3, duration: 0.78, count: 13, gain: 0.032, seed: 104 });
    applyCrossEcho(sound, [{ delay: 0.037, gain: 0.16, cross: 0.72 }, { delay: 0.083, gain: 0.085, cross: 0.88 }]);
    return finalize(sound, 0.54, 1.85);
  },
  "task-complete.wav": () => {
    const sound = createSound(1.04);
    addModalImpact(sound, { start: 0.015, base: 91.75, gain: 0.24, pan: -0.08, seed: 201, modes: [[1, 1, 0.22], [1.618, 0.4, 0.16], [2.889, 0.21, 0.11], [4.237, 0.11, 0.07]] });
    addGranularCloud(sound, { start: 0.02, duration: 0.56, grains: 31, frequency: 1_250, spread: 0.92, gain: 0.026, seed: 202 });
    [[0.14, 146.83, -0.3], [0.3, 207.65, 0.28], [0.47, 329.63, -0.04]].forEach(([start, frequency, pan], index) => {
      addFmVoice(sound, { start, duration: 0.5, carrierFrom: frequency, carrierTo: frequency * (index === 1 ? 1.04 : 0.985), modRatio: 1.618 + index * 0.398, indexFrom: 3.8 - index * 0.7, indexTo: 0.18, gain: 0.14 - index * 0.02, attack: 0.018, release: 0.34, panFrom: pan, panTo: -pan * 0.45, sub: index === 0 ? 0.22 : 0 });
    });
    addDigitalFractures(sound, { start: 0.04, duration: 0.62, count: 9, gain: 0.028, seed: 203 });
    applyCrossEcho(sound, [{ delay: 0.029, gain: 0.14, cross: 0.78 }, { delay: 0.071, gain: 0.07, cross: 0.9 }]);
    return finalize(sound, 0.51, 1.7);
  },
  "error.wav": () => {
    const sound = createSound(0.69);
    addModalImpact(sound, { start: 0.005, base: 61.74, gain: 0.34, pan: 0, seed: 301, modes: [[1, 1, 0.2], [1.463, 0.53, 0.17], [2.117, 0.28, 0.12], [3.66, 0.15, 0.08]] });
    addFmVoice(sound, { start: 0.025, duration: 0.54, carrierFrom: 233.08, carrierTo: 82.41, modRatio: 1.731, indexFrom: 5.4, indexTo: 1.2, gain: 0.18, attack: 0.006, release: 0.31, panFrom: 0.32, panTo: -0.38, sub: 0.35 });
    addGranularCloud(sound, { start: 0.04, duration: 0.42, grains: 25, frequency: 520, spread: 1.28, gain: 0.038, seed: 302 });
    addDigitalFractures(sound, { start: 0.015, duration: 0.36, count: 15, gain: 0.047, seed: 303 });
    applyCrossEcho(sound, [{ delay: 0.024, gain: 0.1, cross: 0.82 }]);
    return finalize(sound, 0.49, 2.15);
  },
  "attention.wav": () => {
    const sound = createSound(0.82);
    [0.015, 0.265, 0.505].forEach((start, index) => {
      addFmVoice(sound, { start, duration: 0.27, carrierFrom: index === 1 ? 207.65 : 185, carrierTo: index === 2 ? 196 : 185, modRatio: 2.414, indexFrom: 3.7, indexTo: 0.55, gain: index === 2 ? 0.13 : 0.16, attack: 0.008, release: 0.16, panFrom: index % 2 ? 0.22 : -0.22, panTo: 0, sub: 0.12 });
      addModalImpact(sound, { start: start + 0.008, base: index === 1 ? 103.83 : 92.5, gain: 0.095, pan: index % 2 ? 0.2 : -0.2, seed: 400 + index });
    });
    addGranularCloud(sound, { start: 0.04, duration: 0.59, grains: 18, frequency: 1_600, spread: 0.7, gain: 0.018, seed: 404 });
    addDigitalFractures(sound, { start: 0.09, duration: 0.5, count: 7, gain: 0.022, seed: 405 });
    return finalize(sound, 0.43, 1.8);
  },
  "mic-on.wav": () => {
    const sound = createSound(0.36);
    addSpectralSwell(sound, { start: 0.005, duration: 0.23, gain: 0.085, lowCut: 700, highCut: 6_200, panFrom: -0.42, panTo: 0.36, seed: 501 });
    addFmVoice(sound, { start: 0.045, duration: 0.27, carrierFrom: 164.81, carrierTo: 493.88, modRatio: 1.618, indexFrom: 4.2, indexTo: 0.3, gain: 0.17, attack: 0.01, release: 0.13, panFrom: -0.28, panTo: 0.28, sub: 0.14 });
    addGranularCloud(sound, { start: 0.04, duration: 0.2, grains: 11, frequency: 1_900, spread: 0.6, gain: 0.021, seed: 502, reverseDensity: true });
    addDigitalFractures(sound, { start: 0.04, duration: 0.18, count: 5, gain: 0.022, seed: 503 });
    return finalize(sound, 0.4, 1.65);
  },
  "navigate.wav": () => {
    const sound = createSound(0.17);
    addFmVoice(sound, { start: 0.004, duration: 0.125, carrierFrom: 311.13, carrierTo: 415.3, modRatio: 2.414, indexFrom: 3.2, indexTo: 0.28, gain: 0.16, attack: 0.003, release: 0.07, panFrom: -0.3, panTo: 0.3 });
    addGranularCloud(sound, { start: 0.006, duration: 0.105, grains: 7, frequency: 1_450, spread: 0.8, gain: 0.023, seed: 601 });
    addDigitalFractures(sound, { start: 0.012, duration: 0.09, count: 3, gain: 0.018, seed: 602 });
    return finalize(sound, 0.31, 1.75);
  },
};

const metadata = {
  "app-open.wav": ["app.open", "O sistema desperta, se organiza e reconhece o usuario."],
  "task-complete.wav": ["task.complete", "As partes de uma tarefa se encaixam em uma conclusao firme."],
  "error.wav": ["error", "A estrutura digital perde estabilidade e colapsa."],
  "attention.wav": ["attention", "Uma presenca neural insiste por uma decisao do usuario."],
  "mic-on.wav": ["mic.on", "Um canal neural se abre para receber a voz."],
  "navigate.wav": ["navigate", "Um fragmento de informacao atravessa a interface."],
};

await mkdir(OUTPUT_DIR, { recursive: true });
const files = [];
for (const [name, build] of Object.entries(builders)) {
  const sound = build();
  const wav = encodeWave(sound);
  await writeFile(path.join(OUTPUT_DIR, name), wav);
  files.push({ name, event: metadata[name][0], description: metadata[name][1], durationMs: Math.round(sound.duration * 1_000), sha256: createHash("sha256").update(wav).digest("hex") });
}

const manifest = {
  collection: "Kaoz.1 Sonic Identity — Neural Corrompido",
  status: "prototype",
  version: "0.1.0",
  author: "Kaoz.1",
  generatedOn: "2026-09-09",
  method: "Sintese procedural original com FM, ressonadores modais, nuvens granulares e microfraturas digitais",
  generator: "scripts/generate-neural-corrupted-sounds.mjs",
  thirdPartySamples: false,
  license: "Proprietary — Kaoz.1",
  format: { container: "WAV", encoding: "PCM signed 16-bit", sampleRate: SAMPLE_RATE, channels: CHANNELS },
  files,
};

await writeFile(path.join(OUTPUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Generated ${files.length} Neural Corrompido prototypes in ${OUTPUT_DIR}`);
