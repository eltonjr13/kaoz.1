import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { existsSync, statSync, unlinkSync } from "node:fs";

const execAsync = promisify(exec);

async function testSpeech() {
  const outPath = path.resolve("./scripts/test_speech.wav");
  if (existsSync(outPath)) unlinkSync(outPath);

  const text = "Aquele cansaço no meio da tarde está travando a sua produtividade?";
  const safeText = text.replace(/["'\\]/g, " ");
  const safePath = outPath.replace(/\\/g, "/");

  const psScript = `
Add-Type -AssemblyName System.Speech;
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;
$s.SetOutputToWaveFile("${safePath}");
$s.Speak("${safeText}");
$s.Dispose();
`;

  const encoded = Buffer.from(psScript, "utf16le").toString("base64");
  await execAsync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`);

  if (existsSync(outPath)) {
    const size = statSync(outPath).size;
    console.log(`[TTS SAPI] Áudio de voz real gerado com sucesso! Tamanho: ${size} bytes`);
    unlinkSync(outPath);
  } else {
    console.log("[TTS SAPI] Arquivo não foi criado.");
  }
}

testSpeech().catch(console.error);
