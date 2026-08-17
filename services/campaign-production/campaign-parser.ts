/**
 * Parser inteligente de artefatos da Sala de Guerra para estruturação de campanha.
 * Extrai cenas, prompts de imagem, textos de locução e metadados.
 */

import type { CampaignAspectRatio, CampaignParsedData, CampaignScene } from "./campaign-production.types.ts";
import { parseCampaignProductionSpec } from "./campaign-production.schemas.ts";

interface RawArtifactInput {
  filename?: string;
  title?: string;
  content?: string;
}

function cleanText(text: string): string {
  return text
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/\\n/g, "\n")
    .trim();
}

function extractAspectRatio(content: string): CampaignAspectRatio {
  if (/9\s*:\s*16|reels|tiktok|shorts|stories|vertical/i.test(content)) return "9:16";
  if (/16\s*:\s*9|youtube|widescreen|horizontal/i.test(content)) return "16:9";
  if (/1\s*:\s*1|feed|quadrado|square/i.test(content)) return "1:1";
  if (/4\s*:\s*3/i.test(content)) return "4:3";
  if (/3\s*:\s*4/i.test(content)) return "3:4";
  return "9:16";
}

function extractCampaignName(artifacts: RawArtifactInput[]): string {
  for (const art of artifacts) {
    const content = art.content || "";
    // Check for Title headings
    const titleMatch = content.match(/^#\s+(?:Briefing(?:\s+(?:Criativo|Estratégico))?|Campanha|Roteiro|Estratégia)?[:\-]?\s*([^\n\r]+)/im);
    if (titleMatch && titleMatch[1].trim()) {
      const candidate = titleMatch[1].replace(/[#*`_]/g, "").trim();
      if (candidate && !/^(Briefing|Roteiro|Prompts|Estratégia)$/i.test(candidate)) {
        return candidate.slice(0, 80);
      }
    }
    // Check for "Campanha: X" or "Produto: X"
    const metaMatch = content.match(/(?:Campanha|Produto|Projeto|Tema|Briefing):\s*([^\n\r]+)/i);
    if (metaMatch && metaMatch[1].trim()) {
      return metaMatch[1].replace(/[#*`_]/g, "").trim().slice(0, 80);
    }
  }
  return "Campanha UGC Kaoz.1";
}

function extractTargetPlatform(content: string): string {
  const match = content.match(/(?:Plataforma|Canais?|Veiculação|Destino):\s*([^\n\r]+)/i);
  if (match && match[1].trim()) {
    return match[1].replace(/[#*`_]/g, "").trim();
  }
  if (/tiktok/i.test(content)) return "TikTok / Instagram Reels";
  if (/youtube/i.test(content)) return "YouTube Shorts";
  return "TikTok & Instagram Reels (9:16)";
}

function parseVisualPromptsArtifact(content: string): Map<number, { prompt: string; style?: string; notes?: string }> {
  const scenesMap = new Map<number, { prompt: string; style?: string; notes?: string }>();
  if (!content) return scenesMap;

  // Split by Scene headers: ### Cena 1, ## Cena 01, ### 1. Hook, ### Prompt 1, etc.
  const sections = content.split(/(?=(?:^|\n)#{1,4}\s*(?:Cena|Scene|Prompt|Take|Quadro)\s*\d+)/i);

  for (const sec of sections) {
    const headerMatch = sec.match(/#{1,4}\s*(?:Cena|Scene|Prompt|Take|Quadro)\s*(\d+)/i);
    if (!headerMatch) continue;
    const sceneNum = parseInt(headerMatch[1], 10);

    // Look for Prompt: ... or text block
    let prompt = "";
    const promptMatch = sec.match(/(?:Prompt(?:\s+Visual)?|Visual|Descrição|Image Prompt):\s*([^\n]+(?:\n(?!(?:#{1,4}|Aspect|Estilo|Duração))[^\n]+)*)/i);
    if (promptMatch) {
      prompt = cleanText(promptMatch[1]);
    } else {
      // Fallback: take non-header paragraphs
      const lines = sec.split("\n").filter((l) => !l.startsWith("#") && !/^(Aspect|Estilo|Duração|Formato):/i.test(l.trim()));
      prompt = cleanText(lines.join(" ").trim());
    }

    const styleMatch = sec.match(/(?:Estilo|Style|Iluminação|Câmera):\s*([^\n\r]+)/i);
    const style = styleMatch ? styleMatch[1].trim() : undefined;

    if (prompt && prompt.length > 5) {
      scenesMap.set(sceneNum, { prompt, style });
    }
  }

  return scenesMap;
}

function parseScriptArtifact(content: string): Array<{
  sceneNumber: number;
  title: string;
  voiceover: string;
  speaker?: string;
  durationSeconds: number;
  notes?: string;
}> {
  const result: Array<{
    sceneNumber: number;
    title: string;
    voiceover: string;
    speaker?: string;
    durationSeconds: number;
    notes?: string;
  }> = [];

  if (!content) return result;

  // Split by Scene headings: ### Cena 1, ## Cena 01 - Hook (0s-3s), ### Take 1, etc.
  const sections = content.split(/(?=(?:^|\n)#{1,4}\s*(?:Cena|Scene|Take|Bloco|Ato)\s*\d+)/i);

  let fallbackSceneCount = 1;

  for (const sec of sections) {
    const headerMatch = sec.match(/#{1,4}\s*(?:Cena|Scene|Take|Bloco|Ato)\s*(\d+)(?:[^\n\r]*)/i);
    if (!headerMatch) continue;

    const sceneNum = parseInt(headerMatch[1], 10) || fallbackSceneCount;
    fallbackSceneCount++;

    // Extract title from header line
    const firstLine = sec.split("\n")[0] || "";
    const titleMatch = firstLine.replace(/#{1,4}\s*(?:Cena|Scene|Take|Bloco|Ato)\s*\d+[:\-]?\s*/i, "").trim();
    const title = titleMatch || `Cena ${sceneNum}`;

    // Extract duration: (0s-3s), (3s a 7s), 4 segundos, 4s, etc.
    let durationSeconds = 4;
    const durationMatch = sec.match(/(?:Duração|Tempo|Timecode)?:\s*\(?(\d+)(?:s|\s*segundos|\s*-\s*(\d+)s)?/i)
      || sec.match(/\((\d+)s\s*-\s*(\d+)s\)/i);
    if (durationMatch) {
      if (durationMatch[2]) {
        const start = parseInt(durationMatch[1], 10);
        const end = parseInt(durationMatch[2], 10);
        durationSeconds = Math.max(1, end - start);
      } else {
        durationSeconds = Math.max(1, parseInt(durationMatch[1], 10));
      }
    }

    // Extract voiceover / speech: Locução: "...", Narrador: "...", Fala: "...", etc.
    let voiceover = "";
    let speaker = "Narrador";

    const speechMatch = sec.match(/(?:Locução|Fala|Voz|Narrador|Áudio|Copy|Texto):\s*(?:\[([^\]]+)\]\s*)?([^\n]+(?:\n(?!(?:#{1,4}|Visual|Duração|Gatilho|Câmera))[^\n]+)*)/i);
    if (speechMatch) {
      if (speechMatch[1]) speaker = speechMatch[1].trim();
      voiceover = cleanText(speechMatch[2]);
    } else {
      // Look for quoted text: "..."
      const quoteMatch = sec.match(/"([^"]{10,})"/);
      if (quoteMatch) {
        voiceover = quoteMatch[1].trim();
      } else {
        // Fallback to text lines
        const lines = sec.split("\n").filter((l) => !l.startsWith("#") && !/^(Visual|Prompt|Duração|Gatilho|Câmera|Tempo):/i.test(l.trim()));
        voiceover = cleanText(lines.join(" ").trim());
      }
    }

    // Extract visual notes if present
    const notesMatch = sec.match(/(?:Visual|Ação|Enquadramento|Câmera):\s*([^\n\r]+)/i);
    const notes = notesMatch ? notesMatch[1].trim() : undefined;

    result.push({
      sceneNumber: sceneNum,
      title,
      voiceover: voiceover || `Cena ${sceneNum} - Apresentação visual da campanha.`,
      speaker,
      durationSeconds,
      notes,
    });
  }

  return result;
}

/**
 * Faz a fusão dos artefatos da Sala de Guerra em uma estrutura coesa de campanha.
 */
export function parseArtifactsToCampaign(artifacts: RawArtifactInput[]): CampaignParsedData {
  const canonicalArtifact = artifacts.find((artifact) =>
    Boolean(artifact.content) && /campaign-production-spec\.json$/i.test(artifact.filename || artifact.title || ""),
  );
  if (canonicalArtifact?.content) {
    const spec = parseCampaignProductionSpec(JSON.parse(canonicalArtifact.content));
    return {
      campaignName: spec.campaignName,
      targetPlatform: spec.targetPlatform,
      aspectRatio: spec.aspectRatio,
      totalEstimatedDuration: spec.scenes.reduce((total, scene) => total + scene.durationSeconds, 0),
      scenes: spec.scenes,
      rawArtifactsCount: artifacts.length,
      sourceMode: "canonical_spec",
    };
  }
  const combinedContent = artifacts.map((a) => a.content || "").join("\n\n");
  const campaignName = extractCampaignName(artifacts);
  const targetPlatform = extractTargetPlatform(combinedContent);
  const aspectRatio = extractAspectRatio(combinedContent);

  // Find visual prompts artifact or content
  const visualArtifact = artifacts.find((a) => /visual-prompt|prompts-visuais|imagem|prompts/i.test(a.filename || a.title || ""));
  const visualPromptsContent = visualArtifact?.content || combinedContent;
  const visualPromptsMap = parseVisualPromptsArtifact(visualPromptsContent);

  // Find script artifact or content
  const scriptArtifact = artifacts.find((a) => /video-script|roteiro|script/i.test(a.filename || a.title || ""));
  const scriptContent = scriptArtifact?.content || combinedContent;
  const parsedScriptScenes = parseScriptArtifact(scriptContent);

  const scenes: CampaignScene[] = [];

  if (parsedScriptScenes.length > 0) {
    for (const s of parsedScriptScenes) {
      const visualData = visualPromptsMap.get(s.sceneNumber);
      const visualPrompt = visualData?.prompt
        || s.notes
        || `Cena cinematográfica para ${campaignName}, estilo moderno de anúncio UGC para redes sociais, iluminação profissional, 8k.`;

      scenes.push({
        sceneNumber: s.sceneNumber,
        title: s.title,
        visualPrompt,
        voiceoverText: s.voiceover,
        durationSeconds: s.durationSeconds,
        aspectRatio,
        speaker: s.speaker,
        notes: s.notes,
        styleKeywords: visualData?.style ? [visualData.style] : undefined,
      });
    }
  } else if (visualPromptsMap.size > 0) {
    // We have visual prompts but no structured script
    let sceneIndex = 1;
    for (const [num, v] of visualPromptsMap.entries()) {
      scenes.push({
        sceneNumber: num,
        title: `Cena ${num}`,
        visualPrompt: v.prompt,
        voiceoverText: `Destaque da cena ${num} para a campanha ${campaignName}.`,
        durationSeconds: 4,
        aspectRatio,
        styleKeywords: v.style ? [v.style] : undefined,
      });
      sceneIndex++;
    }
  } else {
    // Fallback: create 3 standard campaign scenes from title
    scenes.push(
      {
        sceneNumber: 1,
        title: "Hook de Impacto (0s-3s)",
        visualPrompt: `Close-up dinâmico e expressivo para abertura da campanha ${campaignName}, estilo UGC autêntico e moderno, iluminação cinematográfica, proporção ${aspectRatio}`,
        voiceoverText: `Você já sentiu que precisava de uma solução definitiva para ${campaignName}?`,
        durationSeconds: 3,
        aspectRatio,
        speaker: "Criador UGC",
      },
      {
        sceneNumber: 2,
        title: "Demonstração e Benefício (3s-8s)",
        visualPrompt: `Demonstração visual clara do produto e benefícios principais de ${campaignName}, ambiente iluminado, alta nitidez, proporção ${aspectRatio}`,
        voiceoverText: `Veja a diferença na prática. Resultados rápidos e consistentes pensados para você.`,
        durationSeconds: 5,
        aspectRatio,
        speaker: "Criador UGC",
      },
      {
        sceneNumber: 3,
        title: "Chamada para Ação Final (8s-12s)",
        visualPrompt: `Finalização estética com call to action marcante para ${campaignName}, atmosfera inspiradora e confiante, proporção ${aspectRatio}`,
        voiceoverText: `Garanta o seu hoje mesmo e transforme seus resultados. Clique no link e aproveite!`,
        durationSeconds: 4,
        aspectRatio,
        speaker: "Criador UGC",
      }
    );
  }

  const totalEstimatedDuration = scenes.reduce((acc, curr) => acc + curr.durationSeconds, 0);

  // Extract tone & CTA
  const toneMatch = combinedContent.match(/(?:Tom de Voz|Tom|Vibe|Estilo):\s*([^\n\r]+)/i);
  const tone = toneMatch ? toneMatch[1].trim() : "Enérgico, Autêntico e Persuasivo";

  const ctaMatch = combinedContent.match(/(?:CTA|Call to Action|Chamada):\s*([^\n\r]+)/i);
  const callToAction = ctaMatch ? ctaMatch[1].trim() : "Clique no link abaixo e garanta o seu!";

  return {
    campaignName,
    targetPlatform,
    aspectRatio,
    totalEstimatedDuration,
    scenes,
    tone,
    callToAction,
    rawArtifactsCount: artifacts.length,
    sourceMode: parsedScriptScenes.length > 0
      ? "structured_script"
      : visualPromptsMap.size > 0 ? "visual_prompts" : "fallback",
  };
}
