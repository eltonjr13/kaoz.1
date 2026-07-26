# WorkflowFactory

## Responsabilidade

O `WorkflowFactory` recebe uma `ExecutionDecision` e seleciona o tipo de
workflow correspondente ao `ExecutionMode`. Ele não conversa com modelos de
IA, não executa tarefas, não usa ferramentas e não chama agentes. No modo
`EXECUTION`, ele apenas injeta no `ExecutionWorkflow` as portas fornecidas pelo
chamador.

O `ChiefAgent` utiliza o `ExecutionWorkflow` para decisões `EXECUTION`. Os
demais modos ainda preservam seus caminhos existentes.

## Seleção

| ExecutionMode | Workflow |
| --- | --- |
| `QUICK` | `QuickWorkflow` |
| `ANALYSIS` | `AnalysisWorkflow` |
| `EXECUTION` | `ExecutionWorkflow` |
| `BACKGROUND` | `BackgroundWorkflow` |
| `STREAMING` | `StreamingWorkflow` |

```mermaid
flowchart LR
    ED["ExecutionDecision"] --> F["WorkflowFactory"]
    F --> M{"ExecutionMode"}
    M -->|"QUICK"| Q["QuickWorkflow"]
    M -->|"ANALYSIS"| A["AnalysisWorkflow"]
    M -->|"EXECUTION"| E["ExecutionWorkflow"]
    M -->|"BACKGROUND"| B["BackgroundWorkflow"]
    M -->|"STREAMING"| S["StreamingWorkflow"]
```

## Hierarquia

Todos os workflows implementam o mesmo contrato por meio de
`BaseWorkflow`.

```mermaid
classDiagram
    class WorkflowContract {
        +initialize()
        +execute()
        +pause()
        +resume()
        +cancel()
        +status()
        +progress()
        +result()
    }
    class BaseWorkflow
    class QuickWorkflow
    class AnalysisWorkflow
    class ExecutionWorkflow
    class BackgroundWorkflow
    class StreamingWorkflow

    WorkflowContract <|.. BaseWorkflow
    BaseWorkflow <|-- QuickWorkflow
    BaseWorkflow <|-- AnalysisWorkflow
    BaseWorkflow <|-- ExecutionWorkflow
    BaseWorkflow <|-- BackgroundWorkflow
    BaseWorkflow <|-- StreamingWorkflow
```

## Ciclo de vida

```mermaid
stateDiagram-v2
    [*] --> created
    created --> initialized: initialize()
    initialized --> paused: pause()
    paused --> initialized: resume()
    initialized --> running: execute()
    running --> completed: resultado estrutural
    created --> cancelled: cancel()
    initialized --> cancelled: cancel()
    paused --> cancelled: cancel()
```

Nos workflows `QUICK`, `ANALYSIS`, `BACKGROUND` e `STREAMING`, `execute()`
continua representando somente a materialização do resultado estrutural.

No `ExecutionWorkflow`, `execute()` percorre obrigatoriamente o pipeline
transacional abaixo por meio de portas injetadas. O factory continua sem
executar qualquer estágio.

```mermaid
flowchart LR
    G["1. Goal"] --> P["2. Planner"]
    P --> EP["3. ExecutionPlan"]
    EP --> TD["4. TaskDecomposer"]
    TD --> S["5. Scheduler"]
    S --> A["6. Agentes especializados"]
    A --> CO["7. Consensus"]
    CO --> C["8. ChiefAgent"]
    C --> U["Usuário"]
```

Cada fronteira é registrada no `MessageBus`, cada estágio gera um artefato no
`Blackboard` e as durações ficam disponíveis em `metrics()`. Uma falha
interrompe a sequência, registra o erro e mantém `result()` vazio.

## Posição futura

```mermaid
flowchart LR
    U["Objetivo recebido pelo Chief"] --> EC["ExecutionClassifier"]
    EC --> ED["ExecutionDecision"]
    ED --> WF["WorkflowFactory"]
    WF --> W["BaseWorkflow especializado"]
    W --> C["ChiefAgent libera a resposta"]
```
