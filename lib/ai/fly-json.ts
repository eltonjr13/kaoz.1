import { GoogleGenAI } from "@google/genai";
import { OpenAI } from "openai";
import { readAgentLLMSettings } from "@/services/agent-llm/agent-llm.settings";

export type FlyAiModel = "gemini" | "chatgpt" | "claude" | "deepseek" | "cerebras" | "zenmux" | "iamhc";

export function parseFlyAiModel(value: unknown): FlyAiModel {
  return value === "chatgpt" || value === "claude" || value === "deepseek" || value === "gemini" || value === "cerebras" || value === "zenmux" || value === "iamhc"
    ? value
    : "gemini";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} nao configurada no servidor.`);
  }
  return value;
}

async function generateWithGemini(prompt: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY") });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    contents: prompt,
    config: { responseMimeType: "application/json" }
  });
  return response.text || "{}";
}

async function generateWithOpenAI(prompt: string): Promise<string> {
  const openai = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.7
  });
  return response.choices[0]?.message?.content || "{}";
}

async function generateWithDeepSeek(prompt: string): Promise<string> {
  const deepseek = new OpenAI({
    apiKey: requireEnv("DEEPSEEK_API_KEY"),
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
  });
  const response = await deepseek.chat.completions.create({
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.7
  });
  return response.choices[0]?.message?.content || "{}";
}

async function generateWithClaude(prompt: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": requireEnv("ANTHROPIC_API_KEY"),
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) {
    throw new Error(`Anthropic API retornou ${response.status}: ${await response.text()}`);
  }

  const data = await response.json() as {
    content?: Array<{ type?: string; text?: string }>;
  };
  return data.content?.find((part) => part.type === "text")?.text || "{}";
}

async function generateWithCerebras(prompt: string): Promise<string> {
  const cerebras = new OpenAI({
    apiKey: requireEnv("CEREBRAS_API_KEY"),
    baseURL: process.env.CEREBRAS_BASE_URL || "https://api.cerebras.ai/v1"
  });
  const model = process.env.CEREBRAS_MODEL || "gemma-4-31b";
  const extraBody: Record<string, any> = {};
  if (model.includes("glm")) {
    extraBody.clear_thinking = true;
  }
  const response = await cerebras.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.7,
    extra_body: Object.keys(extraBody).length > 0 ? extraBody : undefined
  } as any);
  return response.choices[0]?.message?.content || "{}";
}

async function generateWithZenmux(prompt: string): Promise<string> {
  const zenmux = new OpenAI({
    apiKey: requireEnv("ZENMUX_API_KEY"),
    baseURL: process.env.ZENMUX_BASE_URL || "https://zenmux.ai/api/v1"
  });
  const response = await zenmux.chat.completions.create({
    model: process.env.ZENMUX_MODEL || "x-ai/grok-4.5-free",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.7
  } as any);
  return response.choices[0]?.message?.content || "{}";
}

async function generateWithIamhc(prompt: string): Promise<string> {
  const settings = await readAgentLLMSettings();
  const client = new OpenAI({
    apiKey: requireEnv("IAMHC_API_KEY"),
    baseURL: process.env.IAMHC_BASE_URL || "https://api.iamhc.cn/v1"
  });
  const response = await client.chat.completions.create({
    model: settings.iamhcModel || process.env.IAMHC_MODEL || "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.7
  } as any);
  return response.choices[0]?.message?.content || "{}";
}

export async function generateFlyJson(model: FlyAiModel, prompt: string): Promise<string> {
  switch (model) {
    case "chatgpt":
      return generateWithOpenAI(prompt);
    case "claude":
      return generateWithClaude(prompt);
    case "deepseek":
      return generateWithDeepSeek(prompt);
    case "gemini":
      return generateWithGemini(prompt);
    case "cerebras":
      return generateWithCerebras(prompt);
    case "zenmux":
      return generateWithZenmux(prompt);
    case "iamhc":
      return generateWithIamhc(prompt);
  }
}
