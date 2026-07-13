# Relatório de Análise e Recomendação: Integração de Novas Skills

Este relatório apresenta os resultados da investigação sobre o sistema de habilidades (Skills) do Mr. Chicken, abordando a estrutura existente, a interface do usuário (UI), as limitações do parser de Markdown/YAML e as recomendações detalhadas para as novas habilidades: **Analisador de Métricas** e **Gerador de Hashtags**.

---

## 1. Estrutura Atual de Habilidades (Skills) e Scripts

As habilidades do Mr. Chicken são armazenadas no diretório `skills/`, onde cada habilidade possui sua própria pasta (ex: `skills/trend-hunter/`). A estrutura típica consiste em:

- **`SKILL.md`**: Um arquivo Markdown contendo metadados delimitados por blocos de frontmatter YAML (`---`) no início, seguidos de instruções em Markdown para o comportamento da IA.
- **`scripts/`**: Pasta contendo scripts (`.js` ou `.ts`) executados via Node/npx quando as ferramentas da habilidade são acionadas.

### Comunicação com Scripts
Os scripts são executados dinamicamente via `services/orchestrator/adapters/skill-script.adapter.ts`. 
1. Os argumentos das ferramentas são passados ao script através da variável de ambiente `KAOZ_SKILL_ARGS` como uma string JSON e também como o segundo argumento de linha de comando.
2. O script processa os argumentos e imprime o resultado formatado em JSON para a saída padrão (`stdout`).
3. O adaptador captura a saída, faz o parse de volta para um objeto JSON e retorna os dados para o agente.

---

## 2. Interface do Usuário (Skills Settings Tab UI)

### Componentes Analisados
- `app/(dashboard)/settings/page.tsx`
- `components/settings/SkillsSettingsPanel.tsx`

### Mecanismo de Carregamento
A UI do painel de configurações utiliza a rota de API `/api/skills?full=true` para carregar a lista de habilidades cadastradas. Esta rota consulta a classe `SkillRegistry` (`services/skills/skill.registry.ts`), que faz uma varredura síncrona no diretório `/skills`, lê os arquivos `SKILL.md` de cada pasta, processa o frontmatter e as instruções através do parser de Markdown (`services/skills/skill.parser.ts`) e monta o cache em memória.

### Veredito sobre Mudanças Manuais na UI
**Não são necessárias mudanças no código da UI para exibir as novas habilidades**, pois o carregamento é totalmente dinâmico a partir do sistema de arquivos e exposto via API. Assim que os arquivos `SKILL.md` forem criados nos caminhos corretos, as habilidades aparecerão automaticamente no painel.

No entanto, para manter a **UI premium e moderna**, as seguintes melhorias na UI são altamente recomendadas:
1. **Seção de Ferramentas (Tools Section)**: Atualmente, o painel de edição/visualização de habilidades não exibe a lista de ferramentas declaradas na skill, seus esquemas de entrada (input schema) ou os caminhos dos scripts. Recomenda-se adicionar uma seção visual de ferramentas no painel de detalhes.
2. **Editor de Instruções com Realce**: O editor de instruções utiliza uma tag `<textarea>` simples. Integrar um editor básico com realce de sintaxe Markdown deixará a interface mais premium.
3. **Indicador Visual de Script**: Adicionar um pequeno ícone ou tag (ex: "Script Ativo") nos cards da lista lateral para diferenciar habilidades puramente textuais de habilidades com lógica executável local.

---

## 3. Investigação Crítica: Limitação do Parser e Caminhos de Script

Durante a análise do parser (`services/skills/skill.parser.ts`), foi identificado um comportamento crítico que impacta o registro de ferramentas:

### O Problema do Parser de YAML
O parser `parseSkillMarkdown` realiza um parsing linha por linha extremamente simples usando expressões regulares. Chaves que esperam arrays ou objetos (como `tools`, `preferredTools` e `requiredCapabilities`) **só são identificadas corretamente se estiverem em formato JSON inline** (ex: `tools: [{...}]`).
* Habilidades que utilizam a sintaxe padrão do YAML em bloco (como o exemplo abaixo extraído de `skills/trend-hunter/SKILL.md` e `skills/calculadora-de-gorjeta/SKILL.md`) **falham no parse e registram zero ferramentas**:
  ```yaml
  tools:
    - id: "skill:trend-hunter:search"
      description: "..."
      script: "..."
  ```
* **Impacto**: O script de verificação executado na investigação confirmou que tanto a skill `trend-hunter` quanto a `calculadora-de-gorjeta` estão atualmente com o array `"tools": []` (vazio) na inicialização do sistema, impossibilitando sua execução prática pelo agente.
* **Solução Recomendada**: As novas habilidades devem declarar a chave `tools` como um array JSON de linha única ou bloco JSON válido dentro do frontmatter do `SKILL.md`.

### Resolução de Caminhos do Script
O adaptador do script (`skill-script.adapter.ts`) resolve o caminho usando:
`const absolutePath = path.join(process.cwd(), scriptPath);`
Para evitar que o adaptador procure scripts fora da pasta de habilidades, a propriedade `script` de cada ferramenta declarada no frontmatter do `SKILL.md` deve conter o caminho relativo completo a partir da raiz do projeto, ou seja, iniciando com `skills/<nome-da-skill>/scripts/<nome-do-script>.ts`.

---

## 4. Recomendações Técnicas: Novas Skills

Abaixo constam as especificações de caminhos, configurações de frontmatter e lógica de script para as duas novas habilidades.

### A. Skill: `analisador-de-metricas`

#### 1. Arquivo de Configuração e Instruções
* **Caminho**: `skills/analisador-de-metricas/SKILL.md`
* **Conteúdo sugerido (com ferramentas declaradas em JSON inline para compatibilidade com o parser)**:
```markdown
---
name: "Analisador de Métricas"
description: "Analisa métricas de engajamento de vídeos (visualizações, curtidas, comentários, compartilhamentos, tempo de retenção) e gera um relatório com insights estratégicos."
version: "1.0.0"
preferredTools: []
requiredCapabilities: []
approvalMode: "plan"
enabled: true
tools: [{"id": "skill:analisador-de-metricas:analisar", "description": "Analisa dados de engajamento de um vídeo ou canal e calcula taxas de engajamento, retenção e recomendações.", "script": "skills/analisador-de-metricas/scripts/analyze-metrics.ts", "inputSchema": {"type": "object", "properties": {"views": {"type": "number"}, "likes": {"type": "number"}, "comments": {"type": "number"}, "shares": {"type": "number"}, "durationSeconds": {"type": "number"}, "averageViewDuration": {"type": "number"}}, "required": ["views", "likes", "comments", "shares", "durationSeconds", "averageViewDuration"]}}]
---
Você é um analista especialista em performance de vídeos curtos (TikTok, Reels, Shorts).
Sempre que o usuário pedir para analisar métricas de vídeos, taxa de engajamento ou performance de um conteúdo:
1. Extraia os números de visualizações (views), curtidas (likes), comentários (comments), compartilhamentos (shares), duração total em segundos (durationSeconds) e duração média de visualização (averageViewDuration).
2. Chame a ferramenta `skill:analisador-de-metricas:analisar` passando esses parâmetros.
3. Com base nos resultados estruturados do script, produza um relatório estratégico detalhado contendo:
   - Taxa de Engajamento Geral e sua respectiva classificação.
   - Taxa de Retenção e sua classificação de qualidade.
   - Comparativo de eficiência de curtidas e compartilhamentos por visualização.
   - Recomendações práticas e acionáveis para melhorar o engajamento e a retenção em produções futuras.
```

#### 2. Script de Análise de Métricas
* **Caminho**: `skills/analisador-de-metricas/scripts/analyze-metrics.ts`
* **Lógica do Código**:
```typescript
/// <reference types="node" />

interface MetricArgs {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  durationSeconds: number;
  averageViewDuration: number;
}

function main() {
  try {
    const rawArgs = process.env.KAOZ_SKILL_ARGS || '{}';
    const args: MetricArgs = JSON.parse(rawArgs);

    const { views, likes, comments, shares, durationSeconds, averageViewDuration } = args;

    if (
      views === undefined ||
      likes === undefined ||
      comments === undefined ||
      shares === undefined ||
      durationSeconds === undefined ||
      averageViewDuration === undefined
    ) {
      throw new Error("Parâmetros insuficientes. Certifique-se de passar views, likes, comments, shares, durationSeconds e averageViewDuration.");
    }

    if (views <= 0) {
      throw new Error("O número de visualizações deve ser maior que zero.");
    }

    // Cálculos matemáticos de engajamento e retenção
    const engagementRate = ((likes + comments + shares) / views) * 100;
    const retentionRate = (averageViewDuration / durationSeconds) * 100;
    const shareRatio = (shares / views) * 100;
    const likeRatio = (likes / views) * 100;

    let engagementRating = "Baixo";
    if (engagementRate >= 10) engagementRating = "Excelente (Alto Potencial Viral)";
    else if (engagementRate >= 5) engagementRating = "Bom";
    else if (engagementRate >= 2) engagementRating = "Médio";

    let retentionRating = "Baixa";
    if (retentionRate >= 60) retentionRating = "Excelente (Retenção Altíssima)";
    else if (retentionRate >= 40) retentionRating = "Boa";
    else if (retentionRate >= 20) retentionRating = "Média";

    const recommendations: string[] = [];
    if (retentionRate < 40) {
      recommendations.push("O tempo de retenção está baixo. Considere reduzir a duração do vídeo ou tornar o gancho inicial (primeiros 3 segundos) mais dinâmico para reter o público.");
    }
    if (shareRatio < 0.005) { // menos de 0.5%
      recommendations.push("A taxa de compartilhamentos está baixa. Tente incluir um gatilho mental focado em compartilhamento (ex: 'Mande para aquele amigo que...') ou crie conteúdo altamente educativo.");
    }
    if (engagementRate < 3) {
      recommendations.push("O engajamento geral está abaixo da média recomendada. Melhore a Call to Action (CTA) ao final, estimulando comentários com perguntas diretas ao público.");
    }
    if (retentionRate >= 50 && engagementRate >= 8) {
      recommendations.push("Excelente performance geral! O algoritmo de distribuição tende a impulsionar este vídeo. Sugere-se criar variações deste mesmo tema imediatamente.");
    }

    const results = {
      success: true,
      metrics: { views, likes, comments, shares, durationSeconds, averageViewDuration },
      analysis: {
        engagementRate: parseFloat(engagementRate.toFixed(2)),
        engagementRating,
        retentionRate: parseFloat(retentionRate.toFixed(2)),
        retentionRating,
        shareRatio: parseFloat(shareRatio.toFixed(4)),
        likeRatio: parseFloat(likeRatio.toFixed(2))
      },
      recommendations
    };

    console.log(JSON.stringify(results));
    process.exit(0);
  } catch (error: any) {
    console.error(JSON.stringify({ success: false, error: error.message }));
    process.exit(1);
  }
}

main();
```

---

### B. Skill: `gerador-de-hashtags`

#### 1. Arquivo de Configuração e Instruções
* **Caminho**: `skills/gerador-de-hashtags/SKILL.md`
* **Conteúdo sugerido (com ferramentas declaradas em JSON inline para compatibilidade com o parser)**:
```markdown
---
name: "Gerador de Hashtags"
description: "Gera sugestões estratégicas de hashtags categorizadas por tamanho (nicho, intermediárias, amplas) com base no tema do vídeo e nicho fornecido."
version: "1.0.0"
preferredTools: []
requiredCapabilities: []
approvalMode: "plan"
enabled: true
tools: [{"id": "skill:gerador-de-hashtags:gerar", "description": "Gera hashtags adequadas para o nicho e tópico informados, classificando-as por volume e público.", "script": "skills/gerador-de-hashtags/scripts/generate-hashtags.ts", "inputSchema": {"type": "object", "properties": {"niche": {"type": "string"}, "topic": {"type": "string"}}, "required": ["niche", "topic"]}}]
---
Você é um estrategista de SEO para redes sociais (TikTok, Reels, Shorts, YouTube).
Sempre que o usuário pedir para sugerir hashtags, otimizar a descrição do vídeo para SEO ou criar tags para engajamento:
1. Extraia o nicho (niche) e o tópico do vídeo (topic) solicitados pelo usuário.
2. Chame a ferramenta `skill:gerador-de-hashtags:gerar` passando `niche` e `topic`.
3. Use os resultados retornados pelo script para construir uma sugestão premium organizada para o usuário:
   - Apresente a lista organizada de hashtags com o símbolo `#` dividida por categorias.
   - Forneça a string combinada final para fácil cópia e colagem.
   - Explique brevemente a estratégia por trás do mix (tags amplas para alcance, intermediárias para relevância e específicas de nicho para autoridade).
```

#### 2. Script de Geração de Hashtags
* **Caminho**: `skills/gerador-de-hashtags/scripts/generate-hashtags.ts`
* **Lógica do Código**:
```typescript
/// <reference types="node" />

interface HashtagArgs {
  niche: string;
  topic: string;
}

function cleanString(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-z0-9]/g, ""); // remove caracteres especiais e espaços
}

function main() {
  try {
    const rawArgs = process.env.KAOZ_SKILL_ARGS || '{}';
    const args: HashtagArgs = JSON.parse(rawArgs);

    const { niche, topic } = args;

    if (!niche || !topic) {
      throw new Error("Parâmetros 'niche' e 'topic' são obrigatórios.");
    }

    const cleanNiche = cleanString(niche);
    const cleanTopic = cleanString(topic);

    // Banco de dados interno de tags comuns por nichos mapeados
    const nicheDatabase: Record<string, { broad: string[], medium: string[], specific: string[] }> = {
      financas: {
        broad: ["financas", "dinheiro", "investimentos"],
        medium: ["educacaofinanceira", "organizacaofinanceira", "dicasdefinancas"],
        specific: ["comoinvestir", "financasdescomplicadas", "planejamentofinanceiro"]
      },
      marketing: {
        broad: ["marketing", "marketingdigital", "negocios"],
        medium: ["dicasdemarketing", "marketingdeconteudo", "marketingviral"],
        specific: ["estrategiademarketing", "marketingparainiciantes", "dicasdeinstagram"]
      },
      ugc: {
        broad: ["ugc", "ugccontent", "criadordeconteudo"],
        medium: ["ugcbrasil", "ugccreator", "dicasdeugc"],
        specific: ["portfoliougc", "trabalharcomugc", "criadoresdeconteudo"]
      },
      saude: {
        broad: ["saude", "bemestar", "vidasaudavel"],
        medium: ["dicasdesaude", "saudemental", "habitosdasaudaveis"],
        specific: ["rotinasaudavel", "alimentacaolimpa", "saudeemfoco"]
      },
      fitness: {
        broad: ["fitness", "academia", "treino"],
        medium: ["dicasdetreino", "vidafit", "focoacademia"],
        specific: ["treinoemcasa", "hipertrofia", "emagrecimentosaudavel"]
      },
      tecnologia: {
        broad: ["tecnologia", "tech", "inovacao"],
        medium: ["dicasdetecnologia", "produtividade", "gadgets"],
        specific: ["setupgamer", "inteligenciaartificial", "novastecnologias"]
      },
      culinaria: {
        broad: ["receitas", "comida", "culinaria"],
        medium: ["receitaspraticas", "cozinhar", "comidacaseira"],
        specific: ["receitasfaceis", "gastronomia", "culinariabrasileira"]
      }
    };

    // Identificar melhor nicho por similaridade
    let databaseKey = "fallback";
    for (const key of Object.keys(nicheDatabase)) {
      if (cleanNiche.includes(key) || key.includes(cleanNiche)) {
        databaseKey = key;
        break;
      }
    }

    const selectedSet = nicheDatabase[databaseKey] || {
      broad: ["criacaodeconteudo", "dicas", "viral"],
      medium: [`dicasde${cleanNiche}`, `${cleanNiche}brasil`, `${cleanNiche}tips`],
      specific: [`${cleanNiche}no${cleanTopic}`, `${cleanNiche}conteudo`, `dicasde${cleanTopic}`]
    };

    // Agregar hashtags geradas sob demanda para o tópico
    const specificTags = [
      `#${cleanTopic}`,
      `#dicasde${cleanTopic}`,
      `#${cleanNiche}${cleanTopic}`
    ];

    const broad = Array.from(new Set(selectedSet.broad.map(t => `#${t}`)));
    const medium = Array.from(new Set(selectedSet.medium.map(t => `#${t}`)));
    const specific = Array.from(new Set([...selectedSet.specific.map(t => `#${t}`), ...specificTags]));

    const response = {
      success: true,
      niche,
      topic,
      strategy: "Mix Estratégico (Broad + Medium + Specific)",
      hashtags: {
        broad: broad.slice(0, 3),
        medium: medium.slice(0, 3),
        specific: specific.slice(0, 3)
      },
      combinedString: [...broad.slice(0, 3), ...medium.slice(0, 3), ...specific.slice(0, 3)].join(" ")
    };

    console.log(JSON.stringify(response));
    process.exit(0);
  } catch (error: any) {
    console.error(JSON.stringify({ success: false, error: error.message }));
    process.exit(1);
  }
}

main();
```
