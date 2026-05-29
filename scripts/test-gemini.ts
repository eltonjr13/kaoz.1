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

  console.log(`Using GEMINI_API_KEY: ${apiKey ? apiKey.substring(0, 10) + "..." : "undefined"}`);
  console.log(`Using GEMINI_MODEL: ${modelName}`);

  if (!apiKey) {
    console.error("Error: GEMINI_API_KEY is not defined in .env.local");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    console.log("Sending a test generation request to Gemini...");
    const response = await ai.models.generateContent({
      model: modelName,
      contents: "Hello, this is a test. Reply with one word: 'Success'."
    });
    console.log("Response text:", response.text);
  } catch (error) {
    console.error("Gemini API call failed with error:", error);
  }
}

main();
