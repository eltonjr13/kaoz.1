# Kaoz Flow Companion

Extensão Manifest V3 para gerar imagens no Google Flow usando a sessão normal do
Chrome. A integração atende o Kaoz aberto no navegador; o aplicativo desktop
continua usando o provedor local existente.

## Instalação

1. No Chrome, abra `chrome://extensions` e ative **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e selecione
   `D:\apps\mrchicken\extensions\flow-companion`.
3. Abra **Kaoz Flow Companion**, informe o endereço do Kaoz e clique em
   **Conectar ao Kaoz**. Para desenvolvimento, use `http://localhost:3000`.
4. A extensão abrirá `/flow/images` já com sua identificação.

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
  usuário no popup; outras origens e páginas fora de `/flow` são recusadas.
- Cada conexão do Kaoz usa um token temporário próprio e recebe apenas seus pedidos.
- Uma geração por vez; não há reenvio automático em caso de timeout.
- A extensão abre um projeto próprio e identifica apenas as imagens criadas depois
  do envio. Não interaja com essa aba durante a geração.
- Download limitado a PNG, JPEG ou WebP de até 12 MB dos hosts permitidos.
- Mudanças no editor do Flow, desafios do Google e recarga/fechamento da aba podem
  exigir intervenção. A extensão não lê cookies nem exporta a sessão.
- A fila do servidor fica em memória. A página e o processo do Kaoz devem permanecer
  ativos até a conclusão.
- Ao atualizar o código, recarregue a extensão em `chrome://extensions` e recarregue
  a aba do Flow somente quando não houver geração em andamento.

## Validação em 2026-09-10

- 12 testes passaram, incluindo isolamento por conexão, retomada sem duplicação,
  arquivo corrompido, persistência idempotente e contratos de referência.
- TypeScript e ESLint focado passaram, usando `eslint.config.mjs`.
- Uma imagem real foi gerada no Flow pela extensão. O primeiro retorno revelou que
  o original usa `flow-content.google`; a versão 0.2.0 inclui esse host e busca o
  arquivo original do editor.
- O percurso final após recarregar a versão 0.2.0 no Chrome ainda precisa ser medido.

Arquitetura: Kaoz → broker do servidor → página do Kaoz → service worker → projeto
autenticado do Flow → arquivo original → validação e armazenamento no Kaoz.
