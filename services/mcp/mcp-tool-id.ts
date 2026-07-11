export function mcpToolId(serverId:string,name:string){if(!/^[\w.-]+$/.test(serverId)||!/^[\w.-]+$/.test(name))throw new Error("Identificador MCP inválido.");return `mcp:${serverId}:${name}`;}
export function parseMcpToolId(id:string){const match=/^mcp:([\w.-]+):([\w.-]+)$/.exec(id);if(!match)throw new Error("ID de ferramenta MCP inválido.");return {serverId:match[1],toolName:match[2]};}
