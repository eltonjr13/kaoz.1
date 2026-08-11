import type { SpeechModelDefinition } from "./speech.types";

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const MODEL_ROOT = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

function whisperModel(input: Omit<SpeechModelDefinition, "engine" | "downloadUrl">): SpeechModelDefinition {
  return {
    ...input,
    engine: "whisper-cpp",
    downloadUrl: `${MODEL_ROOT}/${input.fileName}?download=true`,
  };
}

export const SPEECH_MODEL_CATALOG: readonly SpeechModelDefinition[] = [
  whisperModel({ id: "whisper-tiny", name: "Whisper Tiny", description: "Muito rapido e compacto.", fileName: "ggml-tiny.bin", checksum: { algorithm: "sha1", value: "bd577a113a864445d4c299885e0cb97d4ba92b5f" }, sizeBytes: 75 * MIB, memoryBytes: 273 * MIB, multilingual: true, quantized: false, quality: "basic" }),
  whisperModel({ id: "whisper-tiny-en", name: "Whisper Tiny English", description: "Modelo compacto exclusivo para ingles.", fileName: "ggml-tiny.en.bin", checksum: { algorithm: "sha1", value: "c78c86eb1a8faa21b369bcd33207cc90d64ae9df" }, sizeBytes: 75 * MIB, memoryBytes: 273 * MIB, multilingual: false, quantized: false, quality: "basic" }),
  whisperModel({ id: "whisper-base", name: "Whisper Base", description: "Modelo leve para ditado e comandos.", fileName: "ggml-base.bin", checksum: { algorithm: "sha1", value: "465707469ff3a37a2b9b8d8f89f2f99de7299dac" }, sizeBytes: 142 * MIB, memoryBytes: 388 * MIB, multilingual: true, quantized: false, quality: "balanced" }),
  whisperModel({ id: "whisper-base-en", name: "Whisper Base English", description: "Modelo leve exclusivo para ingles.", fileName: "ggml-base.en.bin", checksum: { algorithm: "sha1", value: "137c40403d78fd54d454da0f9bd998f78703390c" }, sizeBytes: 142 * MIB, memoryBytes: 388 * MIB, multilingual: false, quantized: false, quality: "balanced" }),
  whisperModel({ id: "whisper-small", name: "Whisper Small", description: "Bom equilibrio para portugues.", fileName: "ggml-small.bin", checksum: { algorithm: "sha1", value: "55356645c2b361a969dfd0ef2c5a50d530afd8d5" }, sizeBytes: 466 * MIB, memoryBytes: 852 * MIB, multilingual: true, quantized: false, quality: "high" }),
  whisperModel({ id: "whisper-small-en", name: "Whisper Small English", description: "Modelo intermediario exclusivo para ingles.", fileName: "ggml-small.en.bin", checksum: { algorithm: "sha1", value: "db8a495a91d927739f5e50b3c5a50d530afd8d5" }, sizeBytes: 466 * MIB, memoryBytes: 852 * MIB, multilingual: false, quantized: false, quality: "high" }),
  whisperModel({ id: "whisper-small-en-tdrz", name: "Whisper Small English Diarization", description: "Ingles com marcacao local de troca de locutor.", fileName: "ggml-small.en-tdrz.bin", checksum: { algorithm: "sha1", value: "b6c6e7e89af1a35c08e6de56b66ca6a02a2fdfa1" }, sizeBytes: 465 * MIB, memoryBytes: 852 * MIB, multilingual: false, quantized: false, quality: "high" }),
  whisperModel({ id: "whisper-medium", name: "Whisper Medium", description: "Alta precisao multilíngue.", fileName: "ggml-medium.bin", checksum: { algorithm: "sha1", value: "fd9727b6e1212f614f9b698455c4ffd82463b4" }, sizeBytes: 1.5 * GIB, memoryBytes: 2.1 * GIB, multilingual: true, quantized: false, quality: "highest" }),
  whisperModel({ id: "whisper-medium-en", name: "Whisper Medium English", description: "Alta precisao exclusiva para ingles.", fileName: "ggml-medium.en.bin", checksum: { algorithm: "sha1", value: "8c30f0e44ce9560643ebd10bbe50cd20eafd3723" }, sizeBytes: 1.5 * GIB, memoryBytes: 2.1 * GIB, multilingual: false, quantized: false, quality: "highest" }),
  whisperModel({ id: "whisper-large-v1", name: "Whisper Large v1", description: "Primeira geracao do modelo Large.", fileName: "ggml-large-v1.bin", checksum: { algorithm: "sha1", value: "b1caaf735c4cc1429223d5a74f0f4d0b9b59a299" }, sizeBytes: 2.9 * GIB, memoryBytes: 3.9 * GIB, multilingual: true, quantized: false, quality: "highest" }),
  whisperModel({ id: "whisper-large-v2", name: "Whisper Large v2", description: "Alta precisao multilíngue.", fileName: "ggml-large-v2.bin", checksum: { algorithm: "sha1", value: "0f4c8e34f21cf1a914c59d8b3ce882345ad349d6" }, sizeBytes: 2.9 * GIB, memoryBytes: 3.9 * GIB, multilingual: true, quantized: false, quality: "highest" }),
  whisperModel({ id: "whisper-large-v2-q5", name: "Whisper Large v2 Q5", description: "Large v2 quantizado para reduzir disco e memoria.", fileName: "ggml-large-v2-q5_0.bin", checksum: { algorithm: "sha1", value: "00e39f2196344e901b3a2bd5814807a769bd1630" }, sizeBytes: 1.1 * GIB, memoryBytes: 1.8 * GIB, multilingual: true, quantized: true, quality: "highest" }),
  whisperModel({ id: "whisper-large-v3", name: "Whisper Large v3", description: "Maior qualidade disponivel, com alto consumo.", fileName: "ggml-large-v3.bin", checksum: { algorithm: "sha1", value: "ad82bf6a9043ceed055076d0fd39f5f186ff8062" }, sizeBytes: 2.9 * GIB, memoryBytes: 3.9 * GIB, multilingual: true, quantized: false, quality: "highest" }),
  whisperModel({ id: "whisper-large-v3-q5", name: "Whisper Large v3 Q5", description: "Alta qualidade com quantizacao Q5.", fileName: "ggml-large-v3-q5_0.bin", checksum: { algorithm: "sha1", value: "e6e2ed78495d403bef4b7cff42ef4aaadcfea8de" }, sizeBytes: 1.1 * GIB, memoryBytes: 1.8 * GIB, multilingual: true, quantized: true, quality: "highest" }),
  whisperModel({ id: "whisper-large-v3-turbo", name: "Whisper Large v3 Turbo", description: "Alta qualidade com inferencia mais rapida.", fileName: "ggml-large-v3-turbo.bin", checksum: { algorithm: "sha1", value: "4af2b29d7ec73d781377bfd1758ca957a807e941" }, sizeBytes: 1.5 * GIB, memoryBytes: 2.1 * GIB, multilingual: true, quantized: false, quality: "highest" }),
  whisperModel({ id: "whisper-large-v3-turbo-q5", name: "Whisper Large v3 Turbo Q5", description: "Recomendado: rapido, multilíngue e compacto.", fileName: "ggml-large-v3-turbo-q5_0.bin", checksum: { algorithm: "sha1", value: "e050f7970618a659205450ad97eb95a18d69c9ee" }, sizeBytes: 547 * MIB, memoryBytes: 1.2 * GIB, multilingual: true, quantized: true, recommended: true, quality: "highest" }),
  {
    id: "parakeet-tdt-0.6b-v3",
    engine: "parakeet",
    name: "Parakeet TDT 0.6B v3",
    description: "Transcricao local rapida pelo runtime Parakeet existente.",
    fileName: "model",
    sizeBytes: 670 * MIB,
    memoryBytes: 1.2 * GIB,
    multilingual: true,
    quantized: true,
    quality: "high",
  },
] as const;

export const DEFAULT_WHISPER_CPP_MODEL_ID = "whisper-large-v3-turbo-q5";
export const LEGACY_FAST_WHISPER_MODEL_ID = "whisper-base";
export const LEGACY_BALANCED_WHISPER_MODEL_ID = "whisper-small";
export const PARAKEET_MODEL_ID = "parakeet-tdt-0.6b-v3";

export function getSpeechModelDefinition(modelId: string | null | undefined): SpeechModelDefinition | null {
  return SPEECH_MODEL_CATALOG.find((model) => model.id === modelId) || null;
}
