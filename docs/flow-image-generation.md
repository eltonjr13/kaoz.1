# Fluxo de geração de imagens

O fluxo usa um contrato explícito de operação definido em
`src/providers/flow/ImageGenerationContract.ts`.

## Operações

- `simple`: não aceita referência visual. Avatar, upload e anexos antigos são ignorados/limpos.
- `reference`: usa exatamente uma referência explícita. Upload tem prioridade sobre avatar.
- `edit`: exige uma imagem-fonte e aplica o prompt como edição image-to-image.
- `turnaround3d`: mantém a imagem primária isolada e gera os ângulos antes do envio opcional ao Hunyuan.

Selecionar um avatar serve para personalidade e associação do job. A imagem do avatar somente é
anexada quando **Avatar como referência visual** estiver habilitado.

## Referência de elemento selecionado

Integrações de inspeção visual ou extensões podem entregar uma captura e seu XPath para a página
do Flow por meio do evento abaixo:

```js
window.dispatchEvent(new CustomEvent('kaoz1:flow-reference-selected', {
  detail: {
    imageData: 'data:image/png;base64,...',
    xpath: '/html/body/main/...',
    label: 'Nome opcional do elemento'
  }
}));
```

A captura é usada como referência visual e o XPath é preservado nos metadados do job. O XPath
sozinho não é suficiente: `imageData` é obrigatório para que o Google Flow receba a referência.

## Concorrência e idempotência

- Envio de mensagem e aplicação de plano possuem trava síncrona na UI.
- Cada aprovação envia `requestId`; a API reutiliza o job quando recebe a mesma chave novamente.
- Toda operação que navega no perfil do Flow passa pela fila exclusiva do `FlowProvider`.
- Uma falha depois do clique de geração é marcada como submetida e não é repetida automaticamente.

