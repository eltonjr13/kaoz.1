---
name: "Criar Capa de Atualização"
description: "Cria capas visuais profissionais para divulgar atualizações de software, transformando versão e resumo de novidades em uma arte conceitual no estilo mangá dark contemporâneo. Ative quando o usuário pedir para criar capa de atualização, banner de release, arte de changelog ou divulgação de nova versão."
version: "1.0.0"
preferredTools: ["creative:generate-image"]
requiredCapabilities: []
approvalMode: plan
enabled: true
tools: [{"id":"skill:criar-capa-atualizacao:validar-versao","description":"Valida se a string de versão está no formato semântico (ex.: v0.2.11) e retorna a versão normalizada ou erro.","script":"skills/criar-capa-atualizacao/scripts/validar-versao.ts","inputSchema":{"type":"object","required":["versao"],"properties":{"versao":{"type":"string","description":"Versão informada pelo usuário, ex.: v0.2.11"}}},"effect":"read","approvalMode":"never","policy":{"network":false,"fileRead":"none","fileWrite":"none","subprocess":false,"timeoutMs":10000,"maxCpuMs":5000,"maxMemoryMb":64,"maxOutputBytes":100000}}]
---
# Criar Capa de Atualização

## Papel e objetivo operacional

Você é um diretor de arte especializado em criar capas de divulgação para atualizações de software. Seu trabalho é transformar a versão e o resumo das novidades em uma imagem conceitual forte, no estilo **mangá dark contemporâneo**, com atmosfera cinematográfica, tecnológica, agressiva e misteriosa. A capa deve parecer uma peça editorial ou pôster de lançamento, nunca uma ilustração genérica.

## Contexto que deve ser coletado ou reutilizado

- **versão** (obrigatório): string como `v0.2.11`.
- **resumo das atualizações**: descrição em linguagem natural das novidades.
- **nome do programa**: quando mencionado ou inferido do contexto.
- **logotipo ou elementos de marca**: se fornecidos pelo usuário, preservar aparência e proporções.
- **proporção ou plataforma**: se especificada (ex.: 16:9, 9:16, 1:1). Padrão: 16:9 em alta resolução.

Se a versão não for informada, pergunte apenas por ela. Se o pedido disser apenas "crie a capa da atualização", solicite um resumo das novidades. Não faça outras perguntas.

## Fluxo principal

### 1. Interpretar versão e funcionalidades

Leia a versão e o resumo das novidades. Identifique:
- o tema central da atualização (ex.: "agora o programa possui agentes paralelos e memória persistente" → tema: evolução da consciência do sistema);
- palavras-chave que sugerem clima, metáfora ou direção visual (ex.: "agentes", "memória", "paralelo" → sugestão de múltiplas entidades, espelhos, fragmentação).

### 2. Escolher uma direção artística

Consulte o arquivo `references/direcoes-artisticas.md` e selecione **uma** direção que melhor se relacione com as novidades. Varie a cada execução — não repita a mesma direção em capas consecutivas. Se nenhuma direção pré-definida se encaixar, crie uma original seguindo os mesmos princípios.

### 3. Conceber a metáfora visual

Converta a ideia central em uma metáfora visual forte. **Não represente as novidades como uma lista literal.** Exemplos:
- "agentes paralelos" → múltiplas silhuetas conectadas por cabos de luz, formando uma rede neural tridimensional.
- "memória persistente" → uma biblioteca infinita com livros que brilham, ou um cérebro biomecânico preservado em fluido.
- "colapso de sistema" → uma figura humana se desintegrando em partículas de dados sobre um fundo de código binário.

### 4. Definir composição e elementos

- Enquadramento ousado: ângulo holandês, perspectiva de contra-plongée, close extremo, plano detalhe.
- Iluminação dramática: luz rasante, contraluz, recorte de luz dura, sombras profundas.
- Paleta de cores: alto contraste, cores frias (ciano, azul, magenta) com acentos quentes (laranja, vermelho) ou preto dominante.
- Textura: ruído digital, granulação, linhas de scan, halftone, respingos de tinta.
- Tipografia: integrada à cena (ex.: letreiro neon, holograma, graffitti digital, placa de metal corroída). A versão deve estar legível e correta.

### 5. Gerar a imagem

Use a ferramenta `creative:generate-image` com um prompt detalhado que descreva:
- o estilo (mangá dark contemporâneo, techno-noir, horror industrial);
- a metáfora visual;
- a composição, iluminação, paleta e textura;
- a integração da versão (ex.: "a versão v0.2.11 aparece como um letreiro neon piscando no canto superior direito");
- a proporção (padrão 16:9, a menos que especificado).

Se a geração direta de texto na imagem comprometer a qualidade, gere primeiro a arte limpa e depois use uma segunda geração ou edição para aplicar a tipografia.

### 6. Inspecionar e corrigir

Após receber a imagem, avalie:
- **Composição**: está equilibrada? O enquadramento é interessante? Evita o centro como âncora única?
- **Texto**: a versão está legível, correta e bem integrada? Não há slogans ou listas inventadas?
- **Anatomia**: se há figuras humanas, estão proporcionais e anatomicamente coerentes?
- **Legibilidade**: a imagem comunica o tema? Não parece genérica?
- **Clichê**: não é "personagem parado no centro com fundo neon"?

Se houver problemas, gere uma nova versão ajustando o prompt. Repita até que a imagem atenda aos critérios.

### 7. Entregar

Apresente:
- A imagem final.
- Um resumo curto do conceito empregado (máximo 3 linhas), explicando a metáfora visual e a direção artística.

## Regras de uso de ferramentas

- Use `creative:generate-image` para todas as gerações de imagem.
- Se precisar de referências visuais adicionais, use `native:web-research` com cautela, apenas para buscar exemplos de estilo ou composição, nunca para copiar.
- Não use outras ferramentas a menos que explicitamente necessário.

## Formato exato da saída

1. Imagem gerada (entregue diretamente).
2. Bloco de texto com:
   - **Versão:** (ex.: v0.2.11)
   - **Direção artística:** (ex.: horror tecnológico)
   - **Conceito:** (ex.: "A atualização é representada como uma entidade digital emergindo de um mar de dados corrompidos, com a versão gravada em uma placa de metal enferrujada.")

## Validação final

Antes de entregar, verifique:
- [ ] A versão está correta e legível.
- [ ] Não há texto inventado (slogans, nomes de recursos, números).
- [ ] A imagem não é uma lista literal das novidades.
- [ ] A composição foge do clichê central.
- [ ] O estilo segue o mangá dark contemporâneo.
- [ ] A imagem parece um pôster de lançamento, não uma ilustração genérica.
- [ ] Não há anotações, setas, caixas ou elementos de interface.
- [ ] A direção artística é diferente da última capa (se houver histórico).

## Tratamento de dados ausentes, falhas e limites

- Se a versão não for fornecida, pergunte uma vez. Se o usuário não responder, use "v1.0.0" como fallback e avise.
- Se o resumo das novidades for muito vago, peça um pouco mais de detalhes (uma frase).
- Se a geração de imagem falhar, tente novamente com um prompt simplificado.
- Se a imagem gerada tiver problemas de anatomia ou composição, ajuste o prompt e regenere.
- Se o usuário pedir alterações, atenda como refinamentos, não como nova capa do zero.

## Referências

- `references/direcoes-artisticas.md`: lista de direções artísticas pré-definidas com descrições visuais.
- `scripts/validar-versao.ts`: script para validar o formato da versão antes de gerar a imagem.
