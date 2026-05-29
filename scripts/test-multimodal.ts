import { GoogleGenAI } from "@google/genai";
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
  const apiKey = process.env.GEMINI_API_KEY;
  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  if (!apiKey) {
    console.error("Error: GEMINI_API_KEY is not defined in .env.local");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  const testImagePath = "public/uploads/avatars/30e256a9-0d26-4ad9-93be-7503b0b7f425-project-ugc-amateur-reaction-202605270046.jpeg";
  const imageData = fs.readFileSync(testImagePath).toString("base64");

  const contents: any[] = [
    {
      inlineData: {
        data: imageData,
        mimeType: "image/jpeg"
      }
    },
    // Raw string as textPrompt (exactly as in gemini.ts)
    "Analyze this image and describe it in one sentence."
  ];

  try {
    console.log("Sending multimodal request to Gemini...");
    const response = await ai.models.generateContent({
      model: modelName,
      contents: contents,
    });
    console.log("Response text:", response.text);
  } catch (error) {
    console.error("Gemini Multimodal API call failed with error:", error);
  }
}

main();
