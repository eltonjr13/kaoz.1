# CreativeDomain

## Objetivo

`CreativeDomain` é o limite lógico para agentes, contextos e contratos
criativos. Ele não é um agente, não executa workflows e não gera artefatos.

O domínio é registrado separadamente no `AgentRegistry`.
`CreativeDomain.register()` registra também o catálogo estrutural dos dez
agentes especializados. Agentes criativos adicionais devem ser registrados
por `CreativeDomain.registerAgent()`, que inclui automaticamente o `domainId`
`creative`.

## Arquitetura

```mermaid
flowchart TB
    AR["AgentRegistry"]
    DD["AgentDomainDescriptor<br/>id: creative"]
    CD["CreativeDomain<br/>agrupador lógico"]
    CA["Future Creative Agents"]
    CAT["Creative Agent Catalog<br/>10 dormant agents"]
    CB["CreativeBrief"]
    CW["CreativeWorkflow"]
    CC["CreativeDomainContext"]
    ART["CreativeArtifact"]

    CD -->|"register()"| AR
    AR --> DD
    CD -->|"register()"| CAT
    CAT -->|"domainId: creative"| AR
    CD -->|"registerAgent()"| CA
    AR -->|"domainId: creative"| CA
    CD --> CC
    CB --> CW
    CW --> ART
    CC -. referencia .-> CB
    CC -. referencia .-> CW
    CC -. referencia .-> ART
```

## Relação com o runtime multiagente

```mermaid
flowchart LR
    subgraph Runtime["Runtime existente — inalterado"]
        CH["ChiefAgent"] --> PL["PlannerAgent"]
        PL --> TD["TaskDecomposerAgent"]
        TD --> SC["Scheduler"]
        SC --> MB["MessageBus"]
    end

    subgraph Creative["CreativeDomain — nova estrutura"]
        REG["AgentRegistry"]
        DOM["CreativeDomain"]
        FUT["Creative Agent Catalog"]
        VAL["Brief / Workflow / Context / Artifact"]
        DOM --> REG
        REG --> FUT
        DOM --> VAL
    end

    PL -->|"objetivo criativo"| VAL
    VAL -->|"payload domainId: creative"| TD
    SC -. "execução futura do workflow" .-> FUT
```

O `PlannerAgent` agora reconhece intenção criativa de forma determinística.
Ele cria um `CreativeBrief` e um `CreativeWorkflow` somente para objetivos
criativos. O Chief, o Scheduler, o MessageBus, o SharedContext, o Blackboard e
os demais domínios permanecem inalterados.

## Roteamento do Planner

```mermaid
flowchart TD
    G["Goal"]
    C{"Intenção criativa?"}
    OLD["PlanGenerator existente<br/>comportamento preservado"]
    BRIEF["CreativeBrief"]
    WF["CreativeWorkflow"]
    STEP["ExecutionStep existente<br/>input com domainId: creative"]
    PLAN["ExecutionPlan"]

    G --> C
    C -->|"não"| OLD
    OLD --> PLAN
    C -->|"sim"| BRIEF
    BRIEF --> WF
    WF --> STEP
    STEP --> PLAN
```

São reconhecidos `campanha`, `imagem`, `vídeo`, `branding`, `publicidade`,
`social media`, `anúncio` e `marketing`, incluindo plurais aplicáveis e
variações com ou sem acento. A classificação considera apenas título e
objetivo. Restrições não participam da decisão, pois podem mencionar um ativo
somente para proibi-lo.

| Intenção | Capability requerida pelo CreativeWorkflow |
|---|---|
| campanha, publicidade, social media, anúncio, marketing | `creative.campaign-direction` |
| imagem | `creative.image-generation` |
| vídeo | `creative.video-direction` |
| branding | `creative.brand-governance` |

## Catálogo de agentes

```mermaid
flowchart TB
    BASE["CreativeDomainAgentBase<br/>AbstractAgent → BaseAgent"]
    BASE --> CDIR["CampaignDirectorAgent<br/>creative.campaign-direction<br/>brief estruturado ativo"]
    BASE --> AUD["AudienceStrategistAgent<br/>creative.audience-strategy"]
    BASE --> BRAND["BrandAgent<br/>creative.brand-governance"]
    BASE --> COPY["CopyAgent<br/>creative.copywriting"]
    BASE --> VIS["VisualDirectorAgent<br/>creative.visual-direction"]
    BASE --> PROMPT["PromptEngineerAgent<br/>creative.prompt-engineering"]
    BASE --> IMG["ImageGenerationAgent<br/>creative.image-generation"]
    BASE --> VIDEO["VideoDirectionAgent<br/>creative.video-direction"]
    BASE --> MOTION["MotionAgent<br/>creative.motion-design"]
    BASE --> REVIEW["CreativeReviewerAgent<br/>creative.review"]
```

Todos registram:

- metadata, identificador e tipo próprios;
- versão `1.0.0`;
- uma capability especializada;
- `domainId` `creative` e domínio legível `Creative`;
- health e heartbeat herdados de `AbstractAgent`;
- restrição `not-executable` para os especialistas ainda estruturais.

O `CampaignDirectorAgent` é a primeira exceção ativa: ele recebe intenção de
campanha já estruturada e produz um `CreativeBrief`, sem IA, prompts,
ferramentas ou geração de mídia. Os outros nove agentes continuam estruturais;
seus `handleTask()` e `handleMessage()` rejeitam execução com
`CreativeAgentNotExecutableError`.

### Comunicação do CampaignDirector

```mermaid
sequenceDiagram
    participant S as Scheduler
    participant B as MessageBus
    participant C as CampaignDirectorAgent

    S->>B: Command execute-scheduled-task
    B->>C: ExecutionTask
    C->>C: validar e estruturar CreativeBrief
    C-->>B: Response CreativeBrief
    B-->>S: SchedulerTaskExecutionResult.output
```

O agente não conhece uma instância do Scheduler. A resposta correlacionada do
MessageBus é capturada pelo fluxo normal do Scheduler.

## Componentes

### CreativeDomain

- identificação canônica `creative`;
- metadata imutável do domínio;
- registro no `AgentRegistry`;
- registro de agentes com filiação obrigatória;
- criação de `CreativeDomainContext`;
- nenhuma lógica de geração.

### CreativeDomainContext

Contexto imutável específico do domínio. Pode referenciar execução, projeto,
brief, workflow e artefatos por identificador. Possui versão e timestamps, mas
não substitui nem altera o `SharedContext`.

### CreativeBrief

Contrato imutável para objetivo, público-alvo, canais, identidade visual, tom,
mensagem principal, restrições, entregáveis, cronograma, KPIs e metadata de uma
iniciativa criativa.

### CreativeWorkflow

Descrição estrutural de estágios, capabilities necessárias, dependências e
tipos esperados de artefato. Não possui `execute`, `dispatch` ou `generate`.

### CreativeArtifact

Descriptor imutável de um resultado criativo planejado, em rascunho, pronto
ou arquivado. Não contém mecanismo de geração.

## AgentRegistry

O Registry agora suporta:

- `registerDomain()`;
- `removeDomain()`;
- `getDomainById()`;
- `listDomains()`;
- `findByDomain()`;
- `AgentRegistration.domainId`;
- estatísticas `domains` e `byDomain`.

Um agente não pode ser registrado em um domínio inexistente. Um domínio não
pode ser removido enquanto possuir agentes registrados.

## Exemplo de registro futuro

```ts
const registry = new AgentRegistry();
const creativeDomain = new CreativeDomain();

creativeDomain.register(registry); // registra domínio + catálogo
creativeDomain.registerAgent(registry, {
  agent: futureCreativeAgent,
  type: "creative-layout",
});
```

## Limites atuais

Não foram adicionados:

- geração de imagem, vídeo, texto publicitário ou layout;
- execução de `CreativeWorkflow`;
- comunicação com outros agentes;
- persistência;
- rotas ou interface.

O Planner apenas materializa e marca a estrutura para o domínio. As etapas e
capabilities produzidas pelo `PlanGenerator` existente são preservadas. Apenas
o `CampaignDirectorAgent` está habilitado para produzir briefs quando receber
uma tarefa `creative.campaign-direction`; os demais agentes criativos continuam
inativos. Não foram alterados Chief, Scheduler, MessageBus, SharedContext,
Blackboard nem outros domínios.
