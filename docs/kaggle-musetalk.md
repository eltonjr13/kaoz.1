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

### Erro `Could not resolve host: github.com`

Se aparecer na célula de clone/update:

```txt
fatal: unable to access 'https://github.com/TMElyralab/MuseTalk.git/': Could not resolve host: github.com
```

isso significa que a sessão Kaggle está sem DNS/Internet para o GitHub. Faça:

1. No notebook Kaggle, abra **Settings**.
2. Ative **Internet = On**.
3. Se já estiver ativado, use **Restart session**.
4. Rode de novo desde a célula de setup.

A versão atualizada do notebook agora:

- testa DNS para `github.com` antes de clonar;
- se o repositório já existir e estiver íntegro, continua usando o clone local quando apenas o `git fetch` falhar;
- só bloqueia se o clone não existir ou estiver incompleto.

### Erro `cv2` / NumPy 2.x na célula de dependências

Se aparecer:

```txt
A module that was compiled using NumPy 1.x cannot be run in NumPy 2.x
AttributeError: _ARRAY_API not found
ImportError: numpy.core.multiarray failed to import
```

rode novamente a célula de dependências atualizada. Ela força:

```txt
numpy==1.26.4
opencv-python==4.9.0.80
```

Depois disso, **reinicie o runtime do Kaggle** se `cv2` já tiver sido importado na sessão atual, e execute as células desde o início.

Os avisos de conflito com pacotes do Kaggle como `cudf`, `cuml`, `dask-cuda`, `gradio`, `mne` e `sentence-transformers` podem aparecer porque o ambiente Kaggle vem com muitos pacotes pré-instalados. Eles não são bloqueantes para o microserviço MuseTalk desde que a validação da célula termine com `imports ok`.

### `500 Internal Server Error` em `/generate-upload`

Se o smoke test chegar ao Cloudflare mas retornar:

```txt
HTTPError: 500 Server Error: Internal Server Error for url: .../generate-upload
```

isso significa que o tunnel e o FastAPI subiram; a falha agora está dentro da inferência MuseTalk. Antes de tentar corrigir às cegas, imprima o corpo da resposta e os logs do job no Kaggle:

```python
print(response.status_code)
print(response.text[:5000])

from pathlib import Path
job_dir = Path('/kaggle/working/mrchicken_lipsync_outputs/kaggle-smoke-test')
print('job_dir:', job_dir, 'exists=', job_dir.exists())
for p in sorted(job_dir.rglob('*')):
    print(p, p.stat().st_size)

error_log = job_dir / 'error.log'
if error_log.exists():
    print(error_log.read_text(encoding='utf-8')[-8000:])
```

A versão atualizada do notebook registra o traceback em `error.log` e inclui `debugPath` no JSON de erro.

#### Erro `clear_device_cache` / `accelerate.utils.memory`

Se o corpo do erro contiver:

```txt
cannot import name 'clear_device_cache' from 'accelerate.utils.memory'
```

atualize o Accelerate no Kaggle:

```python
import sys, subprocess
subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', '--upgrade', 'accelerate==0.34.2', 'diffusers==0.30.2', 'peft==0.10.0'], check=True)
subprocess.run([sys.executable, '-c', 'from accelerate.utils.memory import clear_device_cache; from diffusers import AutoencoderKL; import peft; print("accelerate/diffusers/peft ok")'], check=True)
```

Depois reexecute o smoke test. Como a inferência roda em subprocesso, normalmente não precisa reiniciar o runtime; se persistir, use **Restart session** e rode as células desde o setup. A célula de dependências do notebook atualizado já usa `accelerate==0.34.2` e `peft==0.10.0`.

#### Erro `EncoderDecoderCache` / `peft` + `transformers`

Se aparecer:

```txt
cannot import name 'EncoderDecoderCache' from 'transformers'
```

é o `peft` novo demais para `transformers==4.39.2`. Corrija fixando `peft==0.10.0`:

```python
import sys, subprocess
subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', '--upgrade', 'peft==0.10.0', 'accelerate==0.34.2', 'diffusers==0.30.2'], check=True)
subprocess.run([sys.executable, '-c', 'from accelerate.utils.memory import clear_device_cache; import peft; from diffusers import AutoencoderKL; print("hf stack ok")'], check=True)
```

Depois rode novamente o smoke test.

### Erro `PUBLIC_URL is not defined` no smoke test

Se aparecer na última célula:

```txt
NameError: name 'PUBLIC_URL' is not defined
```

significa que a célula do **Uvicorn + Cloudflare Tunnel** não foi executada com sucesso nesta sessão, ou o runtime foi reiniciado depois dela. Rode novamente a célula que inicia o serviço e aguarde ela imprimir:

```env
LIPSYNC_API_URL=https://xxxx.trycloudflare.com
```

Depois rode o smoke test. Se já tiver a URL, também pode definir manualmente antes do teste:

```python
PUBLIC_URL = 'https://xxxx.trycloudflare.com'
```

A versão atualizada do notebook agora mostra uma mensagem mais clara e também testa `/health` antes de chamar `/generate-upload`.

### Erro `SyntaxError: unterminated string literal` no `mrchicken_lipsync_service.py`

Se o Uvicorn morrer com algo como:

```txt
/kaggle/working/mrchicken_lipsync_service.py", line 55
config_path.write_text("task_0:
SyntaxError: unterminated string literal
```

use a versão atualizada do notebook. Esse erro vinha de strings `\n` escapadas incorretamente dentro do script Python gerado pela célula do microserviço. A versão corrigida valida também a sintaxe do serviço gerado.

Se já estiver com a sessão Kaggle aberta, reexecute a célula que escreve o microserviço e depois a célula do Uvicorn/Cloudflare Tunnel. O `ConnectionRefusedError` em `/health` é apenas consequência do Uvicorn não ter subido.

### Erro `gdown: unrecognized arguments: --id`

Se aparecer na célula de download dos pesos:

```txt
__main__.py: error: unrecognized arguments: --id
```

use a versão atualizada do notebook. O `gdown` atual aceita o Google Drive file id/URL como argumento posicional, não mais `--id`. A célula corrigida usa:

```python
gdown.download('https://drive.google.com/uc?id=154JgKpzCPW82qINcVieuPH3fZ2e0P812', output_path)
```

ou fallback CLI:

```bash
python -m gdown 'https://drive.google.com/uc?id=154JgKpzCPW82qINcVieuPH3fZ2e0P812' -O /kaggle/working/MuseTalk/models/face-parse-bisent/79999_iter.pth
```

Pode reexecutar apenas a célula de download dos pesos; os downloads já concluídos pelo Hugging Face são reaproveitados.

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
