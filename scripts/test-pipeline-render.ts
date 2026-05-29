import path from "node:path";
import { renderVerticalVideo } from "../lib/videos/render";

async function main() {
  const jobId = "test-render-bg-removal";
  const projectRoot = process.cwd();
  
  const input = {
    jobId,
    reactionVideoPath: path.join(projectRoot, "public", "uploads", "avatars", "30e256a9-0d26-4ad9-93be-7503b0b7f425-project-ugc-amateur-reaction-202605270046.jpeg"),
    reactionIsImage: true,
    sourceVideoPath: path.join(projectRoot, "public", "uploads", "test-boomerang-source.mp4"),
    layout: "source_pip" as const,
    expertBackgroundMode: "remove" as const,
    outputPath: path.join(projectRoot, "public", "uploads", "renders", `${jobId}.mp4`),
    workDir: path.join(projectRoot, ".generated", "jobs", jobId)
  };

  console.log("Starting video rendering test with background removal...");
  console.log("Input configuration:", input);

  try {
    const result = await renderVerticalVideo(input);
    console.log("Rendering completed successfully!");
    console.log("Output video saved to:", result.finalVideoPath);
  } catch (error) {
    console.error("Rendering failed with error:", error);
    process.exit(1);
  }
}

main();
