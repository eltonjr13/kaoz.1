# Cortex com MaleCNS — implementação

Data: 11/09/2026. Repositório: `D:\apps\mrchicken`.
Base de partida: `b872af7` (o plano citava `fc33afd`; a base avançou antes da execução).
Versão do app: `0.2.48`.

Este documento registra **decisões finais, reprodução e limitações**. Os
resultados medidos estão em [`CORTEX_MALECNS_AVALIACAO.md`](./CORTEX_MALECNS_AVALIACAO.md).

---

## 1. O que foi entregue

Um motor de reordenação de memórias cuja conectividade recorrente vem de um
**recorte real do MaleCNS v1.0**, integrado ao Cortex, com preparação
reproduzível, treino offline, inferência isolada, observabilidade e avaliação
comparativa contra controles de topologia.

O motor é um **modelo computacional com restrição anatômica**, não uma simulação
biofísica. O conectoma fornece a fiação; codificação de texto, dinâmica e
treinamento são decisões da Kaoz.

### Componentes

| Grupo | Arquivos |
| --- | --- |
| Contratos | `services/cortex-engine/cortex-engine.types.ts` |
| Configuração | `services/cortex-engine/cortex-engine.settings.ts` |
| Pacote | `services/cortex-engine/connectome-package.ts`, `engine-status.ts` |
| Codificação | `services/cortex-engine/text-encoder.ts`, `candidate-index.ts` |
| Numérico | `services/cortex-engine/sparse-reservoir.ts`, `readout.ts` |
| Worker | `services/cortex-engine/engine-worker.ts`, `engine-runtime.ts` |
| Coordenação | `services/cortex-engine/retrieval-service.ts` |
| Temporal | `services/cortex-engine/task-state.ts` |
| Evidências | `services/cortex-engine/trace-store.ts`, `authorization.ts` |
| Preparação | `scripts/cortex/prepare_malecns.py`, `requirements.txt` |
| Corpus/treino | `scripts/cortex/build_corpus.py`, `train_readout.py`, `run_evaluation.py` |
| Empacotamento | `scripts/cortex/build-worker.mjs` |
| Integração | `lib/cognitive-memory/chat/memory-selection.ts`, `services/cortex-engine/retrieval-context-adapter.ts`, `male-cns-selection.ts`, `agent-candidate-window.ts` |
| UI | `components/cortex/brain/{cortex-brain,brain-canvas,brain-trace-list,brain-trace-details,use-engine-data}` |
| APIs | `app/api/cortex/engine/{status,topology,traces,traces/[id],settings}` |
| Fixtures | `tests/fixtures/cortex-engine/{corpus.json,package/,trained/}` |
| Testes | `tests/cortex-engine-{package,numeric,scope,task-state,retrieval,integration,vertical-slice,agent-memory,worker,parity}.test.ts` |

---

## 2. Reprodução

```bash
# 1. Dependências de preparação (isoladas do Python do app)
pip install -r scripts/cortex/requirements.txt

# 2. Pacote derivado do dataset (baixa ~1,07 GB de insumos públicos)
npm run cortex:prepare

# 3. Corpus sintético de avaliação
npm run cortex:corpus

# 4. Treino + avaliação das variantes + readout instalado no pacote
npm run cortex:train

# 5. Worker JavaScript executável (obrigatório antes do desktop)
npm run cortex:build-worker
npm run cortex:verify-worker

# 6. Testes do motor
npm run test:cortex-engine
```

Variáveis de ambiente opcionais: `KAOZ1_CORTEX_PACKAGE_DIR` e
`KAOZ1_CORTEX_READOUT` trocam o local do pacote e do readout.

O **aplicativo instalado não exige Python, CUDA nem neuPrint**: o pacote e o
worker são artefatos prontos. O download pesado só ocorre no comando de
preparação, nunca na primeira mensagem, em import de módulo, em `next build` ou
em teste unitário.

---

## 3. Dataset e procedência

Fonte fixada: **`male-cns:v1.0`**, sob
`gs://flyem-male-cns/v1.0/connectome-data/flat-connectome/`.

- Licença **CC BY 4.0**, com atribuição embutida no pacote e exibida na interface.
- SHA-256 de cada insumo calculado localmente e gravado em `manifest.json`.
  Nenhum hash é fictício.
- `integrity.json` cobre os binários do próprio pacote e é conferido antes de
  carregar.

Berg et al. (2025), *Sexual dimorphism in the complete connectome of the
Drosophila male central nervous system*, DOI `10.1101/2025.10.09.680999`.

### Seleção do recorte

```
superclass == 'cb_intrinsic'  →  31.280 elegíveis (status 'Traced', type não vazio)
arestas induzidas             →  6.553.692
maior componente fortemente conectado  →  31.280 neurônios
ordenação por grau recorrente (desc, bodyId asc)  →  recorte final
```

| Métrica | Valor |
| --- | --- |
| Elegíveis | 31.280 |
| Arestas induzidas | 6.553.692 |
| Maior SCC | 31.280 |
| **Neurônios retidos** | **1.536** |
| **Arestas retidas** | **181.763** |
| Tipos celulares | 711 |
| Neurônios dimórficos | 119 |
| Faixa de peso | 1 – 1.878 (média 10,27) |

Determinismo verificado: duas execuções produziram **SHA-256 idênticos** para
`row-pointers.bin`, `column-indices.bin`, `weights.bin` e `geometry/positions.bin`.

O recorte é pequeno de propósito — é um **orçamento de engenharia**, não uma
dimensão do dataset. A interface diz explicitamente que é um recorte do cérebro
central, **não o CNS inteiro** e não uma simulação de todos os neurônios.

### Geometria

Vem de `somaLocation` (voxels de 8 nm), normalizado por eixo para `[0,1]`. Não é
necessário baixar morfologia nem volumes completos. A transformação está
registrada em `geometry/levels.json` e exibida na UI.

---

## 4. Decisões técnicas

### Dinâmica

```
h_next = (1 - alpha) * h + alpha * tanh(W @ h + P @ x + b)
```

- `W[destino, origem]`: do pré-sináptico ao pós-sináptico. **Verificado por teste
  de impulso** (`cortex-engine-package.test.ts`), que confirma que um impulso em
  uma origem ativa exatamente as linhas de destino que ela alimenta.
- `W` deriva das contagens de conexões, normalizadas por linha para ganho
  absoluto ≤ 0,9 (estabilidade). **Contagem de sinapses não é força fisiológica.**
- `P` é projeção esparsa determinística com seed reconstruída do manifesto —
  não é persistida, e a mesma seed reconstrói os mesmos pesos.
- Pesos não negativos; nenhum neurotransmissor foi inventado.
- `alpha = 0,5`, 6 passos por codificação. Fixados e escolhidos em validação.
- NaN/Infinity são detectados e **nunca** produzem ranking parcial silencioso.

### Codificação

Encoder lexical determinístico de 64 dimensões (palavras + n-gramas de 3–4
caracteres), sem dependência de rede e sem vocabulário persistido. Está
claramente rotulado: **não** justifica alegar recuperação semântica robusta, e é
uma das causas prováveis do resultado medido (ver limitações).

### Worker

`worker_threads` com `terminate()` real no estouro de deadline. `Promise.race`
sem parar a computação não atende ao requisito. Fila limitada (padrão 64)
recusa trabalho em vez de acumular. Compilado para `.mjs` por
`scripts/cortex/build-worker.mjs`, que percorre o grafo de módulos e transpila
com a API do compilador TypeScript já presente no projeto — sem bundler externo.
Verificado rodando a partir de uma cópia isolada em diretório temporário.

### Modos e fallback

| Modo | Efeito no contexto | Observabilidade |
| --- | --- | --- |
| `legacy` | Caminho anterior | Não inicializa a rede |
| `shadow` | Resultado anterior permanece | Variante processa cópia isolada e registra |
| `malecns` | Novo ranking quando válido | Registra caminho efetivo |

`useCortexMemory=false` prevalece sobre todos os modos. Desligar o Cortex
**não** ativa "legacy memory": mantém a semântica atual de memória desligada e
descarta o estado derivado.

Fallback cobre pacote ausente, checksum divergente, dimensão incompatível,
timeout, worker encerrado, NaN e fila cheia — cada um com motivo próprio no
trace. O trace **não** diz "MaleCNS processou" quando o fallback respondeu.

### Memória de trabalho

Estado explícito (objetivo, restrições, artefato aprovado, correções) +
estado derivado (vetor). Chave: perfil + sessão + projeto + avatar + canal + tarefa.
A tarefa vem **por último** de propósito, para que a chave base seja prefixo
literal da chave completa.

API de descarte separada por intenção, porque a semântica estava ambígua:

- `discardTask(scope)` — uma tarefa, sem tocar nas irmãs;
- `discardDerivedBase(scope)` — todas as tarefas do escopo-base (troca de projeto/reset);
- `discardAllDerived()` — tudo (Cortex desligado).

### Observabilidade

Trace mínimo com ID da requisição, chave de escopo resolvida no servidor, versão
do modelo, engine efetivo, IDs candidatos e selecionados, tempos e fallback.
Atividade é **amostrada e limitada**; matrizes inteiras não são persistidas.
Texto de conversa não entra no trace: detalhes são resolvidos por IDs e
autorização atual, e dados excluídos deixam de estar acessíveis.

### Empacotamento

Novos dados sob `path.join(getLocalDataDir(), 'cortex-engine')` — nunca em
`resources/`, `app.asar` ou `public/`. Escritas atômicas com temporário único e
rename. Aliases `KAOZ1_*` / `MRCHICKEN_*` preservados.

---

### Integração no caminho real (chat / Flow)

A integração separa três responsabilidades, para que o motor participe apenas
do RANKING:

| Responsabilidade | Onde vive |
| --- | --- |
| COLETA de elegíveis | `ChatMemoryService.buildPromptContext` (inalterado) |
| RANKING | estratégia injetável: motor MaleCNS ou caminho anterior |
| MONTAGEM do contexto | `buildPromptContext` (inalterado) |

- `lib/cognitive-memory/chat/memory-selection.ts` define o contrato
  `MemorySelectionStrategy`. Fica em `lib/` para que `lib/` não dependa de
  `services/`.
- `services/cortex-engine/retrieval-context-adapter.ts` converte registros em
  candidatos, resolve o escopo **no servidor** e constrói o runtime apenas
  quando o modo não é `legacy`.
- `services/cortex-engine/male-cns-selection.ts` implementa a estratégia e
  devolve `null` sempre que o motor NÃO participou.

**Regra que garante segurança de comportamento:** a estratégia devolve `null`
em modo `legacy`, em `shadow`, em fallback e em contexto imediato. Com `null`,
`ChatMemoryService` executa seu caminho anterior sem alteração — o que torna
`shadow` e fallback incapazes de mudar o contexto entregue.

`/api/flow/chat` passou a propagar `projectId`, `avatarId` e `taskId` (escopo),
registra o evento do turno no estado temporal (`user-request` ou
`explicit-correction`) e propaga o `traceId` no log. A identidade continua sendo
resolvida no servidor; o cliente nunca define `profileId`.

### Memória dos agentes — o defeito de ordem

O plano apontava (seção 3): *"o adapter dos agentes seleciona episódios recentes
antes de aplicar alguns filtros"*. Confirmado em
`services/agents/memory/memory-manager.adapter.ts`: `getRecentEpisodes(limit)`
cortava a janela **dentro da própria recuperação**, e só depois vinham os filtros
de escopo e de valor. Um episódio elegível fora do top-N recente — outro projeto
dominando a lista, por exemplo — nunca era considerado.

Corrigido para **recuperar → filtrar → cortar**, com a regra isolada em
`services/cortex-engine/agent-candidate-window.ts` (módulo puro). Dois pontos
deliberados:

1. **A ampliação vale para todas as variantes**, inclusive a linha de base
   convencional. Sem isso, qualquer melhoria medida seria atribuída ao motor
   quando na verdade veio do aumento de candidatos — exatamente o erro que o
   plano manda evitar.
2. **`getEligibleMemories` expõe a lista sem o corte final**, para que um
   reranker possa reordenar antes do corte (um reranker não recupera documentos
   que nunca chegaram à lista).

O motor MaleCNS **ainda não está ligado** a este caminho: o que foi corrigido é o
defeito de ordem que o plano identificou como pré-requisito. Ligar o reranker
aqui é o trabalho seguinte.

### Desvios do plano, com motivo

| Item do plano | O que foi feito | Por quê |
| --- | --- | --- |
| Worker demonstrado em `standalone` e no pacote Windows | Worker compilado e validado a partir de cópia isolada em diretório temporário | Substitui parcialmente a verificação no app empacotado, que **não foi executada** |
| Integração no `app/api/flow/agent/route.ts` e nos adapters dos agentes | Não feita | Só o caminho de CHAT foi integrado; ver limitações |
| Telegram / Discord | Não ligados | O plano exige medir e mostrar status por canal antes de anunciar cobertura; não foi feito |
| Encoder semântico multilíngue | Não implementado | O plano permite começar pelo lexical para validar contratos |
| SSE dedicado | Não adicionado | O plano recomenda não adicionar SSE só para animar o cérebro; polling com cancelamento atende |
| Estado temporal alimentado por artefato aprovado / etapa concluída | Não ligado | Os eventos disponíveis no caminho do chat são pedido do usuário e correção; os demais exigem os hooks de artefato e de execução |

---

## 6. Limitações conhecidas

1. **A hipótese não se confirmou nesta entrega.** O ganho ficou abaixo do alvo e
   o intervalo de confiança da diferença inclui zero. Detalhes e números em
   `CORTEX_MALECNS_AVALIACAO.md`. Por isso o **modo padrão permanece `legacy`**.
2. **A integração cobre o caminho de CHAT, não o de agentes nem os canais
   externos.** `app/api/flow/agent/route.ts`, os adapters de memória dos agentes
   e as entradas de Telegram/Discord continuam sem o motor. A matriz de cobertura
   da seção 14.4 do plano (`Fase 4`) não foi produzida.
3. **Nenhuma validação em navegador nem no app Windows empacotado foi
   executada.** Os componentes de UI existem e compilam, mas nunca foram
   renderizados. Larguras de 390/768/1280 px não foram verificadas.
4. **O corpus é sintético e pequeno** (325 consultas). Os intervalos de confiança
   são largos e o poder estatístico é limitado — os limiares de promoção não
   foram atingidos nem rejeitados com folga.
5. **O encoder lexical é a explicação mais provável do resultado.** Um hash de 64
   dimensões não tem semântica: dois textos sobre projetos diferentes viram
   vetores quase ortogonais por acidente. Enquanto isso não for trocado por um
   encoder semântico local, o teste do conectoma não é justo.
6. **O estado derivado ignora tokens com 2 caracteres ou menos.** Conteúdo muito
   curto pode produzir vetor nulo. Não afeta o isolamento por escopo, mas reduz a
   fidelidade do estado temporal.
7. **Os pesos de saída foram treinados com uma única partição congelada.** Cinco
   seeds foram usadas para o readout, mas o conjunto de teste é pequeno.
8. **A geolocalização dos nós é só o soma**, não a morfologia. A anatomia exibida
   é uma nuvem de somas reais, não o volume do neurônio.
9. **O cliente do Flow ainda não envia `projectId`/`avatarId`/`taskId`.** A rota
   aceita e propaga esses campos, mas sem eles o escopo fica com os campos
   marcados como ausentes e o estado temporal não é alimentado. Ligar o envio no
   cliente é trabalho pendente.

---

## 7. Falhas preexistentes de lint (não introduzidas aqui)

Confirmadas em `HEAD` com `git stash` sobre os arquivos, todas no limiar
`complexity: ["error", 10]` de `eslint.config.mjs`:

| Arquivo | Função | Complexidade |
| --- | --- | --- |
| `components/cortex/cortex-identities.tsx` | `CortexIdentities` e dois handlers | 14, 14, 15 |
| `components/cortex/cortex-overview.tsx` | `CortexOverview` e um handler | 52, 12 |
| `components/cortex/cortex-ui-states.tsx` | `CortexStorageHealthPill` | 17 |

Não foram alteradas: o plano proíbe mexer fora da dependência comprovada desta
integração. `components/cortex/cortex-navigation.tsx` **foi** alterado (nova
seção Cérebro) e teve sua complexidade **reduzida** de 17 para dentro do limite,
extraindo `resolveNextIndex`.
