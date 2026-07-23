# Fluxo de geração de imagens

O fluxo usa um contrato explícito de operação definido em
`src/providers/flow/ImageGenerationContract.ts`.

A engenharia de prompt fica centralizada em `lib/ai/image-prompt-engineering.ts`.
Ela atua em duas etapas:

1. orienta o agente a produzir um prompt visual coeso, fiel e específico para a
   operação selecionada;
2. normaliza o prompt imediatamente antes do envio ao Google Flow, acrescentando
   somente as garantias que faltarem para referência, edição, tipografia e
   composição da proporção escolhida.

O prompt final deve priorizar assunto, contexto e estilo, com enquadramento,
iluminação, cor e materiais apenas quando forem relevantes. Listas genéricas de
qualidade, lentes incompatíveis com o meio e formatos comerciais não pedidos não
devem ser acrescentados.

## Operações

- `simple`: não aceita referência visual. Avatar, upload e anexos antigos são ignorados/limpos.
- `reference`: usa exatamente uma referência explícita. Upload tem prioridade sobre avatar.
- `edit`: exige uma imagem-fonte e aplica o prompt como edição image-to-image.
- `turnaround3d`: mantém a imagem primária isolada e gera os ângulos antes do envio opcional ao Hunyuan.

Para `reference`, o prompt informa explicitamente como a imagem anexada funciona
como ingrediente visual e preserva identidade, silhueta, proporções, cores e
materiais. Para `edit`, a mudança solicitada vem primeiro e todos os detalhes não
solicitados formam a fronteira de preservação. Uma imagem anexada nunca implica,
por si só, personagem 3D, anúncio, selfie ou mudança de estilo.

Quando houver texto visível, a grafia solicitada deve permanecer exatamente como
foi escrita e nenhum texto extra deve ser inventado. Como a renderização de texto
continua probabilística, copies curtas tendem a ser mais confiáveis.

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
