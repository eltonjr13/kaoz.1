# Teamwork Preview — Faturamento e evolução do Cortex

## Missão

Planejar, implementar e validar uma fundação de faturamento para o Kaoz.1 e transformar a aba Cortex em uma central clara de memória, identidade, consumo e plano.

O produto é um aplicativo Windows/Electron com Next.js, atualmente local-first e funcional sem login. A implementação deve preservar esse comportamento, os dados existentes e a privacidade do usuário.

Este documento é o briefing mestre para execução pela opção `teamwork-preview` do Antigravity. O líder da equipe deve decompor o trabalho entre agentes especializados, coordenar dependências e entregar uma integração única. Nenhum agente deve interpretar este documento como autorização para inventar decisões comerciais.

## Resultado esperado

Ao final, o projeto deverá ter:

1. Um domínio de billing centralizado e testável.
2. Uma fronteira segura para um backend remoto de faturamento.
3. Entitlements e limites aplicados também no backend local, não apenas na interface.
4. Medição idempotente de uso, sem enviar conteúdo privado do Cortex.
5. Uma aba Cortex reorganizada em seções claras e responsivas.
6. Uma área `Plano e uso` que apresente somente dados reais.
7. Compatibilidade com o modo local atual quando billing não estiver configurado.
8. Testes, documentação e evidências honestas do que foi ou não validado.

## Regras globais obrigatórias

- Ler o `AGENTS.md` antes de qualquer alteração.
- Inspecionar o código atual antes de propor arquitetura ou editar arquivos.
- Preservar alterações preexistentes do usuário e não incluir arquivos alheios nos commits.
- Não inventar preços, descontos, trials, benefícios, product IDs, price IDs, URLs, chaves ou configurações externas.
- Não instalar Supabase, Stripe ou outro SDK antes de confirmar que essa é a infraestrutura escolhida.
- Não simular pagamento aprovado nem apresentar mocks como integração real.
- Não colocar secret keys no Electron, bundle do Next.js, armazenamento local ou variáveis públicas.
- Não enviar prompts, mensagens, memórias, arquivos, nomes de projetos ou conteúdo gerado ao backend de billing.
- Ler, pesquisar, exportar e excluir dados pessoais do Cortex deve permanecer disponível independentemente do plano.
- Falhas de billing nunca podem apagar ou corromper dados locais.
- Não espalhar condicionais de plano pela aplicação. Toda decisão deve passar por uma política central de entitlements.
- Bloqueios devem existir no ponto real de início da operação, além da representação visual na UI.
- Operações de consumo precisam ser idempotentes e seguras sob concorrência.
- Trabalhar com mudanças pequenas e revisáveis.
- Usar a configuração de ESLint efetivamente adotada pelo projeto e alterar somente essa configuração se isso for realmente necessário.
- Rodar `npm.cmd` no Windows.
- Cada agente que modificar código deve criar um commit Conventional Commits criativo, conciso e específico para sua alteração.
- Antes de cada commit, confirmar por `git status --short` quais arquivos entrarão nele.
- Ao finalizar cada tarefa, mostrar o trecho exato antes/depois, listar arquivos modificados e resumir a mudança em uma frase.

## Estado atual a confirmar

O líder deve verificar, sem assumir que esta lista continua exata:

- O Cortex está em `app/(dashboard)/cortex/page.tsx`.
- O grafo está em `components/cortex/cortex-graph-client.tsx`.
- Memórias persistentes estão em `components/cortex/cortex-chat-memories.tsx`.
- O arquivo de conversas e identidades está em `components/cortex/cortex-conversation-archive.tsx`.
- Memória cognitiva é persistida localmente por `lib/cognitive-memory`.
- Conversas são armazenadas localmente por `services/conversation-memory`.
- O dashboard ainda se identifica como modo funcional sem login.
- Não há fundação completa de conta, assinatura, checkout, portal do cliente, webhook e entitlement.

Se qualquer item estiver desatualizado, registrar a evidência correta no relatório da equipe antes de continuar.

## Decisões de produto que não podem ser inventadas

Criar marcadores explícitos para estas decisões caso o usuário ainda não as tenha fornecido:

- provedor de pagamentos;
- backend remoto responsável por clientes e assinaturas;
- método de autenticação;
- preços e moeda;
- periodicidade mensal, anual ou ambas;
- duração e regras de trial;
- limites de cada plano;
- política de tolerância offline;
- quais operações são cobradas pelo Kaoz.1;
- diferença comercial entre uso BYOK e uso pago pelo Kaoz.1;
- política de cancelamento, reembolso e inadimplência.

Ausência dessas decisões não deve bloquear a criação dos contratos internos e da UI de estado `não configurado`, mas deve impedir checkout real, webhook real e catálogo com valores fictícios.

## Arquitetura obrigatória

### Autoridade de faturamento

O backend remoto será a fonte de verdade para:

- cliente;
- assinatura;
- situação do pagamento;
- plano contratado;
- limites comerciais;
- eventos processados pelo provedor;
- emissão e revogação de entitlements.

O aplicativo desktop armazenará apenas o mínimo necessário para operar, incluindo uma concessão de entitlement assinada, com emissão, expiração, versão e identificador de sujeito. A aplicação deve validar essa concessão sem possuir a chave privada usada para assiná-la.

### Modo local

Quando billing não estiver configurado:

- o aplicativo deve iniciar normalmente;
- os dados locais devem continuar acessíveis;
- a área `Plano e uso` deve dizer claramente `Faturamento não configurado`;
- endpoints de checkout e portal devem retornar erro estável e compreensível;
- nenhuma assinatura ou consumo fictício deve aparecer;
- funcionalidades classificadas como sempre disponíveis devem funcionar.

### Privacidade

O backend poderá receber somente identificadores técnicos e métricas mínimas, por exemplo:

- sujeito/conta;
- código da funcionalidade;
- unidade consumida;
- chave de idempotência;
- horário do evento;
- resultado técnico;
- versão do aplicativo.

Não poderá receber o conteúdo que originou a operação.

### BYOK

Quando o usuário usa a própria credencial de um provedor de IA:

- o custo externo não deve ser apresentado como receita ou cobrança do Kaoz.1;
- a atividade pode ser registrada para limites de produto somente se a política comercial determinar isso;
- a interface deve distinguir claramente `uso do produto` de `custo do provedor externo`.

## Organização do teamwork

O líder deve criar os seguintes papéis. Se houver menos agentes disponíveis, executar os papéis em sequência sem fundi-los conceitualmente.

### Agente 1 — Arquitetura e contratos

Responsável por:

- inventário factual da arquitetura atual;
- catálogo de planos sem preços inventados;
- tipos de billing, entitlement, limite, consumo e concessão offline;
- política central de autorização;
- interface para o backend remoto;
- documento de arquitetura;
- testes unitários do domínio.

Propriedade preferencial:

- `services/billing/billing.types.ts`
- `services/billing/plan-catalog.ts`
- `services/billing/entitlement-policy.ts`
- `services/billing/billing-provider.ts`
- `tests/billing-policy.test.ts`
- `docs/billing-cortex-architecture.md`

Não deve alterar a UI do Cortex nem integrar checkout real.

### Agente 2 — Backend local e concessão offline

Começa somente depois da aprovação dos contratos do Agente 1.

Responsável por:

- cliente HTTP do backend remoto;
- cache local atômico de entitlement;
- validação de assinatura da concessão offline;
- sincronização manual e periódica com backoff;
- estados de indisponibilidade e expiração;
- rotas locais de status, sincronização, checkout e portal;
- testes de segurança e falha.

Rotas esperadas:

- `GET /api/billing/status`
- `POST /api/billing/sync`
- `POST /api/billing/checkout-session`
- `POST /api/billing/customer-portal`

Se o backend remoto ou provedor não estiver definido, deve implementar a fronteira, o estado não configurado e os testes correspondentes. Não deve fabricar respostas de sucesso.

### Agente 3 — Experiência Cortex

Pode trabalhar em paralelo com o Agente 2 depois que o contrato de `GET /api/billing/status` estiver estável.

Responsável exclusivamente pela experiência do Cortex:

- divisão da página em seções navegáveis;
- estados de carregamento, vazio, erro e retry;
- acessibilidade;
- responsividade;
- desempenho do grafo;
- integração visual com o contrato de billing;
- preservação integral das operações atuais.

Não deve editar a política de entitlements, o medidor de uso ou rotas de execução.

### Agente 4 — Medição e feature gates

Começa depois dos contratos do Agente 1 e utiliza a implementação do Agente 2.

Responsável por:

- localizar todos os pontos reais de início e término de operações custosas;
- reserva, confirmação e reversão de consumo;
- idempotência;
- concorrência;
- fila local de eventos;
- sincronização de métricas mínimas;
- enforcement no serviço/rota;
- testes de corrida, retry, cancelamento e offline.

Não deve modificar o layout do Cortex.

### Agente 5 — Integração e QA

Começa quando os demais agentes concluírem seus commits.

Responsável por:

- revisar conflitos e contratos divergentes;
- integrar sem reescrever desnecessariamente o trabalho anterior;
- executar testes amplos;
- validar a UI real;
- testar reinício do Electron quando o ambiente permitir;
- documentar riscos e bloqueios de produção;
- corrigir apenas falhas diretamente relacionadas ao escopo.

## Protocolo de coordenação

1. O líder realiza o inventário e publica um resumo factual para a equipe.
2. O Agente 1 define os contratos compartilhados.
3. Nenhum outro agente cria tipos concorrentes antes do contrato ser aceito.
4. Agentes 2 e 3 podem trabalhar em paralelo com propriedade de arquivos separada.
5. O Agente 4 integra os gates somente após a política central existir.
6. O Agente 5 revisa e valida o conjunto completo.
7. Alterações em arquivos pertencentes a outro agente exigem aviso ao líder.
8. Um agente não deve corrigir silenciosamente o trabalho de outro; deve registrar a incompatibilidade e alinhar o contrato.
9. O líder mantém uma lista única de decisões, pendências e evidências.
10. A equipe não declara conclusão enquanto houver teste obrigatório falhando ou integração crítica baseada apenas em mock.

## Contrato funcional mínimo de billing

Modelar pelo menos:

- `PlanId`: `free`, `pro`, `studio`;
- `SubscriptionStatus`: `not_configured`, `trialing`, `active`, `past_due`, `canceling`, `canceled`, `expired`, `invalid`;
- catálogo de funcionalidades com códigos estáveis;
- limite por funcionalidade e período;
- consumo confirmado e reservado;
- início e término do período;
- renovação e cancelamento agendado;
- origem dos dados;
- última sincronização;
- concessão offline assinada;
- motivo estruturado de negação;
- versão do contrato.

O catálogo inicial não deve associar preços. A matriz de funcionalidades deve classificar cada item como:

- sempre disponível;
- limitado por quantidade;
- exclusivo de plano;
- apenas informativo.

## Estrutura da nova aba Cortex

### Visão geral

Mostrar métricas úteis e acionáveis:

- nós semânticos;
- conexões;
- episódios;
- regras procedimentais;
- memórias persistentes;
- conversas arquivadas;
- memórias pendentes de revisão;
- confiança média;
- tamanho do banco local;
- uso do orçamento de memória quente;
- última atualização;
- alertas que indiquem uma ação possível.

Não criar cards decorativos ou indicadores sem fonte real.

### Grafo

Preservar:

- busca;
- seleção de nós;
- criação, edição e exclusão;
- feedback;
- regras procedimentais;
- zoom, pan e reposicionamento.

Melhorar:

- filtros por tipo, confiança e data;
- legibilidade;
- painel de detalhes;
- responsividade;
- suporte a `devicePixelRatio`;
- pausa de animação quando invisível;
- preservação de posição durante atualizações silenciosas;
- comportamento com grafo vazio ou muito grande.

### Memórias

Adicionar:

- pesquisa;
- filtros por escopo, status e origem;
- ordenação;
- destaque de `pending_review`;
- edição segura;
- ação de esquecer com confirmação acessível;
- estados claros de erro e retry.

Preservar todos os campos e estados já suportados.

### Conversas

Manter e aprimorar:

- busca textual;
- filtros por canal e período;
- lista e detalhe;
- carregamento incremental;
- Flow, Telegram e Discord;
- exclusão opcional das memórias derivadas.

Substituir `window.confirm` por modal acessível e deixar explícita a diferença entre apagar a conversa e apagar conhecimentos derivados.

### Identidades

Explicar de forma compreensível:

- qual identidade foi observada;
- canal de origem;
- vínculo com o usuário local;
- efeito de vincular ou desvincular;
- opção separada para esquecer memórias derivadas.

### Plano e uso

Consumir somente dados reais das APIs de billing e mostrar:

- plano atual;
- status;
- período;
- renovação ou cancelamento;
- limites;
- uso confirmado e reservado;
- horário da última sincronização;
- estado offline;
- ações de sincronizar, assinar e gerenciar assinatura.

Se não houver infraestrutura configurada, mostrar o estado correspondente. Não gerar faturas, histórico, preços ou consumo fictícios.

## Medição e controle de consumo

Para cada operação potencialmente limitada:

1. Gerar ou receber uma chave de idempotência.
2. Consultar a política central.
3. Reservar a unidade antes de iniciar trabalho caro.
4. Iniciar a operação somente após a reserva.
5. Confirmar o consumo no ponto definido pela política.
6. Reverter a reserva quando a falha ocorrer antes do ponto faturável.
7. Registrar cancelamentos sem duplicar eventos.
8. Sincronizar apenas metadados mínimos.

Cobrir no mínimo:

- execução de agentes;
- geração de imagens;
- geração de vídeos;
- Sketch;
- renderização/exportação;
- automações;
- operações via conectores, quando aplicável.

O inventário deve diferenciar tentativa, reserva, execução, sucesso, falha e entrega. A equipe não deve escolher arbitrariamente qual etapa consome uma unidade.

## Segurança

Validar explicitamente:

- ausência de segredos no bundle;
- assinatura inválida ou adulterada;
- cache ausente ou corrompido;
- entitlement expirado;
- relógio local incorreto;
- replay de concessão antiga;
- resposta remota 401, 403, 404, 409, 429 e 500;
- timeout e ausência de rede;
- duas operações simultâneas disputando a última unidade;
- retry com a mesma chave;
- troca de plano durante execução;
- cancelamento agendado;
- logs sem credenciais ou conteúdo privado.

O aplicativo local pode ser adulterado por um usuário avançado. O relatório final deve distinguir proteção de UX, proteção local e garantias reais oferecidas pelo backend remoto.

## Testes obrigatórios

### Domínio

- plano conhecido e desconhecido;
- entitlement permitido e negado;
- limite ilimitado, disponível e esgotado;
- concessão válida, expirada, adulterada e incompatível;
- status de assinatura;
- modo não configurado.

### Medição

- reserva e confirmação;
- reversão;
- idempotência;
- retry;
- concorrência;
- cancelamento;
- falha antes e depois do ponto faturável;
- sincronização duplicada;
- BYOK.

### APIs

- respostas e códigos estáveis;
- payload inválido;
- backend ausente;
- timeout;
- autenticação inválida;
- cache disponível durante indisponibilidade remota.

### Cortex

- carregamento, vazio, erro e retry em todas as seções;
- navegação por teclado;
- desktop e viewport estreito;
- grafo vazio e populado;
- filtros;
- edição e exclusão;
- confirmação destrutiva;
- plano não configurado, ativo, atrasado, cancelando e offline.

### Regressão

- dados atuais continuam legíveis;
- aplicativo inicia sem billing;
- memória cognitiva continua funcionando;
- arquivo de conversas continua pesquisável;
- fluxos existentes não pagos não são bloqueados;
- build Next.js;
- preparação/smoke do Electron quando o ambiente suportar.

## Comandos mínimos de validação

Executar de forma separada para que um timeout não esconda a origem do problema:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:memory
npm.cmd run test:memory-archive
```

Adicionar e executar scripts focados de billing criados pela equipe. Rodar build e testes adicionais proporcionais aos arquivos tocados. Se algum teste não puder ser executado, informar o comando, o bloqueio e o que permaneceu sem comprovação.

## Critérios de aceite

O trabalho somente pode ser considerado concluído quando:

- existe uma única política central de entitlement;
- nenhuma chave secreta é distribuída no desktop;
- não há assinatura fictícia em modo não configurado;
- o enforcement ocorre fora da UI;
- concorrência e idempotência possuem testes;
- o Cortex preserva todos os dados e operações existentes;
- `Plano e uso` diferencia consumo do Kaoz.1 e custo BYOK;
- conteúdo privado não é enviado ao backend;
- a aplicação inicia e permite acesso aos dados locais sem billing;
- typecheck e testes focados passam;
- lint dos arquivos alterados passa;
- validação visual real foi realizada ou declarada como pendente;
- checkout e webhook somente são chamados de funcionais se validados contra infraestrutura real;
- todas as limitações restantes estão documentadas.

## Entrega final do líder

Apresentar:

1. Resumo do resultado efetivamente entregue.
2. Diagrama curto do fluxo `aplicativo → backend de billing → provedor de pagamento`.
3. Matriz de planos, funcionalidades e limites, deixando valores não decididos como pendentes.
4. Relação de arquivos criados e modificados por agente.
5. Trechos exatos antes/depois das alterações relevantes.
6. Commits produzidos por cada frente.
7. Comandos executados e respectivos resultados.
8. Cenários validados no navegador e no Electron.
9. Evidências de que dados existentes foram preservados.
10. Itens que ainda dependem de conta, segredo, webhook, infraestrutura ou decisão comercial.
11. Separação explícita entre testes estáticos, mocks e validação ponta a ponta real.

Não encerrar com uma alegação genérica de sucesso. A conclusão deve dizer objetivamente o que está pronto para produção, o que está pronto apenas no código e o que continua bloqueado.
