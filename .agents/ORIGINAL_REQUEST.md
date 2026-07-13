# Original User Request

## 2026-07-13T19:05:29Z

# Teamwork Project Prompt — Draft

> Status: Launched
> Goal: Craft prompt → get user approval → delegate to teamwork_preview

Expanda a Aba de Skills do projeto Next.js criando duas novas skills na pasta `skills/` ("analisador-de-metricas" e "gerador-de-hashtags") seguindo o padrão existente, integre-as na interface da Aba de Skills e garanta que o design permaneça premium e sem erros de importação. A equipe de agentes tem total liberdade para decidir a melhor abordagem técnica para a lógica das skills.

Working directory: d:\apps\mrchicken
Integrity mode: demo

## Requirements

### R1. Criar Novas Skills
Criar as lógicas para duas novas skills: "analisador-de-metricas" (para analisar engajamento de vídeos) e "gerador-de-hashtags". Ambas devem ser criadas dentro do diretório `skills/` e seguir estritamente o padrão das skills já existentes (como a "trend-hunter").

### R2. Integração com a Interface
Localizar o componente/página Next.js responsável pela "Aba de Skills" e adicionar as chamadas/cards para as duas novas skills recém-criadas na interface.

### R3. Qualidade e Design Premium
Revisar os arquivos modificados para garantir que não existam quebras de importações (imports inválidos) e que o design da Aba de Skills mantenha uma estética moderna e premium.

## Acceptance Criteria

### Integridade do Código
- [ ] O comando de build do Next.js (ex: `npm run build` ou `npm run dev`) executa com sucesso sem erros críticos de compilação ou de rotas.
- [ ] Não há erros de importação ("module not found") nos arquivos modificados ou criados.

### Entrega das Skills
- [ ] Os arquivos para `analisador-de-metricas` e `gerador-de-hashtags` existem dentro da pasta `skills/`.
- [ ] O componente da "Aba de Skills" contém referências (cards ou botões) no código fonte apontando para as novas skills.
