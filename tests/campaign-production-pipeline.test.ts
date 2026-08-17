import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { CampaignProductionService } from "../services/campaign-production/campaign-production.service.ts";

test("cria e executa um job de produção completo com imagens, áudio e plano DaVinci", async () => {
  const service = new CampaignProductionService();

  const artifacts = [
    {
      filename: "creative-brief.md",
      content: `# Briefing Criativo: Teclado Mecânico Quantum RGB
**Campanha:** Lançamento Teclado Mecânico Quantum
**Público-Alvo:** Programadores e entusiastas de hardware
**Plataforma:** TikTok & Reels (9:16)
`,
    },
    {
      filename: "video-script.md",
      content: `# Roteiro de Vídeo

### Cena 1: O incômodo de digitar em teclado ruim (0s-3s)
Locução: "Seus dedos doem e sua digitação trava no meio do código?"
Duração: 3s
Visual: Programador cansado digitando em teclado de membrana barato.

### Cena 2: A precisão dos switches óticos (3s-7s)
Locução: "Conheça o Quantum: switches óticos de resposta instantânea e RGB customizável."
Duração: 4s
Visual: Teclado mecânico futurista com teclas translúcidas e iluminação suave.

### Cena 3: Chamada para ação final (7s-10s)
Locução: "Eleve seu setup para o próximo nível. Clique e garanta o seu com frete grátis!"
Duração: 3s
Visual: Setup clean e moderno brilhando com o teclado em destaque.
`,
    },
    {
      filename: "visual-prompts.md",
      content: `# Prompts Visuais

### Prompt 1
Prompt: Close-up de mãos digitando em teclado simples, ambiente escuro com tela de terminal, ângulo dramático, 9:16.

### Prompt 2
Prompt: Teclado mecânico premium com retroiluminação RGB suave, switches óticos expostos, fotografia macro profissional, 8k.

### Prompt 3
Prompt: Mesa de desenvolvedor minimalista com monitor ultrawide e teclado mecânico iluminado, atmosfera aconchegante, 9:16.
`,
    },
  ];

  // 1. Criar Job
  const job = await service.createCampaignProductionJob({
    artifacts,
    options: {
      generateImages: true,
      generateAudio: true,
      createDavinciPlan: true,
      aspectRatio: "9:16",
    },
  });

  assert.ok(job.id.startsWith("camp_"));
  assert.equal(job.status, "queued");
  assert.equal(job.parsedData.scenes.length, 3);
  assert.equal(job.assets.length, 3);

  // 2. Executar Job
  const completedJob = await service.executeCampaignProduction(job.id);

  assert.equal(completedJob.status, "completed_with_warnings");
  assert.equal(completedJob.progress, 100);
  assert.equal(completedJob.assets.length, 3);

  // Validar ativos gerados
  for (const asset of completedJob.assets) {
    assert.equal(asset.imageStatus, "placeholder");
    assert.ok(asset.imagePath, `Imagem da cena ${asset.sceneNumber} deve ter um caminho`);
    assert.ok(asset.audioStatus === "completed" || asset.audioStatus === "placeholder");
    assert.ok(asset.audioPath, `Áudio da cena ${asset.sceneNumber} deve ter um caminho`);
  }

  // Validar DaVinci Plan
  assert.ok(completedJob.davinciPlan, "DaVinci Plan deve ser criado");
  assert.equal(completedJob.davinciPlan.markersCount, 3);
  assert.ok(completedJob.davinciPlan.planPath);
  assert.ok(existsSync(completedJob.davinciPlan.planPath));
  assert.ok(existsSync(path.join(completedJob.outputDirectory, "timeline.edl")), "EDL da timeline DaVinci deve existir");
  assert.ok(existsSync(path.join(completedJob.outputDirectory, "timeline.fcpxml")), "FCPXML da timeline DaVinci deve existir");

  // 3. Recuperar Job por ID
  const retrievedJob = await service.getCampaignProductionJob(job.id);
  assert.ok(retrievedJob);
  assert.equal(retrievedJob.id, job.id);
  assert.equal(retrievedJob.status, "completed_with_warnings");

  // 4. Listar Jobs
  const list = await service.listCampaignProductionJobs();
  assert.ok(list.length > 0);
  assert.ok(list.some((j) => j.id === job.id));
});

test("permite injeção de geradores customizados e opções parciais", async () => {
  const customImageGen = async (prompt: string) => ({
    imageUrl: "https://example.com/custom-image.png",
    imagePath: "/mock/custom-image.png",
  });
  const customAudioGen = async (text: string) => ({
    audioUrl: "https://example.com/custom-audio.mp3",
    audioPath: "/mock/custom-audio.mp3",
  });

  const service = new CampaignProductionService(customImageGen, customAudioGen);

  const job = await service.createCampaignProductionJob({
    customScenes: [
      {
        sceneNumber: 1,
        title: "Cena 1 Teste",
        visualPrompt: "Prompt visual 1",
        voiceoverText: "Texto falado 1",
        durationSeconds: 5,
        aspectRatio: "16:9",
      },
    ],
    options: {
      generateImages: true,
      generateAudio: true,
      createDavinciPlan: false,
      aspectRatio: "16:9",
    },
  });

  assert.equal(job.parsedData.scenes.length, 1);
  assert.equal(job.parsedData.aspectRatio, "16:9");

  const completed = await service.executeCampaignProduction(job.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.assets[0].imageUrl, "https://example.com/custom-image.png");
  assert.equal(completed.assets[0].audioUrl, "https://example.com/custom-audio.mp3");
  assert.equal(completed.davinciPlan, undefined);
});
