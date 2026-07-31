import test from "node:test";
import assert from "node:assert/strict";
import { canFinishAfterPlaywrightMcpTool, compactInlinePrompt, compactToolSchema, connectorPublishProvider, connectorToolErrorResponse, connectorToolResultResponse, isExplicitPlaywrightMcpRequest, missingConnectorToolCallInstruction, missingMcpMentionToolCallInstruction, missingPlaywrightToolCallInstruction, requiredPlaywrightMcpContinuation, selectExplicitPlaywrightMcpTools, shouldSelectSkillTools } from "../services/agent-llm/agent-llm.prompt.ts";
import { activeMcpMentionQuery, buildMcpMentionOptions, extractMcpMention, replaceActiveMcpMention, selectMentionedMcpTools } from "../services/mcp/mcp-mention.ts";

test("compacta prompt grande preservando sistema, cauda e pedido atual", () => {
  const latest = "Encontre tendências virais recentes sobre inteligência artificial para pequenos negócios.";
  const prompt = `[SYSTEM INSTRUCTIONS]:\nREGRA-ESSENCIAL\n${"contexto antigo ".repeat(3_000)}\nUSUARIO:\n${latest}\n\n[INSTRUCAO FINAL]:\nRESPONDA-JSON`;
  const compact = compactInlinePrompt(prompt, 27_500, latest);
  assert.equal(compact.length, 27_500);
  assert.match(compact, /REGRA-ESSENCIAL/);
  assert.match(compact, /RESPONDA-JSON/);
  assert.match(compact, /Encontre tendências virais recentes/);
  assert.match(compact, /CONTEXTO INTERMEDIARIO COMPACTADO/);
});

test("não altera prompt que já cabe no limite", () => {
  assert.equal(compactInlinePrompt("prompt curto", 100, "pedido"), "prompt curto");
});

test("reduz schema de ferramenta sem perder campos operacionais", () => {
  const compact = compactToolSchema({
    type: "object",
    required: ["query"],
    properties: { query: { type: "string", description: "descrição muito longa" }, limit: { type: "number", enum: [5, 10] } },
    additionalProperties: false,
  });
  assert.deepEqual(compact, {
    type: "object",
    required: ["query"],
    properties: { query: { type: "string" }, limit: { type: "number", enum: [5, 10] } },
    additionalProperties: false,
  });
});

test("pedido direto de publicação seleciona o conector sem confirmação redundante", () => {
  assert.equal(connectorPublishProvider("Envie uma mensagem no Discord"), "discord");
  assert.equal(connectorPublishProvider("Publique no Bluesky: novidade lançada"), "bluesky");
  assert.equal(connectorPublishProvider("Envie uma mensagem no Telegram"), "telegram");
  assert.equal(connectorPublishProvider("Explique como funciona o Discord"), null);
  assert.equal(connectorPublishProvider("Escreva uma mensagem para o Discord, mas não envie"), null);
});

test("resposta sem tool call gera correção obrigatória sem fingir publicação", () => {
  const instruction = missingConnectorToolCallInstruction("discord", "Pode deixar, vou mandar agora!");
  assert.match(instruction, /PUBLICACAO NAO EXECUTADA/);
  assert.match(instruction, /social:discord:publish/);
  assert.match(instruction, /CONTEUDO FINAL COMPLETO/);
  assert.match(instruction, /Nao escreva promessa/);
});

test("publicação concluída retorna confirmação determinística sem nova chamada ao modelo", () => {
  const response = JSON.parse(connectorToolResultResponse("discord", { output: { remoteId: "123", url: "https://discord.com/channels/1/2/123" } }));
  assert.equal(response.action, null);
  assert.match(response.message, /Publicado no Discord com sucesso/);
  assert.match(response.message, /123/);
});

test("confirma publicação no Telegram", () => {
  const response = JSON.parse(connectorToolResultResponse("telegram", { output: { remoteId: "99" } }));
  assert.match(response.message, /Publicado no Telegram com sucesso/);
});

test("falha do conector retorna erro real e afirma que nada foi enviado", () => {
  const response = JSON.parse(connectorToolErrorResponse("bluesky", new Error("HTTP 429")));
  assert.equal(response.action, null);
  assert.match(response.message, /HTTP 429/);
  assert.match(response.message, /Nada foi enviado/);
});

test("pedido explícito pelo Playwright seleciona somente as ferramentas desse MCP", () => {
  assert.equal(isExplicitPlaywrightMcpRequest("Use exclusivamente o MCP Playwright Browser."), true);
  assert.equal(isExplicitPlaywrightMcpRequest("Abra o navegador sem indicar MCP."), false);
  assert.deepEqual(
    selectExplicitPlaywrightMcpTools([
      { id: "mcp:playwright-browser:browser_snapshot" },
      { id: "mcp:playwright-browser:browser_click" },
      { id: "mcp:spotify:search_tracks" },
      { id: "mcp:playwright-browser:browser_navigate" },
      { id: "mcp:playwright-browser:browser_wait_for" },
      { id: "native:web-research" },
    ]),
    [
      { id: "mcp:playwright-browser:browser_navigate" },
      { id: "mcp:playwright-browser:browser_wait_for" },
      { id: "mcp:playwright-browser:browser_snapshot" },
      { id: "mcp:playwright-browser:browser_click" },
    ],
  );
});

test("pedido Playwright exclusivo não é sobrescrito pela seleção genérica de skill", () => {
  assert.equal(shouldSelectSkillTools(true, false, false), false);
  assert.equal(shouldSelectSkillTools(false, false, false), true);
  assert.equal(shouldSelectSkillTools(false, true, false), false);
  assert.equal(shouldSelectSkillTools(false, false, true), false);
  assert.equal(shouldSelectSkillTools(false, false, false, true), false);
});

test("mencao @ seleciona somente as ferramentas do MCP indicado", () => {
  const tools = [
    { id: "mcp:playwright-browser:browser_navigate" },
    { id: "mcp:playwright-browser:browser_snapshot" },
    { id: "mcp:spotify-mcp-server-local:search_tracks" },
    { id: "native:web-research" },
  ];
  const servers = [
    { id: "playwright-browser", name: "Playwright Browser", presetId: "playwright-browser" },
    { id: "spotify-mcp-server-local", name: "Spotify API" },
  ];

  assert.equal(extractMcpMention("@playwright abra o YouTube"), "playwright");
  assert.equal(extractMcpMention("envie para usuario@example.com"), null);
  assert.deepEqual(selectMentionedMcpTools(tools, "@spotify busque uma faixa", servers), [tools[2]]);
  assert.deepEqual(selectMentionedMcpTools(tools, "@playwright abra o YouTube", servers), [tools[0], tools[1]]);
  assert.deepEqual(selectMentionedMcpTools(tools, "@desconhecido teste", servers), []);
});

test("autocomplete MCP cria aliases legiveis e preserva o texto ao selecionar", () => {
  const options = buildMcpMentionOptions({
    settings: {
      servers: [
        { id: "playwright-browser", presetId: "playwright-browser", name: "Playwright Browser", enabled: true, transport: "stdio" },
        { id: "server-uuid", name: "Chrome Automator", enabled: true, transport: "stdio" },
        { id: "disabled", name: "Desabilitado", enabled: false, transport: "stdio" },
      ],
    },
    statuses: [
      { id: "playwright-browser", connected: true, error: null, tools: [{ name: "browser_navigate", inputSchema: {} }] },
      { id: "server-uuid", connected: false, error: "offline", tools: [] },
    ],
  });

  assert.deepEqual(options.map((option) => option.alias), ["playwright", "chrome"]);
  assert.equal(options[0].connected, true);
  assert.equal(options[0].toolCount, 1);
  assert.equal(activeMcpMentionQuery("faca isso com @play"), "play");
  assert.equal(replaceActiveMcpMention("faca isso com @play", "playwright"), "faca isso com @playwright ");
});

test("resposta generica sem chamada recebe correcao para o MCP mencionado", () => {
  const instruction = missingMcpMentionToolCallInstruction("spotify", "nao esta disponivel");
  assert.match(instruction, /MCP @spotify NAO EXECUTADO/);
  assert.match(instruction, /ID LISTADO ACIMA/);
});

test("resposta sem tool call recebe correção para usar as ferramentas do host", () => {
  const instruction = missingPlaywrightToolCallInstruction(
    "Apenas StitchMCP está disponível.",
  );
  assert.match(instruction, /PLAYWRIGHT MCP NAO EXECUTADO/);
  assert.match(instruction, /fornecidas pelo host Kaoz\.1/);
  assert.match(instruction, /ID LISTADO ACIMA/);
  assert.match(instruction, /Nao mencione StitchMCP/);
});

test("continuação Playwright respeita a sequência navegar, aguardar e capturar", () => {
  const prompt = `[HISTORICO DA CONVERSA]:
USUARIO:
Use exclusivamente o MCP Playwright Browser. Abra o canal, aguarde 5 segundos, leia o primeiro vídeo e informe título e data. Não use pesquisa web.

KAOZ.1 (VOCE):
Aguardando aprovação.

USUARIO:
aprovar ABC123`;
  const tools = [
    "mcp:playwright-browser:browser_navigate",
    "mcp:playwright-browser:browser_wait_for",
    "mcp:playwright-browser:browser_snapshot",
  ];

  assert.deepEqual(
    requiredPlaywrightMcpContinuation(prompt, tools[0], tools),
    { toolId: tools[1], args: { time: 5 } },
  );
  assert.deepEqual(
    requiredPlaywrightMcpContinuation(prompt, tools[1], tools),
    { toolId: tools[2], args: {} },
  );
  assert.equal(requiredPlaywrightMcpContinuation(prompt, tools[2], tools), null);
  assert.equal(canFinishAfterPlaywrightMcpTool(tools[2]), true);
  assert.equal(canFinishAfterPlaywrightMcpTool(tools[0]), false);
  assert.equal(canFinishAfterPlaywrightMcpTool("mcp:playwright-browser:browser_take_screenshot"), true);
});

test("continuação usa o pedido Playwright mais recente, não um histórico antigo", () => {
  const prompt = `USUARIO:
Use o MCP Playwright Browser, aguarde 30 segundos e leia a página.

KAOZ.1 (VOCE):
Concluído.

USUÁRIO:
Use o MCP Playwright Browser, aguarde 2 segundos e informe o título.

KAOZ.1 (VOCÊ):
Aguardando aprovação.

USUÁRIO:
aprovar TOKEN`;
  const waitTool = "mcp:playwright-browser:browser_wait_for";
  assert.deepEqual(
    requiredPlaywrightMcpContinuation(
      prompt,
      "mcp:playwright-browser:browser_navigate",
      [waitTool],
    ),
    { toolId: waitTool, args: { time: 2 } },
  );
});
