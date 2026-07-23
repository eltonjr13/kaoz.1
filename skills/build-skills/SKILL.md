---
name: "Build Skills"
description: "Projeta, cria, revisa e evolui skills completas e prontas para uso no Kaoz.1. Use quando o usuário pedir para criar, montar, gerar, projetar, melhorar, revisar ou atualizar uma skill, inclusive com /build-skills, exemplos de referência ou padrões de qualidade externos."
version: "2.0.0"
preferredTools: ["native:file-read","native:file-write"]
requiredCapabilities: []
approvalMode: never
enabled: true
tools: []
---
# Build Skills

Crie skills de produção para o ecossistema Kaoz.1. Trate uma skill como um pacote especializado completo, não como um prompt curto.

## Objetivo de qualidade

Entregue uma skill capaz de executar o trabalho do início ao fim com:

- conhecimento de domínio útil e específico;
- fluxo operacional claro;
- decisões condicionais e variantes relevantes;
- formatos de saída prontos para uso;
- validação objetiva antes da entrega;
- referências, scripts e ferramentas quando agregarem capacidade real;
- integração correta com o registro, o Supercomputer e as ferramentas existentes.

Use [references/quality-standard.md](references/quality-standard.md) para avaliar profundidade e completude. Use [references/project-contract.md](references/project-contract.md) para gerar arquivos compatíveis com o Kaoz.1.

## Fluxo obrigatório

### 1. Entender o resultado real

Extraia do pedido:

- capacidade principal;
- exemplos de solicitações que devem ativar a skill;
- público, domínio, plataformas e variantes;
- entradas disponíveis e saída esperada;
- ferramentas, APIs ou arquivos necessários;
- restrições, aprovações e critérios de sucesso.

Leia qualquer skill, pasta ou exemplo fornecido pelo usuário. Identifique os princípios de qualidade e adapte-os ao novo domínio; não copie cegamente nomes, fluxos ou ferramentas incompatíveis.

Faça no máximo duas perguntas curtas por rodada, somente quando a resposta mudar materialmente a arquitetura. Se o objetivo estiver claro, avance diretamente.

### 2. Inspecionar o contexto do projeto

Antes de declarar ferramentas ou integrações:

- confira as ferramentas realmente disponíveis;
- reutilize serviços e pipelines existentes;
- preserve os provedores e comportamentos já funcionais;
- não invente APIs, IDs de ferramenta, scripts ou capacidades;
- determine se a skill será apenas instrucional ou se precisa de execução determinística.

### 3. Projetar o pacote

Defina uma árvore mínima e suficiente:

```text
skills/<id>/
├── SKILL.md
├── references/   # conhecimento extenso ou variantes, quando necessário
└── scripts/      # automações determinísticas, quando necessário
```

Mantenha no `SKILL.md` o fluxo central, as decisões e a navegação. Mova para `references/`:

- playbooks extensos;
- matrizes por plataforma ou cenário;
- limites, schemas e especificações;
- bibliotecas de fórmulas, exemplos e templates;
- conhecimento de domínio que só precisa ser lido em situações específicas.

Crie scripts apenas quando houver cálculo, transformação, coleta ou automação repetível que precise de resultado determinístico. Cada script deve receber argumentos estruturados, validar entradas, produzir saída legível ou JSON e falhar com mensagem acionável.

### 4. Escrever o SKILL.md

Inclua, conforme o domínio exigir:

1. papel e objetivo operacional;
2. contexto que deve ser coletado ou reutilizado;
3. fluxo principal em ordem executável;
4. frameworks, fórmulas ou critérios de decisão;
5. variantes por plataforma, formato ou cenário;
6. regras de uso de ferramentas;
7. formato exato da saída;
8. validação final;
9. tratamento de dados ausentes, falhas e limites.

Escreva instruções no imperativo, com exemplos concretos. A descrição deve explicar o que a skill faz e quais pedidos devem ativá-la.

Evite:

- instruções genéricas que qualquer modelo já conhece;
- listas longas sem orientar quando usar cada item;
- perguntas desnecessárias antes de começar;
- dependências externas não confirmadas;
- uma única resposta fixa para cenários diferentes;
- referências mencionadas mas não entregues;
- scripts sem ferramenta associada ou ferramenta sem script.

### 5. Conectar ferramentas

Para cada script executável, declare uma ferramenta com:

- ID no formato `skill:<id>:<acao>`;
- descrição operacional;
- caminho `scripts/<arquivo>`;
- `inputSchema` JSON completo, incluindo campos obrigatórios, tipos e descrições.

Use `preferredTools` apenas para ferramentas existentes que favoreçam o fluxo. Use `requiredCapabilities` somente quando a execução realmente depender de `web`, `content` ou `system`.

Escolha o modo de aprovação:

- `never`: somente leitura ou operação local segura e previsível;
- `plan`: alterações e execuções normais que devem ser revisadas no plano;
- `step`: ações externas ou sensíveis que exigem aprovação por etapa.

### 6. Revisar antes de apresentar

Execute a checklist:

- O pacote resolve exemplos reais de ponta a ponta?
- A profundidade é comparável a uma skill profissional do domínio?
- O fluxo diz o que fazer, em qual ordem e com quais decisões?
- Cada referência está ligada diretamente no `SKILL.md`?
- Cada ferramenta aponta para um script entregue?
- Os caminhos e IDs seguem o contrato do projeto?
- Há formato de saída e critérios verificáveis?
- A skill evita inventar integrações e fatos?

Se qualquer resposta for não, corrija antes de entregar.

## Forma de entrega

Apresente um resumo curto do pacote e produza o rascunho completo com:

- metadados da skill;
- conteúdo integral do `SKILL.md`;
- todos os arquivos de referência necessários;
- todos os scripts necessários;
- ferramentas, capacidades e modo de aprovação já configurados.

O usuário revisa o pacote completo antes da instalação. Não reduza uma solicitação clara a um esqueleto ou a uma lista de sugestões.
