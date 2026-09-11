# Validação de navegador — Fase 5

Registro da verificação real obrigatória (plano, seção 16). Reporta apenas o que
foi **executado e medido**. O que não foi executado está marcado como tal.

Data: 2026-09-11
Ambiente: Windows 11, Node v22.22.3, npm 10.9.8, Playwright 1.60.0 (Chromium)

## Instrumentos

| Script | O que mede |
| --- | --- |
| `scripts/cortex/probe-hydration.mjs` | se o React assumiu a página (varredura de internos em todo o DOM) |
| `scripts/cortex/validate-browser.mjs` | overflow horizontal, alvos de ação pequenos/cobertos, hidratação, estados do cérebro, erros de console, requisições falhas, capturas |
| `scripts/cortex/validate-memory-flow.mjs` | ciclo criar → ver → corrigir → excluir → estado do cérebro, pela interface |

Alvo de tamanho mínimo: 24×24 CSS px (WCAG 2.5.8, AA).

## Resultado válido (produção)

Servidor confirmado como produção: processo `next start` e **todos os 13 chunks
com hash** no nome (o build de dev usa nomes sem hash).

```
rota     largura  overflow  alvos  pequenos  cobertos  hidratado  estado do cérebro
/cortex     390      0px      21       1         0       true     "Pacote ausente"
/flow       390      0px      20       1         0       true     —
/cortex     768      0px      19       0         0       true     "Pacote ausente"
/flow       768      0px      18       0         0       true     —
/cortex    1280      0px      19       0         0       true     "Pacote ausente"
/flow      1280      0px      18       0         0       true     —
```

- **Zero overflow horizontal** em todas as combinações.
- **Zero alvos de ação cobertos** por outro elemento.
- Hidratação **funciona** nas três rotas (`/`: 104/127 nós com React; `/cortex`:
  231/253; `/flow`: 271/318).
- O cérebro mostra estado operacional definido, **sem simular atividade**:
  `skeleton=0` e a mensagem *"Pacote do conectoma ausente — O recorte do MaleCNS
  ainda não foi preparado neste computador. Rode `npm run cortex:prepare` para
  habilitar a anatomia real."* O cabeçalho exibe o selo *Local-First Operacional*.

## Ciclo de vida da memória (produção, pela interface)

```
criada          id=8289610c | Usuario informou: ZZ-TESTE-VALIDACAO-CORTEX usa luz quente de 3200K
visivel na lista: true
versoes na serie: 2 (ativas=1, superseded=1)
1. uma unica versao ativa: true
2. a ativa tem o conteudo novo: true
3. a anterior esta superseded: true
4. nenhuma ativa com conteudo antigo: true
5. linhagem preservada: true
interface rotula a versao antiga: true
nenhuma versao ativa apos esquecer: true
cerebro: {"skeleton":0,"pacoteAusente":true,"erro":false}
resultado: CICLO COMPLETO OK
limpeza: serie de teste removida do armazenamento real
```

**Sobre a correção:** o projeto **não sobrescreve** a memória. `editMemory` marca
a versão anterior como `superseded` e cria uma nova `active` com `supersedesId`.
O critério de sucesso correto é linhagem (uma única ativa, com o conteúdo novo, e
a anterior fora das recuperações) — procurar pelo id antigo com
`includeHistory: true` produz falso negativo. A interface distingue as versões:
rótulo de status, opacidade reduzida e **ausência dos botões Editar/Esquecer**
nas superseded.

Limpeza confirmada: varredura do arquivo de armazenamento inteiro por marcador de
teste = **0 resíduos**.

## Achados reais

| # | Achado | Severidade |
| --- | --- | --- |
| 1 | Alvo `<a>` "Kaoz.1" mede **68×20 px**, abaixo do mínimo de 24 px do WCAG 2.5.8. Aparece a 390 px nas duas rotas. Elemento global de navegação, pré-existente. | baixa (acessibilidade) |
| 2 | `/api/cortex/engine/topology` responde **404 com `package-missing`** quando o pacote não está no diretório de runtime. | nenhuma — comportamento correto e desejado |
| 3 | `/api/cortex/engine/status` responde `configuredMode=legacy`, `effectiveMode=legacy`, `status=disabled`, `packageAvailable=false`. | nenhuma — falha segura, não inventa atividade |
| 4 | 79 requisições `?_rsc=` abortadas por página, mais 3 de `/api/flow/media` para um asset ausente. | nenhuma — prefetch de `<Link>` cancelado na navegação; o asset ausente é anterior a este trabalho |

## Erro de medição que precisa ficar registrado

O primeiro ciclo reportou hidratação ausente **e produziu uma conclusão falsa de
defeito de produto**. Estava errado, e a causa vale como lição:

1. Um servidor `next dev --webpack` permaneceu escutando na porta 3000 (processo
   órfão; matar o wrapper do shell não mata o servidor). O `npm start` **nunca
   conseguiu bindar a porta** e falhou em silêncio.
2. Todas as medições ditas "de produção" eram, na verdade, contra o **servidor de
   desenvolvimento**.
3. O cliente de dev tenta o WebSocket de HMR; sem servidor de HMR, a hidratação
   não completa → a aba Cérebro ficava presa no esqueleto. Isso é **artefato de
   ambiente**, não defeito do produto.
4. O identificador de origem também importava: no dev, `127.0.0.1` não hidratava e
   `localhost` sim (restrição de origens do `next dev`). Eu havia interpretado
   isso como diferença de servidor.

**Como o erro foi pego:** comparar o tamanho do chunk servido com o arquivo em
disco. `main-app.js` vinha com **11,9 MB** (tamanho de dev) e existia apenas em
`.next/dev/static/chunks/`; o build de produção usa
`.next/static/chunks/main-app-ea3bce5c7b48d2e1.js`. A árvore de processos então
mostrou `next dev` como pai do processo que escutava na porta.

**Regra que fica:** antes de validar contra um servidor, confirmar *o que* está
escutando a porta — não confiar em qual comando se pretendeu rodar. E tamanho de
chunk é um discriminador barato e confiável entre build de dev e de produção.

## Testes automatizados executados nesta fase

| Comando | Resultado |
| --- | --- |
| `api-cortex-integration` + `cortex-graph-physics-layout` | 35/35 |
| `tests/e2e/cortex/test-runner.mjs` | 67/67 (4 tiers) |
| `test:desktop`, `test:updates`, `test:connectors` | passam |
| `test:cortex-engine` | 121/121 |
| Typecheck | limpo |
| Lint do repositório | 243 erros, todos preexistentes (linha de base documentada: 245) |

## Não executado (não declarar como concluído)

- **Aplicativo Windows empacotado** (Fase 6): iniciar com perfil legado, alternar
  modos, conversa com recuperação, reiniciar, operar offline, fallback sem modelo.
- **Modos `male-cns` e `shadow` na interface**, que exigem o pacote preparado em
  `.generated/local-data/cortex-engine/packages/male-cns-v1.0`. Nesta máquina o
  pacote existe apenas em `tests/fixtures/`, então a anatomia real, os rastros e
  a atividade do cérebro **não foram vistos renderizados**.
- Leitores de tela e navegação por teclado (a medição cobre tamanho e cobertura de
  alvo, não a ordem de foco nem anúncio de leitor).

Não afirmo que o recurso funciona de ponta a ponta no produto empacotado.
