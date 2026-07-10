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
  isLikelyActionRequest,
} = await import(pathToFileURL(path.join(workspaceRoot, "lib/ai/gemini.ts")).href);

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
const response = await chatWithAgent(
  messages,
  null,
  async (compiledPrompt) => {
    capturedPrompt = compiledPrompt;

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
assert.equal(response.action?.flow, "image");
assert.match(response.action?.optimizedPrompt ?? "", /painter/i);
assert.doesNotMatch(response.action?.optimizedPrompt ?? "", /math/i);

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
console.log("PASS: sem contexto imediato suficiente, o chatbot pede esclarecimento e não cria uma ação.");
