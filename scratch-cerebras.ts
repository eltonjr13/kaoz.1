import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { queryConfiguredAgentCli } from "./services/agent-llm/agent-llm.service.ts";

async function run() {
  console.log("Iniciando query...");
  try {
    const res = await queryConfiguredAgentCli("Por favor, pesquise no Google qual é a cotação do dólar hoje e me diga");
    console.log("RESPOSTA DO CEREBRAS:");
    console.log(res);
  } catch(e) {
    console.error("ERRO:", e);
  }
}
run();
