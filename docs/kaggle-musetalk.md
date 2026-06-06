# Rodar MuseTalk no Kaggle para o MrChicken

Este guia configura o MuseTalk como microserviço externo no Kaggle, mantendo o pipeline do MrChicken:

```txt
roteiro -> voz -> lipsync -> render final
```

Como o Kaggle não enxerga o disco local do Next.js, use o modo **upload**:

- Next.js envia `avatar` e `audio` por multipart para `POST /generate-upload`.
- Kaggle processa com MuseTalk.
- Kaggle retorna `videoUrl`.
- Next.js baixa o MP4 para `.generated/jobs/<jobId>/lipsync/musetalk-output.mp4`.
- O FFmpeg usa esse MP4 local no render final.

## Arquivos adicionados

```txt
notebooks/musetalk-kaggle-service.ipynb  # notebook pronto para Kaggle
lib/ai/lipsync.ts                        # suporta LIPSYNC_TRANSFER_MODE=upload
services/lipsync/app.py                  # também aceita /generate-upload
```

## 1. Preparar o Kaggle

1. Abra o Kaggle e crie um notebook novo.
2. Ative GPU em **Settings -> Accelerator -> GPU**.
3. Ative Internet.
4. Em **Add-ons -> Secrets**, crie:

```txt
LIPSYNC_API_KEY=<uma-chave-longa-aleatoria>
```

5. Importe ou copie o notebook:

```txt
notebooks/musetalk-kaggle-service.ipynb
```

6. Execute as células em ordem.

A célula do Cloudflare Tunnel imprimirá algo assim:

```env
LIPSYNC_API_URL=https://xxxx.trycloudflare.com
LIPSYNC_API_KEY=<mesmo valor do Kaggle Secret LIPSYNC_API_KEY>
LIPSYNC_TRANSFER_MODE=upload
LIPSYNC_TIMEOUT_MS=1800000
```

> A URL `trycloudflare.com` é temporária. Quando a sessão Kaggle reiniciar, rode a célula do túnel de novo e atualize o `.env.local`.

## 2. Configurar o MrChicken local

No arquivo `.env.local` do projeto:

```env
LIPSYNC_API_URL=https://xxxx.trycloudflare.com
LIPSYNC_API_KEY=<mesmo valor do Kaggle Secret LIPSYNC_API_KEY>
LIPSYNC_TRANSFER_MODE=upload
LIPSYNC_TIMEOUT_MS=1800000
```

Depois reinicie o servidor Next.js.

## 3. Testar saúde do serviço

No terminal local:

```bash
curl "$LIPSYNC_API_URL/health"
```

Ou, sem depender de variáveis do shell:

```bash
curl "https://xxxx.trycloudflare.com/health"
```

Resposta esperada:

```json
{
  "success": true,
  "engine": "musetalk",
  "gpuAvailable": true
}
```

## 4. Testar geração pelo notebook

A última célula do notebook faz um smoke test com os exemplos oficiais do MuseTalk:

```txt
/kaggle/working/MuseTalk/data/video/yongen.mp4
/kaggle/working/MuseTalk/data/audio/eng.wav
```

Ela chama `POST /generate-upload`, baixa o `videoUrl` e valida que o MP4 existe e tem tamanho maior que zero.

## 5. Rodar o pipeline do MrChicken

Com o Kaggle ligado e o `.env.local` atualizado:

1. Inicie o app Next.js.
2. Crie/inicie um job normalmente.
3. Verifique logs:

```txt
[VOICE] ...
[LIPSYNC] Enviando job ... para MuseTalk ... (upload)
[LIPSYNC] Job ... concluído via MuseTalk: .generated/jobs/.../lipsync/musetalk-output.mp4
[RENDER] ...
```

## Troubleshooting

### `GPU_UNAVAILABLE`

- Confirme que o Kaggle está com **Accelerator = GPU**.
- Rode a célula de diagnóstico e confira `torch.cuda.is_available()`.
- Se o Kaggle entregar P100 e o PyTorch pré-instalado não suportar `sm_60`, troque a sessão/GPU para T4. Reinstalar PyTorch em Python 3.12 pode baixar vários GB e nem sempre resolve.

### Timeout

A primeira execução baixa/carrega modelos e pode demorar. Use:

```env
LIPSYNC_TIMEOUT_MS=1800000
MUSETALK_TIMEOUT_SECONDS=1800
```

### `401 Unauthorized`

A chave em `.env.local` precisa ser exatamente a mesma do Kaggle Secret `LIPSYNC_API_KEY`.

### `videoUrl` inacessível

- Reexecute a célula do Cloudflare Tunnel.
- Atualize `LIPSYNC_API_URL` no `.env.local`.
- Reinicie o Next.js.

### Arquivo local não encontrado no render

No modo Kaggle, mantenha:

```env
LIPSYNC_TRANSFER_MODE=upload
```

Se usar `path`, o Kaggle retornará paths como `/kaggle/working/...`, que não existem na máquina do Next.js.
