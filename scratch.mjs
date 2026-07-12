import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function run() {
  console.log("Iniciando teste MCP Puppeteer...");
  const transport = new StdioClientTransport({
    command: "npx.cmd",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    env: process.env
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    console.log("Conectando...");
    await client.connect(transport);
    console.log("Conectado! Listando tools...");
    const tools = await client.listTools();
    console.log("Tools encontradas:", tools.tools.map(t => t.name));
    await client.close();
  } catch (err) {
    console.error("ERRO FATAL:", err);
  }
}

run();
