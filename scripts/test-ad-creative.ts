import * as fs from "fs";
import * as path from "path";
import { classifyIntention } from "../lib/ai/gemini";
// Simple helper to load .env.local variables manually
function loadEnvLocal() {
  const envPath = path.resolve(".env.local");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/);
      if (match) {
        const key = match[1];
        let val = match[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.slice(1, -1);
        } else if (val.startsWith("'") && val.endsWith("'")) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  }
}
async function test() {
  console.log("Loading .env.local variables...");
  loadEnvLocal();
  if (!process.env.GEMINI_API_KEY) {
    console.error("ERRO: GEMINI_API_KEY não encontrada no .env.local.");
    process.exit(1);
  }
  const prompt = "Gere 20 imagens criativas de anúncio para o produto Kaoz.1, focado em alta conversão e inteligência artificial para o público de programadores.";
  console.log(`\nTestando classificação com o prompt: "${prompt}"\n`);
  try {
    const decision = await classifyIntention(prompt);
    console.log("Decisão do Agente:");
    console.log(JSON.stringify(decision, null, 2));
    if (decision.flow === "ad-creative") {
      console.log("\n[SUCESSO] O fluxo foi classificado corretamente como 'ad-creative'!");
      if (decision.adCreativePlan && decision.adCreativePlan.concepts.length > 0) {
        console.log(`[SUCESSO] Foram gerados ${decision.adCreativePlan.concepts.length} conceitos criativos.`);
        for (const concept of decision.adCreativePlan.concepts) {
          console.log(`\n- Conceito: ${concept.conceptName}`);
          console.log(`  Copy: "${concept.copyText}"`);
          console.log(`  Visual Prompt: "${concept.visualPrompt}"`);
        }
      } else {
        console.error("[FALHA] Nenhum conceito criativo foi retornado no adCreativePlan.");
      }
    } else {
      console.error(`[FALHA] Esperava fluxo 'ad-creative', mas retornou: '${decision.flow}'`);
    }
  } catch (err) {
    console.error("Erro durante o teste:", err);
  }
}
test();
