# WorkflowFactory

## Responsabilidade

O `WorkflowFactory` recebe uma `ExecutionDecision` e seleciona o tipo de
workflow correspondente ao `ExecutionMode`. Ele não conversa com modelos de
IA, não executa tarefas, não usa ferramentas e não chama agentes.

Nesta etapa, a camada está implementada e exportada, mas não está conectada ao
`ChiefAgent` nem ao runtime atual.

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

`execute()` representa somente a materialização do resultado estrutural do
workflow. Ele não percorre as etapas de `expectedWorkflow`, não aciona o
Scheduler e não executa nenhum trabalho. A execução real continuará sendo
responsabilidade do runtime quando houver uma integração futura explícita.

## Posição futura

```mermaid
flowchart LR
    U["Mensagem do usuário"] -. "integração futura" .-> EC["ExecutionClassifier"]
    EC --> ED["ExecutionDecision"]
    ED --> WF["WorkflowFactory"]
    WF --> W["BaseWorkflow especializado"]
    W -. "ainda não conectado" .-> C["ChiefAgent"]
```
