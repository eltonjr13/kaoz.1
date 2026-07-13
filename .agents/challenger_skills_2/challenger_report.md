# Challenger Verification Report

This report documents the verification of the runtime correctness, exit codes, and stdout/stderr behavior for the scripts:
1. `analisador-de-metricas` (`skills/analisador-de-metricas/scripts/analyze-metrics.ts`)
2. `gerador-de-hashtags` (`skills/gerador-de-hashtags/scripts/generate-hashtags.ts`)

---

## 1. Analisador de Métricas (`analyze-metrics.ts`)

### Test Case 1.1: Normal Inputs
* **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"visualizacoes": 1000, "curtidas": 100, "comentarios": 10, "compartilhamentos": 5, "salvamentos": 5, "duracaoSegundos": 60, "tempoRetencaoMedio": 30}'; npx tsx skills/analisador-de-metricas/scripts/analyze-metrics.ts
  ```
* **Exit Code**: `0`
* **Output (Stdout - JSON)**:
  ```json
  {"sucesso":true,"metricas":{"taxaEngajamento":12,"classificacaoEngajamento":"Excelente","taxaRetencao":50,"classificacaoRetencao":"Bom","taxaCompartilhamento":0.5,"taxaSalvamento":0.5},"diagnostico":{"resumo":"Vídeo com taxa de engajamento de 12.00% (Excelente) e retenção de 50.00% (Bom).","recomendacoes":["Excelente performance geral! Mantenha a consistência desta estrutura de vídeo."]}}
  ```

### Test Case 1.2: Boundary - Zero Views
* **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"visualizacoes": 0, "curtidas": 100, "comentarios": 10, "compartilhamentos": 5, "salvamentos": 5, "duracaoSegundos": 60, "tempoRetencaoMedio": 30}'; npx tsx skills/analisador-de-metricas/scripts/analyze-metrics.ts
  ```
* **Exit Code**: `1`
* **Output (Stderr)**:
  ```
  O número de visualizações não pode ser zero.
  ```

### Test Case 1.3: Boundary - Zero Duration
* **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"visualizacoes": 1000, "curtidas": 100, "comentarios": 10, "compartilhamentos": 5, "salvamentos": 5, "duracaoSegundos": 0, "tempoRetencaoMedio": 30}'; npx tsx skills/analisador-de-metricas/scripts/analyze-metrics.ts
  ```
* **Exit Code**: `1`
* **Output (Stderr)**:
  ```
  A duração do vídeo não pode ser zero.
  ```

### Test Case 1.4: Boundary - Negative Values (e.g. Negative Likes)
* **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"visualizacoes": 1000, "curtidas": -10, "comentarios": 10, "compartilhamentos": 5, "salvamentos": 5, "duracaoSegundos": 60, "tempoRetencaoMedio": 30}'; npx tsx skills/analisador-de-metricas/scripts/analyze-metrics.ts
  ```
* **Exit Code**: `1`
* **Output (Stderr)**:
  ```
  Parâmetros inválidos. Todos os valores numéricos devem ser positivos.
  ```

### Test Case 1.5: Extreme Values / Poor Performance Recommendations
* **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"visualizacoes": 1000000, "curtidas": 1, "comentarios": 0, "compartilhamentos": 0, "salvamentos": 0, "duracaoSegundos": 100, "tempoRetencaoMedio": 1}'; npx tsx skills/analisador-de-metricas/scripts/analyze-metrics.ts
  ```
* **Exit Code**: `0`
* **Output (Stdout - JSON)**:
  ```json
  {"sucesso":true,"metricas":{"taxaEngajamento":0,"classificacaoEngajamento":"Baixo","taxaRetencao":1,"classificacaoRetencao":"Crítico","taxaCompartilhamento":0,"taxaSalvamento":0},"diagnostico":{"resumo":"Vídeo com taxa de engajamento de 0.00% (Baixo) e retenção de 1.00% (Crítico).","recomendacoes":["O gancho inicial do vídeo (primeiros 3 segundos) falhou em reter o público. Melhore a retenção no início com legendas dinâmicas, cortes mais rápidos e títulos instigantes.","Apesar do alcance, a taxa de interação foi baixa. Adicione uma Call to Action (CTA) explícita e clara ao final do vídeo e na legenda para engajar a audiência.","A taxa de salvamentos está baixa. Tente produzir conteúdos educativos, listas, tutoriais ou dicas práticas que o espectador sinta necessidade de salvar para consultar depois.","A taxa de compartilhamentos está baixa. Crie ganchos de identificação rápida, memes do nicho ou resolva uma dor imediata que faça o espectador querer compartilhar com amigos."]}}
  ```

---

## 2. Gerador de Hashtags (`generate-hashtags.ts`)

### Test Case 2.1: Niche "tecnologia" on Platform "tiktok"
* **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"tema": "tecnologia", "plataforma": "tiktok"}'; npx tsx skills/gerador-de-hashtags/scripts/generate-hashtags.ts
  ```
* **Exit Code**: `0`
* **Output (Stdout - JSON)**:
  ```json
  {"sucesso":true,"tema":"tecnologia","plataforma":"tiktok","hashtags":{"nicho":["#setupgamer","#ti","#inteligenciaartificial","#computador","#smartphone","#dicasdetecnologia"],"amplas":["#tecnologia","#tech","#gadgets","#inovacao"],"plataforma":["#fyp","#foryou","#viral"]},"formattedList":"#setupgamer #ti #inteligenciaartificial #computador #smartphone #dicasdetecnologia #tecnologia #tech #gadgets #inovacao #fyp #foryou #viral"}
  ```

### Test Case 2.2: Niche "finanças" on Platform "instagram"
* **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"tema": "finanças", "plataforma": "instagram"}'; npx tsx skills/gerador-de-hashtags/scripts/generate-hashtags.ts
  ```
* **Exit Code**: `0`
* **Output (Stdout - JSON)**:
  ```json
  {"sucesso":true,"tema":"finanças","plataforma":"instagram","hashtags":{"nicho":["#financaspessoais","#educacaofinanceira","#investir","#poupar","#fundosimobiliarios","#acoes"],"amplas":["#financas","#dinheiro","#investimentos","#economia"],"plataforma":["#reelsinstagram","#explorepage","#reelsviral"]},"formattedList":"#financaspessoais #educacaofinanceira #investir #poupar #fundosimobiliarios #acoes #financas #dinheiro #investimentos #economia #reelsinstagram #explorepage #reelsviral"}
  ```

### Test Case 2.3: Niche "culinária" on Platform "youtube"
* **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"tema": "culinária", "plataforma": "youtube"}'; npx tsx skills/gerador-de-hashtags/scripts/generate-hashtags.ts
  ```
* **Exit Code**: `0`
* **Output (Stdout - JSON)**:
  ```json
  {"sucesso":true,"tema":"culinária","plataforma":"youtube","hashtags":{"nicho":["#receitasfit","#comidadeverdade","#culinariavegana","#docesgourmet","#jantarrapido","#cozinhar"],"amplas":["#culinaria","#comida","#gastronomia","#receitas"],"plataforma":["#shorts","#youtubeshorts","#viralshorts"]},"formattedList":"#receitasfit #comidadeverdade #culinariavegana #docesgourmet #jantarrapido #cozinhar #culinaria #comida #gastronomia #receitas #shorts #youtubeshorts #viralshorts"}
  ```

### Test Case 2.4: Niche "fitness" on Platform "all" (Fallback to Geral)
* **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"tema": "fitness", "plataforma": "all"}'; npx tsx skills/gerador-de-hashtags/scripts/generate-hashtags.ts
  ```
* **Exit Code**: `0`
* **Output (Stdout - JSON)**:
  ```json
  {"sucesso":true,"tema":"fitness","plataforma":"all","hashtags":{"nicho":["#treinoemcasa","#dietaflexivel","#hipertrofia","#vidasaudavel","#foco","#emagrecimento"],"amplas":["#fitness","#academia","#saude","#treino"],"plataforma":["#viral","#trend","#compartilhe"]},"formattedList":"#treinoemcasa #dietaflexivel #hipertrofia #vidasaudavel #foco #emagrecimento #fitness #academia #saude #treino #viral #trend #compartilhe"}
  ```

### Test Case 2.5: Missing 'tema' Parameter
* **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"plataforma": "tiktok"}'; npx tsx skills/gerador-de-hashtags/scripts/generate-hashtags.ts
  ```
* **Exit Code**: `1`
* **Output (Stderr)**:
  ```
  O parâmetro 'tema' é obrigatório.
  ```

### Test Case 2.6: Custom Non-Predefined Niche Fallback
* **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"tema": "pinguim azul voador", "plataforma": "tiktok"}'; npx tsx skills/gerador-de-hashtags/scripts/generate-hashtags.ts
  ```
* **Exit Code**: `0`
* **Output (Stdout - JSON)**:
  ```json
  {"sucesso":true,"tema":"pinguim azul voador","plataforma":"tiktok","hashtags":{"nicho":["#pinguim","#azul","#voador"],"amplas":["#pinguimazulvoador","#viral","#conteudo"],"plataforma":["#fyp","#foryou","#viral"]},"formattedList":"#pinguim #azul #voador #pinguimazulvoador #viral #conteudo #fyp #foryou"}
  ```

---

## Conclusion
Both scripts function correctly in all evaluated scenarios. Output format remains compliant with valid JSON written to `stdout` upon success, and error logs are directed to `stderr` with exit code `1` on invalid arguments.
