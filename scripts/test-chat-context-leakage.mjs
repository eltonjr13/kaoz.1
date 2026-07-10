import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveWorkspaceModule(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.mjs`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.js"),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

// The application uses TypeScript path aliases and extensionless imports. This
// hook lets current Node versions load the real source with built-in type
// stripping, without a test framework or a network dependency.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let resolvedPath;

    if (specifier.startsWith("@/")) {
      resolvedPath = resolveWorkspaceModule(path.join(workspaceRoot, specifier.slice(2)));
    } else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      resolvedPath = resolveWorkspaceModule(fileURLToPath(new URL(specifier, context.parentURL)));
    }

    if (resolvedPath) {
      return { url: pathToFileURL(resolvedPath).href, shortCircuit: true };
    }

    return nextResolve(specifier, context);
  },
});

const {
  chatWithAgent,
  isContextDependentActionRequest,
  isImmediateContextReference,
  isLikelyActionRequest,
} = await import(pathToFileURL(path.join(workspaceRoot, "lib/ai/gemini.ts")).href);
const {
  extractLatestUserPrompt,
  getForcedSpotifyToolName,
} = await import(pathToFileURL(path.join(
  workspaceRoot,
  "services/agent-llm/agent-llm.service.ts",
)).href);

const messages = [
  {
    role: "user",
    parts: [{ text: "Estou com problemas em matemática." }],
  },
  {
    role: "model",
    parts: [{ text: "Posso ajudar com matemática quando você quiser." }],
  },
  {
    role: "user",
    parts: [{ text: "Mude de assunto e me conte uma história com emoção." }],
  },
  {
    role: "model",
    parts: [{
      text: "Ao anoitecer, um pintor triste permaneceu sozinho na praça diante de uma tela vazia. Quando uma criança deixou uma flor ao lado de seus pincéis, ele voltou a pintar e encontrou esperança nas cores.",
    }],
  },
  {
    role: "user",
    parts: [{ text: "Gostei da história, gera uma ilustração sobre." }],
  },
];

assert.equal(isLikelyActionRequest(messages), true);
assert.equal(isContextDependentActionRequest(messages), true);
assert.equal(isContextDependentActionRequest([
  { role: "user", parts: [{ text: "Gere uma imagem sobre matemática." }] },
]), false);

let capturedPrompt = "";
let capturedQueryOptions;
const response = await chatWithAgent(
  messages,
  null,
  async (compiledPrompt, _referenceImagePath, queryOptions) => {
    capturedPrompt = compiledPrompt;
    capturedQueryOptions = queryOptions;

    return JSON.stringify({
      message: "Vou ilustrar o momento mais emotivo da história.",
      action: {
        flow: "image",
        optimizedPrompt: "Emotional storybook illustration of a sad painter alone in a town square at dusk, finding hope after a child leaves a flower beside his brushes, expressive lighting and painterly colors",
        explanation: "A ilustração usa o pintor e a virada emocional da história imediatamente anterior.",
      },
    });
  },
  undefined,
  {
    useCortexMemory: true,
    relevantMemories: "- O usuário costuma estudar matemática e prefere imagens com fórmulas.",
    activeMemories: [{
      status: "active",
      kind: "user_preference",
      content: "Usuário prefere matemática como tema visual.",
    }],
  },
);

assert.match(capturedPrompt, /pintor triste/i);
assert.doesNotMatch(capturedPrompt, /matem[aá]tica/i);
assert.match(capturedPrompt, /CONTEXTO IMEDIATO - ÚNICA FONTE/i);
assert.equal(
  extractLatestUserPrompt(capturedPrompt),
  "Gostei da história, gera uma ilustração sobre.",
);
assert.equal(
  capturedQueryOptions?.toolIntentText,
  "Gostei da história, gera uma ilustração sobre.",
);
assert.equal(capturedQueryOptions?.useExternalTools, false);
assert.equal(
  getForcedSpotifyToolName("nenhum topico anterior pode definir o sujeito da imagem ou video"),
  null,
);
assert.equal(
  getForcedSpotifyToolName("volte para a musica anterior no spotify"),
  "previous_track",
);
assert.equal(response.action?.flow, "image");
assert.match(response.action?.optimizedPrompt ?? "", /painter/i);
assert.doesNotMatch(response.action?.optimizedPrompt ?? "", /math/i);

const alligatorJokeMessages = [
  {
    role: "user",
    parts: [{ text: "Estou com problemas no livro de matemática." }],
  },
  {
    role: "model",
    parts: [{ text: "Elias estava triste em um banco da praça e desenhou um sol vermelho para uma menina." }],
  },
  {
    role: "user",
    parts: [{ text: "Ok, mas eu quero outra piada engraçada." }],
  },
  {
    role: "model",
    parts: [{
      text: "Por que o jacaré tirou o jacarezinho da escola? Porque ele era réptil de ano.",
    }],
  },
  {
    role: "user",
    parts: [{ text: "Essa foi engraçada, gera uma ilustração estilo HQ dessa piada." }],
  },
];

assert.equal(isImmediateContextReference(alligatorJokeMessages), true);
assert.equal(isContextDependentActionRequest(alligatorJokeMessages), true);

let alligatorPrompt = "";
const alligatorResponse = await chatWithAgent(
  alligatorJokeMessages,
  null,
  async (compiledPrompt) => {
    alligatorPrompt = compiledPrompt;
    return JSON.stringify({
      message: "Vou transformar a última piada em uma cena de HQ.",
      action: {
        flow: "image",
        optimizedPrompt: "Humorous comic-book illustration of an alligator parent taking a young alligator out of school after repeating the grade, playful classroom setting, expressive characters, bold ink outlines and colorful panels",
        explanation: "O prompt representa exclusivamente a piada do jacaré contada imediatamente antes.",
      },
    });
  },
  undefined,
  {
    useCortexMemory: true,
    relevantMemories: "- O usuário prefere ilustrações sobre livros de matemática.",
  },
);

assert.match(alligatorPrompt, /jacaré tirou o jacarezinho/i);
assert.doesNotMatch(alligatorPrompt, /Elias|matem[aá]tica/i);
assert.match(alligatorPrompt, /ÚNICA FONTE PARA O SUJEITO/i);
assert.match(alligatorResponse.action?.optimizedPrompt ?? "", /alligator/i);

let recoveryPrompt = "";
const recoveryMessages = [
  ...alligatorJokeMessages,
  {
    role: "model",
    parts: [{ text: "De qual piada você está falando: a história de Elias ou a do livro de matemática?" }],
  },
  {
    role: "user",
    parts: [{ text: "Eu estou pensando dessa que você falou por último." }],
  },
];

assert.equal(isImmediateContextReference(recoveryMessages), true);
const recoveryResponse = await chatWithAgent(
  recoveryMessages,
  null,
  async (compiledPrompt) => {
    recoveryPrompt = compiledPrompt;
    return "Você está falando da piada do jacaré que era réptil de ano.";
  },
  undefined,
  {
    useCortexMemory: true,
    relevantMemories: "- Contexto persistente sobre álgebra avançada.",
  },
);

assert.match(recoveryPrompt, /jacaré tirou o jacarezinho/i);
assert.match(recoveryPrompt, /REGRA DE REFERÊNCIA RECENTE/i);
assert.doesNotMatch(recoveryPrompt, /álgebra avançada/i);
assert.match(recoveryResponse.message, /jacaré/i);

let modelWasCalled = false;
const clarification = await chatWithAgent(
  [{ role: "user", parts: [{ text: "Gera uma ilustração sobre isso." }] }],
  null,
  async () => {
    modelWasCalled = true;
    return "{}";
  },
);

assert.equal(modelWasCalled, false);
assert.equal(clarification.action, null);
assert.match(clarification.message, /qual conteúdo/i);

console.log("PASS: o prompt usa o pintor da história imediata e exclui matemática/memórias antigas.");
console.log("PASS: 'dessa piada' ancora a ação somente na piada mais recente do jacaré.");
console.log("PASS: 'que você falou por último' usa a janela recente e ignora o Cortex.");
console.log("PASS: a seção de grounding não vaza para a intenção de ferramentas nem força previous_track.");
console.log("PASS: sem contexto imediato suficiente, o chatbot pede esclarecimento e não cria uma ação.");
