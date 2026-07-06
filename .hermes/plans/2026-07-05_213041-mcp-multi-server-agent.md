# Agente com Múltiplos MCPs Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fazer o agente do MrChicken conseguir se conectar a vários servidores MCP simultaneamente, descobrir ferramentas, escolher ferramentas relevantes durante o planejamento/execução e chamar essas ferramentas com segurança.

**Architecture:** O projeto já tem uma base MCP em `services/mcp/*`, endpoints em `app/api/mcp/*` e UI em `components/settings/McpSettingsPanel.tsx`. A melhor abordagem é evoluir isso para uma camada de “tool registry + executor” usada pelo `FlowAgent`, mantendo conexões persistentes por servidor e expondo um endpoint de chamada controlado para debug/UI.

**Tech Stack:** Next.js 16, TypeScript, `@modelcontextprotocol/sdk`, rotas App Router, armazenamento local em `.generated/local-data`, agente existente em `src/providers/flow/FlowAgent.ts`.

---

## Current Context / Assumptions

- Já existe `services/mcp/mcp.manager.ts` com suporte inicial a múltiplos servidores habilitados.
- Já existe `services/mcp/mcp.types.ts`, mas só cobre `stdio | sse`, sem headers, timeouts, health metadata, nomes normalizados ou permissões.
- Já existe `/api/mcp/config` para carregar/salvar e `/api/mcp/test` para testar conexão.
- Já existe aba MCP nas configurações via `components/settings/McpSettingsPanel.tsx`.
- O `FlowAgent` ainda não parece usar ferramentas MCP no loop do agente; ele usa LLM/browser automation/Flow Provider e memória local.
- A meta não deve ser apenas “conectar MCP”, porque isso já começou. A meta real é **usar vários MCPs como ferramentas do agente**.

---

## Proposed Approach

Implementar em camadas:

1. **Endurecer o gerenciador MCP**: validação, reconexão limpa, HTTP/SSE/stdio com timeouts e status por servidor.
2. **Criar registro de ferramentas**: mapear `serverId + toolName` para um identificador único e seguro, tipo `mcp:<serverId>:<toolName>`.
3. **Criar executor de ferramentas**: chamada de ferramenta com logs, timeout, erros redigidos e limites.
4. **Integrar no agente**: antes de planejar ou executar, buscar ferramentas disponíveis; deixar o LLM decidir quando precisa chamar uma ferramenta; executar e injetar resultado no contexto.
5. **UI e APIs**: listar ferramentas, testar chamada, ver status, habilitar/desabilitar por servidor.
6. **Testar com 2–3 MCPs reais**: filesystem seguro, time/search, e um MCP HTTP/SSE/local se disponível.

---

## Task 1: Normalize MCP types and settings

**Objective:** Expandir tipos MCP para suportar vários transportes, metadados, timeouts e segurança.

**Files:**
- Modify: `services/mcp/mcp.types.ts`

**Steps:**

1. Atualizar `McpTransportType` para:
   - `stdio`
   - `sse`
   - `streamable-http` ou `http`, se o SDK atual suportar no projeto.
2. Adicionar campos em `McpServerConfig`:
   - `description?: string`
   - `timeoutMs?: number`
   - `connectTimeoutMs?: number`
   - `headers?: Record<string, string>` para transportes remotos
   - `allowToolCalls?: boolean`
   - `allowedTools?: string[]`
   - `blockedTools?: string[]`
3. Adicionar tipo `McpToolRef`:
   - `id: string` no formato `mcp:${serverId}:${toolName}`
   - `serverId`
   - `serverName`
   - `name`
   - `description?`
   - `inputSchema`
4. Adicionar status com:
   - `lastConnectedAt?: string`
   - `lastErrorAt?: string`
   - `toolCount: number`

**Validation:**

Run:

```bash
npm run typecheck
```

Expected: TypeScript aponta apenas locais que precisam ser ajustados depois, não erros de sintaxe no arquivo de tipos.

---

## Task 2: Harden `McpManager` connection lifecycle

**Objective:** Tornar conexões múltiplas mais previsíveis e seguras.

**Files:**
- Modify: `services/mcp/mcp.manager.ts`

**Steps:**

1. Separar métodos privados:
   - `connectServer(config)`
   - `disconnectServer(serverId)`
   - `normalizeTools(serverId, tools)`
   - `isToolAllowed(config, toolName)`
2. Ao salvar settings:
   - fechar clientes removidos/desabilitados
   - reconectar só servidores alterados quando possível, ou manter reinit total inicialmente se quiser simplicidade
3. Não passar `process.env` inteiro para MCP stdio por padrão.
   - Criar allowlist mínima: `PATH`, `HOME`, `USER`, `TEMP`, `TMP`, `SystemRoot` no Windows se necessário.
   - Mesclar apenas `config.env` explicitamente configurado.
4. Adicionar timeout para conexão/teste usando `Promise.race`.
5. Redigir erros com tokens/chaves antes de guardar status.
6. Garantir que falha de um MCP não derrube os outros.

**Validation:**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: sem erros novos.

---

## Task 3: Add a first-class MCP tool registry

**Objective:** Expor uma lista única de ferramentas disponíveis para o agente, sem ele precisar saber detalhes dos clientes MCP.

**Files:**
- Create: `services/mcp/mcp.registry.ts`
- Modify: `services/mcp/mcp.manager.ts`

**Steps:**

1. Criar função `toToolId(serverId: string, toolName: string)` retornando `mcp:${serverId}:${toolName}`.
2. Criar função `parseToolId(toolId: string)` retornando `{ serverId, toolName }`.
3. Criar função `describeToolsForPrompt(tools: McpToolRef[])` que gera texto compacto:
   - ID
   - descrição
   - schema JSON resumido
4. No manager, adicionar método:

```ts
public async getToolRefs(): Promise<McpToolRef[]> { ... }
```

5. Filtrar ferramentas bloqueadas/desabilitadas.

**Validation:**

Criar teste manual temporário via rota/API no Task 5 ou usar endpoint existente `/api/mcp/config` e conferir se `statuses[].tools` continua preenchido.

---

## Task 4: Add safe MCP tool executor

**Objective:** Criar uma camada única para chamada de ferramenta com logs, timeout e mensagens amigáveis.

**Files:**
- Create: `services/mcp/mcp.executor.ts`
- Modify: `services/mcp/mcp.manager.ts`

**Steps:**

1. Criar função:

```ts
export async function callMcpToolById(toolId: string, args: unknown, options?: { timeoutMs?: number })
```

2. Dentro dela:
   - parsear `toolId`
   - validar ferramenta existe e está permitida
   - chamar `McpManager.callTool(serverId, toolName, args)`
   - aplicar timeout
   - retornar `{ success: true, content, raw }` ou `{ success: false, error }`
3. Redigir credenciais em erros.
4. Registrar eventos no console com `serverId`, `toolName`, duração, sucesso/falha.
5. Definir limite de tamanho de resultado para injetar no LLM, por exemplo 20–50 KB.

**Validation:**

Run:

```bash
npm run typecheck
```

Expected: executor compila e não quebra manager.

---

## Task 5: Add MCP APIs for tools and calls

**Objective:** Permitir UI/debug e facilitar testes reais.

**Files:**
- Create: `app/api/mcp/tools/route.ts`
- Create: `app/api/mcp/call/route.ts`
- Modify: `app/api/mcp/config/route.ts` if needed

**Steps:**

1. `GET /api/mcp/tools`:
   - retorna `tools: McpToolRef[]`
   - retorna `statuses`
2. `POST /api/mcp/call` body:

```json
{
  "toolId": "mcp:server:tool",
  "arguments": {}
}
```

3. A rota de call deve:
   - validar JSON
   - chamar executor
   - retornar status HTTP 200 para chamada processada, mesmo se ferramenta falhar com `success: false`
4. Bloquear chamadas para servidor desabilitado ou `allowToolCalls === false`.

**Validation:**

Com app rodando:

```bash
curl http://localhost:3000/api/mcp/tools
```

Expected: JSON com lista de ferramentas ou lista vazia, sem erro 500.

---

## Task 6: Improve MCP Settings UI for multiple servers

**Objective:** Tornar configuração multi-MCP utilizável sem editar JSON manualmente.

**Files:**
- Modify: `components/settings/McpSettingsPanel.tsx`

**Steps:**

1. Adicionar campos:
   - descrição
   - timeout
   - env em textarea JSON ou linhas `KEY=VALUE`
   - headers para SSE/HTTP remoto
   - allow tool calls
2. Mostrar lista expandível de ferramentas por servidor.
3. Adicionar botão “Atualizar status”.
4. Adicionar botão “Testar ferramenta” para chamadas simples com JSON args.
5. Corrigir parsing de args: split por espaço quebra caminhos com espaços. Melhor aceitar JSON array ou textarea por linha.

**Validation:**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: UI compila.

---

## Task 7: Integrate MCP context into `FlowAgent` planning

**Objective:** Fazer o agente enxergar as ferramentas disponíveis quando planeja.

**Files:**
- Modify: `src/providers/flow/FlowAgent.ts`
- Possibly modify: `lib/ai/gemini.ts` depending where prompts are built

**Steps:**

1. Antes de `planAutonomousAgent`, carregar ferramentas:

```ts
const mcpManager = await McpManager.getInstance();
const mcpTools = await mcpManager.getToolRefs();
```

2. Injetar no prompt de planejamento uma seção:

```text
Ferramentas MCP disponíveis:
- mcp:server:tool — descrição — schema resumido
```

3. Pedir ao LLM para retornar plano com `toolCalls?: Array<{ toolId, arguments, reason }>` quando precisar de dados externos.
4. Atualizar `FlowDecision` para aceitar `toolCalls` ou criar tipo específico `AgentToolCallPlan`.
5. Não executar ferramentas destrutivas automaticamente no primeiro passo. Para começo, permitir apenas ferramentas read-only ou explicitamente permitidas.

**Validation:**

Run:

```bash
npm run typecheck
```

Expected: tipos ajustados.

---

## Task 8: Add MCP tool-call loop during agent execution

**Objective:** Fazer o agente chamar ferramentas MCP e usar resultados para melhorar prompt/roteiro/projeto.

**Files:**
- Modify: `src/providers/flow/FlowAgent.ts`
- Modify/Create: `services/mcp/mcp.executor.ts`

**Steps:**

1. Criar método privado no `FlowAgent`:

```ts
private async runPlannedMcpToolCalls(jobId: string, calls: AgentToolCallPlan[]): Promise<string>
```

2. Para cada chamada:
   - logar evento `tool_call_started`
   - chamar executor
   - logar `tool_call_completed` ou `tool_call_failed`
   - acumular resultado resumido
3. Injetar resultados no contexto do prompt seguinte:

```text
Resultados das ferramentas MCP:
[toolId] reason
resultado resumido...
```

4. Adicionar limite:
   - máximo 3 chamadas MCP por etapa no começo
   - máximo 10 chamadas por job
   - tamanho máximo de resultado por chamada
5. Se uma ferramenta falha, continuar com fallback e registrar evento.

**Validation:**

Criar um servidor MCP simples de filesystem/time e executar um job de teste que peça explicitamente para usar MCP. Confirmar eventos em job events.

---

## Task 9: Add sample MCP presets

**Objective:** Facilitar configuração pelo usuário.

**Files:**
- Create: `services/mcp/mcp.presets.ts`
- Modify: `components/settings/McpSettingsPanel.tsx`

**Suggested presets:**

1. Filesystem restrito ao projeto:

```json
{
  "name": "Filesystem do MrChicken",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "D:/apps/mrchicken"],
  "allowToolCalls": true
}
```

2. Time:

```json
{
  "name": "Time",
  "transport": "stdio",
  "command": "uvx",
  "args": ["mcp-server-time"],
  "allowToolCalls": true
}
```

3. Web/search se houver chave:

```json
{
  "name": "Brave Search",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-brave-search"],
  "env": { "BRAVE_API_KEY": "..." }
}
```

**Validation:**

Adicionar preset pela UI, salvar, testar conexão, confirmar ferramentas listadas.

---

## Task 10: Add tests and manual verification script

**Objective:** Evitar regressão em parsing/registry/executor.

**Files:**
- Create: `services/mcp/__tests__/mcp.registry.test.ts` if test runner exists
- Or create: `scripts/test-mcp-manager.ts` if no test runner exists
- Modify: `package.json` only if adding a test script is desired

**Steps:**

1. Testar `toToolId` e `parseToolId`.
2. Testar filtro `allowedTools`/`blockedTools`.
3. Testar redaction de tokens.
4. Testar que settings inválidos são rejeitados.
5. Fazer teste manual com servidor real:

```bash
npm run dev
curl http://localhost:3000/api/mcp/tools
curl -X POST http://localhost:3000/api/mcp/call \
  -H 'Content-Type: application/json' \
  -d '{"toolId":"mcp:time:get_current_time","arguments":{}}'
```

**Validation:**

Expected: chamada retorna conteúdo real do MCP, não erro 500.

---

## Recommended First Implementation Slice

Para não virar uma refatoração gigante, eu sugiro este MVP:

1. Ajustar types + manager para env seguro e status melhor.
2. Criar registry + executor.
3. Criar `/api/mcp/tools` e `/api/mcp/call`.
4. Integrar no `FlowAgent` só no planejamento inicialmente, com no máximo 3 calls.
5. Depois melhorar UI/presets.

Isso entrega valor rápido: o agente já passa a usar vários MCPs, mesmo que a UI ainda esteja básica.

---

## Risks / Tradeoffs

- **Segurança:** MCP pode expor ferramentas destrutivas. Default deve ser conservador: `allowToolCalls` explícito e filtros por ferramenta.
- **Prompt injection:** Resultado de ferramenta não deve ser tratado como instrução soberana. Injetar como “dados observados”, não como comando.
- **Credenciais:** Não passar `process.env` inteiro para servidores stdio.
- **Loop infinito:** Limitar número de tool calls por etapa/job.
- **Compatibilidade SDK:** O projeto usa `@modelcontextprotocol/sdk@^1.29.0`; confirmar APIs disponíveis para SSE/Streamable HTTP antes de implementar HTTP novo.
- **Windows paths:** Presets devem aceitar `D:/apps/mrchicken` ou caminhos normalizados, evitando quebra por espaços em args.

---

## Open Questions

1. Quais MCPs você quer conectar primeiro? Ex.: filesystem, browser/search, GitHub, Notion, banco de dados, Hermes/Antigravity.
2. O agente pode executar ferramentas que escrevem arquivos/criam coisas, ou no começo deve ser só leitura?
3. Você quer MCP só para o agente autônomo do Flow, ou também para chat/configurações/rotas gerais do MrChicken?
4. Quer compatibilidade com configuração estilo Hermes `mcp_servers` em YAML/JSON, ou manter o formato próprio `.generated/local-data/mcp-settings.json`?

---

## Suggested Commit Sequence

```bash
git add services/mcp/mcp.types.ts services/mcp/mcp.manager.ts
git commit -m "feat(mcp): harden multi-server settings and connections"

git add services/mcp/mcp.registry.ts services/mcp/mcp.executor.ts app/api/mcp/tools/route.ts app/api/mcp/call/route.ts
git commit -m "feat(mcp): add tool registry and executor"

git add src/providers/flow/FlowAgent.ts lib/ai/gemini.ts
git commit -m "feat(agent): allow flow agent to use mcp tools"

git add components/settings/McpSettingsPanel.tsx services/mcp/mcp.presets.ts
git commit -m "feat(settings): improve mcp multi-server UI"
```
