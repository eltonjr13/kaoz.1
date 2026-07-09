const str = '<TOOL_CALL> { "serverId": "spotify-mcp-server-local", "toolName": "create_playlist", "args": { "name": "Tyler and Kanye Vibes", "description": "Uma curadoria com aproximadamente 30 faixas no estilo de Tyler, The Creator e Kanye West.", "public": true } } </TOOL_CALL>';
const match = str.match(/<TOOL_CALL>\s*(\{[\s\S]*?\})\s*<\/TOOL_CALL>/i);
console.log(match ? 'MATCHED: ' + match[1] : 'FAILED');
