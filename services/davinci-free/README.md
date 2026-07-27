# DaVinci Resolve Free — runner interno do Kaoz.1

O Resolve Free não aceita a conexão externa usada pelo MCP oficial. Este modo
usa um script **executado manualmente dentro do Resolve**, sem mouse virtual,
atalhos, socket local ou tentativa de contornar a licença.

## Fluxo

1. Em **Settings > Resolve Free**, instale o runner uma vez.
2. Prepare a voz (opcional) e o plano de edição.
3. Abra um projeto existente no Resolve Free.
4. Execute **Workspace > Scripts > Utility > Kaoz.1 > Kaoz1ApplyPlan**.
5. Revise a nova timeline `Kaoz - ...`. Nenhuma timeline existente é editada.

O runner monta intro, vídeo principal e encerramento; adiciona voz preparada,
música em faixa separada, correção CDL conservadora e marcadores rastreáveis.
Lower thirds, zoom animado, cursor, transições e importação do SRT ficam
marcados para acabamento visual porque essas operações não possuem uma API
estável e segura equivalente na edição Free.

O plano é de uso único e idempotente por `requestId`. O runner não executa
código recebido no JSON e não inicia render.
