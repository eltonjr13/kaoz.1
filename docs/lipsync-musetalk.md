# Integração MuseTalk Lip-Sync

Esta integração substitui o placeholder antigo de lip-sync por um provider HTTP desacoplado baseado em MuseTalk, mantendo o pipeline existente:

```txt
generateScript() -> generateVoice() -> generateLipSync() -> renderVideo()
```

## Estrutura

```txt
lib/ai/lipsync.ts              # contrato LipSyncProvider + MuseTalkProvider
services/lipsync/app.py        # API REST FastAPI
services/lipsync/musetalk_service.py
services/lipsync/models/       # checkpoints/modelos quando gerenciados localmente
services/lipsync/outputs/      # saídas por job
```

## Contrato REST

`POST /generate` usa paths locais/compartilhados:

Request:

```json
{
  "jobId": "uuid",
  "avatarPath": "/path/avatar.jpg",
  "audioPath": "/path/audio.wav"
}
```

Response:

```json
{
  "success": true,
  "videoPath": "/path/output.mp4"
}
```

`POST /generate-upload` usa `multipart/form-data`, recomendado para Kaggle/serviços externos:

```txt
jobId=<uuid>
avatar=<arquivo jpg/png/webp/mp4>
audio=<arquivo wav/mp3/m4a>
```

Response:

```json
{
  "success": true,
  "provider": "musetalk-v15",
  "videoPath": "/kaggle/working/.../musetalk-v15-output.mp4",
  "videoUrl": "https://xxxx.trycloudflare.com/outputs/<jobId>/musetalk-v15-output.mp4"
}
```

Quando LIPSYNC_API_KEY está configurado no microserviço, o Next.js envia os headers Authorization: Bearer *** e X-API-Key: <key>.

## Variáveis de ambiente do Next.js

```env
LIPSYNC_ENGINE=musetalk-v15
LIPSYNC_API_URL=http://localhost:8010
LIPSYNC_API_KEY=
LIPSYNC_TIMEOUT_MS=1800000
LIPSYNC_TRANSFER_MODE=upload
LIPSYNC_DOWNLOADS_DIR=.generated/jobs
```

Use `LIPSYNC_TRANSFER_MODE=path` quando o microserviço e o Next.js compartilham o mesmo filesystem. O renderizador FFmpeg recebe `lipSyncResult.videoPath` como `reactionVideoPath`, então o `videoPath` retornado pelo MuseTalk precisa existir no worker Next.js.

Use `LIPSYNC_TRANSFER_MODE=upload` para Kaggle/ambiente externo. Nesse modo o Next.js envia avatar e áudio para `POST /generate-upload`, recebe `videoUrl`, baixa o MP4 para `.generated/jobs/<jobId>/lipsync/musetalk-v15-output.mp4` e retorna esse path local para o FFmpeg. Veja `docs/kaggle-musetalk-v15.md` ou `docs/colab-musetalk-v15.md`.

## Variáveis do microserviço Python

```env
LIPSYNC_API_KEY=mesma-chave-do-next
MUSETALK_REPO_PATH=/kaggle/working/MuseTalk
MUSETALK_VERSION=v15
MUSETALK_UNET_MODEL_PATH=models/musetalkV15/unet.pth
MUSETALK_UNET_CONFIG=models/musetalkV15/musetalk.json
MUSETALK_OUTPUTS_DIR=/kaggle/working/mrchicken_lipsync_outputs
MUSETALK_TIMEOUT_SECONDS=1800
MUSETALK_REQUIRE_GPU=true
MUSETALK_FFMPEG_PATH=
```

Alternativa avançada para instalações customizadas:

```env
MUSETALK_COMMAND_TEMPLATE='python /opt/MuseTalk/scripts/inference.py --avatar "$avatarPath" --audio "$audioPath" --result "$outputPath"'
```

Placeholders suportados no template: `$jobId`, `$avatarPath`, `$audioPath`, `$outputPath`, `$jobDir`, `$modelsDir`.

## Executando o microserviço

```bash
cd services/lipsync
python -m venv .venv
. .venv/Scripts/activate  # Windows Git Bash
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8010
```

Instale o MuseTalk e o build CUDA do PyTorch conforme a GPU do host. O `requirements.txt` não fixa `torch` ou bibliotecas OpenMMLab (`mmcv`, `mmpose`, etc.) porque dependem de build CUDA específico por ambiente.

## Tratamento de falhas

- Arquivo de avatar/áudio ausente: `FILE_NOT_FOUND` / HTTP 404.
- GPU/CUDA indisponível: `GPU_UNAVAILABLE` / HTTP 503.
- Timeout: `TIMEOUT` / HTTP 504.
- Erro do subprocesso MuseTalk: `MUSETALK_ERROR` / HTTP 500.
- No Next.js, esses códigos são normalizados como `LipSyncError` (`LIPSYNC_FILE_MISSING`, `LIPSYNC_GPU_UNAVAILABLE`, `LIPSYNC_TIMEOUT`, etc.).

## Logs

Os estágios usam prefixos padronizados:

```txt
[VOICE]   geração de voz OmniVoice
[LIPSYNC] chamada ao provider MuseTalk e microserviço Python
[RENDER]  composição FFmpeg final
```

## Troca futura de motor

`lib/ai/lipsync.ts` define:

```ts
export interface LipSyncProvider {
  readonly name: LipSyncEngine;
  generateTalkingAvatar(input: LipSyncInput): Promise<LipSyncResult>;
}
```

Para adicionar Wav2Lip, Hallo ou OmniHuman, implemente uma nova classe com `generateTalkingAvatar()` e registre em `createLipSyncProvider()`. O pipeline não precisa mudar.

