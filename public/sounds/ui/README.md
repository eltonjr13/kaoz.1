# Kaoz.1 Sonic Identity — Dark Tech

Pacote original de sons curtos para a interface do Kaoz.1.

| Arquivo | Evento sugerido | Uso |
| --- | --- | --- |
| `send.wav` | `send` | Ação enviada |
| `receive.wav` | `receive` | Nova resposta |
| `success.wav` | `success` | Operação concluída |
| `attention.wav` | `attention` | Aprovação ou decisão pendente |
| `error.wav` | `error` | Falha definitiva |
| `mic-on.wav` | `mic.on` | Início da captura de voz |
| `mic-off.wav` | `mic.off` | Fim da captura de voz |
| `task-complete.wav` | `task.complete` | Tarefa importante concluída |
| `app-open.wav` | `app.open` | Abertura do Kaoz.1 |
| `navigate.wav` | `navigate` | Navegação entre áreas principais |
| `toggle-on.wav` | `toggle.on` | Controle ativado |
| `toggle-off.wav` | `toggle.off` | Controle desativado |
| `processing-start.wav` | `processing.start` | Processamento iniciado |
| `progress-step.wav` | `progress.step` | Etapa relevante do progresso |
| `warning.wav` | `warning` | Condição que merece revisão |
| `cancel.wav` | `cancel` | Operação cancelada |
| `connected.wav` | `connected` | Conexão estabelecida |
| `disconnected.wav` | `disconnected` | Conexão encerrada |
| `download-ready.wav` | `download.ready` | Arquivo pronto para uso |

Todos os sons foram criados por síntese procedural, sem amostras de terceiros. Os parâmetros de síntese estão versionados em `scripts/generate-ui-sounds.mjs`; execute `node scripts/generate-ui-sounds.mjs` na raiz do projeto para reproduzir o pacote.

Os arquivos são propriedade do Kaoz.1. Consulte `manifest.json` para formato, versão, duração e hash de cada ativo.
