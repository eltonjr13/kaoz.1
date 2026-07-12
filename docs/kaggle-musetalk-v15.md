# Guia: Executando MuseTalk 1.5 Oficial no Kaggle / Colab

Este guia detalha como executar o **MuseTalk 1.5 Oficial** (sincronização labial de última geração da Tencent Music Lyra Lab) como um microserviço REST externo no **Kaggle** ou **Google Colab**, integrado ao pipeline do MrChicken.

Como o ambiente do Kaggle/Colab e a sua máquina de desenvolvimento local não compartilham o mesmo sistema de arquivos, utilizamos o modo **upload**:

1. O Next.js envia o `avatar` (ou `video`) e o `audio` via requisição `multipart/form-data` para o endpoint `/generate-upload`.
2. O microserviço processa a inferência usando o repositório oficial da TMElyralab.
3. O microserviço responde com o `videoUrl` público temporário gerado pelo túnel.
4. O Next.js baixa o arquivo MP4 para o caminho local `.generated/jobs/<jobId>/lipsync/musetalk-v15-output.mp4`.
5. O renderizador local do MrChicken (FFmpeg) consome esse arquivo local no pipeline final.

---

## 1. Passo a Passo no Kaggle / Colab

### Passo 1: Preparar o Notebook
1. Crie uma conta ou faça login no [Kaggle](https://www.kaggle.com/) ou [Google Colab](https://colab.research.google.com/).
2. Crie um novo Notebook.
3. Ative a GPU:
   - **Kaggle**: Vá nas opções laterais à direita -> *Accelerator* -> selecione **T4 GPU** (ou GPU T4 x2).
   - **Colab**: Vá em *Ambiente de Execução* -> *Alterar tipo de ambiente de execução* -> selecione **GPU T4**.
4. Ative a Internet (obrigatório no Kaggle):
   - **Kaggle**: Ative a opção *Internet on* nas configurações laterais.
5. Importe ou faça upload do notebook gerado em seu projeto:
   `notebooks/musetalk-kaggle-service.ipynb`

### Passo 2: Executar as células
Execute todas as células em ordem. O processo de setup fará o seguinte automaticamente:
- Clonará ou atualizará o repositório oficial `https://github.com/TMElyralab/MuseTalk`.
- Instalará os pacotes de sistema necessários (`libgl1`, `ffmpeg`).
- Instalará os pacotes Python oficiais do OpenMMLab (`mmengine`, `mmcv`, `mmdet`, `mmpose`).
- Baixará todos os pesos oficiais necessários do MuseTalk 1.5 do Hugging Face.
- Validará a estrutura de pastas e arquivos dos pesos.
- Escreverá e subirá o microserviço FastAPI (`app.py` e `musetalk_service.py`).
- Exporá a porta local (`8010`) via túnel público temporário da Cloudflare.

### Passo 3: Copiar o bloco `.env` gerado
A última célula do notebook imprimirá o bloco de configuração que você deve copiar e colar no seu arquivo `.env.local` do MrChicken. Exemplo de saída:

```env
LIPSYNC_ENGINE=musetalk-v15
LIPSYNC_API_URL=https://xxxxxxxxxx.trycloudflare.com
LIPSYNC_API_KEY=13991059620
LIPSYNC_TRANSFER_MODE=upload
LIPSYNC_TIMEOUT_MS=1800000
```

> [!WARNING]
> A URL gerada pela Cloudflare (`trycloudflare.com`) é temporária e expira quando a sessão do notebook for encerrada ou recomeçada. Lembre-se de atualizar o `.env.local` caso reinicie o notebook.

---

## 2. Configurando o MrChicken local

Edite o arquivo `D:\apps\mrchicken\.env.local` no seu ambiente local e cole o bloco gerado acima. Em seguida, reinicie o Next.js:

```bash
npm run dev
```

---

## 3. Validando e Testando a Conexão

### Teste de Saúde (/health)
Você pode rodar uma requisição GET local no terminal para validar que o serviço externo está respondendo e que a GPU/checkpoints estão configurados corretamente:

```bash
curl "https://xxxxxxxxxx.trycloudflare.com/health"
```

A resposta JSON esperada deve conter:
```json
{
  "success": true,
  "engine": "musetalk-v15",
  "gpuAvailable": true,
  "repoPath": "/kaggle/working/MuseTalk",
  "outputsPath": "/kaggle/working/mrchicken_lipsync_outputs",
  "config": {
    "musetalk_version": "v15",
    "unet_model_path": "models/musetalkV15/unet.pth",
    "unet_config": "models/musetalkV15/musetalk.json",
    "require_gpu": "true",
    "timeout_seconds": "1800"
  },
  "imports": {
    "torch": "OK",
    "diffusers": "OK",
    "transformers": "OK",
    "mmpose": "OK",
    "mmcv": "OK",
    "mmdet": "OK",
    "mmengine": "OK"
  }
}
```

---

## 4. Diferenças entre Transfer Modes

- **`upload`**: Recomendado para rodar o serviço em GPU externa na nuvem (Kaggle/Colab). O Next.js gerencia uploads de arquivos e baixa o resultado gerado.
- **`path`**: Recomendado quando o microserviço roda localmente na mesma máquina ou em ambiente compartilhado via rede local, onde ambos os servidores podem acessar diretamente os caminhos de arquivo absolutos.

---

## 5. Resolução de Problemas (Troubleshooting)

### Erro `GPU_UNAVAILABLE`
Certifique-se de que selecionou a GPU como acelerador no Kaggle/Colab e reinicie o notebook.

### Falha ao importar pacotes `mmcv` / `mmpose`
O script do notebook já gerencia a instalação correta na sequência recomendada usando `openmim`. Caso ocorra algum problema de compilação, você pode forçar a reinstalação reinstalando a célula correspondente.

### Túnel Cloudflare travado
Se a URL do túnel não aparecer após 90 segundos, tente parar a execução da célula e execute-a novamente.
