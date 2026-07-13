import { GoogleGenAI } from "@google/genai";
import { OpenAI } from "openai";
import { readAgentLLMSettings } from "@/services/agent-llm/agent-llm.settings";
import { getApiProviderConfig } from "@/services/api-providers/api-provider.settings";

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
  const config = await getApiProviderConfig("gemini");
  const ai = new GoogleGenAI({ apiKey: config.apiKey || requireEnv("GEMINI_API_KEY") });
  const response = await ai.models.generateContent({
    model: config.model,
    contents: prompt,
    config: { responseMimeType: "application/json" }
  });
  return response.text || "{}";
}

async function generateWithOpenAI(prompt: string): Promise<string> {
  const config = await getApiProviderConfig("openai");
  const openai = new OpenAI({ apiKey: config.apiKey || requireEnv("OPENAI_API_KEY") });
  const response = await openai.chat.completions.create({
    model: config.model,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.7
  });
  return response.choices[0]?.message?.content || "{}";
}

async function generateWithDeepSeek(prompt: string): Promise<string> {
  const config = await getApiProviderConfig("deepseek");
  const deepseek = new OpenAI({
    apiKey: config.apiKey || requireEnv("DEEPSEEK_API_KEY"),
    baseURL: config.baseUrl
  });
  const response = await deepseek.chat.completions.create({
    model: config.model,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.7
  });
  return response.choices[0]?.message?.content || "{}";
}

async function generateWithClaude(prompt: string): Promise<string> {
  const config = await getApiProviderConfig("anthropic");
  const baseUrl = (config.baseUrl || "https://api.anthropic.com").replace(/\/$/, "");
  const messagesUrl = `${baseUrl}${baseUrl.endsWith("/v1") ? "" : "/v1"}/messages`;
  const response = await fetch(messagesUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    "x-api-key": config.apiKey || requireEnv("ANTHROPIC_API_KEY"),
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: config.model,
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
  const config = await getApiProviderConfig("cerebras");
  const cerebras = new OpenAI({
    apiKey: config.apiKey || requireEnv("CEREBRAS_API_KEY"),
    baseURL: config.baseUrl
  });
  const model = config.model;
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
  const config = await getApiProviderConfig("zenmux");
  const zenmux = new OpenAI({
    apiKey: config.apiKey || requireEnv("ZENMUX_API_KEY"),
    baseURL: config.baseUrl
  });
  const response = await zenmux.chat.completions.create({
    model: config.model,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.7
  } as any);
  return response.choices[0]?.message?.content || "{}";
}

async function generateWithIamhc(prompt: string): Promise<string> {
  const settings = await readAgentLLMSettings();
  const config = await getApiProviderConfig("iamhc");
  const client = new OpenAI({
    apiKey: config.apiKey || requireEnv("IAMHC_API_KEY"),
    baseURL: config.baseUrl
  });
  const response = await client.chat.completions.create({
    model: settings.iamhcModel || config.model,
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
