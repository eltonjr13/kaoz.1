# DaVinci Resolve Free — edição inteligente do Kaoz.1

O Resolve Free não aceita a conexão externa usada pelo MCP oficial. Este modo
usa processamento local e um script executado manualmente dentro do Resolve,
sem mouse virtual, socket local ou tentativa de contornar a licença.

## Fluxo inteligente

1. Em **Settings > Resolve Free**, instale o runner uma vez.
2. Informe o vídeo, curso, módulo, estilo e uma música opcional.
3. Clique em **Analisar áudio e planejar edição**.
4. Revise os momentos escolhidos pelo agente e renderize a prévia.
5. Assista à prévia e clique em **Aprovar e preparar para o Resolve**.
6. No Resolve, execute
   **Workspace > Scripts > Utility > Kaoz.1 > Kaoz1ApplyPlan**.
7. Revise a nova timeline `Kaoz - ...`. Nenhuma timeline existente é editada.

## O que é aplicado de fato

A prévia incorpora intro e encerramento de quatro segundos, lower thirds,
zooms suaves, transições discretas, correção de cor conservadora, redução de
ruído, equalização, compressão, limiter, normalização de voz, música entre
−35 e −40 dB e legendas revisadas. O agente recebe apenas a transcrição
temporal compacta, com ferramentas externas desabilitadas.

O áudio informa **quando** uma explicação merece destaque, mas não informa
**onde** o cursor está. Por isso, o destaque de cursor só é aplicado quando
existem coordenadas produzidas por análise visual local ou telemetria; o
sistema não inventa uma posição.

O plano enviado ao Resolve é de uso único e idempotente por `requestId`.
Planos substituídos são arquivados, não apagados. O runner não executa código
recebido no JSON e sempre cria uma timeline nova.
