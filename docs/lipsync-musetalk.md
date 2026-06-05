# Integração MuseTalk Lip-Sync

Esta integração substitui o placeholder antigo de lip-sync por um provider HTTP desacoplado baseado em MuseTalk, mantendo o pipeline existente:

```txt
generateScript() -> generateVoice() -> generateLipSync() -> renderVideo()
```

## Estrutura

```txt
lib/ai/lipsync.ts              # contrato LipSyncProvider + MuseTalkProvider
lib/videos/lip-sync.ts         # wrapper de compatibilidade do pipeline antigo
services/lipsync/app.py        # API REST FastAPI
services/lipsync/musetalk_service.py
services/lipsync/models/       # checkpoints/modelos quando gerenciados localmente
services/lipsync/outputs/      # saídas por job
```

## Contrato REST

`POST /generate`

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

Quando LIPSYNC_API_KEY está configurado no microserviço, o Next.js envia os headers Authorization: Bearer <key> e X-API-Key: <key>.

## Variáveis de ambiente do Next.js

```env
LIPSYNC_API_URL=http://localhost:8010
LIPSYNC_API_KEY=
LIPSYNC_TIMEOUT_MS=900000
```

O renderizador FFmpeg recebe `lipSyncResult.videoPath` como `reactionVideoPath`, então o `videoPath` retornado pelo MuseTalk precisa estar acessível no filesystem do worker Next.js. Em ambiente externo, use volume compartilhado, mount de rede ou um path comum dentro do container/VM.

## Variáveis do microserviço Python

```env
LIPSYNC_API_KEY=mesma-chave-do-next
MUSETALK_REPO_PATH=/opt/MuseTalk
MUSETALK_PYTHON=python
MUSETALK_TIMEOUT_SECONDS=900
MUSETALK_REQUIRE_GPU=true
MUSETALK_OUTPUTS_DIR=/shared/mrchicken/lipsync
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

Instale o MuseTalk e o build CUDA do PyTorch conforme a GPU do host. O `requirements.txt` não fixa `torch` porque wheels CUDA são específicos por ambiente.

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
