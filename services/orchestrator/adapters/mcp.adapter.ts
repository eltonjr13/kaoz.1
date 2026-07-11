import { McpManager } from "../../mcp/mcp.manager";
import type { KaozTool, ToolResult } from "../../tools/tool.types";
import { truncateToolResult } from "../orchestrator.budget";
import { mcpToolId, parseMcpToolId } from "../../mcp/mcp-tool-id";
export async function discoverMcpTools():Promise<KaozTool[]>{ const manager=await McpManager.getInstance(); const entries=await manager.getAllTools(); return entries.map(({serverId,tool})=>({id:mcpToolId(serverId,tool.name),name:tool.name,description:tool.description||`Ferramenta MCP de ${serverId}`,source:"mcp",inputSchema:tool.inputSchema,effect:"external",approvalMode:"step",timeoutMs:45_000,enabled:true})); }
export async function executeMcpTool(id:string,args:Record<string,unknown>):Promise<ToolResult>{ const {serverId,toolName}=parseMcpToolId(id); const manager=await McpManager.getInstance(); const known=(await manager.getAllTools()).some((e)=>e.serverId===serverId&&e.tool.name===toolName); if(!known) throw new Error("Ferramenta MCP indisponível ou servidor desconectado."); return {output:truncateToolResult(await manager.callTool(serverId,toolName,args))}; }
