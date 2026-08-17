import test from "node:test";
import assert from "node:assert/strict";
import { parseArtifactsToCampaign } from "../services/campaign-production/campaign-parser.ts";

test("extrai campanha completa a partir de artefatos de roteiro e prompts visuais", () => {
  const artifacts = [
    {
      filename: "creative-brief.md",
      content: `# Briefing Criativo: Fone Gamer Apex Pro
**Campanha:** Lançamento Fone Gamer Apex Pro
**Público-Alvo:** Gamers e Criadores de Conteúdo
**Tom de Voz:** Enérgico e Futurista
**Plataforma:** TikTok & Reels (9:16)
`,
    },
    {
      filename: "video-script.md",
      content: `# Roteiro de Vídeo

### Cena 1: O Problema do Ruído (0s-3s)
Locução: "Você não aguenta mais perder partidas por causa de ruídos externos?"
Duração: 3s
Visual: Jogador frustrado com fone comum em quarto escuro.

### Cena 2: Apresentação do Apex Pro (3s-7s)
Locução: "Conheça o Apex Pro: cancelamento ativo de ruído ultrarrápido."
Duração: 4s
Visual: Fone gamer com iluminação RGB acendendo em câmera lenta.

### Cena 3: Chamada para Ação (7s-10s)
Locução: "Suba de nível no seu gameplay agora mesmo. Link na bio com 20% off!"
Duração: 3s
Visual: Jogador sorrindo comemorando a vitória.
`,
    },
    {
      filename: "visual-prompts.md",
      content: `# Prompts Visuais de Imagem

### Prompt 1
Prompt: Close-up dramático de gamer focado na tela com iluminação neon azul e vermelha, expressão tensa, proporção 9:16.
Estilo: Cyberpunk / Realista

### Prompt 2
Prompt: Fone de ouvido gamer premium flutuando no ar com luzes RGB neon e partículas sonoras ao redor, fundo escuro, 8k.
Estilo: Product Photography

### Prompt 3
Prompt: Jogador vitorioso sorrindo usando fone gamer iluminado, troféu holográfico ao fundo, iluminação dourada e vibrante.
Estilo: Lifestyle Gamer
`,
    },
  ];

  const parsed = parseArtifactsToCampaign(artifacts);

  assert.equal(parsed.campaignName, "Fone Gamer Apex Pro");
  assert.equal(parsed.aspectRatio, "9:16");
  assert.equal(parsed.scenes.length, 3);
  assert.equal(parsed.totalEstimatedDuration, 10);

  // Scene 1 assertions
  assert.equal(parsed.scenes[0].sceneNumber, 1);
  assert.match(parsed.scenes[0].voiceoverText, /Você não aguenta mais perder partidas/);
  assert.match(parsed.scenes[0].visualPrompt, /Close-up dramático de gamer focado/);
  assert.equal(parsed.scenes[0].durationSeconds, 3);

  // Scene 2 assertions
  assert.equal(parsed.scenes[1].sceneNumber, 2);
  assert.match(parsed.scenes[1].voiceoverText, /Conheça o Apex Pro/);
  assert.match(parsed.scenes[1].visualPrompt, /Fone de ouvido gamer premium flutuando/);
  assert.equal(parsed.scenes[1].durationSeconds, 4);

  // Scene 3 assertions
  assert.equal(parsed.scenes[2].sceneNumber, 3);
  assert.match(parsed.scenes[2].voiceoverText, /Suba de nível no seu gameplay/);
  assert.match(parsed.scenes[2].visualPrompt, /Jogador vitorioso sorrindo/);
  assert.equal(parsed.scenes[2].durationSeconds, 3);
});

test("gera fallback coerente quando recebe apenas um briefing simples", () => {
  const artifacts = [
    {
      filename: "briefing.txt",
      content: "Campanha: Café Artesanal Orgânico da Serra\nFoco em sabor e sustentabilidade para Instagram Reels",
    },
  ];

  const parsed = parseArtifactsToCampaign(artifacts);

  assert.equal(parsed.campaignName, "Café Artesanal Orgânico da Serra");
  assert.equal(parsed.aspectRatio, "9:16");
  assert.equal(parsed.scenes.length, 3);
  assert.ok(parsed.scenes[0].visualPrompt.includes("Café Artesanal"));
  assert.ok(parsed.scenes[0].voiceoverText.length > 10);
});
