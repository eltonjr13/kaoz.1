# Challenger Report — Runtime Correctness Verification

This report documents the verification and stress testing of two scripts: `analisador-de-metricas` (metrics analyzer) and `gerador-de-hashtags` (hashtag generator).

---

## 1. Script: `analisador-de-metricas`

**Script Path**: `skills/analisador-de-metricas/scripts/analyze-metrics.ts`

### Test Cases

#### Case 1.1: Normal Inputs
- **Description**: Standard metrics representing typical video performance.
- **Input (`KAOZ_SKILL_ARGS`)**:
  ```json
  {
    "visualizacoes": 1000,
    "curtidas": 100,
    "comentarios": 10,
    "compartilhamentos": 5,
    "salvamentos": 5,
    "duracaoSegundos": 60,
    "tempoRetencaoMedio": 30
  }
  ```
- **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"visualizacoes": 1000, "curtidas": 100, "comentarios": 10, "compartilhamentos": 5, "salvamentos": 5, "duracaoSegundos": 60, "tempoRetencaoMedio": 30}'; npx tsx skills/analisador-de-metricas/scripts/analyze-metrics.ts
  ```
- **Output (Stdout)**:
  ```json
  {"sucesso":true,"metricas":{"taxaEngajamento":12,"classificacaoEngajamento":"Excelente","taxaRetencao":50,"classificacaoRetencao":"Bom","taxaCompartilhamento":0.5,"taxaSalvamento":0.5},"diagnostico":{"resumo":"Vídeo com taxa de engajamento de 12.00% (Excelente) e retenção de 50.00% (Bom).","recomendacoes":["Excelente performance geral! Mantenha a consistência desta estrutura de vídeo."]}}
  ```
- **Exit Code**: `0` (Success)

#### Case 1.2: Boundary - 0 Views
- **Description**: Test error handling when views count is zero.
- **Input (`KAOZ_SKILL_ARGS`)**:
  ```json
  {
    "visualizacoes": 0,
    "curtidas": 100,
    "comentarios": 10,
    "compartilhamentos": 5,
    "salvamentos": 5,
    "duracaoSegundos": 60,
    "tempoRetencaoMedio": 30
  }
  ```
- **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"visualizacoes": 0, "curtidas": 100, "comentarios": 10, "compartilhamentos": 5, "salvamentos": 5, "duracaoSegundos": 60, "tempoRetencaoMedio": 30}'; npx tsx skills/analisador-de-metricas/scripts/analyze-metrics.ts
  ```
- **Output (Stderr)**:
  ```
  O número de visualizações não pode ser zero.
  ```
- **Exit Code**: `1` (Failure)

#### Case 1.3: Boundary - 0 Duration
- **Description**: Test error handling when duration is zero.
- **Input (`KAOZ_SKILL_ARGS`)**:
  ```json
  {
    "visualizacoes": 1000,
    "curtidas": 100,
    "comentarios": 10,
    "compartilhamentos": 5,
    "salvamentos": 5,
    "duracaoSegundos": 0,
    "tempoRetencaoMedio": 30
  }
  ```
- **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"visualizacoes": 1000, "curtidas": 100, "comentarios": 10, "compartilhamentos": 5, "salvamentos": 5, "duracaoSegundos": 0, "tempoRetencaoMedio": 30}'; npx tsx skills/analisador-de-metricas/scripts/analyze-metrics.ts
  ```
- **Output (Stderr)**:
  ```
  A duração do vídeo não pode ser zero.
  ```
- **Exit Code**: `1` (Failure)

#### Case 1.4: Negative Inputs
- **Description**: Test error handling when a parameter has negative values.
- **Input (`KAOZ_SKILL_ARGS`)**:
  ```json
  {
    "visualizacoes": 1000,
    "curtidas": -100,
    "comentarios": 10,
    "compartilhamentos": 5,
    "salvamentos": 5,
    "duracaoSegundos": 60,
    "tempoRetencaoMedio": 30
  }
  ```
- **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"visualizacoes": 1000, "curtidas": -100, "comentarios": 10, "compartilhamentos": 5, "salvamentos": 5, "duracaoSegundos": 60, "tempoRetencaoMedio": 30}'; npx tsx skills/analisador-de-metricas/scripts/analyze-metrics.ts
  ```
- **Output (Stderr)**:
  ```
  Parâmetros inválidos. Todos os valores numéricos devem ser positivos.
  ```
- **Exit Code**: `1` (Failure)

#### Case 1.5: Missing / Invalid Inputs
- **Description**: Test error handling when parameters are missing.
- **Input (`KAOZ_SKILL_ARGS`)**:
  ```json
  {
    "visualizacoes": 1000,
    "curtidas": 100,
    "duracaoSegundos": 60,
    "tempoRetencaoMedio": 30
  }
  ```
- **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"visualizacoes": 1000, "curtidas": 100, "duracaoSegundos": 60, "tempoRetencaoMedio": 30}'; npx tsx skills/analisador-de-metricas/scripts/analyze-metrics.ts
  ```
- **Output (Stderr)**:
  ```
  Parâmetros inválidos. Todos os valores numéricos devem ser positivos.
  ```
- **Exit Code**: `1` (Failure)

#### Case 1.6: Extreme Values
- **Description**: Test handling of very high performance stats (viral metrics on a large account).
- **Input (`KAOZ_SKILL_ARGS`)**:
  ```json
  {
    "visualizacoes": 10000000,
    "curtidas": 2500000,
    "comentarios": 100000,
    "compartilhamentos": 500000,
    "salvamentos": 300000,
    "duracaoSegundos": 3600,
    "tempoRetencaoMedio": 1800
  }
  ```
- **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"visualizacoes": 10000000, "curtidas": 2500000, "comentarios": 100000, "compartilhamentos": 500000, "salvamentos": 300000, "duracaoSegundos": 3600, "tempoRetencaoMedio": 1800}'; npx tsx skills/analisador-de-metricas/scripts/analyze-metrics.ts
  ```
- **Output (Stdout)**:
  ```json
  {"sucesso":true,"metricas":{"taxaEngajamento":34,"classificacaoEngajamento":"Excelente","taxaRetencao":50,"classificacaoRetencao":"Bom","taxaCompartilhamento":5,"taxaSalvamento":3},"diagnostico":{"resumo":"Vídeo com taxa de engajamento de 34.00% (Excelente) e retenção de 50.00% (Bom).","recomendacoes":["Excelente performance geral! Mantenha a consistência desta estrutura de vídeo."]}}
  ```
- **Exit Code**: `0` (Success)

---

## 2. Script: `gerador-de-hashtags`

**Script Path**: `skills/gerador-de-hashtags/scripts/generate-hashtags.ts`

### Test Cases

#### Case 2.1: Niche `tecnologia` on Platform `tiktok`
- **Description**: Generate tags for predefined technology niche using TikTok defaults.
- **Input (`KAOZ_SKILL_ARGS`)**:
  ```json
  {
    "tema": "tecnologia",
    "plataforma": "tiktok"
  }
  ```
- **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"tema": "tecnologia", "plataforma": "tiktok"}'; npx tsx skills/gerador-de-hashtags/scripts/generate-hashtags.ts
  ```
- **Output (Stdout)**:
  ```json
  {"sucesso":true,"tema":"tecnologia","plataforma":"tiktok","hashtags":{"nicho":["#setupgamer","#ti","#inteligenciaartificial","#computador","#smartphone","#dicasdetecnologia"],"amplas":["#tecnologia","#tech","#gadgets","#inovacao"],"plataforma":["#fyp","#foryou","#viral"]},"formattedList":"#setupgamer #ti #inteligenciaartificial #computador #smartphone #dicasdetecnologia #tecnologia #tech #gadgets #inovacao #fyp #foryou #viral"}
  ```
- **Exit Code**: `0` (Success)

#### Case 2.2: Niche `finanças` (with accent) on Platform `instagram`
- **Description**: Ensure character normalization handles accents in predefined niches.
- **Input (`KAOZ_SKILL_ARGS`)**:
  ```json
  {
    "tema": "finanças",
    "plataforma": "instagram"
  }
  ```
- **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"tema": "finanças", "plataforma": "instagram"}'; npx tsx skills/gerador-de-hashtags/scripts/generate-hashtags.ts
  ```
- **Output (Stdout)**:
  ```json
  {"sucesso":true,"tema":"finanças","plataforma":"instagram","hashtags":{"nicho":["#financaspessoais","#educacaofinanceira","#investir","#poupar","#fundosimobiliarios","#acoes"],"amplas":["#financas","#dinheiro","#investimentos","#economia"],"plataforma":["#reelsinstagram","#explorepage","#reelsviral"]},"formattedList":"#financaspessoais #educacaofinanceira #investir #poupar #fundosimobiliarios #acoes #financas #dinheiro #investimentos #economia #reelsinstagram #explorepage #reelsviral"}
  ```
- **Exit Code**: `0` (Success)

#### Case 2.3: Niche `culinária` on Platform `youtube`
- **Description**: Predefined cooking/culinary niche using YouTube shorts hashtags.
- **Input (`KAOZ_SKILL_ARGS`)**:
  ```json
  {
    "tema": "culinária",
    "plataforma": "youtube"
  }
  ```
- **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"tema": "culinária", "plataforma": "youtube"}'; npx tsx skills/gerador-de-hashtags/scripts/generate-hashtags.ts
  ```
- **Output (Stdout)**:
  ```json
  {"sucesso":true,"tema":"culinária","plataforma":"youtube","hashtags":{"nicho":["#receitasfit","#comidadeverdade","#culinariavegana","#docesgourmet","#jantarrapido","#cozinhar"],"amplas":["#culinaria","#comida","#gastronomia","#receitas"],"plataforma":["#shorts","#youtubeshorts","#viralshorts"]},"formattedList":"#receitasfit #comidadeverdade #culinariavegana #docesgourmet #jantarrapido #cozinhar #culinaria #comida #gastronomia #receitas #shorts #youtubeshorts #viralshorts"}
  ```
- **Exit Code**: `0` (Success)

#### Case 2.4: Niche `fitness` on Platform `all`
- **Description**: Validate platform fallback logic (should fallback to geral platform tags).
- **Input (`KAOZ_SKILL_ARGS`)**:
  ```json
  {
    "tema": "fitness",
    "plataforma": "all"
  }
  ```
- **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"tema": "fitness", "plataforma": "all"}'; npx tsx skills/gerador-de-hashtags/scripts/generate-hashtags.ts
  ```
- **Output (Stdout)**:
  ```json
  {"sucesso":true,"tema":"fitness","plataforma":"all","hashtags":{"nicho":["#treinoemcasa","#dietaflexivel","#hipertrofia","#vidasaudavel","#foco","#emagrecimento"],"amplas":["#fitness","#academia","#saude","#treino"],"plataforma":["#viral","#trend","#compartilhe"]},"formattedList":"#treinoemcasa #dietaflexivel #hipertrofia #vidasaudavel #foco #emagrecimento #fitness #academia #saude #treino #viral #trend #compartilhe"}
  ```
- **Exit Code**: `0` (Success)

#### Case 2.5: Custom Theme `desenho` on Platform `tiktok`
- **Description**: Validate dynamic fallback tag generation for a theme not present in the predefined database.
- **Input (`KAOZ_SKILL_ARGS`)**:
  ```json
  {
    "tema": "desenho",
    "plataforma": "tiktok"
  }
  ```
- **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"tema": "desenho", "plataforma": "tiktok"}'; npx tsx skills/gerador-de-hashtags/scripts/generate-hashtags.ts
  ```
- **Output (Stdout)**:
  ```json
  {"sucesso":true,"tema":"desenho","plataforma":"tiktok","hashtags":{"nicho":["#desenho"],"amplas":["#desenho","#viral","#conteudo"],"plataforma":["#fyp","#foryou","#viral"]},"formattedList":"#desenho #viral #conteudo #fyp #foryou"}
  ```
- **Exit Code**: `0` (Success)

#### Case 2.6: Missing Required Theme parameter
- **Description**: Ensure script fails gracefully when `tema` is not provided.
- **Input (`KAOZ_SKILL_ARGS`)**:
  ```json
  {
    "plataforma": "tiktok"
  }
  ```
- **Command**:
  ```powershell
  $env:KAOZ_SKILL_ARGS='{"plataforma": "tiktok"}'; npx tsx skills/gerador-de-hashtags/scripts/generate-hashtags.ts
  ```
- **Output (Stderr)**:
  ```
  O parâmetro 'tema' é obrigatório.
  ```
- **Exit Code**: `1` (Failure)

---

## Conclusion
Both scripts function correctly according to their interface contracts:
1. Inputs are successfully read from the `KAOZ_SKILL_ARGS` environment variable.
2. Output is printed to `stdout` as a valid JSON string on success.
3. Errors are printed to `stderr` on invalid input.
4. Process exit codes are exactly `0` for successful scenarios and `1` for invalid/boundary error scenarios.
