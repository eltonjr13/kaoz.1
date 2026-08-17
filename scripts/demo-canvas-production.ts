/**
 * Script de Demonstração Interativo: Canvas -> Produção de Campanha
 * Executa o fluxo completo e exibe os ativos multimídia e plano DaVinci gerados.
 */

import { campaignProductionService } from "../services/campaign-production/campaign-production.service.ts";

async function runDemo() {
  console.log("\n========================================================");
  console.log("🎬 KAOZ.1 - DEMO: DO CANVAS PARA A PRODUÇÃO EM 1 CLIQUE");
  console.log("========================================================\n");

  const sampleArtifacts = [
    {
      filename: "creative-brief.md",
      content: `# Briefing Criativo: Energético Natural Focus Boost
**Campanha:** Lançamento Focus Boost - Energia Limpa para Criadores
**Público-Alvo:** Desenvolvedores, Designers e Gamers
**Tom de Voz:** Enérgico, Confiante e Autêntico
**Plataforma:** TikTok & Instagram Reels (9:16)
`,
    },
    {
      filename: "video-script.md",
      content: `# Roteiro de Vídeo

### Cena 1: A Queda de Energia das 15h (0s-3s)
Locução: "Aquele cansaço no meio da tarde está travando a sua produtividade?"
Duração: 3s
Visual: Criador exausto encarando o código na tela do computador.

### Cena 2: O Poder do Focus Boost (3s-7s)
Locução: "Focus Boost combina cafeína natural e nootrópicos para foco sem taquicardia."
Duração: 4s
Visual: Lata do Focus Boost com gotas de água e luzes de neon energéticas.

### Cena 3: Chamada para Ação Final (7s-10s)
Locução: "Desbloqueie seu foco máximo hoje. Frete grátis no link da bio!"
Duração: 3s
Visual: Criador focado e sorrindo trabalhando em ritmo acelerado com setup iluminado.
`,
    },
    {
      filename: "visual-prompts.md",
      content: `# Prompts Visuais

### Prompt 1
Prompt: Close-up cinematográfico de um desenvolvedor cansado em um quarto escuro iluminado apenas pela tela do monitor com código, expressão exausta, 9:16.

### Prompt 2
Prompt: Lata de bebida energética futurista com gotas de orvalho condensado, iluminação volumétrica roxa e ciano, partículas brilhantes ao redor, 8k, fotografia de produto.

### Prompt 3
Prompt: Desenvolvedor jovem sorrindo com olhar focado e energizado, setup minimalista elegante com luz ambiente suave, proporção 9:16.
`,
    },
  ];

  console.log("1️⃣ Analisando e extraindo cenas dos artefatos do Canvas...");
  const job = await campaignProductionService.createCampaignProductionJob({
    artifacts: sampleArtifacts,
    options: {
      generateImages: true,
      generateAudio: true,
      createDavinciPlan: true,
      aspectRatio: "9:16",
    },
  });

  console.log(`✅ Campanha estruturada com sucesso!`);
  console.log(`   - ID da Campanha: ${job.id}`);
  console.log(`   - Nome: ${job.parsedData.campaignName}`);
  console.log(`   - Total de Cenas: ${job.parsedData.scenes.length}`);
  console.log(`   - Duração Estimada: ${job.parsedData.totalEstimatedDuration} segundos`);
  console.log(`   - Proporção: ${job.parsedData.aspectRatio}\n`);

  console.log("2️⃣ Executando produção multimídia (Imagens + Áudios + Timeline DaVinci)...");
  const completedJob = await campaignProductionService.executeCampaignProduction(job.id);

  console.log("\n========================================================");
  console.log("🏆 PRODUÇÃO CONCLUÍDA COM SUCESSO!");
  console.log("========================================================\n");

  console.log("🖼️ IMAGENS E ÁUDIOS GERADOS POR CENA:");
  completedJob.assets.forEach((asset) => {
    console.log(`\n📌 [Cena ${asset.sceneNumber}] ${asset.title}`);
    console.log(`   - Imagem: ${asset.imagePath || "OK"}`);
    console.log(`   - Áudio:  ${asset.audioPath || "OK"}`);
    console.log(`   - Fala:   "${asset.voiceoverText}"`);
  });

  if (completedJob.davinciPlan) {
    console.log("\n🎞️ PLANO DAVINCI RESOLVE:");
    console.log(`   - Timeline: ${completedJob.davinciPlan.timelineName}`);
    console.log(`   - Marcadores: ${completedJob.davinciPlan.markersCount} marcadores sincronizados`);
    console.log(`   - Arquivo do Plano: ${completedJob.davinciPlan.planPath}`);
  }

  console.log(`\n📁 Diretório dos arquivos: ${completedJob.outputDirectory}\n`);
}

runDemo().catch(console.error);
