# Rodar LatentSync no Kaggle para o MrChicken

Este guia configura o **LatentSync (ByteDance)** como microserviço externo no Kaggle, mantendo o pipeline do MrChicken:

```txt
roteiro -> voz -> lipsync -> render final
```

Como o Kaggle não enxerga o disco local do Next.js, use o modo **upload**:

- Next.js envia `avatar` e `audio` por multipart para `POST /generate-upload`.
- Kaggle processa com LatentSync.
- Kaggle retorna `videoUrl`.
- Next.js baixa o MP4 para `.generated/jobs/<jobId>/lipsync/musetalk-output.mp4`.
- O FFmpeg usa esse MP4 local no render final.

## Arquivos adicionados/modificados

```txt
notebooks/musetalk-kaggle-service.ipynb  # notebook pronto para Kaggle (LatentSync)
lib/ai/lipsync.ts                        # cliente Next.js local compatível
```

---

## 1. Preparar o Kaggle

1. Abra o **Kaggle** e crie um notebook novo.
2. Ative GPU em **Settings -> Accelerator -> GPU** (selecione a **T4 GPU** ou **T4 x2**).
3. Ative a Internet em **Settings -> Internet = On**.
4. Importe ou copie o arquivo do notebook:
   ```txt
   notebooks/musetalk-kaggle-service.ipynb
   ```
5. Execute as células em ordem.

A célula do Cloudflare Tunnel imprimirá algo assim:

```env
=== CONFIGURE NO .env.local DO MRCHICKEN ===
LIPSYNC_API_URL=https://xxxx.trycloudflare.com
# LIPSYNC_API_KEY não é necessária
LIPSYNC_TRANSFER_MODE=upload
LIPSYNC_TIMEOUT_MS=1800000
```

> **Nota:** A URL `trycloudflare.com` é temporária. Se a sessão Kaggle reiniciar ou expirar, você deve rodar a célula do túnel novamente e atualizar o `.env.local` com a nova URL gerada.

---

## 2. Configurar o MrChicken local

No arquivo `.env.local` do seu projeto MrChicken local:

```env
LIPSYNC_API_URL=https://xxxx.trycloudflare.com
LIPSYNC_TRANSFER_MODE=upload
LIPSYNC_TIMEOUT_MS=1800000
```

Depois reinicie o servidor Next.js local (`npm run dev`).

---

## 3. Testar saúde do serviço

No terminal local, verifique a conexão:

```bash
curl "https://xxxx.trycloudflare.com/health"
```

Resposta esperada:

```json
{
  "success": true,
  "engine": "latentsync",
  "gpuAvailable": true
}
```

---

## 4. Funcionamento Interno e Imagens Estáticas

### Entrada de Vídeo
Se você passar um vídeo como avatar, o LatentSync processará a sincronização labial diretamente na face detectada no vídeo sincronizando com o áudio.

### Entrada de Imagem Estática (Fallback automático)
Como o LatentSync é um modelo de difusão de vídeo para vídeo e requer um arquivo de vídeo como entrada, o microserviço possui uma lógica transparente de fallback:
- Se o avatar enviado for uma imagem (`.jpg`, `.jpeg`, `.png`, `.webp`), o microserviço usará o **FFmpeg** em segundo plano para gerar um vídeo estático em loop sincronizado exatamente com a duração do áudio enviado.
- Esse vídeo gerado é então enviado para o pipeline de inferência do LatentSync.
- Isso permite usar tanto avatares em imagem quanto avatares em vídeo de forma 100% transparente.

---

## 5. Troubleshooting no Kaggle

### `GPU_UNAVAILABLE`
- Confirme que o Kaggle está com o acelerador de hardware configurado em **GPU**.
- Se necessário, limpe o cache e reinicie a sessão.

### OOM (Out Of Memory) na GPU
- A inferência de difusão do LatentSync consome bastante VRAM (cerca de 20GB-30GB para vídeos em resolução total).
- Se a inferência falhar por falta de memória na T4, tente usar uma imagem ou um vídeo de menor duração/resolução.
- O script está configurado para utilizar automaticamente `stage2.yaml` se disponível, ou o `second_stage.yaml`. Você pode alterar o código do serviço para usar `configs/unet/stage2_efficient.yaml` se precisar economizar VRAM.

### DNS ou falha ao baixar checkpoints
- Certifique-se de que a opção **Internet** está ativada (Internet = On) no painel de configurações à direita do Kaggle.
- A ferramenta `huggingface-cli` é usada para baixar os pesos de `ByteDance/LatentSync`. Esse processo consome cerca de 4.5 GB de dados e pode demorar alguns minutos na primeira execução.
