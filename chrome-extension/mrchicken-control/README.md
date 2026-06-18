# MrChicken Browser Control

Extensao Chrome Manifest V3 usada pelo `FLOW_BROWSER_DRIVER=extension`.

## Uso

1. Defina no `.env.local`:

```env
FLOW_BROWSER_DRIVER=extension
FLOW_EXTENSION_TOKEN=um-token-local
FLOW_EXTENSION_TASK_TIMEOUT=300000
```

2. Abra `chrome://extensions`.
3. Ative o modo de desenvolvedor.
4. Clique em `Carregar sem compactacao`.
5. Selecione esta pasta: `chrome-extension/mrchicken-control`.
6. Abra as opcoes da extensao e configure:

```text
App URL: http://localhost:3000
Token local: o mesmo valor de FLOW_EXTENSION_TOKEN
```

A extensao nao resolve Cloudflare/Turnstile automaticamente. Quando uma verificacao aparecer, resolva manualmente na aba aberta para a tarefa continuar.
