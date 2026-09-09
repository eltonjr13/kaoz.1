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

Todos os sons foram criados por síntese procedural, sem amostras de terceiros. Os parâmetros de síntese estão versionados em `scripts/generate-ui-sounds.mjs`; execute `node scripts/generate-ui-sounds.mjs` na raiz do projeto para reproduzir o pacote.

Os arquivos são propriedade do Kaoz.1. Consulte `manifest.json` para formato, versão, duração e hash de cada ativo.
