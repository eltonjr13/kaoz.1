import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { getLocalDataDir } from "@/lib/runtime-paths";

export type SFXType =
  | "whoosh"
  | "pop"
  | "chime"
  | "swoosh"
  | "vine-boom"
  | "anime-wow"
  | "rizz"
  | "fart"
  | "bone-crack"
  | "among-us"
  | "faah";

const SFX_DIR = path.join(process.cwd(), "public", "sfx");

function generateWavHeader(numSamples: number, sampleRate = 48000): Buffer {
  const bytesPerSample = 2; // 16-bit PCM
  const dataSize = numSamples * bytesPerSample;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);

  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);  // PCM
  header.writeUInt16LE(1, 22);  // Mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * bytesPerSample, 28);
  header.writeUInt16LE(bytesPerSample, 32);
  header.writeUInt16LE(16, 34);

  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return header;
}

function synthesizeWhoosh(sampleRate = 48000): Buffer {
  const duration = 0.28;
  const numSamples = Math.floor(sampleRate * duration);
  const header = generateWavHeader(numSamples, sampleRate);
  const data = Buffer.alloc(numSamples * 2);

  for (let i = 0; i < numSamples; i++) {
    const t = i / numSamples;
    const env = Math.sin(Math.PI * t);
    const noise = Math.random() * 2 - 1;
    const sweepFreq = 180 + Math.sin(t * Math.PI) * 420;
    const tone = Math.sin(2 * Math.PI * sweepFreq * (i / sampleRate));
    const sample = Math.max(-1, Math.min(1, (noise * 0.65 + tone * 0.35) * env * 0.7));
    data.writeInt16LE(Math.floor(sample * 32767), i * 2);
  }

  return Buffer.concat([header, data]);
}

function synthesizePop(sampleRate = 48000): Buffer {
  const duration = 0.07;
  const numSamples = Math.floor(sampleRate * duration);
  const header = generateWavHeader(numSamples, sampleRate);
  const data = Buffer.alloc(numSamples * 2);

  for (let i = 0; i < numSamples; i++) {
    const t = i / numSamples;
    const env = Math.pow(1 - t, 2.5);
    const freq = 480 - t * 320;
    const sample = Math.sin(2 * Math.PI * freq * (i / sampleRate)) * env * 0.75;
    data.writeInt16LE(Math.floor(sample * 32767), i * 2);
  }

  return Buffer.concat([header, data]);
}

function synthesizeChime(sampleRate = 48000): Buffer {
  const duration = 0.32;
  const numSamples = Math.floor(sampleRate * duration);
  const header = generateWavHeader(numSamples, sampleRate);
  const data = Buffer.alloc(numSamples * 2);

  for (let i = 0; i < numSamples; i++) {
    const t = i / numSamples;
    const env = Math.sin(Math.PI * Math.sqrt(t)) * Math.pow(1 - t, 1.8);
    const f1 = 880;
    const f2 = 1320;
    const tone1 = Math.sin(2 * Math.PI * f1 * (i / sampleRate));
    const tone2 = Math.sin(2 * Math.PI * f2 * (i / sampleRate));
    const sample = (tone1 * 0.6 + tone2 * 0.4) * env * 0.65;
    data.writeInt16LE(Math.floor(sample * 32767), i * 2);
  }

  return Buffer.concat([header, data]);
}

function synthesizeSwoosh(sampleRate = 48000): Buffer {
  const duration = 0.22;
  const numSamples = Math.floor(sampleRate * duration);
  const header = generateWavHeader(numSamples, sampleRate);
  const data = Buffer.alloc(numSamples * 2);

  for (let i = 0; i < numSamples; i++) {
    const t = i / numSamples;
    const env = Math.sin(Math.PI * t);
    const noise = Math.random() * 2 - 1;
    const freq = 220 + t * 450;
    const tone = Math.sin(2 * Math.PI * freq * (i / sampleRate));
    const sample = (noise * 0.4 + tone * 0.6) * env * 0.6;
    data.writeInt16LE(Math.floor(sample * 32767), i * 2);
  }

  return Buffer.concat([header, data]);
}

// MEME SOUNDBOARD SYNTHESIZERS

function synthesizeVineBoom(sampleRate = 48000): Buffer {
  const duration = 0.85;
  const numSamples = Math.floor(sampleRate * duration);
  const header = generateWavHeader(numSamples, sampleRate);
  const data = Buffer.alloc(numSamples * 2);

  for (let i = 0; i < numSamples; i++) {
    const t = i / numSamples;
    const env = Math.pow(1 - t, 1.5);
    const freq = 65 - t * 35; // Deep sub-bass pitch drop
    const sub = Math.sin(2 * Math.PI * freq * (i / sampleRate));
    const dist = Math.tanh(sub * 2.5); // Soft saturation distortion
    const sample = dist * env * 0.95;
    data.writeInt16LE(Math.floor(sample * 32767), i * 2);
  }

  return Buffer.concat([header, data]);
}

function synthesizeAnimeWow(sampleRate = 48000): Buffer {
  const duration = 0.45;
  const numSamples = Math.floor(sampleRate * duration);
  const header = generateWavHeader(numSamples, sampleRate);
  const data = Buffer.alloc(numSamples * 2);

  for (let i = 0; i < numSamples; i++) {
    const t = i / numSamples;
    const env = Math.sin(Math.PI * Math.sqrt(t)) * Math.pow(1 - t, 1.2);
    // Ascending arpeggio (F5, A5, C6)
    const step = Math.floor(t * 3);
    const f = step === 0 ? 698.46 : step === 1 ? 880 : 1046.5;
    const tone = Math.sin(2 * Math.PI * f * (i / sampleRate));
    const sample = tone * env * 0.8;
    data.writeInt16LE(Math.floor(sample * 32767), i * 2);
  }

  return Buffer.concat([header, data]);
}

function synthesizeRizz(sampleRate = 48000): Buffer {
  const duration = 0.65;
  const numSamples = Math.floor(sampleRate * duration);
  const header = generateWavHeader(numSamples, sampleRate);
  const data = Buffer.alloc(numSamples * 2);

  for (let i = 0; i < numSamples; i++) {
    const t = i / numSamples;
    const env = Math.sin(Math.PI * t);
    const freq = 130 + Math.pow(t, 2) * 260; // Pitch swell
    const vibrato = Math.sin(2 * Math.PI * 8 * t) * 12;
    const tone = Math.sin(2 * Math.PI * (freq + vibrato) * (i / sampleRate));
    const sample = tone * env * 0.85;
    data.writeInt16LE(Math.floor(sample * 32767), i * 2);
  }

  return Buffer.concat([header, data]);
}

function synthesizeFart(sampleRate = 48000): Buffer {
  const duration = 0.4;
  const numSamples = Math.floor(sampleRate * duration);
  const header = generateWavHeader(numSamples, sampleRate);
  const data = Buffer.alloc(numSamples * 2);

  for (let i = 0; i < numSamples; i++) {
    const t = i / numSamples;
    const env = Math.pow(1 - t, 1.8);
    const mod = Math.sin(2 * Math.PI * 25 * t) * 30;
    const freq = Math.max(20, 55 + mod - t * 20);
    const noise = (Math.random() * 2 - 1) * 0.3;
    const tone = Math.sin(2 * Math.PI * freq * (i / sampleRate));
    const sample = Math.max(-1, Math.min(1, (tone + noise) * env * 0.9));
    data.writeInt16LE(Math.floor(sample * 32767), i * 2);
  }

  return Buffer.concat([header, data]);
}

function synthesizeBoneCrack(sampleRate = 48000): Buffer {
  const duration = 0.12;
  const numSamples = Math.floor(sampleRate * duration);
  const header = generateWavHeader(numSamples, sampleRate);
  const data = Buffer.alloc(numSamples * 2);

  for (let i = 0; i < numSamples; i++) {
    const t = i / numSamples;
    const env = Math.pow(1 - t, 4);
    const transient = Math.random() * 2 - 1;
    const tone = Math.sin(2 * Math.PI * 1200 * (i / sampleRate));
    const sample = (transient * 0.7 + tone * 0.3) * env * 0.9;
    data.writeInt16LE(Math.floor(sample * 32767), i * 2);
  }

  return Buffer.concat([header, data]);
}

function synthesizeAmongUs(sampleRate = 48000): Buffer {
  const duration = 0.5;
  const numSamples = Math.floor(sampleRate * duration);
  const header = generateWavHeader(numSamples, sampleRate);
  const data = Buffer.alloc(numSamples * 2);

  for (let i = 0; i < numSamples; i++) {
    const t = i / numSamples;
    const env = t < 0.2 ? Math.sin(Math.PI * 2.5 * t) : Math.pow(1 - (t - 0.2) / 0.8, 2);
    const f = t < 0.22 ? 523.25 : 659.25; // C5 to E5
    const tone = Math.sin(2 * Math.PI * f * (i / sampleRate));
    const sample = tone * env * 0.85;
    data.writeInt16LE(Math.floor(sample * 32767), i * 2);
  }

  return Buffer.concat([header, data]);
}

function synthesizeFaah(sampleRate = 48000): Buffer {
  const duration = 0.55;
  const numSamples = Math.floor(sampleRate * duration);
  const header = generateWavHeader(numSamples, sampleRate);
  const data = Buffer.alloc(numSamples * 2);

  for (let i = 0; i < numSamples; i++) {
    const t = i / numSamples;
    const env = Math.sin(Math.PI * t);
    const freq = 380 - t * 240; // Vocal pitch drop
    const formant = Math.sin(2 * Math.PI * freq * (i / sampleRate)) * 0.7 + Math.sin(2 * Math.PI * (freq * 2) * (i / sampleRate)) * 0.3;
    const sample = formant * env * 0.8;
    data.writeInt16LE(Math.floor(sample * 32767), i * 2);
  }

  return Buffer.concat([header, data]);
}

let sfxInitialized = false;

export async function ensureSfxLibrary(): Promise<Record<SFXType, string>> {
  if (!existsSync(SFX_DIR)) {
    await mkdir(SFX_DIR, { recursive: true });
  }

  const paths: Record<SFXType, string> = {
    whoosh: path.join(SFX_DIR, "whoosh.wav"),
    pop: path.join(SFX_DIR, "pop.wav"),
    chime: path.join(SFX_DIR, "chime.wav"),
    swoosh: path.join(SFX_DIR, "swoosh.wav"),
    "vine-boom": path.join(SFX_DIR, "vine-boom.wav"),
    "anime-wow": path.join(SFX_DIR, "anime-wow.wav"),
    rizz: path.join(SFX_DIR, "rizz.wav"),
    fart: path.join(SFX_DIR, "fart.wav"),
    "bone-crack": path.join(SFX_DIR, "bone-crack.wav"),
    "among-us": path.join(SFX_DIR, "among-us.wav"),
    faah: path.join(SFX_DIR, "faah.wav"),
  };

  if (sfxInitialized) return paths;

  const tasks: Array<Promise<void>> = [];

  if (!existsSync(paths.whoosh)) tasks.push(writeFile(paths.whoosh, synthesizeWhoosh()));
  if (!existsSync(paths.pop)) tasks.push(writeFile(paths.pop, synthesizePop()));
  if (!existsSync(paths.chime)) tasks.push(writeFile(paths.chime, synthesizeChime()));
  if (!existsSync(paths.swoosh)) tasks.push(writeFile(paths.swoosh, synthesizeSwoosh()));
  if (!existsSync(paths["vine-boom"])) tasks.push(writeFile(paths["vine-boom"], synthesizeVineBoom()));
  if (!existsSync(paths["anime-wow"])) tasks.push(writeFile(paths["anime-wow"], synthesizeAnimeWow()));
  if (!existsSync(paths.rizz)) tasks.push(writeFile(paths.rizz, synthesizeRizz()));
  if (!existsSync(paths.fart)) tasks.push(writeFile(paths.fart, synthesizeFart()));
  if (!existsSync(paths["bone-crack"])) tasks.push(writeFile(paths["bone-crack"], synthesizeBoneCrack()));
  if (!existsSync(paths["among-us"])) tasks.push(writeFile(paths["among-us"], synthesizeAmongUs()));
  if (!existsSync(paths.faah)) tasks.push(writeFile(paths.faah, synthesizeFaah()));

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }

  sfxInitialized = true;
  return paths;
}
