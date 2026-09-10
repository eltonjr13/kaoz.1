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

## 2026-09-09T22:01:19Z

# Teamwork Project Prompt — Draft

> Status: Launched
> Goal: Craft prompt → get user approval → delegate to teamwork_preview
> Requested team: Sequential 5-agent pipeline with strict blocking between phases

Refatorar a aba Sketch do Kaoz.1 para uma experiência minimalista orientada à entrega automática de anúncios estáticos (fluxo: prompt + anexos opcionais + sketch opcional -> criativo pronto), executando a pipeline em 5 fases estritamente sequenciais onde a execução de cada agente é bloqueada até que o anterior entregue seus artefatos e validações.

Working directory: d:\apps\mrchicken
Integrity mode: demo

## Regra Fundamental de Orquestração
Executar a pipeline em fases estritamente sequenciais. Bloquear o avanço para a fase seguinte até que os artefatos, contratos, testes e commits da fase anterior estejam completamente entregues e verificados:
Fase 1 (Agente 1) ➔ Fase 2 (Agente 2) & Fase 3 (Agente 3) ➔ Fase 4 (Agente 4) ➔ Fase 5 (Agente 5).

---

## Requirements

### R1. Base de Contratos, Armazenamento e Compatibilidade (Agente 1)
Definir os contratos versionados e a camada de persistência para a nova experiência Sketch antes dos demais agentes em `types/sketch.ts` e `lib/sketch/sketch-storage.ts`:
- Contratos versionados para:
  1. Pedido simples: prompt, formato (dimensões/proporção), referências selecionadas e sketch opcional.
  2. Plano criativo interno: fatos fornecidos, ângulo de venda, conceito visual, copy, direção de arte, composição e restrições.
  3. Resultado: arte final, recursos necessários a ajustes, pedido de origem e versão/linhagem.
  4. Intenção de alteração: refinar resultado existente ou criar outro conceito independente.
- Diferenciar estritamente fatos informados de decisões criativas inferidas, preservando literalmente textos, ofertas e preços fornecidos pelo usuário.
- Novos projetos devem iniciar limpos, sem chamadas prontas, sem selo, sem CTA e sem layout promocional pré-montado (o prompt de exemplo deve ser apenas placeholder visual de UI, nunca conteúdo persistido).
- Garantir compatibilidade aditiva com projetos antigos existentes, preservando histórico, camadas internas e opções antigas sem sobrescrever dados.
- Entregar contratos puros e testes automatizados de persistência e compatibilidade antes de desbloquear as fases seguintes.

### R2. Interface Minimalista de Fluxo Único (Agente 2)
Implementar a nova experiência visual em `components/sketch/` e `app/(dashboard)/sketch/page.tsx` consumindo os contratos da Fase 1:
- Substituir a interface de múltiplos painéis por uma tela limpa e focada:
  - Título Sketch e acesso discreto ao histórico de projetos/criações.
  - Campo proeminente de texto para descrever o anúncio.
  - Upload e gerenciamento de anexos de referência (arquivo, drag-and-drop, colar via clipboard, visualização em miniatura, remoção e tag opcional de finalidade). Sem necessidade de posicionar em prancheta.
  - Modal de desenho Sketch (pincel, borracha, paleta de cores essenciais, espessura, desfazer/refazer, limpar, aplicar com miniatura, cancelar preservando desenho anterior). Se não desenhar, nada é enviado.
  - Seletor compacto de formato/aspect ratio.
  - Botão principal único: "Gerar criativo".
- Não exigir criação/nomeação manual prévia de projeto para começar.
- Não exibir no fluxo inicial: briefing estruturado, editor de copy manual, painel de propriedades, lista permanente de camadas, prévia do Flow ou prancheta vazia.
- Tela de resultado: arte final em destaque, botão "Baixar", botão "Outra ideia", campo de ajuste "O que você quer mudar?", progresso simples e tratamento de erro com retry.
- Salvar coordenadamente sob uma mesma revisão (pedido + anexos + sketch) e validar responsividade e navegação por teclado.

### R3. Motor Criativo Interno e Geração de Copy (Agente 3)
Implementar o planejamento criativo em `lib/sketch/` (`sketch-copy-generator.ts`, `sketch-prompt-compiler.ts` e novo módulo de planejamento):
- Entrada: pedido simples validado pela Fase 1. Saída: plano criativo estruturado e pronto para execução visual.
- O motor deve:
  1. Extrair produto, público-alvo, objetivo, oferta e restrições do pedido simples.
  2. Separar fatos explícitos de escolhas de direção artística.
  3. Formular internamente 3 conceitos breves e distintos (explorando desejo, objeção, demonstração, contraste ou curiosidade).
  4. Selecionar o conceito mais adequado antes de disparar geração visual.
  5. Sincronizar copy e direção de arte para trabalharem em conjunto.
  6. Planejar composição automática e tipografia sem impor templates genéricos de título/selo/CTA para todos os anúncios.
- Evitar clichês publicitários artificiais por default (ex: "O futuro chegou", produto flutuando com partículas e neon), a menos que solicitado explicitamente.
- Testar e validar o planejamento com no mínimo 6 pedidos distintos: produto físico, serviço, oferta com preço exato, pedido sem texto, referência de identidade de produto e composição guiada por sketch.

### R4. Integração do Pipeline, Gerenciamento de Jobs e Composição Final (Agente 4)
Integrar os contratos (Fase 1), a interface (Fase 2) e o motor criativo (Fase 3) na infraestrutura de jobs e composição em `lib/sketch/sketch-job-manager.ts`, `lib/sketch/sketch-composite-preparer.ts`, `lib/sketch/sketch-exporter.ts`, `lib/sketch/sketch-composition-rules.ts` e rotas `app/api/sketch/`:
- Conectar o pipeline completo de ponta a ponta: Pedido imutável ➔ Planejamento criativo ➔ Preparação de referências ➔ Geração visual ➔ Composição determinística ➔ Arquivo final entregue.
- Garantir processamento assíncrono persistente (a geração não pode depender de manter a aba do navegador aberta).
- Respeitar limites reais de anexos/referências sem descarte silencioso; diferenciar identidade visual de guia de composição.
- Suporte a ajustes inteligentes:
  - Ajuste apenas de texto: reutilizar a arte base existente sem nova geração de imagem desnecessária.
  - Ajuste visual: aplicar edição/referência suportada.
  - "Outra ideia": gerar um novo conceito distinto, preservando fatos, produto e restrições fornecidas.
  - Cada resultado gera uma nova versão imutável na linhagem do projeto, sem sobrescrever versões anteriores.
- Validar fluxo com provedor simulado/mock, verificando bytes, plano executado e existência da arte finalizada.

### R5. Validação Independente, Auditoria E2E e Estabilidade (Agente 5)
Realizar a auditoria e validação independente de toda a refatoração integrada para responder: "Consigo descrever um anúncio e receber uma arte pronta sem operar um editor de design?":
- Validar os 10 cenários essenciais:
  1. Primeiro acesso com apenas o campo de pedido e ações essenciais.
  2. Prompt isolado.
  3. Prompt com anexos de referência.
  4. Prompt com desenho Sketch.
  5. Prompt combinado com referências e sketch.
  6. Cancelamento/reabertura do modal de desenho sem perda de estado prévio.
  7. Ajuste exclusivo de texto reaproveitando a arte visual existente.
  8. Ação "Outra ideia" produzindo conceito genuinamente diferente.
  9. Download do criativo exatamente correspondente ao resultado exibido.
  10. Reabertura de projetos legados com histórico, dados e compatibilidade 100% preservados.
- Garantir ausência de regressões que reintroduzam complexidade (briefing manual obrigatório, camadas visíveis por padrão, etc.).
- Validação técnica completa:
  - `npm run typecheck` sem erros.
  - ESLint direcionado aos arquivos alterados sem violações.
  - Testes unitários e de integração do Sketch executando com sucesso.
  - Verificação de não-regressão de Flow, prompts e atalhos.
  - Build de produção (`npm run build`) concluído com sucesso.

---

## Acceptance Criteria

### Integridade do Código e Compatibilidade
- [ ] O comando `npm run typecheck` passa sem erros de tipagem.
- [ ] O build do Next.js (`npm run build`) completa com sucesso sem falhas de rotas ou compilação.
- [ ] Projetos antigos do Sketch abrem perfeitamente sem perda de dados, camadas ou histórico.
- [ ] Novos projetos iniciam com estado limpo, sem textos padrão, CTAs ou selos pré-populados.

### Experiência do Usuário e Interface Minimalista
- [ ] O fluxo inicial contém apenas o campo de descrição do anúncio, anexos, botão de sketch, seletor de formato e botão "Gerar criativo".
- [ ] Não há exigência de criar projeto antes de redigir o pedido.
- [ ] A tela de resultado apresenta arte pronta, Baixar, Outra ideia e campo de ajustes.
- [ ] O modal de sketch abre, permite desenhar/limpar/desfazer/refazer, gera miniatura ao aplicar e mantém o desenho anterior em caso de cancelamento.

### Motor Criativo e Composição
- [ ] O motor criativo extrai fatos estritamente fornecidos e gera múltiplos conceitos internamente, sem clichês genéricos.
- [ ] Textos e ofertas literais do usuário são rigorosamente preservados.
- [ ] Nenhum anexo ou referência é silenciosamente ignorado.
- [ ] Ajustes de texto reutilizam a imagem existente quando aplicável.
- [ ] Ação "Outra ideia" gera nova versão com conceito distinto na mesma linhagem.

### Bloqueio e Entrega por Agente
- [ ] Cada agente conclui sua fase gerando arquivos, testes e commit Conventional Commit dedicado antes do próximo iniciar.
- [ ] Todos os testes unitários e de integração passam.
- [ ] Relatório final de validação independente detalha os 10 cenários testados.

## 2026-09-10T16:16:39Z

# Teamwork Project Prompt

Requested team: Equipe completa de agentes (executando auditoria, APIs, grafo, memórias, shell e QA em paralelo/fases)

Refatorar a aba Cortex do Kaoz.1 (aplicativo desktop Windows/Electron com Next.js local-first) para transformá-la em uma central clara, eficiente e confiável de memória cognitiva, conhecimento, conversas e identidades, preservando integralmente os dados locais persistidos e os comportamentos existentes.

Working directory: D:\apps\mrchicken
Integrity mode: development

Referência mestre: D:\apps\mrchicken\docs\TEAMWORK_REFATORAMENTO_CORTEX.md

## Requirements

### R1. Shell Unificado e Visão Geral Baseada em Dados Reais
Estruturar a página Cortex em seções navegáveis (`Visão Geral`, `Grafo`, `Memórias`, `Conversas`, `Identidades`) com navegação acessível por teclado, compatibilidade com viewport estreito e estados inequívocos de carregamento, vazio, erro com retry e atualização em andamento. A Visão Geral deve apresentar métricas e status operacionais calculados exclusivamente a partir dos dados locais reais.

### R2. Robustez de APIs e Contratos de Dados Locais
Padronizar contratos e tratamento de erros das rotas locais consumidas pelo Cortex (`/api/memory/**`, `/api/cortex/**`, `/api/conversations/**`). Garantir persistência atômica no arquivo JSON de memória cognitiva e integridade no SQLite de conversas, sem quebras de compatibilidade retroativa, sem retorno de dados fictícios e sem mascarar falhas de requisição como listas vazias.

### R3. Grafo Cognitivo Desacoplado e Otimizado
Decompor o componente do grafo separando layout/física, renderização canvas e painel de controles/detalhes. Preservar todas as operações existentes (inspeção, edição de nós e conexões, feedback de episódios, regras procedimentais). Otimizar consumo de recursos pausando loops de animação e polling fora de visibilidade, tratando DPI e mantendo a posição estável dos nós durante atualizações em segundo plano.

### R4. Gestão de Memórias, Conversas, Identidades e Ações Destrutivas
Implementar busca, filtros, paginação e ordenação nas listagens de memórias e conversas, prevenindo condições de corrida onde respostas tardias sobrescrevem buscas recentes. Gerenciar vínculos de identidades observadas com impacto explícito em dados derivados. Substituir diálogos síncronos (`window.confirm`) por modais acessíveis com foco retido, feedback de progresso e rollback confiável se a exclusão falhar.

### R5. Infraestrutura e Restrições Locais
Operar em ambiente Windows utilizando `npm.cmd`. Garantir que nenhum dado de memória cognitiva, conversa ou identidade seja transmitido para serviços externos em nuvem. Reutilizar componentes e estilos existentes do projeto sem introduzir dependências desnecessárias que aumentem o bundle do Electron.

## Verification Resources
- Testes automatizados existentes: `tests/cognitive-memory.test.ts`, `tests/conversation-memory.test.ts`.
- Scripts de validação: `npm.cmd run typecheck`, `npm.cmd run test:memory`, `npm.cmd run test:memory-archive`, `npm.cmd run lint`.

## Acceptance Criteria

### Integridade e Dados
- [ ] Leitura e escrita de esquemas existentes de memória cognitiva (JSON) e arquivo de conversas (SQLite) mantidas sem perda ou corrupção de dados preexistentes.
- [ ] Nenhuma chamada de rede transmite dados de memórias ou conversas para servidores remotos.
- [ ] Todas as mutações existentes (nós, conexões, regras procedimentais, feedback de episódios, memórias e conversas) permanecem disponíveis e funcionais.

### Desempenho e Arquitetura
- [ ] Componente do grafo não concentra física, renderização, mutação e modais em um único bloco monolítico.
- [ ] O loop `requestAnimationFrame` do canvas e polling periódico são pausados quando a aba, seção ou janela estiver invisível.
- [ ] Polling em segundo plano ou atualizações parciais não resetam nem recalculam posições de nós já posicionados.
- [ ] Requisições assíncronas concorrentes ou lentas de busca não sobrescrevem consultas ou filtros mais recentes.

### Experiência e Acessibilidade
- [ ] Erros de requisição e falhas de rede exibem mensagens com opção de retry e não são renderizados como estados vazios normais.
- [ ] Ações destrutivas utilizam modais acessíveis com foco retornado ao elemento de origem e tratamento de erro inline com rollback se a operação falhar.
- [ ] Navegação entre seções preserva o estado ativo e permite operação completa por teclado.

### Verificação Técnica
- [ ] `npm.cmd run typecheck` conclui sem erros.
- [ ] `npm.cmd run test:memory` e `npm.cmd run test:memory-archive` passam com sucesso.
- [ ] Testes automatizados focados criados para as novas rotas/componentes/utilitários passam.
- [ ] `npm.cmd run lint` passa nos arquivos criados ou modificados.
- [ ] Registro documentado de validação visual real no navegador e no Electron, com relatório final das entregas e compatibilidade.

## 2026-09-10T21:38:37Z

# Cortex Refactoring — Resumption for Milestones M1, M3, M4, M5

Working directory: D:\apps\mrchicken
Integrity mode: development
Requested team: Equipe completa de agentes

## Background & Checkpoint State

Milestone M2 (API standardization, atomic JSON persistence, SQLite WAL transactions, contract envelopes, elimination of fake seed data) and the E2E Testing Track (67/67 tests passing) are 100% complete and verified in git commit 17482b5.

The specifications, contracts, and architecture are defined in:
- `D:\apps\mrchicken\PROJECT.md`
- `D:\apps\mrchicken\docs\TEAMWORK_REFATORAMENTO_CORTEX.md`
- `D:\apps\mrchicken\TEST_INFRA.md`

Current verification baseline:
- `npm.cmd run typecheck`: 0 errors
- `npm.cmd run test:memory`: 9/9 passed
- `npm.cmd run test:memory-archive`: 7/7 passed
- `node --experimental-strip-types tests/api-cortex-integration.test.ts`: 21/21 passed
- `node tests/e2e/cortex/test-runner.mjs`: 67/67 passed

## Scope of Work (Milestones M1, M3, M4, M5)

### M1 — Unified Shell & Overview Dashboard
- Refactor `app/(dashboard)/cortex/page.tsx` and modular shell components in `components/cortex/`.
- Tabbed keyboard-accessible navigation between 5 sections:
  1. `Visão Geral`
  2. `Grafo`
  3. `Memórias`
  4. `Conversas`
  5. `Identidades`
- Visão Geral dashboard driven **strictly by real data** from local endpoints:
  - Node counts, edge counts, active rules, episodic memories, persistent memories, conversations, messages, external identities.
  - Operational health of local storage engines (JSON cognitive memory and SQLite conversation archive).
  - No synthetic seeds, no decorative placeholders.
- Unified explicit UI states: Loading skeleton, Empty state, Error state with retry action, and updating indicator.
- Narrow viewport responsive layout without horizontal overflow.

### M3 — Decoupled & Optimized Cognitive Graph
- Decompose monolithic `components/cortex/cortex-graph-client.tsx` into clean, testable modules in `components/cortex/graph/`:
  - `cortex-graph.tsx`: Container orchestrator
  - `cortex-graph-canvas.tsx`: Canvas renderer with high-DPI (`devicePixelRatio`), inverse hit-testing coordinate mapping, and `ResizeObserver`
  - `cortex-graph-physics.ts` & `cortex-graph-layout.ts`: Pure physics engine decoupled from React render loop, velocity dampening, collision repulsion
  - `cortex-graph-controls.tsx`: Zoom, pan, HUD, keyboard navigation
  - `cortex-graph-details.tsx`: Node/edge inspection, rule editing, episode feedback
  - `cortex-graph-types.ts`: Graph data types
- Animation and polling optimization:
  - Pause `requestAnimationFrame` loop and polling when `document.visibilityState === 'hidden'` or when tab is not active.
  - Preserve node coordinates during 30s background polling without resetting or shifting existing nodes.
- Preserve 100% of existing operations: node creation/edit/deletion, connection management, procedural rule feedback/editing, episode creation/feedback.

### M4 — Memory, Conversation, Identity Management & Accessible Modais
- In `components/cortex/memories/` and `components/cortex/conversations/`:
  - Memory list (`cortex-chat-memories.tsx`): text search, filters (scope, status, type), pagination, review actions (including `pending_review` highlight).
  - Conversation archive (`cortex-conversation-archive.tsx`): search with `AbortController` and sequence IDs (preventing stale async responses from overwriting recent searches), genuine empty search results (fix fallback bug).
  - Identity linking management (`cortex-identities.tsx`): channel association with visible progress and feedback on derived memory impact.
- Replace all synchronous `window.confirm` and `window.alert` with accessible modal dialogs (`components/cortex/cortex-confirm-modal.tsx`):
  - Focus trapping, Escape key dismiss, focus restoration to trigger element.
  - Progress state during deletion, inline error display and safe rollback on failure.

### M5 — QA, Verification & Final Report
- Run all test suites: `npm.cmd run typecheck`, `npm.cmd run test:memory`, `npm.cmd run test:memory-archive`, `node tests/e2e/cortex/test-runner.mjs`, and `npm.cmd run lint` on touched files.
- Ensure 0 regressions and 100% pass rate.
- Document visual validation and Electron desktop readiness.

Coordinate work across specialized agents, maintain clean git commits per phase, and verify all acceptance criteria.



