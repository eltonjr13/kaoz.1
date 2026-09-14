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
| 5 | A rota `GET /api/cortex/engine/topology` registrava **stack trace completo em nível de erro** para o estado esperado "pacote não preparado". Como a interface pede a topologia em cada poll, o log do servidor enchia de ruído e escondia falha real. A classificação 404/500 também era feita por regex sobre a mensagem. | corrigido — ver abaixo |

### Correção do achado 5

`topologyError` passou a classificar pelo `reason` tipado do `PackageError` (o
regex sobre a mensagem ficou só como reserva), e o caso esperado agora emite
**uma linha informativa sem stack**; só o inesperado vira `console.error` em
nível 500.

Resposta HTTP **inalterada**, verificado chamando o handler direto:

```
[API Cortex Engine] GET topology: pacote não preparado (404 esperado): package-missing
status HTTP: 404 | success: false | codigo: NOT_FOUND
```

Antes: ~15 linhas de stack trace por requisição. A rota `topology` era a única
do motor com esse padrão — as demais devolvem 200 ou falham de fato.

## Erro de medição que precisa ficar registrado

O primeiro ciclo reportou hidratação ausente **e produziu uma conclusão falsa de
defeito de produto**. Estava errado, e a causa vale como lição:

1. Um servidor `next dev --webpack` já ocupava a porta 3000 — **o terminal
   integrado do Antigravity IDE rodando `next dev` para este projeto**, não um
   resíduo deste trabalho. A cadeia de processos termina em
   `Antigravity IDE.exe → powershell → npm-cli.js → cmd → next dev`.
2. O `npm start` **nunca conseguiu bindar a porta**. O erro não apareceu porque o
   comando estava sob um wrapper que engoliu o stderr; a evidência veio depois,
   no buffer do processo:
   `Error: listen EADDRINUSE: address already in use :::3000`.
3. Todas as medições ditas "de produção" eram, na verdade, contra o **servidor de
   desenvolvimento**.
4. O cliente de dev tenta o WebSocket de HMR; sem servidor de HMR, a hidratação
   não completa → a aba Cérebro ficava presa no esqueleto. Isso é **artefato de
   ambiente**, não defeito do produto.
5. O identificador de origem também importava: no dev, `127.0.0.1` não hidratava e
   `localhost` sim (restrição de origens do `next dev`). Eu havia interpretado
   isso como diferença de servidor.

**Como o erro foi pego:** comparar o tamanho do chunk servido com o arquivo em
disco. `main-app.js` vinha com **11,9 MB** (tamanho de dev) e existia apenas em
`.next/dev/static/chunks/`; o build de produção usa
`.next/static/chunks/main-app-ea3bce5c7b48d2e1.js`. A árvore de processos então
mostrou `next dev` como pai do processo que escutava na porta.

**Regras que ficam:**

- Antes de validar contra um servidor, confirmar **o que** está escutando a porta
  — não confiar em qual comando se pretendeu rodar. Nesta máquina o
  desenvolvimento costuma estar ativo na 3000 (IDE), então a validação de
  produção precisa de outra porta ou de derrubar o dev antes.
- Tamanho de chunk é um discriminador barato e confiável: build de dev tem nomes
  **sem hash** e é ordens de magnitude maior.
- Encerrar processos por nome/linha de comando é perigoso: um `Stop-Process` por
  padrão em `*next*dev*` derrubou o servidor de desenvolvimento do próprio
  usuário. Preferir o PID exato confirmado na porta.


## Testes automatizados executados nesta fase

| Comando | Resultado |
| --- | --- |
| `api-cortex-integration` + `cortex-graph-physics-layout` | 35/35 |
| `tests/e2e/cortex/test-runner.mjs` | 67/67 (4 tiers) |
| `test:desktop`, `test:updates`, `test:connectors` | passam |
| `test:cortex-engine` | 121/121 |
| Typecheck | limpo |
| Lint do repositório | 243 erros, todos preexistentes (linha de base documentada: 245) |

## Anatomia real renderizada (pacote instalado no runtime)

O pacote passou a existir em
`.generated/local-data/cortex-engine/packages/male-cns-v1.0`, produzido por
`cortex:prepare` (reprodução determinística a partir do cache: 1536 neurônios,
181.763 arestas, 711 tipos) com o readout treinado (`1.0.0-D`, variante D) ao lado.

**Verificação de que é o mesmo artefato validado:** os quatro SHA-256 do
`integrity.json` do runtime são **idênticos** aos do pacote de referência.

Estado reportado pelo motor:

```
packageAvailable: true   packageVersion: v1.0   packageDatasetId: male-cns:v1.0
readoutAvailable: true   readoutVersion: 1.0.0-D   readoutVariant: D
attribution: Berg et al. (2025) 'Sexual dimorphism in the complete connectome
             of the Drosophila male central nervous system'.
             Janelia FlyEM / Drosophila Connectomics Group.
             DOI 10.1101/2025.10.09.680999
license: CC BY 4.0
```

Com o pacote presente, as três rotas do motor respondem 200 e a aba Cérebro
**desenha a anatomia**: nuvem real de neurônios (512 no nível 1, de 1536), com a
estrutura do recorte visível. O texto na tela é explícito:

> 1536 neurônios · 181.763 conexões · 711 tipos
> ANATOMIA DO RECORTE — somaLocation (8nm voxels) normalizado por eixo para [0,1]
> *"Sem atividade observada: exibição estática. Valores numéricos do motor
> normalizados por tanh; NÃO são medições biológicas de atividade neural."*
> *"Recorte de 1536 neurônios (711 tipos) do cérebro central. Não é o CNS inteiro
> nem uma simulação de todos os neurônios."*

Isso atende ao requisito do plano de mostrar estado real e **não simular
atividade ausente**. O selo aparece como *Desligado* e "PROCESSAMENTOS RECENTES"
fica vazio porque o modo **configurado** é `legacy` — a anatomia não depende do
modo, os rastros sim.

Evidência: `tests/fixtures/cortex-engine/browser-evidence/cerebro-real-1440.png`

**Importante:** o pacote fica em `.generated/`, que é ignorado pelo git. Ele é
derivado de um dataset de 1,05 GB e se reproduz pelo comando
`cortex:prepare` a partir do cache — não deve ser versionado.

### O pacote precisa existir em DOIS runtimes

`getRuntimeDataRoot()` resolve o diretório assim:

```js
// Electron/pacote instalado: %APPDATA%/Kaoz.1/generated
// desenvolvimento/web:       <projeto>/.generated
```

Instalar só em `.generated` resolve **desenvolvimento** e deixa o **aplicativo
empacotado** mostrando "Pacote do conectoma ausente" — porque o app lê
`%APPDATA%/Kaoz.1`. O gap foi encontrado comparando os dois diretórios: o runtime
do Electron já existia (com `local-data/davinci-resolve-free`, `jobs`,
`connectors`) e **não** tinha o pacote do Cortex.

O pacote foi instalado nos dois. Verificação com `KAOZ1_DATA_DIR` apontando para o
runtime do Electron — que é o que o app empacotado faz — resolve corretamente:

```
pacoteDir resolvido: C:\Users\elton\AppData\Roaming\Kaoz.1\generated\local-data\cortex-engine\packages\male-cns-v1.0
packageAvailable: true    packageVersion: v1.0
readoutAvailable: true    readoutVersion: 1.0.0-D
```

Hashes do `integrity.json` **idênticos** entre os dois runtimes.

Isto segue o que o plano determina (seção 395): o pacote pode ser *"distribuído
com a aplicação ou preparado explicitamente durante desenvolvimento"*, e o
empacotamento **não pode** capturar `.generated` (seção 397). Com 1,7 MB, o
pacote é pequeno o bastante para distribuição — mas **não existe hoje nenhum
mecanismo automático** que o leve ao runtime do app: nem
`prepare-desktop-build.mjs` nem `desktop-runtime-validation.mjs` mencionam o
Cortex. Levá-lo para o instalador é trabalho da Fase 6.


### Anatomia completa do CNS (camada de visualização)

O recorte de 1.536 neurônios de **uma** região (`cb_intrinsic`) não forma anatomia
reconhecível na tela — parece ruído. A referência completa do CNS tem outra escala:

| | CNS completo | recorte do motor |
| --- | --- | --- |
| neurônios | 211.577 anotados (**141.781 com posição real**) | 1.536 |
| arestas (minconf 0.5) | 151.856.684 | 181.763 |
| tipos celulares | 8.199 | 711 |

A diferença visual vem das superclasses: `ol_intrinsic` (lobo óptico) tem 81.055
neurônios com posição e simplesmente não existe no recorte.

**A separação é obrigatória, não estética.** O plano já a previa (seção 5.3:
*"renderizar uma anatomia geral não significa simular todos os neurônios"*). Rodar
o motor sobre o CNS inteiro custaria ~836× mais por recuperação — a dinâmica faz
uma multiplicação esparsa por passo, com custo proporcional ao número de arestas,
e cada consulta executa `steps=6 × 128 candidatos`:

- recorte: 768 × 181.763 ≈ **1,4 × 10⁸** operações
- CNS completo: 768 × 151.856.684 ≈ **1,2 × 10¹¹**

*(Estimativa a partir da contagem de arestas, não benchmark. Transformar isso em
medição é o critério 6, ainda não instrumentado.)*

#### O artefato

`cortex:build-anatomy` produz `anatomy/male-cns-v1.0/` (~2,9 MB):
`positions.bin` (Float32 normalizado), `superclass.bin`, `body-ids.bin`,
`manifest.json` e `integrity.json`. Determinístico, só leitura do cache local.
O manifesto declara `purpose: "visualizacao"` e um aviso explícito de que o
artefato **não participa de nenhuma pontuação**.

Servido em binário por `GET /api/cortex/engine/anatomy/points?level=N` — em JSON
seriam ~7 MB de texto; como buffer, o cliente lê direto num `Float32Array`.
Níveis: 141.781 / 70.891 / 35.446 / 17.723 pontos.

#### O enquadramento — defeito evitado

O pacote do motor normaliza as posições sobre o **próprio** bounding box; a
anatomia normaliza sobre o do **CNS inteiro**. Desenhar um sobre o outro sem
converter teria esticado o recorte por **100% do canvas**, sugerindo que o motor
cobre o CNS — exatamente o que não acontece.

O construtor agora lê os `bodyId` do pacote, recupera a posição real de cada um e
registra `motorFrame` no manifesto. Medido:

> recorte: 1530 neurônios | cobre **[0.589, 0.673, 0.241]** do CNS por eixo

Ou seja, o recorte ocupa a maior parte de X e Y mas só ~24% da profundidade (Z).
Também revelou um detalhe real: **6 dos 1.536 neurônios do recorte não têm
`somaLocation`** no dataset — ficam sem posição, e isso é registrado como
`missingPosition` em vez de silenciosamente inventado.

`mapToAnatomyFrame` converte as coordenadas antes da projeção, de modo que
desenho e teste de clique usam a mesma geometria. Fixado em
`tests/cortex-anatomy-frame.test.ts` (6 casos, incluindo eixo de extensão zero).

#### Na interface

O fundo é o CNS completo esmaecido; o recorte destacado fica sobreposto na posição
correta. Rasterizado em canvas próprio — são dezenas de milhares de pontos e
redesenhá-los a cada movimento do mouse custaria caro.

A tela declara as duas camadas:

> **Anatomia do CNS** — Fundo: 35.446 neurônios de referência anatômica (CNS
> completo, exibição estática). Motor: 1.536 neurônios do recorte.

E o rótulo de acessibilidade do canvas diz que o motor **não computa** sobre o
fundo.

## Não executado (não declarar como concluído)

- **Aplicativo Windows empacotado** (Fase 6): iniciar com perfil legado, alternar
  modos, conversa com recuperação, reiniciar, operar offline, fallback sem modelo.
- **Modos `male-cns` e `shadow`**: com o pacote instalado eles agora *podem* ser
  exercitados, mas o modo configurado permanece `legacy`. A comparação em `shadow`
  e a atribuição em `male-cns`, com rastros reais aparecendo na interface, **ainda
  não foram vistas**.
- Leitores de tela e navegação por teclado (a medição cobre tamanho e cobertura de
  alvo, não a ordem de foco nem anúncio de leitor).
- O desenho das **conexões** na anatomia não foi observado — o nível 1 traz 512
  nós e a exibição sem atividade é estática, conforme o próprio painel declara.

Não afirmo que o recurso funciona de ponta a ponta no produto empacotado.

