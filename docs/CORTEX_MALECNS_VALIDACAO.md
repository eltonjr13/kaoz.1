# Validação de navegador — Fase 5

Registro da verificação real obrigatória (plano, seção 16). Este documento
reporta apenas o que foi **executado e medido**. O que não foi executado está
marcado como não executado.

Data da execução: 2026-09-11
Ambiente: Windows 11, Node v22.22.3, npm 10.9.8, Chromium via Playwright 1.60.0

## Instrumento

`scripts/cortex/validate-browser.mjs` mede, para `/cortex` e `/flow` em 390, 768
e 1280 px:

| Medida | Por quê |
| --- | --- |
| overflow horizontal da página e do elemento mais largo | o plano exige ausência de overflow |
| alvos de ação totais, pequenos e cobertos | ação inacessível é requisito explícito |
| hidratação (chaves React no DOM) | sem hidratação a página é HTML morto e a medição visual engana |
| estados do cérebro (esqueleto / pacote ausente / erro) | o plano exige estado operacional real, sem atividade fictícia |
| captura de tela por largura | evidência |
| erros de console e requisições falhas | regressão de runtime |

Alvo de tamanho mínimo: 24×24 CSS px (WCAG 2.5.8, AA).

## Resultado em ambiente de desenvolvimento

O primeiro ciclo de medição rodou contra `npm run dev` e produziu um resultado
**inválido**, que fica registrado porque muda a leitura dos números:

```
/cortex @ 390px  | overflowX=0px | alvos=21 pequenos=1 cobertos=0
/flow   @ 390px  | overflowX=0px | alvos=20 pequenos=1 cobertos=0
/cortex @ 768px  | overflowX=0px | alvos=19 pequenos=0 cobertos=0
/flow   @ 768px  | overflowX=0px | alvos=18 pequenos=0 cobertos=0
/cortex @ 1280px | overflowX=0px | alvos=19 pequenos=0 cobertos=0
/flow   @ 1280px | overflowX=0px | alvos=18 pequenos=0 cobertos=0
```

Zero overflow e zero alvos cobertos em todas as combinações. **Porém descobriu-se
depois que a página não estava hidratando**: o DOM não tinha nenhuma chave React
(`__reactFiber$`) e nenhuma requisição a `/api/cortex/engine/*` partia do
navegador. Clicar em outra aba não produzia efeito algum.

Ou seja: aqueles números descreviam **HTML do servidor congelado**. Layout e
alvos ainda são medições reais, mas interação, estados e fluxos não.

### Causa

O dev server (`next dev --webpack`) falhava o handshake do WebSocket de HMR
(`/_next/webpack-hmr` → `net::ERR_INVALID_HTTP_RESPONSE`, 22 ocorrências), e o
runtime do cliente não hidratava. Reproduzido em `/cortex` **e** `/flow`:

```
/cortex: chunks=4 | reactKeys(tab/button/a)=0/0/0
/flow:   chunks=4 | reactKeys(tab/button/a)=-1/0/0
```

Falha nas duas rotas ⇒ é ambiente de desenvolvimento, **não** defeito do
recurso. As requisições do motor chegaram a acontecer no painel de preview do
app Hermes, que hidrata normalmente — o que confirma o diagnóstico.

**Consequência:** a validação de interface precisa rodar contra o build de
produção, que é o que o produto entrega.

## Achados

| # | Achado | Severidade |
| --- | --- | --- |
| 1 | O validador original não detectava ausência de hidratação — media página morta e reportava verde | do instrumento; corrigido |
| 2 | Alvo `<a>` "Kaoz.1" mede 68×20 px, abaixo do mínimo de 24 px do WCAG 2.5.8 | baixa, acessibilidade; elemento global de navegação, pré-existente |
| 3 | `/api/cortex/engine/topology` responde 404 com `package-missing` quando o pacote não está no diretório de runtime | comportamento correto e desejado |
| 4 | `/api/cortex/engine/status` responde `configuredMode=legacy`, `effectiveMode=legacy`, `status=disabled`, `packageAvailable=false` | comportamento correto: sem pacote, falha para o caminho anterior e não inventa atividade |

O achado 1 é o mais importante do ciclo: sem a sonda de hidratação, o relatório
teria declarado "interface validada" com base numa página que não executava
JavaScript.
