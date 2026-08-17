/**
 * Sintetizador de Voz Real para Produção de Mídia e Campanhas
 * Gera arquivos de áudio WAV/MP3 com fala real em Português e Inglês.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, statSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execAsync = promisify(exec);

export interface SpeechSynthesisOptions {
  provider?: "fish-audio" | "cartesia" | "omnivoice" | "local";
  voiceModel?: string;
  voiceReferenceId?: string;
  durationSeconds?: number;
  lang?: string;
}

async function materializeGeneratedAudio(source: string, outputPath: string): Promise<number> {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Falha ao baixar a locução gerada: ${response.status} ${response.statusText}`);
    const audio = Buffer.from(await response.arrayBuffer());
    await writeFile(outputPath, audio);
    return audio.length;
  }

  const sourcePath = source.startsWith("/uploads/")
    ? path.join(process.cwd(), "public", source.replace(/^\//, ""))
    : path.resolve(source);
  if (!existsSync(sourcePath)) throw new Error(`O provedor informou um áudio inexistente: ${source}`);
  if (path.resolve(sourcePath) !== path.resolve(outputPath)) await copyFile(sourcePath, outputPath);
  return statSync(outputPath).size;
}

/**
 * Fallback sintético limpo se nenhum sintetizador de sistema estiver disponível
 */
function createSyntheticPcmWavBuffer(durationSeconds: number): Buffer {
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

/**
 * Sintetiza voz usando exatamente o provedor selecionado nas configurações.
 */
export async function synthesizeRealSpeechToFile(
  text: string,
  outputPath: string,
  options?: SpeechSynthesisOptions
): Promise<{ success: boolean; path: string; engine: "fish-audio" | "cartesia" | "omnivoice" | "windows-sapi" | "pcm-fallback"; bytes: number }> {
  await mkdir(path.dirname(outputPath), { recursive: true });

  const cleanText = text.trim();
  if (!cleanText) {
    const buf = createSyntheticPcmWavBuffer(options?.durationSeconds || 3);
    await writeFile(outputPath, buf);
    return { success: true, path: outputPath, engine: "pcm-fallback", bytes: buf.length };
  }

  if (options?.provider !== "local") {
    const { generateJobVoice } = await import("../../lib/ai/voice.ts");
    const generated = await generateJobVoice({
      script: cleanText,
      jobId: `campaign-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      refAudioPath: options?.voiceReferenceId || null,
      settings: options?.provider ? { provider: options.provider } : undefined,
    });
    const bytes = await materializeGeneratedAudio(generated.audioPath, outputPath);
    return { success: true, path: outputPath, engine: generated.provider, bytes };
  }

  // Provedor local explícito: usar síntese nativa do Windows.
  if (os.platform() === "win32") {
    try {
      const safeText = cleanText.replace(/["'\\]/g, " ").slice(0, 500);
      const safeOut = outputPath.replace(/\\/g, "/");

      const psScript = `
Add-Type -AssemblyName System.Speech;
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;
$s.SetOutputToWaveFile("${safeOut}");
$s.Speak("${safeText}");
$s.Dispose();
`;
      const encoded = Buffer.from(psScript, "utf16le").toString("base64");
      await execAsync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, { timeout: 15000 });

      if (existsSync(outputPath)) {
        const stats = statSync(outputPath);
        if (stats.size > 1000) {
          return {
            success: true,
            path: outputPath,
            engine: "windows-sapi",
            bytes: stats.size,
          };
        }
      }
    } catch (sapiErr) {
      console.warn("[SpeechSynthesizer] Falha no SAPI do Windows:", sapiErr);
    }
  }

  // O arquivo silencioso é marcado como fallback, nunca como voz real.
  const buf = createSyntheticPcmWavBuffer(options?.durationSeconds || 3);
  await writeFile(outputPath, buf);
  return { success: false, path: outputPath, engine: "pcm-fallback", bytes: buf.length };
}
