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

## Capacidades Verificadas do FlowProvider (Google Flow / ImageFX)

1. **Referências:**
   - O composer do Google Flow suporta no máximo **1 imagem de referência por comando**.
   - Aceita anexação via upload de arquivo temporário (`resolveReferenceAttachmentStrategy === 'upload'`) ou seleção de ativo existente no projeto (`'select-existing'`).
   - Múltiplas referências nativas **não** são suportadas pelo provedor.

2. **Proporções:**
   - Suporte estrito a 5 proporções fixas: `1:1`, `9:16`, `16:9`, `4:3`, `3:4`.
   - Proporções adicionais da prancheta (como `4:5` para feed do Instagram e `custom`) são mapeadas deterministicamente para a proporção mais próxima aceita pelo Flow (`resolveProviderAspectRatio`).

3. **Quantidade:**
   - Suporte a lotes de 1 a 4 imagens por requisição (`1 | 2 | 3 | 4 | '1x' | 'x2' | 'x3' | 'x4'`).

4. **Retorno dos Arquivos:**
   - Arquivos são baixados para `getFlowGeneratedDir()` (`storage/generated/images/` ou pasta personalizada).
   - Conversão automática para PDF (`pdfPaths`, `pdfFilenames`) para visualização e distribuição.
   - Retorno estruturado com caminho absoluto, nome de arquivo e timestamp.

5. **Exclusão Mútua do Navegador:**
   - Garantida por fila serial baseada em Promises (`runBrowserTaskExclusive` com `browserTaskTail`) no `FlowProvider`.
   - Impede concorrência ou conflito de digitação/clique no composer do Playwright.

## Módulo Sketch e Composição Única

- **Contratos Versionados:** Projeto (`SketchProjectData`), Briefing (`SketchBriefingData`), Copy (`SketchCopyData`), Documento (`SketchDocumentData`), Camadas (`BaseLayer`), Anexos (`SketchAttachment`), Requisição (`SketchGenerationRequest`) e Resultados (`SketchGenerationResult`) possuem campos explícitos de versão (`schemaVersion`, `version`).
- **Funções de Referência:** `product`, `person`, `logo`, `style`, `composition`, `background`.
- **Isolamento de Guias:** Elementos com `isGuide: true` ou `exportToProvider: false` são isolados e excluídos da referência visual enviada ao Flow.
- **Preparação da Composição Única:** Para cenários combinados (ex: sketch de layout + imagem de produto), os ativos são unificados em uma referência composta única (`prepareSketchCompositeReference`), com prévia estruturada (`SketchCompositePreview`) e diagnóstico de anexos não posicionados para impedir descarte silencioso.
- **Diferenciação de Sketch vs Identidade:** O modo `sketch` orienta a IA a usar a referência estritamente para enquadramento e proporção, proibindo a renderização de rabiscos ou wireframes. O modo `composite` instrui renderização comercial limpa preservando a identidade do produto/pessoa sem traços de rascunho. O modo `identity` mantém 100% de compatibilidade legada.
- **Identificação de Execução Real vs Mock:** A prova técnica identifica formalmente execuções em ambiente de teste (`executionStatus: 'mock_validated_contract_pending_live_flow'`), registrando a pendência de fidelidade visual para sessões autenticadas ao vivo.
