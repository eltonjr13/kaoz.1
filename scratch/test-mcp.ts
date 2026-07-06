import { McpManager } from "../services/mcp/mcp.manager";

async function run() {
  const manager = await McpManager.getInstance();
  const statuses = manager.getStatuses();
  console.log("Status dos servidores MCP:");
  console.log(JSON.stringify(statuses, null, 2));

  const tools = await manager.getAllTools();
  console.log("\nFerramentas carregadas:");
  console.log(tools.map(t => t.tool.name));
  
  process.exit(0);
}

run().catch(console.error);
