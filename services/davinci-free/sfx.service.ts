import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { getLocalDataDir } from "@/lib/runtime-paths";

export type SFXType = "whoosh" | "pop" | "chime" | "swoosh";

const SFX_DIR = path.join(getLocalDataDir(), "davinci-resolve-free", "sfx");

function generateWavHeader(numSamples: number, sampleRate = 48000): Buffer {
  const bytesPerSample = 2; // 16-bit PCM
  const dataSize = numSamples * bytesPerSample;
  const header = Buffer.alloc(44);

  // RIFF header
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);

  // fmt chunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size
  header.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
  header.writeUInt16LE(1, 22);  // NumChannels (1 = Mono)
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * bytesPerSample, 28); // ByteRate
  header.writeUInt16LE(bytesPerSample, 32); // BlockAlign
  header.writeUInt16LE(16, 34); // BitsPerSample

  // data chunk
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
    const t = i / numSamples; // 0 to 1
    const env = Math.sin(Math.PI * t); // Smooth bell curve envelope
    // Noise + frequency sweep
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
    const env = Math.pow(1 - t, 2.5); // Exponential decay
    const freq = 480 - t * 320; // Pitch drop
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
    const f1 = 880; // A5
    const f2 = 1320; // E6
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
  };

  if (sfxInitialized) return paths;

  const tasks: Array<Promise<void>> = [];

  if (!existsSync(paths.whoosh)) tasks.push(writeFile(paths.whoosh, synthesizeWhoosh()));
  if (!existsSync(paths.pop)) tasks.push(writeFile(paths.pop, synthesizePop()));
  if (!existsSync(paths.chime)) tasks.push(writeFile(paths.chime, synthesizeChime()));
  if (!existsSync(paths.swoosh)) tasks.push(writeFile(paths.swoosh, synthesizeSwoosh()));

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }

  sfxInitialized = true;
  return paths;
}
