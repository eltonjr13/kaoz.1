# Kaoz Flow Companion — prova local

Extensão Manifest V3 para testar geração de uma imagem na sessão normal do Chrome.
O experimento usa `http://localhost:3000/flow-extension-test.html` e não altera o
provedor de geração do desktop. Não é ainda a integração de produção do app web.

## Instalação

1. No Chrome, abra `chrome://extensions` e ative **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e selecione
   `D:\apps\mrchicken\extensions\flow-companion`.
3. Pelo menu de extensões, abra **Kaoz Flow Companion — teste** e clique em
   **Abrir teste no Kaoz**. O link preenche automaticamente o ID da extensão.
4. Mantenha o app local rodando na porta 3000.

Instalação local conforme a [documentação oficial do Chrome](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

## Teste real

1. Faça login normalmente no Flow, no mesmo perfil do Chrome da extensão.
2. Deixe exatamente uma aba de projeto do Flow aberta, com o comando vazio.
3. Desative **Agente** e selecione **Nano Banana** ou **Imagen**, quantidade **x1**.
4. No painel local, conecte e clique em **Gerar uma imagem**.
5. Verifique a nova imagem no Flow, sua prévia no painel e o arquivo baixado.

O teste envia o prompt informado ao Google e utiliza a geração disponível na conta.
A extensão não solicita permissões de cookies, histórico ou depuração. A sessão
permanece no Chrome. O painel recebe somente o resultado desta solicitação.

## Escopo e limites

- Somente a página de teste na porta 3000 pode enviar comandos. Outros sites,
  outras portas e outras páginas são recusados pelo service worker.
- A aba que iniciou o trabalho é a única que pode consultar seu resultado.
- Uma geração por vez; não há reenvio automático em caso de timeout.
- Selecione um projeto vazio e não interaja com ele durante a geração. O protótipo
  identifica o resultado pela nova imagem exibida; ele não correlaciona IDs da API do Google.
- Download limitado a PNG, JPEG ou WebP de até 12 MB dos hosts permitidos.
- Mudanças no editor do Flow, desafios do Google, recarga/fechamento da aba e URLs
  de mídia fora dos hosts previstos podem exigir intervenção. Não há captura de sessão.
- Ainda não há fila persistente, referências, vários usuários ou domínio hospedado.
- Ao atualizar o código, recarregue a extensão em `chrome://extensions` e recarregue
  a aba do Flow somente quando não houver geração em andamento.

## Validação em 2026-09-09

- `node --test tests/flow-companion.test.mjs`: quatro testes passaram.
- ESLint dos arquivos da extensão, painel e testes: passou, sem alterar a configuração.
- Painel local abriu no Chrome; geração fica desativada sem conexão.
- Flow abriu autenticado e um projeto novo foi preparado com Nano Banana 2, x1.
- Instalação e geração real: pendentes. A ferramenta de controle bloqueou
  `chrome://extensions`; é necessário o usuário carregar a pasta manualmente.

Arquitetura: painel local → mensagens externas → service worker → content script
no projeto autenticado do Flow → nova imagem → arquivo de imagem no painel.
