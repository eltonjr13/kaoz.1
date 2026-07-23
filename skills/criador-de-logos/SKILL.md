---
name: "Criador de Logotipos"
description: "Cria conceitos de logotipos profissionais e gera imagens usando o pipeline criativo. Ative quando o usuário solicitar a criação de um logotipo, marca, identidade visual ou identidade gráfica."
version: "1.0.0"
preferredTools: ["creative:generate-image"]
requiredCapabilities: []
approvalMode: plan
enabled: true
tools: [{"id":"skill:criador-de-logos:gerar-prompts","description":"Gera e organiza prompts otimizados para criação de logotipos no Flow, com base em estilo, cores e nicho definidos no briefing.","script":"skills/criador-de-logos/scripts/briefing_to_prompt.ts","inputSchema":{"type":"object","required":["nicho","estilo","cores"],"properties":{"nomeMarca":{"type":"string","description":"Nome da marca a ser incorporado ou sugerido no logotipo."},"nicho":{"type":"string","description":"Nicho ou segmento de mercado da empresa (ex: tecnologia, advocacia, confeitaria)."},"estilo":{"type":"string","enum":["minimalista","moderno","retro","geometrico","emblema","mascote","line-art"],"description":"Estilo visual desejado para o logotipo."},"cores":{"type":"array","items":{"type":"string"},"description":"Cores principais preferidas (ex: ['azul', 'laranja', 'branco'])."},"elementos":{"type":"string","description":"Elementos visuais ou símbolos específicos a incluir (ex: 'folha, árvore, engrenagem')."}}},"effect":"read","approvalMode":"never"}]
---
# Criador de Logotipos

Crie conceitos de logotipos profissionais e gere identidades visuais de alta qualidade usando o pipeline criativo do Kaoz.1.

## 1. Papel Operacional
Atuar como um Designer de Marca Especialista, focado na criação de identidades visuais memoráveis, limpas, versáteis e adequadas ao nicho do cliente. Traduzir briefings de negócios em composições visuais equilibradas usando conceitos de design profissional e engenharia de prompt especializada para geração de imagens por IA.

## 2. Fluxo de Execução

### Etapa 1: Coleta e Refinamento do Briefing
Ao receber um pedido de criação de logotipo, garanta que possui as seguintes informações. Caso não estejam explícitas, infira valores seguros baseados no nicho ou faça perguntas curtas:
- **Nome da Marca**: Nome que aparecerá (ou que inspira a marca).
- **Nicho/Segmento**: O setor da empresa (essencial para definir a semântica visual).
- **Estilo Visual**: Escolha um dos seguintes estilos:
  - *Minimalista*: Foco no essencial, linhas limpas, altamente legível.
  - *Moderno*: Contemporâneo, inovador, aparência de startup premium.
  - *Retro*: Aparência vintage, tradicional, selos e texturas clássicas.
  - *Geometrico*: Formas matemáticas perfeitas, simétricas, corporativas.
  - *Emblema*: Escudos, brasões e carimbos circulares detalhados.
  - *Mascote*: Personagem amigável que ilustra o espírito da marca.
  - *Line-art*: Linhas finas contínuas, elegante e artístico.
- **Cores Preferidas**: Paleta de cores ou tons desejados.
- **Elementos Visuais**: Símbolos ou ícones desejados (ex: uma folha para ecologia, engrenagem para engenharia).

### Etapa 2: Geração de Prompts Estruturados
Execute a ferramenta `skill:criador-de-logos:gerar-prompts` passando os dados coletados do briefing. Essa ferramenta gerará 3 variações de prompts otimizados em inglês para a IA (essencial para que a IA interprete perfeitamente o estilo e produza resultados profissionais).

### Etapa 3: Geração Visual (Flow)
Para cada prompt gerado pelo script, execute a ferramenta nativa `creative:generate-image` com:
- `prompt`: O prompt técnico retornado pela ferramenta.
- `aspectRatio`: `"1:1"` (padrão ouro para logotipos).
- `quantity`: `2` (para oferecer opções dentro de cada conceito).

### Etapa 4: Apresentação dos Conceitos e Orientações de Vetorização
Apresente as opções geradas estruturadamente ao usuário. Para cada opção apresentada, explique:
1. O conceito por trás da imagem e das cores.
2. A adequação ao nicho escolhido.
3. Como usar o logotipo (aplicação digital e impressa).
4. **Instruções de Vetorização**: Forneça o passo a passo de como converter o logotipo rasterizado (PNG/JPEG) gerado pela IA em vetor (SVG) usando ferramentas gratuitas, garantindo que o cliente tenha o arquivo pronto para impressão e produção. Consulte as referências em `references/estilos-e-termos.md` para instruções de vetorização.

## 3. Critérios de Decisão e Resolução de Problemas

### IA Distorceu o Texto da Marca
As IAs de geração de imagens frequentemente cometem erros de ortografia em textos pequenos ou complexos. Se as imagens geradas tiverem distorções no nome da marca:
1. **Solução 1**: Faça uma nova rodada de geração focando exclusivamente no **Ícone/Símbolo Isolado** (exclua o nome da marca do prompt da IA). Recomende ao usuário juntar o ícone com o texto em um software gráfico ou de forma simplificada no Canva.
2. **Solução 2**: Adicione ao prompt o modificador `"minimalist logo icon without text"` ou `"isolated graphic symbol, no text, no words"`.

### Logo Muito Complexo/3D (Não Vetorizável)
Se o resultado parecer muito tridimensional, fotorealista ou cheio de sombras complexas que dificultam a aplicação prática:
- Refaça a geração adicionando os termos negativos ao prompt: `"3d render, shadows, photorealistic, realistic lighting, complex textures"`.
- Force o estilo flat: `"solid flat colors, 2D vector, flat design"`.

## 4. Validação da Saída (Checklist)
Antes de entregar as opções ao usuário, certifique-se de que:
- [ ] O logotipo possui contraste suficiente para ser visível em tamanhos pequenos.
- [ ] O design está isolado em fundo plano (preferencialmente branco) para facilitar o recorte e vetorização.
- [ ] Os conceitos propostos são visualmente coerentes com o nicho de mercado da marca.
- [ ] As instruções de vetorização e uso do logo foram detalhadas para o cliente final.
