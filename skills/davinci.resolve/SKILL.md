---
name: "DaVinci Resolve local"
description: "Consulta e controla o DaVinci Resolve local pela API oficial usando o servidor MCP seguro do Kaoz.1."
version: "1.0.0"
preferredTools: ["mcp:davinci-resolve-local:resolve_get_status", "mcp:davinci-resolve-local:resolve_list_projects", "mcp:davinci-resolve-local:resolve_open_project", "mcp:davinci-resolve-local:resolve_get_current_timeline", "mcp:davinci-resolve-local:resolve_list_timelines", "mcp:davinci-resolve-local:resolve_create_timeline", "mcp:davinci-resolve-local:resolve_import_media", "mcp:davinci-resolve-local:resolve_append_clips", "mcp:davinci-resolve-local:resolve_add_marker", "mcp:davinci-resolve-local:resolve_add_subtitles", "mcp:davinci-resolve-local:resolve_export_timeline", "mcp:davinci-resolve-local:resolve_create_render_job", "mcp:davinci-resolve-local:resolve_get_render_status", "mcp:davinci-resolve-local:resolve_start_render"]
requiredCapabilities: ["content"]
approvalMode: "step"
enabled: "true"
tools: []
---
Use primeiro as ferramentas de leitura para confirmar o projeto e a timeline.

Toda chamada MCP deve gerar uma aprovação humana de uso único antes de ser executada. Para edição, crie uma timeline nova no namespace `Kaoz -`; não substitua timelines existentes. Criar um render job apenas prepara a fila. Inicie o render somente depois de uma segunda aprovação explícita.

Se o diagnóstico indicar que o Resolve, o módulo Python ou os paths estão indisponíveis, explique a recuperação indicada pela ferramenta sem tentar automação de tela, mouse ou teclado.
