# Análise de Arquitetura de Skills e UI - MrChicken AI

Este relatório apresenta os resultados da investigação sobre o diretório `skills/`, o analisador de Markdown de skills (`skill.parser.ts`), o registro de ferramentas (`tool.registry.ts`), a interface de usuário de configurações de skills (`SkillsSettingsPanel.tsx`), e propõe as especificações técnicas detalhadas para a criação das novas habilidades `analisador-de-metricas` e `gerador-de-hashtags`.

---

## 1. Descobertas e Diagnóstico do Sistema Atual

Durante a análise do código e execução de simulações com o parser atual, foram descobertos **três problemas críticos** que impedem o funcionamento correto das habilidades baseadas em scripts no estado atual do repositório:

### A. O Bug de Desativação de Skills Silencioso (`enabled: "true"`)
No arquivo `services/skills/skill.parser.ts` (linha 78), o estado ativo da skill é avaliado da seguinte forma:
```typescript
if (key === "enabled") skill.enabled = value === "true";
```
No entanto, nos arquivos `SKILL.md` das habilidades `calculadora-de-gorjeta` e `trend-hunter`, a chave é declarada com aspas na sintaxe YAML:
```yaml
enabled: "true"
```
Isso faz com que o `value` extraído contenha as aspas reais (`'"true"'`), resultando na comparação `'"true"' === "true"`, que é **falsa**. Consequentemente, as habilidades `calculadora-de-gorjeta`, `general.execute-goal`, `research.web-research`, `script-director`, e `trend-hunter` são registradas como desativadas (`enabled: false`) e omitidas de todas as listagens operacionais do agente.

### B. Falha Crítica no Parsing de Ferramentas YAML (`tools: []`)
O parser atual não possui um interpretador YAML completo. Ele apenas lê o frontmatter linha por linha e tenta encontrar arrays ou objetos JSON delimitados por colchetes ou chaves.
No frontmatter de `trend-hunter` e `calculadora-de-gorjeta`, a chave `tools` é estruturada como uma lista YAML padrão:
```yaml
tools:
  - id: "skill:trend-hunter:search"
    description: "..."
    script: "..."
```
Como esse bloco não inicia com `[` ou `{`, ele cai no bloco comum de parsing de strings, onde a chave `tools` é ignorada e os atributos filhos (como `description`) sobrescrevem os dados da própria Skill. O resultado é que **todas as ferramentas baseadas em scripts do repositório são carregadas com uma lista de ferramentas vazia (`tools: []`)**, impossibilitando que o agente as execute.

### C. Bug de Sobrescrita no Salvamento do Registro (`skillRegistry.save`)
No arquivo `services/skills/skill.registry.ts` (linhas 96-107), o método `save` reconstrói o arquivo `SKILL.md` ao salvar alterações enviadas pela UI. Contudo, **o método reconstrói o arquivo sem incluir a chave `tools`**. Se uma skill configurada com ferramentas for editada e salva pela UI, seu bloco de ferramentas será permanentemente removido do arquivo físico.

---

## 2. Análise da UI do Painel de Configurações (`SkillsSettingsPanel.tsx`)

### Comportamento Atual:
1. O painel carrega as skills dinamicamente chamando `GET /api/skills?full=true` (que retorna o conteúdo do `skillRegistry`).
2. A lista lateral renderiza as skills ativas. Devido aos bugs descritos acima, **as skills baseadas em scripts não aparecem**, a menos que o usuário utilize a ferramenta de criação de skills por IA (que as inicia limpas).
3. O formulário de edição permite alterar apenas `id`, `name`, `description` e `instructions` (Markdown). Não há suporte na tela para visualizar, testar ou editar ferramentas (`tools`), dependências ou permissões.

### Recomendações de UI Premium e Moderna:
Para elevar a experiência do usuário e torná-la premium, as seguintes modificações manuais na UI são recomendadas:
1. **Seção de Scripts e Ferramentas (Custom Tools):** Adicionar um acordeão ou aba "Ferramentas do Sistema" no painel de edição para listar os scripts associados à skill (caminho do arquivo, descrição e esquema de entrada esperado).
2. **Terminal de Teste de Script Integrado:** Incluir um botão de teste rápido ("Executar Teste") diretamente ao lado de cada ferramenta para permitir a execução manual daquele script com argumentos mockados em JSON, exibindo a saída em um mini-terminal.
3. **Indicador de Tipo de Skill:** Adicionar badges visuais na listagem de skills indicando se ela é `Instrucional` (apenas regras em Markdown) ou `Híbrida/Script` (com ferramentas executáveis associadas).
4. **Editor JSON Schema:** Um pequeno validador visual para o esquema de parâmetros das ferramentas, para que o usuário não insira estruturas inválidas.

---

## 3. Especificação das Novas Skills

Para que as novas skills funcionem imediatamente no sistema atual, sem exigir a correção prévia dos parsers, recomendamos escrever seu frontmatter no formato compatível (inline JSON para `tools` e valores primitivos sem aspas para booleanos e approvalMode). 

Abaixo, fornecemos o rascunho de implementação ideal (YAML limpo com correção do código sugerida) e o rascunho compatível com o parser legado.

### A. Skill: `analisador-de-metricas`

Analisa o engajamento e gera relatórios de performance para vídeos curtos.

* **Caminho do Arquivo de Configuração:** `skills/analisador-de-metricas/SKILL.md`
* **Caminho do Script Executável:** `skills/analisador-de-metricas/scripts/analyze-metrics.ts`

#### Configuração `SKILL.md` (Versão Compatível com Parser Legado):
```markdown
---
name: "Analisador de Métricas"
description: "Analisa as métricas de engajamento de vídeos e fornece relatórios."
version: "1.0.0"
preferredTools: []
requiredCapabilities: []
approvalMode: plan
enabled: true
tools: [{"id":"skill:analisador-de-metricas:analisar","description":"Calcula a taxa de engajamento e gera insights de melhorias para um vídeo curto.","script":"skills/analisador-de-metricas/scripts/analyze-metrics.ts","inputSchema":{"type":"object","required":["views","likes","comments","shares","duration"],"properties":{"views":{"type":"integer","description":"Número de visualizações"},"likes":{"type":"integer","description":"Número de curtidas"},"comments":{"type":"integer","description":"Número de comentários"},"shares":{"type":"integer","description":"Número de compartilhamentos"},"duration":{"type":"integer","description":"Duração em segundos"}}}}]
---
Você é um especialista em análise de métricas de engajamento de vídeos curtos (TikTok, Reels, Shorts).
Sempre que o usuário fornecer dados de visualizações, curtidas, comentários, compartilhamentos ou duração:

1. Chame a ferramenta `skill:analisador-de-metricas:analisar` passando os parâmetros coletados.
2. Formate os resultados de engajamento de maneira visual e profissional.
3. Destaque os pontos positivos e os principais pontos de melhoria com base nos insights fornecidos pelo script.
```

#### Código do Script `analyze-metrics.ts`:
```typescript
/// <reference types="node" />

interface MetricArgs {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  duration: number;
}

function analyzeMetrics() {
  try {
    const rawArgs = process.env.KAOZ_SKILL_ARGS || '{}';
    const args: MetricArgs = JSON.parse(rawArgs);

    const { views, likes, comments, shares, duration } = args;

    if (views === undefined || likes === undefined || comments === undefined || shares === undefined || duration === undefined) {
      throw new Error("Parâmetros insuficientes. Requer views, likes, comments, shares e duration.");
    }

    if (views <= 0) {
      throw new Error("O número de visualizações deve ser maior que zero.");
    }

    const totalInteractions = likes + comments + shares;
    const engagementRate = (totalInteractions / views) * 100;
    const likeToViewRatio = (likes / views) * 100;
    const commentToViewRatio = (comments / views) * 100;
    const shareToViewRatio = (shares / views) * 100;

    let engagementLevel = "Baixo";
    let score = 30;
    
    if (engagementRate >= 10) {
      engagementLevel = "Viral / Altíssimo";
      score = 95;
    } else if (engagementRate >= 6) {
      engagementLevel = "Alto";
      score = 80;
    } else if (engagementRate >= 3) {
      engagementLevel = "Médio (Saudável)";
      score = 60;
    }

    const insights: string[] = [];

    if (likeToViewRatio < 2) {
      insights.push("A taxa de curtidas está baixa (< 2%). Considere melhorar o gancho inicial ou fazer um conteúdo mais alinhado com o público-alvo.");
    } else {
      insights.push("Bom volume de curtidas, o que indica que o conteúdo tem apelo visual e agrada quem assiste.");
    }

    if (commentToViewRatio < 0.1) {
      insights.push("Baixa densidade de comentários (< 0.1%). Adicione perguntas instigantes, caixas de perguntas ou debates no roteiro (CTA de comentário).");
    } else {
      insights.push("A comunidade está ativa nos comentários! Continue estimulando debates e responda os principais comentários.");
    }

    if (shareToViewRatio < 0.3) {
      insights.push("Baixo compartilhamento (< 0.3%). Para que o vídeo seja compartilhado, adicione dicas práticas salváveis, curiosidades impactantes ou humor compartilhável.");
    } else {
      insights.push("Excelente taxa de compartilhamento! Vídeos com alto compartilhamento tendem a ser distribuídos organicamente pelos algoritmos.");
    }

    if (duration > 60) {
      insights.push("Vídeo longo para formatos curtos (> 60s). Garanta um ritmo rápido e cortes dinâmicos para não prejudicar a retenção.");
    } else if (duration < 15) {
      insights.push("Vídeo ultra-curto (< 15s). Ideal para re-views (looping), mas certifique-se de que a mensagem foi clara e o gancho prendeu instantaneamente.");
    }

    const results = {
      sucesso: true,
      data: {
        views,
        likes,
        comments,
        shares,
        duration,
        metrics: {
          engagementRate: Number(engagementRate.toFixed(2)),
          likeToViewRatio: Number(likeToViewRatio.toFixed(2)),
          commentToViewRatio: Number(commentToViewRatio.toFixed(2)),
          shareToViewRatio: Number(shareToViewRatio.toFixed(2)),
        },
        engagementLevel,
        score,
        insights
      }
    };

    console.log(JSON.stringify(results));
    process.exit(0);
  } catch (error: any) {
    console.error(error.message);
    process.exit(1);
  }
}

analyzeMetrics();
```

---

### B. Skill: `gerador-de-hashtags`

Gera hashtags personalizadas combinando nicho, plataforma e contexto do tema.

* **Caminho do Arquivo de Configuração:** `skills/gerador-de-hashtags/SKILL.md`
* **Caminho do Script Executável:** `skills/gerador-de-hashtags/scripts/generate-hashtags.ts`

#### Configuração `SKILL.md` (Versão Compatível com Parser Legado):
```markdown
---
name: "Gerador de Hashtags"
description: "Gera hashtags estratégicas com base no nicho e plataforma pretendida."
version: "1.0.0"
preferredTools: []
requiredCapabilities: []
approvalMode: plan
enabled: true
tools: [{"id":"skill:gerador-de-hashtags:gerar","description":"Gera uma lista de hashtags otimizada por plataforma.","script":"skills/gerador-de-hashtags/scripts/generate-hashtags.ts","inputSchema":{"type":"object","required":["theme","niche"],"properties":{"theme":{"type":"string","description":"Tema ou título do vídeo"},"niche":{"type":"string","description":"Nicho de conteúdo (ex: finanças, marketing)"},"platform":{"type":"string","enum":["tiktok","instagram","youtube","all"],"description":"Plataforma do vídeo"},"count":{"type":"integer","description":"Quantidade máxima de hashtags"}}}}]
---
Você é um especialista em otimização de metadados para redes sociais (SEO e hashtags).
Sempre que o usuário solicitar tags para um post ou vídeo curto:

1. Chame a ferramenta `skill:gerador-de-hashtags:gerar` passando o tema, nicho e plataforma (se especificada).
2. Apresente as hashtags geradas agrupadas de forma clara para que o usuário copie facilmente.
3. Forneça uma dica rápida de onde inseri-las (legenda vs. primeiro comentário) dependendo da plataforma selecionada.
```

#### Código do Script `generate-hashtags.ts`:
```typescript
/// <reference types="node" />

interface HashtagArgs {
  theme: string;
  niche: string;
  platform: 'tiktok' | 'instagram' | 'youtube' | 'all';
  count?: number;
}

const NICHE_HASHTAGS: Record<string, string[]> = {
  tecnologia: ["#tecnologia", "#tech", "#inovacao", "#programacao", "#setup", "#ia", "#inteligenciaartificial", "#computador", "#smartphone"],
  financas: ["#financas", "#dinheiro", "#investimentos", "#educacaofinanceira", "#riqueza", "#negocios", "#empreendedorismo", "#bolsadevalores"],
  beleza: ["#beleza", "#maquiagem", "#skincare", "#cabelo", "#autoestima", "#dicasdebeleza", "#makeup", "#tutorialdemaquiagem"],
  saude: ["#saude", "#fitness", "#alimentacaosaudavel", "#treino", "#vidasaudavel", "#bemestar", "#foco", "#dieta", "#saudemental"],
  marketing: ["#marketing", "#marketingdigital", "#vendas", "#trafegopago", "#negociosonline", "#afiliados", "#copwriting", "#redessociais"],
  educacao: ["#educacao", "#estudos", "#dicasdeestudo", "#aprendizado", "#conhecimento", "#escola", "#faculdade", "#livros"],
  entretenimento: ["#entretenimento", "#humor", "#comedia", "#memesbr", "#rir", "#engracado", "#curiosidades", "#cinema", "#jogos"],
  culinaria: ["#culinaria", "#receitas", "#comida", "#gastronomia", "#cozinhar", "#receitasfaceis", "#confeitaria", "#doces", "#almoco"]
};

const PLATFORM_HASHTAGS = {
  tiktok: ["#fyp", "#foryou", "#viral", "#tiktokbrasil", "#trend"],
  instagram: ["#reels", "#reelsinstagram", "#explore", "#instagramreels", "#trendingreels"],
  youtube: ["#shorts", "#youtubeshorts", "#shortsclip", "#viralshorts", "#subscribe"],
  all: ["#viral", "#explore", "#trending", "#videoviral"]
};

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function generateHashtags() {
  try {
    const rawArgs = process.env.KAOZ_SKILL_ARGS || '{}';
    const args: HashtagArgs = JSON.parse(rawArgs);

    const { theme, niche, platform = 'all', count = 15 } = args;

    if (!theme || !niche) {
      throw new Error("Parâmetros 'theme' e 'niche' são obrigatórios.");
    }

    const normNiche = normalizeText(niche);
    const generated: string[] = [];

    let nicheTags: string[] = [];
    for (const [key, tags] of Object.entries(NICHE_HASHTAGS)) {
      if (normNiche.includes(normalizeText(key)) || normalizeText(key).includes(normNiche)) {
        nicheTags = [...tags];
        break;
      }
    }

    if (nicheTags.length === 0) {
      nicheTags.push(`#${normalizeText(niche)}`);
      nicheTags.push(`#dicasde${normalizeText(niche)}`);
      nicheTags.push(`#${normalizeText(niche)}brasil`);
    }

    const words = theme.split(/\s+/);
    const themeTags = words
      .map(w => normalizeText(w))
      .filter(w => w.length > 3)
      .map(w => `#${w}`);

    const platTags = PLATFORM_HASHTAGS[platform] || PLATFORM_HASHTAGS.all;

    const allUniqueTags = new Set<string>();

    const maxNiche = Math.ceil(count * 0.4);
    const maxTheme = Math.ceil(count * 0.4);
    const maxPlat = count - (maxNiche + maxTheme);

    nicheTags.slice(0, maxNiche).forEach(t => allUniqueTags.add(t));
    themeTags.slice(0, maxTheme).forEach(t => allUniqueTags.add(t));
    platTags.slice(0, Math.max(2, maxPlat)).forEach(t => allUniqueTags.add(t));

    let i = 0;
    while (allUniqueTags.size < count && i < nicheTags.length) {
      allUniqueTags.add(nicheTags[i++]);
    }
    i = 0;
    while (allUniqueTags.size < count && i < themeTags.length) {
      allUniqueTags.add(themeTags[i++]);
    }
    i = 0;
    while (allUniqueTags.size < count && i < platTags.length) {
      allUniqueTags.add(platTags[i++]);
    }

    const finalTags = Array.from(allUniqueTags).slice(0, count);

    const response = {
      sucesso: true,
      data: {
        theme,
        niche,
        platform,
        count: finalTags.length,
        hashtags: finalTags,
        copyText: finalTags.join(" ")
      }
    };

    console.log(JSON.stringify(response));
    process.exit(0);
  } catch (error: any) {
    console.error(error.message);
    process.exit(1);
  }
}

generateHashtags();
```

---

## 4. Recomendações de Correção de Código (Para o Implementador)

Para possibilitar a utilização de sintaxe YAML limpa (idêntica à do `trend-hunter`), as seguintes correções de código no sistema são propostas para o implementador realizar:

### Correção no Parser (`services/skills/skill.parser.ts`)
1. **Substituir a verificação de booleanos:** Limpar aspas do valor antes da comparação em `enabled`:
   ```typescript
   // De:
   if (key === "enabled") skill.enabled = value === "true";
   
   // Para (limpando aspas):
   if (key === "enabled") {
       const cleanVal = value.replace(/^"|"$/g, '').trim();
       skill.enabled = cleanVal === "true";
   }
   ```
2. **Substituir o parsing manual de YAML de ferramentas por um parser seguro.** Como não temos dependência do `yaml` instalada por padrão, podemos implementar um parser simples de bloco recursivo para YAML no próprio parser, ou converter todos os arquivos `SKILL.md` (inclusive `trend-hunter` e `calculadora-de-gorjeta`) para declarar as chaves sem aspas e suas `tools` como arrays JSON inline simples.

### Correção no Registro (`services/skills/skill.registry.ts`)
1. **Preservar `tools` no salvamento:** Alterar o método `save` para gravar o array `tools` no frontmatter de `SKILL.md`:
   ```typescript
   // Atualizar a gravação de arquivos para incluir tools:
   const content = `---
   name: ${JSON.stringify(skill.name)}
   description: ${JSON.stringify(skill.description)}
   version: ${JSON.stringify(skill.version)}
   preferredTools: ${JSON.stringify(skill.preferredTools || [])}
   requiredCapabilities: ${JSON.stringify(skill.requiredCapabilities || [])}
   approvalMode: ${skill.approvalMode}
   enabled: ${skill.enabled}
   tools: ${JSON.stringify(skill.tools || [])}
   ---
   ${skill.instructions}
   `;
   ```

Com estas diretrizes claras e rascunhos, o Implementador terá insumos completos para desenvolver a feature com excelência.
