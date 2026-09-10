# Kaoz Flow Companion

Extensão Manifest V3 para gerar imagens no Google Flow usando a sessão normal do
Chrome. Ela é o transporte principal de imagens tanto no navegador quanto no
aplicativo desktop.

## Instalação

1. No Chrome, abra `chrome://extensions` e ative **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e selecione
   `D:\apps\mrchicken\extensions\flow-companion`.
3. Abra **Kaoz Flow Companion**, informe o endereço do Kaoz e clique em
   **Conectar ao Kaoz**. Para desenvolvimento, use `http://localhost:3000`.
4. A extensão abrirá `/flow/images` já com sua identificação.

No aplicativo desktop, a ponte Native Messaging é registrada no primeiro
início e a conexão ocorre automaticamente. O popup da extensão pode ser aberto pelo
botão **Abrir extensão no Chrome** dentro do Kaoz.1.

Instalação local conforme a [documentação oficial do Chrome](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

## Uso

1. Faça login normalmente no Flow, no mesmo perfil do Chrome da extensão.
2. Mantenha a aba do Kaoz aberta e solicite a imagem na conversa ou em
   `/flow/images`.
3. A extensão cria um projeto, configura modelo, formato e quantidade, acompanha
   a geração e envia os arquivos originais ao Kaoz.
4. O Kaoz valida e salva PNG, JPEG ou WebP em `storage/generated/images/companion`.

O teste envia o prompt informado ao Google e utiliza a geração disponível na conta.
A extensão não solicita permissões de cookies, histórico ou depuração. A sessão
permanece no Chrome. O painel recebe somente o resultado desta solicitação.

## Escopo e limites

- Localhost é autorizado por padrão. Domínios HTTPS precisam ser adicionados pelo
  usuário no popup; outras origens e páginas fora de `/flow` e `/sketch` são recusadas.
- Cada conexão do Kaoz usa um token temporário próprio e recebe apenas seus pedidos.
- Uma geração por vez; não há reenvio automático em caso de timeout.
- A extensão abre um projeto próprio e identifica apenas as imagens criadas depois
  do envio. Não interaja com essa aba durante a geração.
- Download limitado a PNG, JPEG ou WebP de até 12 MB dos hosts permitidos.
- Mudanças no editor do Flow, desafios do Google e recarga/fechamento da aba podem
  exigir intervenção. A extensão não lê cookies nem exporta a sessão.
- O desktop registra o estado da fila em `%APPDATA%\Kaoz.1\storage\flow-companion`.
  Se a comunicação cair depois do envio, o pedido exige conferência no Flow e não é
  reenviado automaticamente.
- Ao atualizar o código, recarregue a extensão em `chrome://extensions` e recarregue
  a aba do Flow somente quando não houver geração em andamento.

## Validação em 2026-09-10

- 16 testes focados passaram, incluindo isolamento por conexão, retomada sem
  duplicação, persistência idempotente e separação entre jobs do Chrome e desktop.
- TypeScript e ESLint focado passaram, usando `eslint.config.mjs`.
- Uma imagem real foi gerada no Flow pela extensão. O primeiro retorno revelou que
  o original usa `flow-content.google`; a versão 0.2.2 inclui esse host e busca o
  arquivo original do editor.
- O percurso direto da versão 0.2.2 passou no Chrome: projeto novo, Nano Banana 2,
  formato 9:16, geração x1, retorno do original, validação, armazenamento e prévia.
- O percurso pelo Sketch também passou: anúncio 1:1, geração x1, arquivo JPEG
  1024x1024 salvo como Versão #1 e exibido na tela de resultado.
- Um esboço real com 19 traços passou como `kaoz-reference.png`: geração 3:4 x1,
  JPEG 896x1200 salvo como Versão #2 e rótulo confirmado na interface.

Arquitetura: Kaoz → broker do servidor → página do Kaoz → service worker → projeto
autenticado do Flow → arquivo original → validação e armazenamento no Kaoz.

No desktop: Kaoz → broker local → Native Messaging Host → service worker → projeto
autenticado do Flow → API local autenticada → validação e armazenamento no Kaoz.
