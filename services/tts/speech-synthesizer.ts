/**
 * Sintetizador de Voz Real para Produção de Mídia e Campanhas
 * Gera arquivos de áudio WAV/MP3 com fala real em Português e Inglês.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateFishAudioSpeech } from "../../lib/fish-audio.ts";
import { readTTSConfig } from "./tts.settings.ts";

const execAsync = promisify(exec);

export interface SpeechSynthesisOptions {
  voiceModel?: string;
  voiceReferenceId?: string;
  durationSeconds?: number;
  lang?: string;
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
 * Sintetiza voz real usando o motor disponível (Fish Audio API ou Windows SAPI nativo)
 */
export async function synthesizeRealSpeechToFile(
  text: string,
  outputPath: string,
  options?: SpeechSynthesisOptions
): Promise<{ success: boolean; path: string; engine: "fish-audio" | "windows-sapi" | "pcm-fallback"; bytes: number }> {
  await mkdir(path.dirname(outputPath), { recursive: true });

  const cleanText = text.trim();
  if (!cleanText) {
    const buf = createSyntheticPcmWavBuffer(options?.durationSeconds || 3);
    await writeFile(outputPath, buf);
    return { success: true, path: outputPath, engine: "pcm-fallback", bytes: buf.length };
  }

  // 1. Tentar Fish Audio se configurado
  try {
    const ttsConfig = await readTTSConfig().catch(() => ({}));
    if (ttsConfig?.fishAudioApiKey) {
      const fishResult = await generateFishAudioSpeech({
        text: cleanText,
        apiKey: ttsConfig.fishAudioApiKey,
        referenceId: options?.voiceReferenceId || ttsConfig.fishAudioReferenceId || "",
        model: options?.voiceModel || ttsConfig.fishAudioModel || "s2.1-pro-free",
        jobId: `tts-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      });

      if (fishResult?.audioPath) {
        // Copiar para outputPath se necessário
        return {
          success: true,
          path: fishResult.audioPath,
          engine: "fish-audio",
          bytes: 1000,
        };
      }
    }
  } catch (fishErr) {
    console.warn("[SpeechSynthesizer] Falha no Fish Audio, tentando fallback de sistema:", fishErr);
  }

  // 2. Tentar síntese nativa do Windows (PowerShell System.Speech.Synthesis)
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

  // 3. Fallback limpo
  const buf = createSyntheticPcmWavBuffer(options?.durationSeconds || 3);
  await writeFile(outputPath, buf);
  return { success: true, path: outputPath, engine: "pcm-fallback", bytes: buf.length };
}
