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

    SC -. "seleção futura por capability" .-> FUT
```

O vínculo pontilhado representa uma extensão futura. Esta etapa não conecta
o domínio ao Chief, Planner, Scheduler ou MessageBus.

## Catálogo de agentes

```mermaid
flowchart TB
    BASE["CreativeDomainAgentBase<br/>AbstractAgent → BaseAgent"]
    BASE --> CDIR["CampaignDirectorAgent<br/>creative.campaign-direction"]
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
- restrição `not-executable`.

Os agentes são estruturais. `handleTask()` e `handleMessage()` rejeitam
execução com `CreativeAgentNotExecutableError`. Como não são inicializados no
registro, permanecem offline e indisponíveis para seleção operacional.

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

Contrato imutável para objetivo, audiência, entregáveis, restrições e metadata
de uma iniciativa criativa.

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

## Limites desta etapa

Não foram adicionados:

- geração de imagem, vídeo, texto ou layout;
- execução de `CreativeWorkflow`;
- comunicação com outros agentes;
- integração com Chief, Planner, Scheduler ou MessageBus;
- persistência;
- rotas ou interface.

Também não foram alterados `SharedContext` e `Blackboard`.
