import assert from "node:assert/strict";
import test from "node:test";
import { detectQuickIntent, noteTitle } from "../lib/quick-assistant/intent.ts";

test("registra somente ditado de nota explícito e preserva o conteúdo", () => {
  assert.deepEqual(detectQuickIntent("Anote minha ideia: lançar um app\ncom reunião"), {
    kind: "note",
    content: "lançar um app\ncom reunião",
  });
  assert.equal(noteTitle("Uma ideia longa para um produto"), "Uma ideia longa para um produto");
  assert.deepEqual(detectQuickIntent("Pense comigo sobre notas"), { kind: "chat" });
});

test("abre somente aplicativos cadastrados e bloqueia pedido local desconhecido", () => {
  assert.deepEqual(detectQuickIntent("Abra o bloco de notas"), { kind: "open", targetId: "notepad" });
  assert.deepEqual(detectQuickIntent("Por favor, abra o VS Code"), { kind: "open", targetId: "workspace-vscode" });
  assert.deepEqual(detectQuickIntent("abra o Chrome"), { kind: "unsupported-local-action" });
  assert.deepEqual(detectQuickIntent("Me ajude a planejar um app"), { kind: "chat" });
});

test("cria um projeto a partir da ideia e só solicita VS Code quando explícito", () => {
  assert.deepEqual(detectQuickIntent("Inicie um projeto para organizar reuniões"), {
    kind: "project", idea: "organizar reuniões", openInCode: false,
  });
  assert.deepEqual(detectQuickIntent("Crie um projeto para planejar o lançamento e abra no VS Code"), {
    kind: "project", idea: "planejar o lançamento", openInCode: true,
  });
});
