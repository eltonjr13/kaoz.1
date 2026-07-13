# Analysis & Recommendations — Skills Integration and UI Enhancements

## 1. Executive Summary
This report analyzes the existing skills framework and the Skills Settings panel in Mr. Chicken, determines the suitability of dynamic loading for new skills, provides UI enhancement recommendations to keep the interface premium, and outlines the exact specifications, file paths, and script logic for the two new skills: `analisador-de-metricas` and `gerador-de-hashtags`.

---

## 2. Technical Investigation

### 2.1. Existing Skills Folder Structure and Registry
Skills in Mr. Chicken are stored in the `/skills` root directory. Each skill is organized inside its own directory containing:
1. `SKILL.md`: A markdown file with YAML frontmatter specifying metadata (`name`, `description`, `version`, `preferredTools`, `requiredCapabilities`, `approvalMode`, `enabled`, and optionally `tools`). The content after the frontmatter contains markdown instructions guiding the agent on how/when to use the skill.
2. `scripts/`: An optional directory containing the Node.js/TypeScript scripts executed by the Skill Adapter. Scripts parse input arguments from the `process.env.KAOZ_SKILL_ARGS` environment variable (as a JSON string), output results as JSON strings to `stdout` (`console.log`), and exit with code `0` on success or `1` on error.

### 2.2. Skills Tab UI Investigation
- **`app/(dashboard)/settings/page.tsx`**: Renders the `<SkillsSettingsPanel />` client component when the active tab is `"skills"`. No manual skill registry logic is kept here.
- **`components/settings/SkillsSettingsPanel.tsx`**: Fetches `/api/skills?full=true` to dynamically list all skills. It renders the skills list in a sidebar and provides an editing panel for Name, Description, and Markdown Instructions.
- **`app/api/skills/route.ts`**: Handles fetching and saving skills. It uses `skillRegistry.getAll()` to list skills from the registry and `skillRegistry.save()` to write the updated `SKILL.md` back to the filesystem.
- **`services/skills/skill.registry.ts`**: Synchronously reads the `/skills` folder, parses each `SKILL.md` using `parseSkillMarkdown`, and caches the results. The skill `id` is derived from the directory name.

---

## 3. UI Assessment & Recommendations

### 3.1. Sufficiency of Dynamic Loading
**Dynamic loading from the API is fully sufficient** to display any new skill directory created under `/skills/`.
Adding `/skills/analisador-de-metricas/SKILL.md` and `/skills/gerador-de-hashtags/SKILL.md` will instantly populate them in the Settings sidebar, making them visible and toggleable without manual frontend code changes.

### 3.2. Premium UI Enhancements (Recommendations)
While the current UI is functional, it lacks controls for several core properties of the `KaozSkill` schema. To make the interface premium, modern, and fully-featured, the following changes are recommended for `components/settings/SkillsSettingsPanel.tsx`:

1. **Expose Advanced Configurations in the Form**:
   - Add a dropdown for **`approvalMode`** allowing users to select between:
     - `plan` (Revisar plano de execução)
     - `always` (Sempre pedir aprovação)
     - `never` (Executar automaticamente sem pedir confirmação)
   - Add toggle badges/checkboxes for **`requiredCapabilities`** (e.g. `web`, `content`, `system`).
   - Add a section listing the skill's custom **`tools`** (tool ID, script path, and JSON input schemas) with visual validation checks (e.g., checking if the TS/JS script file exists in the directory).

2. **Search and Categorization**:
   - Add a **Search / Filter Bar** at the top of the sidebar to filter skills as the list expands.
   - Distinctly categorize skills using badges: **"Built-in"** (read-only or revertible) vs. **"Custom"** (created by the user).
   - Display the skill's **`version`** next to its ID in the detail view.

3. **Advanced Editor Capabilities**:
   - Use a lightweight code/syntax highlighter or markdown preview pane next to the Instructions textarea to give visual feedback to the user editing the instructions.

---

## 4. Specifications for New Skills

### 4.1. Skill: `analisador-de-metricas`
This skill calculates engagement and retention rates from video metrics and produces strategic diagnostics.

- **Directory Path**: `skills/analisador-de-metricas`
- **Configuration (SKILL.md)**:
  ```markdown
  ---
  name: "Analisador de Métricas"
  description: "Analisa métricas de engajamento e retenção de vídeos (visualizações, curtidas, comentários, compartilhamentos, salvamentos e retenção) para diagnosticar performance."
  version: "1.0.0"
  preferredTools: []
  requiredCapabilities: []
  approvalMode: "plan"
  enabled: "true"
  tools:
    - id: "skill:analisador-de-metricas:calcular"
      description: "Calcula métricas de performance (engajamento, retenção) de um vídeo e retorna diagnósticos e recomendações estratégicas baseados nos valores."
      script: "scripts/analisar-metricas.ts"
      inputSchema:
        type: "object"
        required: ["visualizacoes", "curtidas", "comentarios", "compartilhamentos", "salvamentos", "duracaoSegundos", "tempoRetencaoMedio"]
        properties:
          visualizacoes:
            type: "number"
            description: "Número total de visualizações do vídeo."
          curtidas:
            type: "number"
            description: "Número total de curtidas."
          comentarios:
            type: "number"
            description: "Número total de comentários."
          compartilhamentos:
            type: "number"
            description: "Número total de compartilhamentos."
          salvamentos:
            type: "number"
            description: "Número total de salvamentos."
          duracaoSegundos:
            type: "number"
            description: "Duração total do vídeo em segundos."
          tempoRetencaoMedio:
            type: "number"
            description: "Tempo médio de retenção dos espectadores em segundos."
  ---
  Você é um especialista em análise de métricas de redes sociais (TikTok, Reels, Shorts).
  Sempre que o usuário pedir para avaliar o desempenho de um vídeo, calcular taxas de engajamento ou diagnosticar problemas de retenção:
  1. Chame a ferramenta `skill:analisador-de-metricas:calcular` passando todos os parâmetros numéricos solicitados.
  2. Apresente o diagnóstico fornecido pela ferramenta de forma clara e estruturada.
  3. Adicione recomendações estratégicas baseadas nas falhas de métricas identificadas no relatório da ferramenta (ex: otimizar o gancho se a retenção estiver baixa; criar CTAs fortes para incentivar interações).
  ```

- **Script Logic (`scripts/analisar-metricas.ts`)**:
  ```typescript
  /// <reference types="node" />

  interface MetricArgs {
    visualizacoes: number;
    curtidas: number;
    comentarios: number;
    compartilhamentos: number;
    salvamentos: number;
    duracaoSegundos: number;
    tempoRetencaoMedio: number;
  }

  function main() {
    try {
      const rawArgs = process.env.KAOZ_SKILL_ARGS || '{}';
      const args: MetricArgs = JSON.parse(rawArgs);

      const {
        visualizacoes,
        curtidas,
        comentarios,
        compartilhamentos,
        salvamentos,
        duracaoSegundos,
        tempoRetencaoMedio,
      } = args;

      if (
        [visualizacoes, curtidas, comentarios, compartilhamentos, salvamentos, duracaoSegundos, tempoRetencaoMedio].some(
          (val) => val === undefined || isNaN(val) || val < 0
        )
      ) {
        throw new Error("Parâmetros inválidos. Todos os valores numéricos devem ser positivos.");
      }

      if (visualizacoes === 0) {
        throw new Error("O número de visualizações não pode ser zero.");
      }

      if (duracaoSegundos === 0) {
        throw new Error("A duração do vídeo não pode ser zero.");
      }

      // Calculations
      const interacoesTotais = curtidas + comentarios + compartilhamentos + salvamentos;
      const taxaEngajamento = (interacoesTotais / visualizacoes) * 100;
      const taxaRetencao = (tempoRetencaoMedio / duracaoSegundos) * 100;
      const taxaCompartilhamento = (compartilhamentos / visualizacoes) * 100;
      const taxaSalvamento = (salvamentos / visualizacoes) * 100;

      // Classifications
      let classificacaoEngajamento = "Regular";
      if (taxaEngajamento >= 10) classificacaoEngajamento = "Excelente";
      else if (taxaEngajamento >= 5) classificacaoEngajamento = "Bom";
      else if (taxaEngajamento >= 2) classificacaoEngajamento = "Médio";
      else classificacaoEngajamento = "Baixo";

      let classificacaoRetencao = "Regular";
      if (taxaRetencao >= 60) classificacaoRetencao = "Viral";
      else if (taxaRetencao >= 40) classificacaoRetencao = "Bom";
      else if (taxaRetencao >= 25) classificacaoRetencao = "Médio";
      else classificacaoRetencao = "Crítico";

      // Diagnosis & Recommendations
      const recomendacoes: string[] = [];
      if (taxaRetencao < 40) {
        recomendacoes.push(
          "O gancho inicial do vídeo (primeiros 3 segundos) falhou em reter o público. Melhore a retenção no início com legendas dinâmicas, cortes mais rápidos e títulos instigantes."
        );
      }
      if (taxaEngajamento < 4) {
        recomendacoes.push(
          "Apesar do alcance, a taxa de interação foi baixa. Adicione uma Call to Action (CTA) explícita e clara ao final do vídeo e na legenda para engajar a audiência."
        );
      }
      if (taxaSalvamento < 0.5) {
        recomendacoes.push(
          "A taxa de salvamentos está baixa. Tente produzir conteúdos educativos, listas, tutoriais ou dicas práticas que o espectador sinta necessidade de salvar para consultar depois."
        );
      }
      if (taxaCompartilhamento < 0.5) {
        recomendacoes.push(
          "A taxa de compartilhamentos está baixa. Crie ganchos de identificação rápida, memes do nicho ou resolva uma dor imediata que faça o espectador querer compartilhar com amigos."
        );
      }
      if (recomendacoes.length === 0) {
        recomendacoes.push("Excelente performance geral! Mantenha a consistência desta estrutura de vídeo.");
      }

      const resultado = {
        sucesso: true,
        metricas: {
          taxaEngajamento: Number(taxaEngajamento.toFixed(2)),
          classificacaoEngajamento,
          taxaRetencao: Number(taxaRetencao.toFixed(2)),
          classificacaoRetencao,
          taxaCompartilhamento: Number(taxaCompartilhamento.toFixed(2)),
          taxaSalvamento: Number(taxaSalvamento.toFixed(2)),
        },
        diagnostico: {
          resumo: `Vídeo com taxa de engajamento de ${taxaEngajamento.toFixed(2)}% (${classificacaoEngajamento}) e retenção de ${taxaRetencao.toFixed(2)}% (${classificacaoRetencao}).`,
          recomendacoes,
        }
      };

      console.log(JSON.stringify(resultado));
      process.exit(0);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  }

  main();
  ```

---

### 4.2. Skill: `gerador-de-hashtags`
This skill structures and groups balanced hashtags optimized for specific platforms and niches.

- **Directory Path**: `skills/gerador-de-hashtags`
- **Configuration (SKILL.md)**:
  ```markdown
  ---
  name: "Gerador de Hashtags"
  description: "Gera um conjunto equilibrado de hashtags (gerais, de nicho e de plataforma) com base no tema e plataforma informados."
  version: "1.0.0"
  preferredTools: []
  requiredCapabilities: []
  approvalMode: "plan"
  enabled: "true"
  tools:
    - id: "skill:gerador-de-hashtags:gerar"
      description: "Gera e organiza hashtags categorizadas por volume e relevância de forma offline com base no tema e plataforma informados."
      script: "scripts/gerar-hashtags.ts"
      inputSchema:
        type: "object"
        required: ["tema", "plataforma"]
        properties:
          tema:
            type: "string"
            description: "O tema ou nicho do vídeo (ex: culinária saudável, finanças pessoais, setup gamer, programação)."
          plataforma:
            type: "string"
            enum: ["tiktok", "instagram", "youtube", "geral"]
            description: "A plataforma onde o vídeo será publicado."
          limite:
            type: "number"
            description: "O número máximo de hashtags desejadas (padrão é 15)."
  ---
  Você é um especialista em SEO e otimização de metadados para redes sociais.
  Sempre que o usuário pedir para gerar, sugerir ou escolher hashtags para uma publicação ou vídeo:
  1. Chame a ferramenta `skill:gerador-de-hashtags:gerar` passando o tema e a plataforma.
  2. Apresente as hashtags geradas de forma organizada em categorias (Hashtags de Nicho, Hashtags Amplas e Hashtags da Plataforma).
  3. Adicione dicas estratégicas para uso das hashtags de acordo com a plataforma (ex: utilizar poucas hashtags focadas no TikTok, ou colocar no final da legenda no Instagram).
  ```

- **Script Logic (`scripts/gerar-hashtags.ts`)**:
  ```typescript
  /// <reference types="node" />

  interface HashtagArgs {
    tema: string;
    plataforma: string;
    limite?: number;
  }

  // Pre-configured tag database mapping common niches to optimized hashtags
  const NICHE_TAG_DATABASE: Record<string, { amplas: string[]; nichos: string[] }> = {
    financas: {
      amplas: ["#financas", "#dinheiro", "#investimentos", "#economia"],
      nichos: ["#financaspessoais", "#educacaofinanceira", "#investir", "#poupar", "#fundosimobiliarios", "#acoes"]
    },
    tecnologia: {
      amplas: ["#tecnologia", "#tech", "#gadgets", "#inovacao"],
      nichos: ["#setupgamer", "#ti", "#inteligenciaartificial", "#computador", "#smartphone", "#dicasdetecnologia"]
    },
    programacao: {
      amplas: ["#programacao", "#desenvolvimento", "#codigo", "#software"],
      nichos: ["#javascript", "#python", "#webdev", "#devlife", "#frontend", "#backend", "#estudarprogramacao"]
    },
    culinaria: {
      amplas: ["#culinaria", "#comida", "#gastronomia", "#receitas"],
      nichos: ["#receitasfit", "#comidadeverdade", "#culinariavegana", "#docesgourmet", "#jantarrapido", "#cozinhar"]
    },
    fitness: {
      amplas: ["#fitness", "#academia", "#saude", "#treino"],
      nichos: ["#treinoemcasa", "#dietaflexivel", "#hipertrofia", "#vidasaudavel", "#foco", "#emagrecimento"]
    },
    marketing: {
      amplas: ["#marketing", "#negocios", "#vendas", "#marketingdigital"],
      nichos: ["#marketingdeconteudo", "#tráfegopago", "#branding", "#mktdigital", "#empreendedorismo", "#socialmedia"]
    }
  };

  const PLATFORM_TAGS: Record<string, string[]> = {
    tiktok: ["#fyp", "#foryou", "#viral", "#tiktokbrasil", "#trend"],
    instagram: ["#reelsinstagram", "#explorepage", "#reelsviral", "#instadaily"],
    youtube: ["#shorts", "#youtubeshorts", "#viralshorts", "#canalnovo"],
    geral: ["#viral", "#trend", "#compartilhe", "#sucesso"]
  };

  function sanitizeTag(word: string): string {
    return "#" + word
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove acentos
      .replace(/[^a-zA-Z0-9]/g, "");   // remove caracteres especiais e espaços
  }

  function main() {
    try {
      const rawArgs = process.env.KAOZ_SKILL_ARGS || '{}';
      const args: HashtagArgs = JSON.parse(rawArgs);

      const tema = args.tema?.trim();
      const plataforma = args.plataforma?.toLowerCase() || "geral";
      const limite = args.limite || 15;

      if (!tema) {
        throw new Error("O parâmetro 'tema' é obrigatório.");
      }

      // Check if theme matches predefined database
      const sanitizedTema = tema.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      let matchedKey = "";
      for (const key of Object.keys(NICHE_TAG_DATABASE)) {
        if (sanitizedTema.includes(key) || key.includes(sanitizedTema)) {
          matchedKey = key;
          break;
        }
      }

      let amplas: string[] = [];
      let nichos: string[] = [];

      if (matchedKey && NICHE_TAG_DATABASE[matchedKey]) {
        amplas = [...NICHE_TAG_DATABASE[matchedKey].amplas];
        nichos = [...NICHE_TAG_DATABASE[matchedKey].nichos];
      } else {
        // Dynamic fallback generation based on terms
        const words = tema.split(/\s+/).filter(w => w.length > 2);
        words.forEach(word => {
          const cleanTag = sanitizeTag(word);
          if (cleanTag.length > 2) nichos.push(cleanTag);
        });
        amplas.push(sanitizeTag(tema));
        amplas.push("#viral");
        amplas.push("#conteudo");
      }

      // Platform specific tags
      const platformTags = PLATFORM_TAGS[plataforma] || PLATFORM_TAGS.geral;

      // Build balanced list: 40% niche, 40% broad, 20% platform
      const targetNichos = Math.max(1, Math.round(limite * 0.4));
      const targetAmplas = Math.max(1, Math.round(limite * 0.4));
      const targetPlatform = Math.max(1, limite - targetNichos - targetAmplas);

      const selectedNichos = nichos.slice(0, targetNichos);
      const selectedAmplas = amplas.slice(0, targetAmplas);
      const selectedPlatform = platformTags.slice(0, targetPlatform);

      const todasHashtags = Array.from(new Set([...selectedNichos, ...selectedAmplas, ...selectedPlatform]));

      const resultado = {
        sucesso: true,
        tema,
        plataforma,
        hashtags: {
          nicho: selectedNichos,
          amplas: selectedAmplas,
          plataforma: selectedPlatform,
        },
        formattedList: todasHashtags.join(" ")
      };

      console.log(JSON.stringify(resultado));
      process.exit(0);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  }

  main();
  ```
