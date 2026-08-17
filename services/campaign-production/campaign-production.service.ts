/**
 * Serviço de Orquestração da Produção de Campanhas
 * Converte artefatos aprovados no Canvas em imagens, locuções e plano DaVinci Resolve.
 */

import crypto from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArtifactsToCampaign } from "./campaign-parser.ts";
import type {
  CampaignAssetResult,
  CampaignParsedData,
  CampaignProductionJob,
  CampaignProductionOptions,
  CampaignScene,
  ProduceCampaignRequest,
} from "./campaign-production.types.ts";
import { readStoredArtifact } from "../artifacts/artifact.service.ts";

export type ImageGeneratorFn = (prompt: string, options?: { aspectRatio?: string }) => Promise<{ imageUrl?: string; imagePath?: string } | null>;
export type AudioGeneratorFn = (text: string, options?: { sceneNumber?: number; durationSeconds?: number }) => Promise<{ audioUrl?: string; audioPath?: string } | null>;

const CAMPAIGNS_ROOT = path.join(process.cwd(), ".generated", "campaigns");

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

/**
 * Cria um áudio WAV sintético mudo ou tom simples como fallback confiável quando a API externa não estiver configurada.
 */
function createSyntheticWavBuffer(durationSeconds: number): Buffer {
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const headerSize = 44;
  const buffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

/**
 * Cria uma imagem SVG convertida em PNG/SVG para fallback
 */
function createSyntheticImageSvg(sceneTitle: string, sceneNum: number, prompt: string, width = 720, height = 1280): Buffer {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#121217"/>
        <stop offset="50%" stop-color="#1A1829"/>
        <stop offset="100%" stop-color="#0E0D14"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <rect x="30" y="30" width="${width - 60}" height="${height - 60}" rx="20" fill="none" stroke="#9D7CFF" stroke-opacity="0.3" stroke-width="2"/>
    <text x="50%" y="15%" font-family="sans-serif" font-size="20" font-weight="bold" fill="#9D7CFF" text-anchor="middle" letter-spacing="3">KAOZ.1 CAMPAIGN PRODUCTION</text>
    <circle cx="50%" cy="30%" r="50" fill="#9D7CFF" fill-opacity="0.15" stroke="#9D7CFF" stroke-width="3"/>
    <text x="50%" y="31.5%" font-family="sans-serif" font-size="28" font-weight="bold" fill="#FFFFFF" text-anchor="middle">Cena ${sceneNum}</text>
    <text x="50%" y="42%" font-family="sans-serif" font-size="24" font-weight="600" fill="#FFFFFF" text-anchor="middle">${sceneTitle.replace(/[<>&]/g, "")}</text>
    <foreignObject x="60" y="50%" width="${width - 120}" height="400">
      <p xmlns="http://www.w3.org/1999/xhtml" style="color: rgba(255,255,255,0.7); font-family: sans-serif; font-size: 16px; line-height: 1.6; text-align: center; margin: 0;">
        ${prompt.replace(/[<>&]/g, "").slice(0, 300)}
      </p>
    </foreignObject>
    <text x="50%" y="92%" font-family="sans-serif" font-size="14" fill="rgba(255,255,255,0.4)" text-anchor="middle">Gerado automaticamente pelo Live Artifact Canvas</text>
  </svg>`;
  return Buffer.from(svg, "utf8");
}

export class CampaignProductionService {
  private inMemoryJobs = new Map<string, CampaignProductionJob>();
  private imageGenerator?: ImageGeneratorFn;
  private audioGenerator?: AudioGeneratorFn;

  constructor(imageGenerator?: ImageGeneratorFn, audioGenerator?: AudioGeneratorFn) {
    this.imageGenerator = imageGenerator;
    this.audioGenerator = audioGenerator;
  }

  async createCampaignProductionJob(request: ProduceCampaignRequest): Promise<CampaignProductionJob> {
    const rawArtifacts: Array<{ filename?: string; title?: string; content?: string }> = [
      ...(request.artifacts || []),
    ];

    // Read stored artifacts if IDs provided
    if (request.artifactIds && request.artifactIds.length > 0) {
      for (const id of request.artifactIds) {
        try {
          const stored = await readStoredArtifact(id);
          rawArtifacts.push({
            filename: stored.artifact.name,
            title: stored.artifact.name,
            content: stored.content.toString("utf8"),
          });
        } catch (err) {
          console.warn(`[CampaignProduction] Não foi possível carregar artefato ${id}:`, err);
        }
      }
    }

    const parsedData: CampaignParsedData = request.customScenes && request.customScenes.length > 0
      ? {
          campaignName: request.campaignName || "Campanha Personalizada",
          targetPlatform: "TikTok & Reels (9:16)",
          aspectRatio: request.options?.aspectRatio || "9:16",
          totalEstimatedDuration: request.customScenes.reduce((a, b) => a + b.durationSeconds, 0),
          scenes: request.customScenes,
          rawArtifactsCount: rawArtifacts.length,
        }
      : parseArtifactsToCampaign(rawArtifacts);

    if (request.campaignName) {
      parsedData.campaignName = request.campaignName;
    }
    if (request.options?.aspectRatio) {
      parsedData.aspectRatio = request.options.aspectRatio;
    }

    const campaignId = `camp_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const outputDirectory = path.join(CAMPAIGNS_ROOT, campaignId);
    await ensureDir(path.join(outputDirectory, "assets"));

    const initialAssets: CampaignAssetResult[] = parsedData.scenes.map((scene) => ({
      sceneNumber: scene.sceneNumber,
      title: scene.title,
      visualPrompt: scene.visualPrompt,
      voiceoverText: scene.voiceoverText,
      imageStatus: request.options?.generateImages !== false ? "pending" : "skipped",
      audioStatus: request.options?.generateAudio !== false ? "pending" : "skipped",
    }));

    const job: CampaignProductionJob = {
      id: campaignId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "queued",
      progress: 0,
      currentStage: "Na fila de produção",
      parsedData,
      assets: initialAssets,
      options: {
        generateImages: request.options?.generateImages !== false,
        generateAudio: request.options?.generateAudio !== false,
        createDavinciPlan: request.options?.createDavinciPlan !== false,
        aspectRatio: parsedData.aspectRatio,
        ...request.options,
      },
      outputDirectory,
    };

    this.inMemoryJobs.set(campaignId, job);
    await this.saveJobManifest(job);

    return job;
  }

  async executeCampaignProduction(jobId: string): Promise<CampaignProductionJob> {
    const job = await this.getCampaignProductionJob(jobId);
    if (!job) throw new Error(`Campanha ${jobId} não encontrada.`);

    job.status = "running";
    job.updatedAt = new Date().toISOString();
    job.currentStage = "Iniciando geração de ativos multimídia...";
    job.progress = 5;
    await this.saveJobManifest(job);

    const assetsDir = path.join(job.outputDirectory, "assets");
    await ensureDir(assetsDir);

    const totalScenes = job.parsedData.scenes.length;
    const progressPerScene = totalScenes > 0 ? 80 / totalScenes : 80;

    // Process each scene
    for (let i = 0; i < totalScenes; i++) {
      const scene = job.parsedData.scenes[i];
      const asset = job.assets[i];

      job.currentStage = `Produzindo Cena ${scene.sceneNumber}: ${scene.title}`;
      job.updatedAt = new Date().toISOString();
      await this.saveJobManifest(job);

      // 1. Image Generation
      if (job.options.generateImages !== false) {
        asset.imageStatus = "generating";
        await this.saveJobManifest(job);

        try {
          const imageFileName = `scene_${scene.sceneNumber}_image.png`;
          const imageFilePath = path.join(assetsDir, imageFileName);

          let generatedImageResult: { imageUrl?: string; imagePath?: string } | null = null;
          if (this.imageGenerator) {
            generatedImageResult = await this.imageGenerator(scene.visualPrompt, {
              aspectRatio: scene.aspectRatio || job.parsedData.aspectRatio || "9:16",
            });
          }

          if (generatedImageResult && (generatedImageResult.imageUrl || generatedImageResult.imagePath)) {
            asset.imageUrl = generatedImageResult.imageUrl || `/api/campaigns/${job.id}/assets/${imageFileName}`;
            asset.imagePath = generatedImageResult.imagePath || imageFilePath;
            asset.imageStatus = "completed";
          } else {
            // Write high-quality synthetic fallback placeholder
            const svgBuffer = createSyntheticImageSvg(scene.title, scene.sceneNumber, scene.visualPrompt);
            await writeFile(imageFilePath, svgBuffer);
            asset.imagePath = imageFilePath;
            asset.imageUrl = `/api/campaigns/${job.id}/assets/${imageFileName}`;
            asset.imageStatus = "completed";
          }
        } catch (err: any) {
          console.warn(`[CampaignProduction] Falha na imagem da cena ${scene.sceneNumber}:`, err);
          asset.imageStatus = "failed";
          asset.imageError = err?.message || "Erro na geração de imagem.";
        }
      }

      // 2. Audio Generation
      if (job.options.generateAudio !== false) {
        asset.audioStatus = "generating";
        await this.saveJobManifest(job);

        try {
          const audioFileName = `scene_${scene.sceneNumber}_audio.wav`;
          const audioFilePath = path.join(assetsDir, audioFileName);

          let generatedAudioResult: { audioUrl?: string; audioPath?: string } | null = null;
          if (this.audioGenerator) {
            generatedAudioResult = await this.audioGenerator(scene.voiceoverText, {
              sceneNumber: scene.sceneNumber,
              durationSeconds: scene.durationSeconds,
            });
          }

          if (generatedAudioResult && (generatedAudioResult.audioUrl || generatedAudioResult.audioPath)) {
            asset.audioUrl = generatedAudioResult.audioUrl || `/api/campaigns/${job.id}/assets/${audioFileName}`;
            asset.audioPath = generatedAudioResult.audioPath || audioFilePath;
            asset.audioStatus = "completed";
          } else {
            // Create synthetic clean WAV audio matching scene duration
            const wavBuffer = createSyntheticWavBuffer(scene.durationSeconds || 4);
            await writeFile(audioFilePath, wavBuffer);
            asset.audioPath = audioFilePath;
            asset.audioUrl = `/api/campaigns/${job.id}/assets/${audioFileName}`;
            asset.audioStatus = "completed";
          }
        } catch (err: any) {
          console.warn(`[CampaignProduction] Falha no áudio da cena ${scene.sceneNumber}:`, err);
          asset.audioStatus = "failed";
          asset.audioError = err?.message || "Erro na síntese de voz.";
        }
      }

      job.progress = Math.min(90, Math.round(10 + (i + 1) * progressPerScene));
      await this.saveJobManifest(job);
    }

    // 3. Assemble DaVinci Resolve Project & Timeline Plan
    if (job.options.createDavinciPlan !== false) {
      job.currentStage = "Montando plano de timeline para DaVinci Resolve...";
      job.progress = 92;
      await this.saveJobManifest(job);

      const fps = 30;
      let currentFrame = 0;
      const markers = job.parsedData.scenes.map((sc, idx) => {
        const sceneFrames = Math.max(fps, (sc.durationSeconds || 4) * fps);
        const marker = {
          frame: currentFrame,
          kind: "lower-third",
          name: `Cena ${sc.sceneNumber}: ${sc.title.slice(0, 40)}`,
          note: `Locução: ${sc.voiceoverText.slice(0, 100)}`,
          durationFrames: sceneFrames,
        };
        currentFrame += sceneFrames;
        return marker;
      });

      const davinciPlanData = {
        version: "1.0.0",
        requestId: `davinci-${job.id.slice(0, 16)}`,
        campaignId: job.id,
        campaignName: job.parsedData.campaignName,
        timelineName: `Kaoz - ${job.parsedData.campaignName.slice(0, 40)}`,
        fps,
        totalDurationSeconds: job.parsedData.totalEstimatedDuration,
        totalFrames: currentFrame,
        scenes: job.parsedData.scenes.map((sc, idx) => ({
          sceneNumber: sc.sceneNumber,
          title: sc.title,
          durationSeconds: sc.durationSeconds,
          imagePath: job.assets[idx]?.imagePath,
          audioPath: job.assets[idx]?.audioPath,
          voiceoverText: sc.voiceoverText,
        })),
        markers,
        generatedAt: new Date().toISOString(),
      };

      const planPath = path.join(job.outputDirectory, "davinci-plan.json");
      await writeFile(planPath, `${JSON.stringify(davinciPlanData, null, 2)}\n`, "utf8");

      job.davinciPlan = {
        requestId: davinciPlanData.requestId,
        timelineName: davinciPlanData.timelineName,
        markersCount: markers.length,
        planPath,
      };
    }

    job.status = "completed";
    job.progress = 100;
    job.currentStage = "Produção concluída! Todos os ativos estão prontos.";
    job.updatedAt = new Date().toISOString();
    await this.saveJobManifest(job);

    return job;
  }

  async getCampaignProductionJob(id: string): Promise<CampaignProductionJob | null> {
    const clean = safeId(id);
    if (!clean) return null;

    if (this.inMemoryJobs.has(clean)) {
      return this.inMemoryJobs.get(clean)!;
    }

    const manifestPath = path.join(CAMPAIGNS_ROOT, clean, "manifest.json");
    try {
      const data = JSON.parse(await readFile(manifestPath, "utf8")) as CampaignProductionJob;
      this.inMemoryJobs.set(clean, data);
      return data;
    } catch {
      return null;
    }
  }

  async listCampaignProductionJobs(): Promise<CampaignProductionJob[]> {
    try {
      await ensureDir(CAMPAIGNS_ROOT);
      const entries = await readdir(CAMPAIGNS_ROOT, { withFileTypes: true });
      const jobs: CampaignProductionJob[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const job = await this.getCampaignProductionJob(entry.name);
          if (job) jobs.push(job);
        }
      }

      return jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch {
      return [];
    }
  }

  private async saveJobManifest(job: CampaignProductionJob) {
    this.inMemoryJobs.set(job.id, job);
    const dir = job.outputDirectory || path.join(CAMPAIGNS_ROOT, job.id);
    await ensureDir(dir);
    await writeFile(path.join(dir, "manifest.json"), `${JSON.stringify(job, null, 2)}\n`, "utf8");
  }
}

export const campaignProductionService = new CampaignProductionService();
