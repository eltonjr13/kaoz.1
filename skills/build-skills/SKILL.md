---
name: "Build Skills"
description: "Cria e aprimora skills conversando com o usuário. Use quando pedirem para criar, montar, gerar, projetar, revisar ou atualizar uma skill, inclusive pelo comando /build-skills."
version: "1.0.0"
preferredTools: []
requiredCapabilities: []
approvalMode: "plan"
enabled: true
---
# Build Skills (Padrão Higgsfield.ai)

1. **Entenda a capacidade desejada**: Peça exemplos de uso, tom, regras, ganchos (hooks) e qual o objetivo principal que a skill deve realizar.
2. **Defina a Estrutura de Alta Qualidade (Higgsfield-Style)**:
   - Toda skill complexa deve ter instruções ricas em detalhes (incluindo seções como Contexto, Fórmulas de Ganchos, Diretrizes de Plataforma, Estrutura de Calendário, e Checklists de Validação quando aplicável).
   - Se o volume de conteúdo/instruções for grande (mais de 200 linhas), subdivida-o. O arquivo principal `SKILL.md` deve conter o fluxo e regras essenciais de orquestração. Sub-tópicos extensos (ex: limites de caracteres, templates específicos, playbooks ou listas de ideias) devem ser gravados em arquivos markdown separados dentro da pasta `skills/<id>/references/`.
   - Nas instruções do `SKILL.md` gerado, faça referência aos arquivos da pasta utilizando a convenção `See references/<nome-do-arquivo>.md` para guiar a leitura do orquestrador.
3. **Mapeamento de Ferramentas**:
   - Defina quais ferramentas a skill utilizará. Lembre-se que as ferramentas criativas (`creative:generate-image`, `creative:generate-video`) e a sandbox de código (`system:run-code`) estão disponíveis nativamente e devem ser sugeridas para automação de tarefas de mídia e lógica.
   - Caso precise de scripts utilitários permanentes para a skill, crie-os em `skills/<id>/scripts/`.
4. **Instalação Segura**:
   - Gere o identificador no padrão lowercase kebab-case (limite de 64 caracteres).
   - Apresente o rascunho de todos os arquivos (`SKILL.md` e os arquivos de `references/` ou scripts associados) para aprovação explícita do usuário antes de salvá-los no disco usando `native:file-write`.

