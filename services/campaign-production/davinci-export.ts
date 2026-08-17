/**
 * Gerador de Exportações de Timeline para DaVinci Resolve
 * Cria arquivos EDL (.edl) e FCPXML (.fcpxml) prontos para importação direta no DaVinci Resolve Free / Studio.
 */

import type { CampaignScene } from "./campaign-production.types.ts";

function formatTimecode(frames: number, fps = 30): string {
  const totalSeconds = Math.floor(frames / fps);
  const remFrames = frames % fps;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number, z = 2) => String(n).padStart(z, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(remFrames)}`;
}

export function generateDavinciEdl(
  campaignName: string,
  scenes: CampaignScene[],
  fps = 30
): string {
  const lines: string[] = [
    `TITLE: Kaoz - ${campaignName.slice(0, 40)}`,
    `FCM: NON-DROP FRAME`,
    "",
  ];

  let currentFrame = 0;

  scenes.forEach((scene, index) => {
    const editNum = String(index + 1).padStart(3, "0");
    const durationFrames = Math.max(fps, (scene.durationSeconds || 3) * fps);
    const startTc = formatTimecode(currentFrame, fps);
    const endTc = formatTimecode(currentFrame + durationFrames, fps);
    const clipStartTc = formatTimecode(0, fps);
    const clipEndTc = formatTimecode(durationFrames, fps);

    lines.push(`${editNum}  AX       V     C        ${clipStartTc} ${clipEndTc} ${startTc} ${endTc}`);
    lines.push(`* FROM CLIP NAME: scene_${scene.sceneNumber}_image.png`);
    lines.push(`* LOC: ${startTc} Red Cena ${scene.sceneNumber}: ${scene.title.slice(0, 40)}`);
    lines.push(`* COMMENT: Locução: ${scene.voiceoverText.slice(0, 80)}`);
    lines.push("");

    currentFrame += durationFrames;
  });

  return lines.join("\n");
}

export function generateDavinciFcpxml(
  campaignName: string,
  scenes: CampaignScene[],
  aspectRatio = "9:16",
  fps = 30
): string {
  const width = aspectRatio === "16:9" ? 1920 : aspectRatio === "1:1" ? 1080 : 1080;
  const height = aspectRatio === "16:9" ? 1080 : aspectRatio === "1:1" ? 1080 : 1920;

  let totalFrames = 0;
  const spineElements = scenes.map((scene) => {
    const sceneFrames = Math.max(fps, (scene.durationSeconds || 3) * fps);
    const element = `        <video name="Cena ${scene.sceneNumber}: ${scene.title.replace(/[<>&]/g, "")}" offset="${totalFrames}/${fps}s" duration="${sceneFrames}/${fps}s" start="0s">
          <marker start="0s" duration="1/${fps}s" value="Cena ${scene.sceneNumber}" note="${scene.voiceoverText.replace(/[<>&]/g, "").slice(0, 100)}"/>
        </video>`;
    totalFrames += sceneFrames;
    return element;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.8">
  <resources>
    <format id="r1" name="KaozFormat" frameDuration="1/${fps}s" width="${width}" height="${height}"/>
  </resources>
  <library>
    <event name="Kaoz - ${campaignName.replace(/[<>&]/g, "")}">
      <project name="${campaignName.replace(/[<>&]/g, "")}">
        <sequence format="r1" duration="${totalFrames}/${fps}s">
          <spine>
${spineElements.join("\n")}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}
