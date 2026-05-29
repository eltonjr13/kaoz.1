import { analyzeAndGenerateScript } from "../lib/ai/gemini";
import fs from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("=");
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join("=").trim();
      process.env[key] = val;
    }
  }
}

async function main() {
  loadEnvLocal();
  
  const videoPath = path.join(process.cwd(), "public", "uploads", "test-boomerang-source.mp4");
  const topic = "mulher tomando oleo de soja puro";
  const workDir = path.join(process.cwd(), ".generated", "jobs", "test-gemini-multimodal");
  
  let personality = null;
  const lorenzoPath = path.join(process.cwd(), "lorenzo.json");
  if (fs.existsSync(lorenzoPath)) {
    personality = JSON.parse(fs.readFileSync(lorenzoPath, "utf-8"));
  }

  console.log("Starting analyzeAndGenerateScript direct test...");
  console.log("Model in use:", process.env.GEMINI_MODEL || "gemini-2.5-flash");

  try {
    const result = await analyzeAndGenerateScript(videoPath, topic, workDir, personality);
    console.log("Success! Gemini analysis result:");
    console.log(result);
  } catch (error) {
    console.error("FAILED! The Gemini pipeline failed with error:");
    console.error(error);
  }
}

main();
