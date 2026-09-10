# Teamwork Preview — Refatoramento da aba Cortex

## Missão

Refatorar a aba Cortex do Kaoz.1 para transformá-la em uma central clara, confiável e eficiente de memória cognitiva, conhecimento, conversas e identidades, preservando integralmente os dados e comportamentos existentes.

O Kaoz.1 é um aplicativo Windows/Electron com Next.js e funcionamento local-first. O escopo desta tarefa está restrito à arquitetura, experiência, desempenho e confiabilidade do Cortex.

Este documento é o briefing mestre para execução pela opção `teamwork-preview` do Antigravity. O líder deve dividir o trabalho entre agentes especializados, coordenar dependências, evitar conflitos de arquivos e entregar uma integração única e validada.

## Resultado esperado

Ao final, a aba Cortex deverá:

1. Ter uma arquitetura de componentes compreensível e sustentável.
2. Organizar grafo, memórias, conversas e identidades em seções navegáveis.
3. Exibir uma visão geral baseada exclusivamente em dados reais.
4. Preservar criação, edição, exclusão, feedback, busca e vínculos existentes.
5. Ter estados claros de carregamento, vazio, erro, atualização e sucesso.
6. Funcionar bem em desktop e janelas estreitas.
7. Ter navegação acessível por teclado e semântica adequada.
8. Melhorar o desempenho do grafo e evitar trabalho desnecessário em segundo plano.
9. Preservar os formatos atuais de armazenamento e compatibilidade com dados legados.
10. Possuir testes focados e evidências de validação visual real.

## Limites do escopo

### Dentro do escopo

- estrutura da página Cortex;
- componentes de grafo, memórias, conversas e identidades;
- APIs diretamente utilizadas pela aba Cortex;
- contratos de dados dessas APIs;
- estados de carregamento e erro;
- acessibilidade;
- responsividade;
- desempenho do canvas;
- filtros, busca e ordenação;
- confirmações de ações destrutivas;
- testes do Cortex e das APIs relacionadas;
- documentação técnica estritamente necessária.

### Fora do escopo

- funcionalidades comerciais;
- autenticação geral do aplicativo;
- reformulação da tela Flow;
- alterações no Sketch, Model P, vídeo, Supervisor ou Settings sem dependência comprovada;
- substituição integral do sistema de memória;
- migração para banco remoto;
- sincronização em nuvem;
- envio de memórias ou conversas para serviços externos;
- redesign global do Kaoz.1;
- mudança de identidade visual do produto.

Qualquer necessidade fora desse escopo deve ser relatada ao líder e não implementada sem autorização explícita.

## Regras globais obrigatórias

- Ler o `AGENTS.md` antes de qualquer alteração.
- Inspecionar o código atual antes de propor arquitetura ou editar arquivos.
- Preservar alterações preexistentes do usuário.
- Não incluir arquivos alheios nos commits.
- Não apagar, redefinir ou migrar dados locais sem compatibilidade retroativa e testes.
- Não alterar o significado dos campos persistidos apenas para simplificar a interface.
- Não esconder uma falha de API apresentando estado vazio.
- Não usar dados fictícios para preencher a interface.
- Não transformar a tela em um painel genérico cheio de cards decorativos.
- Não substituir componentes funcionais por protótipos incompletos.
- Não modificar simultaneamente armazenamento, APIs e UI sem contratos e testes intermediários.
- Não introduzir dependência pesada sem justificar necessidade e impacto no pacote Electron.
- Reutilizar componentes e tokens visuais existentes quando adequados.
- Usar a configuração de ESLint efetivamente adotada pelo projeto e alterar somente essa configuração, caso isso seja indispensável.
- Usar `npm.cmd` para comandos npm no Windows.
- Trabalhar em mudanças pequenas, revisáveis e com propriedade clara de arquivos.
- Cada agente que alterar código deve criar um commit Conventional Commits criativo, conciso e específico.
- Antes de cada commit, executar `git status --short` e confirmar exatamente os arquivos incluídos.
- Ao finalizar cada tarefa, mostrar trecho exato antes/depois, listar arquivos modificados e explicar a mudança em uma frase.

## Estado atual a confirmar

O líder deve verificar cada item diretamente no repositório:

- página principal em `app/(dashboard)/cortex/page.tsx`;
- grafo em `components/cortex/cortex-graph-client.tsx`;
- memórias persistentes em `components/cortex/cortex-chat-memories.tsx`;
- conversas e identidades em `components/cortex/cortex-conversation-archive.tsx`;
- APIs em `app/api/memory`, `app/api/cortex` e `app/api/conversations`;
- memória cognitiva em `lib/cognitive-memory`;
- arquivo de conversas em `services/conversation-memory`;
- persistência cognitiva baseada em arquivo JSON local;
- arquivo de conversas baseado em SQLite local;
- existência de testes em `tests/cognitive-memory.test.ts` e `tests/conversation-memory.test.ts`;
- navegação para o Cortex definida no shell do dashboard.

Se algum item estiver desatualizado, registrar a descoberta com caminho e linha antes de continuar.

## Princípios da refatoração

### Preservação de dados

Os dados existentes pertencem ao usuário. A refatoração deve manter:

- leitura dos arquivos já criados;
- nós semânticos e conexões;
- episódios;
- regras procedimentais;
- memórias persistentes e seus estados;
- conversas e mensagens;
- identidades observadas e seus vínculos;
- referências entre conversas e memórias derivadas.

Se uma mudança de esquema for indispensável, ela precisa ser aditiva, versionada, reversível quando possível e coberta por fixture representando dados anteriores.

### Clareza operacional

A interface deve responder de forma visível:

- o que o Cortex sabe;
- de onde esse conhecimento veio;
- qual é a confiança;
- quando foi atualizado;
- como está relacionado;
- o que está pendente de revisão;
- o que será afetado por editar, esquecer, excluir ou desvincular.

### Verdade dos estados

Cada seção deve diferenciar:

- carregando;
- carregado sem dados;
- carregado com dados;
- erro de rede ou API;
- atualização silenciosa;
- operação mutável em andamento;
- operação concluída;
- operação revertida após falha.

### Separação de responsabilidades

- componentes visuais não devem conhecer detalhes do armazenamento;
- hooks ou clientes devem concentrar chamadas às APIs;
- contratos compartilhados não devem ser duplicados em vários componentes;
- transformações e cálculos puros devem sair dos componentes quando puderem ser testados isoladamente;
- o grafo não deve misturar física, renderização, acesso à API, formulários e modais em um único bloco monolítico.

## Organização do teamwork

O líder deve criar os papéis abaixo. Se houver menos agentes disponíveis, executar os papéis sequencialmente, mantendo a separação conceitual.

### Agente 1 — Auditoria e arquitetura

Responsável por mapear o estado atual e definir os contratos da refatoração.

Tarefas:

1. Ler todos os arquivos do Cortex e APIs relacionadas.
2. Identificar funcionalidades existentes e caminhos de mutação.
3. Mapear contratos de request e response.
4. Identificar duplicação de tipos, estilos e lógica.
5. Mapear estados de loading, erro e vazio ausentes.
6. Verificar riscos de perda de dados e condições de corrida.
7. Avaliar tamanho e responsabilidades do componente do grafo.
8. Propor fronteiras de componentes, hooks e utilitários.
9. Criar um plano de migração incremental.

Entregável preferencial:

- `docs/cortex-refactor-architecture.md`
- tipos compartilhados estritamente necessários;
- testes de caracterização do comportamento atual antes da refatoração.

Não deve redesenhar a interface nem alterar o armazenamento nesta etapa.

### Agente 2 — APIs e contratos de dados

Começa após o Agente 1 publicar os contratos.

Responsável pelas rotas diretamente consumidas pelo Cortex.

Tarefas:

- padronizar respostas de sucesso e erro sem quebrar clientes existentes;
- validar query params e corpos mutáveis;
- manter códigos HTTP adequados;
- evitar que exceções virem falso estado vazio;
- preservar paginação e busca;
- garantir respostas consistentes para exclusão e edição;
- criar tipos compartilhados onde houver duplicação real;
- testar casos válidos, inválidos, ausentes e corrompidos;
- preservar atomicidade do JSON e integridade do SQLite;
- evitar exposição desnecessária de caminhos locais ou dados internos.

Propriedade preferencial:

- `app/api/memory/**`
- `app/api/cortex/**`
- `app/api/conversations/**`
- contratos compartilhados criados pelo Agente 1;
- testes focados das rotas.

Não deve alterar o layout do Cortex nem reescrever o motor de memória.

### Agente 3 — Grafo cognitivo

Pode trabalhar em paralelo com o Agente 2 após os contratos estarem definidos.

Responsável por decompor e melhorar o grafo sem remover funcionalidades.

Preservar:

- carregamento de nós e conexões;
- estatísticas;
- busca;
- seleção e inspeção;
- zoom e pan;
- arraste;
- criação, edição e exclusão de nó;
- feedback de episódio;
- criação, edição e exclusão de regra;
- timeline e configurações úteis já existentes.

Melhorar:

- separar tipos, layout, física, desenho e interação;
- extrair funções puras testáveis;
- respeitar `devicePixelRatio` sem distorcer hit testing;
- usar `ResizeObserver` ou solução equivalente para dimensionamento correto;
- pausar animação quando o documento ou painel estiver invisível;
- evitar recriar posições em todo polling silencioso;
- impedir loops de renderização desnecessários por closures antigas;
- preservar posição de nós existentes quando novos dados chegam;
- lidar com grafo vazio, um único nó, componentes desconectados e grafos grandes;
- melhorar contraste, foco, tooltip e painel de detalhes;
- adicionar filtros por tipo, confiança e atualização;
- manter controles compreensíveis para usuários não técnicos.

Propriedade preferencial:

- `components/cortex/cortex-graph-*`
- novos arquivos locais em `components/cortex/graph/`;
- utilitários puros relacionados ao grafo;
- testes focados de layout, filtros e interações.

Não deve modificar as regras de persistência ou componentes de conversas.

### Agente 4 — Memórias, conversas e identidades

Pode trabalhar em paralelo com o Agente 3 após os contratos estarem definidos.

Responsável por:

- memórias persistentes;
- arquivo de conversas;
- busca e filtros;
- detalhe da conversa;
- identidades observadas;
- confirmações destrutivas.

Memórias:

- pesquisa por conteúdo;
- filtro por escopo, status e origem;
- ordenação por atualização e confiança;
- destaque de `pending_review`;
- edição com estado de salvamento;
- esquecimento com atualização otimista reversível;
- mensagem de erro próxima da ação que falhou;
- preservação de todos os campos existentes.

Conversas:

- pesquisa textual;
- filtros por canal e período;
- lista e painel de detalhe responsivos;
- paginação ou carregamento incremental;
- preservação de Flow, Telegram e Discord;
- datas formatadas consistentemente;
- estado vazio diferente de erro;
- proteção contra resposta antiga sobrescrever busca recente.

Identidades:

- explicar canal, identificador e vínculo atual;
- vincular e desvincular com progresso visível;
- explicar o efeito sobre memórias derivadas;
- preservar a opção de esquecer dados derivados;
- não misturar identidades do Flow local com identidades externas quando isso confundir o usuário.

Ações destrutivas:

- substituir `window.confirm` por modal acessível;
- mostrar exatamente o item afetado;
- separar exclusão da conversa e esquecimento de memórias derivadas;
- desabilitar confirmação durante a requisição;
- manter o modal aberto e mostrar erro se a operação falhar;
- não remover o item da tela definitivamente antes da confirmação da API, salvo se houver rollback confiável.

Não deve modificar o canvas do grafo nem o armazenamento subjacente.

### Agente 5 — Shell da página, visão geral e integração visual

Começa quando as partes principais dos Agentes 3 e 4 estiverem estáveis.

Responsável por montar a experiência unificada.

Nova estrutura sugerida:

- `Visão geral`
- `Grafo`
- `Memórias`
- `Conversas`
- `Identidades`

A navegação pode usar abas, segmentos ou rotas internas, desde que:

- seja acessível por teclado;
- preserve estado relevante ao trocar de seção;
- funcione com janela estreita;
- permita link direto ou restauração da seção quando tecnicamente simples;
- não carregue e anime conteúdo pesado que não esteja visível;
- não quebre o atalho global que abre o Cortex.

Visão geral deve usar dados reais e mostrar somente indicadores úteis:

- quantidade de nós;
- quantidade de conexões;
- episódios;
- regras procedimentais;
- memórias persistentes;
- conversas e mensagens;
- identidades externas;
- jobs de consolidação pendentes;
- uso do orçamento de memória quente;
- tamanho do armazenamento local;
- última atualização;
- itens pendentes de revisão;
- alertas com ação possível.

Não adicionar funcionalidades comerciais ou indicadores estranhos ao domínio do Cortex.

### Agente 6 — Integração e QA

Começa depois dos commits dos demais agentes.

Responsável por:

- revisar divergências de contrato;
- integrar mudanças sem reescrever desnecessariamente o trabalho anterior;
- corrigir conflitos dentro do escopo;
- executar testes amplos;
- validar a interface real;
- testar reinício do Electron quando possível;
- comprovar preservação dos dados;
- produzir relatório final honesto.

Não deve aproveitar a etapa final para realizar redesign adicional ou expansão de escopo.

## Protocolo de coordenação

1. O líder registra `git status --short --branch` antes da equipe começar.
2. O líder publica o inventário factual e os riscos encontrados.
3. O Agente 1 define contratos e testes de caracterização.
4. Nenhum agente cria contratos concorrentes enquanto o Agente 1 estiver trabalhando.
5. Agentes 2, 3 e 4 recebem propriedade de arquivos separada.
6. O Agente 5 integra apenas depois que as superfícies internas estiverem estáveis.
7. O Agente 6 valida o conjunto completo.
8. Alteração em arquivo pertencente a outro agente exige aviso ao líder.
9. Um agente não deve sobrescrever silenciosamente mudanças de outro.
10. O líder mantém uma lista única de decisões, pendências, arquivos e commits.
11. Cada agente informa testes executados e testes não executados.
12. O líder não declara sucesso com base apenas em typecheck ou inspeção estática.

## Arquitetura de componentes desejada

A equipe deve confirmar os nomes finais, mas buscar uma separação equivalente a:

```text
components/cortex/
  cortex-shell.tsx
  cortex-overview.tsx
  cortex-navigation.tsx
  cortex-error-state.tsx
  cortex-empty-state.tsx
  cortex-confirm-dialog.tsx
  memories/
    cortex-memory-list.tsx
    cortex-memory-filters.tsx
    cortex-memory-editor.tsx
  conversations/
    cortex-conversation-list.tsx
    cortex-conversation-detail.tsx
    cortex-conversation-filters.tsx
    cortex-identities.tsx
  graph/
    cortex-graph.tsx
    cortex-graph-canvas.tsx
    cortex-graph-controls.tsx
    cortex-graph-details.tsx
    cortex-graph-layout.ts
    cortex-graph-renderer.ts
    cortex-graph-types.ts
```

Essa árvore é uma direção, não uma obrigação literal. Não fragmentar componentes pequenos sem ganho claro. O critério é separar responsabilidades e tornar lógica importante testável.

## Contratos de dados

Centralizar tipos compartilhados para:

- nó semântico;
- conexão semântica;
- episódio;
- regra procedimental;
- estatísticas do Cortex;
- memória persistente;
- conversa;
- mensagem arquivada;
- resultado de busca;
- identidade observada;
- estado de paginação;
- erro estruturado de API.

Regras:

- não duplicar interfaces incompatíveis entre componente e API;
- não retornar `any` quando o formato é conhecido;
- validar dados vindos de requests;
- normalizar datas em ISO na API e formatar somente na apresentação;
- manter compatibilidade com campos antigos;
- não expor campos internos sem uso na interface.

## Desempenho do grafo

O agente responsável deve medir ou demonstrar cada melhoria. Verificar:

- quantidade de chamadas durante polling;
- reconstrução das posições;
- quantidade de loops `requestAnimationFrame` ativos;
- comportamento ao alternar de seção;
- redimensionamento da janela;
- densidade de pixels do canvas;
- custo do cálculo de repulsão entre todos os pares;
- comportamento com centenas de nós;
- atualização de React dentro do loop de animação;
- listeners adicionados e removidos;
- timers corretamente cancelados no unmount.

Não adicionar otimização complexa sem um problema demonstrável. Para grafos grandes, priorizar degradação previsível, limite visual informado ou estrutura espacial simples antes de introduzir uma biblioteca pesada.

## Segurança e integridade

Validar explicitamente:

- escrita atômica da memória cognitiva;
- concorrência entre edições;
- rollback de atualização otimista;
- arquivo JSON ausente ou corrompido;
- banco SQLite ausente ou corrompido;
- parâmetros de busca inválidos;
- IDs inexistentes;
- exclusão repetida;
- resposta lenta chegando fora de ordem;
- duplo clique em ação mutável;
- falha durante vinculação de identidade;
- exclusão de conversa com e sem memórias derivadas;
- nenhum log contendo conteúdo completo desnecessariamente;
- nenhuma chamada externa nova com conteúdo privado.

## Acessibilidade

Exigir:

- elementos interativos semanticamente corretos;
- rótulos acessíveis;
- ordem de tabulação previsível;
- foco visível;
- retorno do foco após fechar modal;
- fechamento por `Escape` quando seguro;
- focus trap em diálogos modais;
- confirmação destrutiva claramente identificada;
- contraste suficiente;
- informação não transmitida apenas por cor;
- estados de carregamento anunciáveis;
- canvas acompanhado de alternativa textual ou lista navegável para os dados essenciais.

## Testes obrigatórios

### Caracterização

- registrar comportamento existente antes da refatoração;
- confirmar contratos atuais das APIs;
- usar fixtures com dados antigos;
- provar que operações já existentes continuam disponíveis.

### Grafo

- layout com zero, um e vários nós;
- componentes desconectados;
- preservação de posições;
- filtro por texto, tipo e confiança;
- cálculo de nó relacionado;
- resize e escala de pixels;
- montagem e desmontagem sem timer ou listener residual;
- atualização silenciosa sem reset indevido.

### Memórias

- carregamento e vazio;
- pesquisa e filtros;
- edição válida e inválida;
- esquecimento bem-sucedido;
- falha com rollback;
- estados `active`, `pending_review`, `superseded` e `rejected`;
- escopos existentes.

### Conversas

- lista e paginação;
- pesquisa por texto;
- filtros por canal e período;
- abrir detalhe;
- carregar mais;
- resposta fora de ordem;
- excluir com e sem dados derivados;
- falha de exclusão.

### Identidades

- lista de identidades externas;
- vínculo;
- desvínculo;
- esquecimento opcional de memórias derivadas;
- falha de API;
- prevenção de ação duplicada.

### Interface integrada

- navegação entre seções;
- preservação de estado;
- teclado;
- desktop;
- janela estreita;
- loading, empty, error e retry;
- atualização manual;
- polling apenas onde necessário.

### Regressão

- memória cognitiva continua legível e gravável;
- arquivo de conversas continua pesquisável;
- Flow continua podendo consultar o Cortex;
- Telegram e Discord continuam arquivando conversas;
- feedback de episódios continua funcionando;
- regras procedimentais continuam editáveis;
- build do Next.js;
- inicialização do Electron quando o ambiente permitir.

## Validação visual obrigatória

O Agente 6 deve abrir a aplicação e verificar a aba Cortex real, não apenas os componentes isolados.

Capturar evidência de:

- Visão geral;
- grafo vazio e populado, quando fixtures seguras permitirem;
- nó selecionado;
- filtros ativos;
- memórias com estados diferentes;
- conversa aberta;
- modal destrutivo;
- identidade vinculada e desvinculada;
- erro de API;
- viewport desktop;
- viewport estreito.

Verificar também console do navegador, overflow, texto truncado, elementos encobertos, foco, scroll interno e estabilidade durante polling.

Não chamar de validado no Electron se apenas o navegador foi testado.

## Comandos mínimos

Executar separadamente para manter a origem das falhas clara:

```powershell
npm.cmd run typecheck
npm.cmd run test:memory
npm.cmd run test:memory-archive
npm.cmd run lint
```

Criar e executar testes focados adicionais para Cortex, APIs e grafo. Rodar build e smoke do desktop conforme o risco e a disponibilidade do ambiente.

Se o lint completo falhar por problemas preexistentes, executar lint focado nos arquivos alterados e documentar separadamente a falha global. Não esconder falhas novas entre problemas antigos.

## Critérios de aceite

O trabalho somente pode ser considerado concluído quando:

- não foi adicionada nenhuma funcionalidade fora do domínio do Cortex;
- a página Cortex possui navegação clara entre suas áreas;
- todas as funções existentes continuam acessíveis;
- contratos de dados não estão duplicados de forma incompatível;
- o componente do grafo deixou de concentrar responsabilidades incompatíveis;
- animação e polling não continuam ativos sem necessidade;
- posições do grafo não são perdidas a cada atualização silenciosa;
- ações destrutivas utilizam confirmação acessível;
- erros não aparecem como listas vazias;
- requisições fora de ordem não sobrescrevem estado recente;
- dados existentes continuam compatíveis;
- nenhuma memória ou conversa é enviada a serviço externo novo;
- typecheck passa;
- testes focados passam;
- lint dos arquivos alterados passa;
- validação visual real é registrada;
- qualquer bloqueio de Electron é informado honestamente.

## Entrega final do líder

Apresentar:

1. Resultado efetivamente entregue.
2. Inventário do comportamento preservado.
3. Arquitetura anterior e nova arquitetura.
4. Relação de arquivos por agente.
5. Trechos exatos antes/depois das alterações relevantes.
6. Commits produzidos.
7. Comandos executados e resultados.
8. Evidências de validação no navegador.
9. Evidências separadas da validação no Electron.
10. Compatibilidade comprovada com dados antigos.
11. Problemas encontrados e não resolvidos.
12. Separação entre inspeção estática, teste automatizado e validação ponta a ponta.

Não encerrar com uma declaração genérica de sucesso. A conclusão deve dizer objetivamente o que foi validado, em qual ambiente e quais riscos permanecem.
