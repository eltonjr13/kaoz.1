# Cortex com MaleCNS — avaliação

Data: 11/09/2026. Gerado por `npm run cortex:train`.
Relatório bruto: `tests/fixtures/cortex-engine/trained/report.json`.

> **Conclusão: o `legacy` permanece como modo padrão.** A hipótese não se
> confirmou dentro dos critérios do plano. O recurso fica integrado e acessível
> como experimental, com estes resultados publicados.

---

## 1. Variantes avaliadas

Corpus sintético congelado de **325 consultas** (meta: ≥300) em 13 famílias,
34 memórias, 60 sequências de 5–15 eventos (603 eventos). Partições por família
de cenário, de modo que paráfrases da mesma memória nunca se separam:
treino 145 · validação 95 · teste 85.

| Variante | Descrição |
| --- | --- |
| A | linha de base convencional |
| B | busca híbrida + scorer convencional |
| C | conectividade **reconfigurada** (controle de topologia) |
| D | **MaleCNS** sem estado temporal |
| E | MaleCNS com estado temporal |
| F | estado temporal convencional (controle de E) |

Cinco seeds (11, 23, 37, 59, 71) por variante; hiperparâmetro escolhido em
validação; conjunto de teste nunca orientou escolha.

---

## 2. Resultados

### nDCG@8 no teste (k=8, ganho 2 = essencial, 1 = útil)

| Variante | nDCG@8 | IC 95% | Recall@8 | MRR | Mistura de projeto no top-8 |
| --- | --- | --- | --- | --- | --- |
| A — convencional | 0,8691 | [0,8390 – 0,8969] | 0,7765 | 0,3554 | 2,235 |
| B — híbrida | 0,8691 | [0,8390 – 0,8969] | 0,7765 | 0,3554 | 2,235 |
| C — topologia reconfigurada | 0,8739 | [0,8464 – 0,9002] | 0,7882 | 0,3513 | 2,235 |
| **D — MaleCNS** | **0,8782** | [0,8515 – 0,9032] | 0,7882 | 0,3403 | 2,176 |
| E — MaleCNS + estado | 0,8782 | [0,8515 – 0,9032] | 0,7882 | 0,3403 | 2,176 |
| F — estado convencional | 0,8691 | [0,8390 – 0,8969] | 0,7765 | 0,3554 | 2,235 |

`Recall@128` dos candidatos **antes** do reranking: **0,8000** (IC 95%
[0,6163 – 0,9535]). Sem isso, nenhuma conclusão de reranking seria legítima.

Ressurreição de memória obsoleta: **0 em todas as variantes**.

### Diferenças pareadas por cenário (o que decide a promoção)

| Comparação | Diferença | IC 95% da diferença |
| --- | --- | --- |
| D vs A (melhor convencional) | **+0,0091** | **[−0,0012 – +0,0113]** |
| D vs C (controle de topologia) | +0,0047 | [−0,0020 – +0,0113] |

### Diagnóstico: só as features do conectoma

| Conjunto | nDCG@8 | Recall@8 | MRR | Mistura de projeto |
| --- | --- | --- | --- | --- |
| Apenas `state-cosine`, `state-distance`, `query-state-dot`, `readout-energy` | 0,5825 | 0,4471 | 0,2762 | 4,318 |
| Baseline aleatório sobre o mesmo corpus | ≈0,4444 | — | — | — |

---

## 3. Critérios de promoção do plano

| # | Critério | Resultado |
| --- | --- | --- |
| 1 | Zero falhas nos testes determinísticos de isolamento, flag desligada, exclusão, precedência e autorização | ✅ **84/84** passam |
| 2 | Ganho ≥ **+0,03** absoluto em nDCG@8, com limite inferior do IC 95% acima de zero | ❌ ganho **+0,0091**; limite inferior **−0,0012** |
| 3 | Sem regressão material em evidências essenciais | ✅ Recall@8 subiu de 0,7765 para 0,7882 |
| 4 | Vantagem consistente frente ao controle de topologia reconfigurada | ❌ IC [−0,0020 – +0,0113] inclui zero |
| 5 | Promover E sobre D com ganho em sequências | ➖ E = D exatamente; sem ganho demonstrado |
| 6 | Overhead p95 ≤ 150 ms, RSS ≤ 200 MB | ⚠️ **não medido** — sem instrumentação de RSS/p95 |

**Decisão: manter `legacy` como padrão.** O recurso fica integrado e acessível
como experimental.

---

## 4. O que mudou — e por quê isso importa

A primeira rodada de avaliação foi feita com um **bug de paridade**: o gerador
`mulberry32` em Python não reproduzia o do TypeScript. Encontrei a divergência
(0,46 no vetor da consulta), corrigi e validei contra o Node em cinco seeds.

O efeito da correção foi material e vale registrar, porque inverte a leitura:

| Métrica | Antes do conserto | Depois |
| --- | --- | --- |
| A — convencional | 0,8925 | 0,8691 |
| C — topologia reconfigurada | 0,8899 | 0,8739 |
| **D — MaleCNS** | **0,8821** | **0,8782** |
| Ganho D vs A | **−0,0103** | **+0,0091** |
| Vencedor | A | **D** |
| Diagnóstico só-conectoma | 0,4466 (≈ aleatório) | **0,5825** |

Antes: o conectoma parecia inútil (0,4466 vs 0,4444 do aleatório).
Depois: **as features de estado carregam sinal real** — 0,5825 contra 0,4444 do
aleatório é um ganho substancial, e D passa a liderar as seis variantes.

Ou seja: a conclusão anterior de "a rede não distingue nada" era artefato do bug,
não do conectoma. Corrigido, a direção muda — mas ainda **não** é suficiente para
promover, porque o intervalo de confiança atravessa zero.

Após a correção, o teste de paridade Python↔JS passa **5/5**: o readout treinado
em Python é reproduzido pelo runtime JavaScript dentro de 1e-5.

### Onde o MaleCNS ajuda (por cenário)

Maiores ganhos de D sobre A, consistentes e acima de 0,03:

- `soundtrack:proj-marola` — 0,822 → **0,924** (+0,102)
- `soundtrack:proj-orla` — 0,881 → **0,928** (+0,047)
- `soundtrack:proj-hatch` — 0,818 → 0,855 (+0,037)
- `parallel-tasks:proj-hatch` — 0,752 → 0,780 (+0,028)

Onde D perde ou empata: `duration:proj-brasa` (−0,001), `informal:proj-orla`
(−0,021), `parallel-tasks:proj-orla` (−0,017), `parallel-tasks:proj-brasa`
(−0,024). Não há padrão claro de vitória por família: `soundtrack` favorece D,
`parallel-tasks` é misto.

---

## 5. Interpretação honesta

1. **O conectoma não foi refutado nem confirmado.** Depois do conserto de
   paridade, D lidera as seis variantes em nDCG@8 e em Recall@8, e o diagnóstico
   isolado mostra sinal real. Mas a diferença não alcança significância
   estatística neste corpus.
2. **O corpus é pequeno.** 85 consultas de teste em 13 famílias. Os intervalos
   de confiança são largos o bastante para engolir o efeito. Aumentar o corpus é
   o caminho mais direto para decidir.
3. **O encoder lexical é o gargalo mais provável.** Um hash de 64 dimensões não
   tem semântica. A variante C (topologia embaralhada) performar próxima de D
   sugere que boa parte do sinal vem da fiação local, não de estrutura de alto
   nível — coerente com o achado metodológico citado no plano
   (arXiv:2604.04033) de que vantagens aparentes encolhem com controles melhores.
4. **Estado temporal não agregou nada.** E = D exatamente. O vetor de estado
   derivado não mudou nenhum score. Suspeita principal: o encoder de eventos
   ignora tokens de ≤2 caracteres e o corpus de sequências é sintético demais.
5. **Sem medição de memória e latência.** Os critérios 6 do plano ficaram sem
   instrumentação. Não afirmo ganho de custo que não medi.

---

## 6. Próximo passo que os dados sugerem

Trocar o encoder lexical por um **encoder semântico multilíngue local**
(exigindo fixar modelo, revisão, tokenizer, dimensão, normalização e hash antes
de gerar índices) e reexecutar a mesma avaliação congelada. É a variável com
maior chance de mudar o resultado, e o plano já a previa como candidata a
lançamento.

Se o ganho continuar abaixo de +0,03 com IC incluindo zero, a leitura correta é
que a topologia MaleCNS não agrega nesta tarefa — e o `legacy` permanece.

---

## 7. Ressalvas

- Corpus **sintético**: nenhuma conversa, credencial ou memória pessoal local foi
  usada no treino ou na avaliação.
- As métricas não usam o relógio da máquina: o instante de avaliação é fixo.
- A validação **não** incluiu navegador nem app Windows empacotado. Não afirmo
  que o recurso funciona de ponta a ponta no produto — apenas que o motor
  funciona, sob teste, e que a UI compila.
