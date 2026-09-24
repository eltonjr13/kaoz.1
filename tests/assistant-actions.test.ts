import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { POST as openTarget } from "../app/api/assistant/open/route.ts";
import { POST as createProjectRoute } from "../app/api/assistant/projects/route.ts";
import { AssistantNotesStore } from "../services/assistant/assistant-notes.store.ts";
import { createAssistantProject } from "../services/assistant/assistant-projects.ts";

test("notas persistem, aceitam edição e preservam um arquivo inválido", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kaoz-assistant-notes-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "assistant-notes.json");
  const store = new AssistantNotesStore(filePath);

  const first = await store.create({ title: " Ideia da campanha ", content: "Primeiro rascunho" });
  assert.equal(first.title, "Ideia da campanha");
  assert.equal((await store.find(first.id))?.content, "Primeiro rascunho");

  const updated = await store.update(first.id, { content: "Rascunho revisado" });
  assert.equal(updated?.content, "Rascunho revisado");
  assert.equal((await new AssistantNotesStore(filePath).list())[0]?.content, "Rascunho revisado");

  await assert.rejects(store.create({ title: " ", content: "Sem título" }));
  assert.equal((await store.list()).length, 1);

  await writeFile(filePath, "dados que precisam ser recuperados", "utf8");
  await assert.rejects(store.create({ title: "Outra nota" }));
  assert.equal(await readFile(filePath, "utf8"), "dados que precisam ser recuperados");
});

test("API de abertura bloqueia outra origem e destinos fora da lista", async () => {
  const prior = process.env.KAOZ1_DESKTOP;
  process.env.KAOZ1_DESKTOP = "1";
  try {
    const makeRequest = (origin: string, targetId: string) => new Request(
      "http://127.0.0.1:3000/api/assistant/open",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ targetId }),
      },
    );
    const foreignOrigin = await openTarget(makeRequest("https://example.com", "notepad"));
    assert.equal(foreignOrigin.status, 403);

    const unsupported = await openTarget(makeRequest("http://127.0.0.1:3000", "powershell"));
    assert.equal(unsupported.status, 400);
    assert.match((await unsupported.json()).error, /não permitido|indisponível/i);

    const plainText = await openTarget(new Request("http://127.0.0.1:3000/api/assistant/open", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3000", "content-type": "text/plain" },
      body: "notepad",
    }));
    assert.equal(plainText.status, 400);

    process.env.KAOZ1_DESKTOP = "0";
    const browserOnly = await openTarget(makeRequest("http://127.0.0.1:3000", "notepad"));
    assert.equal(browserOnly.status, 403);
  } finally {
    if (prior === undefined) delete process.env.KAOZ1_DESKTOP;
    else process.env.KAOZ1_DESKTOP = prior;
  }
});

test("projetos criam briefings editáveis sem sobrescrever títulos repetidos", async (context) => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "kaoz-assistant-projects-"));
  context.after(() => rm(workspaceDir, { recursive: true, force: true }));
  const opened: string[] = [];
  const options = {
    workspaceDir,
    openCode: async (folderPath: string) => { opened.push(folderPath); return true; },
  };

  const first = await createAssistantProject({ title: "Minha / Ideia", idea: "Texto inicial" }, options);
  const second = await createAssistantProject({ title: "Minha / Ideia", idea: "Outra proposta", openInCode: true }, options);

  assert.equal(first.project.id, "ideia-minha-ideia");
  assert.equal(second.project.id, "ideia-minha-ideia-2");
  assert.equal(path.dirname(first.project.folderPath), workspaceDir);
  assert.equal(path.dirname(second.project.folderPath), workspaceDir);
  assert.match(await readFile(first.project.briefPath, "utf8"), /Texto inicial/);
  assert.match(await readFile(second.project.briefPath, "utf8"), /Outra proposta/);
  assert.deepEqual(opened, [second.project.folderPath]);
  assert.equal(second.project.openedInCode, true);

  const sanitized = await createAssistantProject({ title: "../../CON", idea: "Seguro" }, options);
  assert.equal(path.dirname(sanitized.project.folderPath), workspaceDir);
  assert.equal(sanitized.project.id, "ideia-con");
  await assert.rejects(createAssistantProject({ title: " ", idea: "Válida" }, options));
  await assert.rejects(createAssistantProject({ title: "Válido", idea: " " }, options));
});

test("API de projetos rejeita dados inválidos antes de criar arquivos", async () => {
  const prior = process.env.KAOZ1_DESKTOP;
  process.env.KAOZ1_DESKTOP = "1";
  try {
    const response = await createProjectRoute(new Request("http://127.0.0.1:3000/api/assistant/projects", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000" },
      body: JSON.stringify({ title: "", idea: "Uma ideia" }),
    }));
    assert.equal(response.status, 400);
  } finally {
    if (prior === undefined) delete process.env.KAOZ1_DESKTOP;
    else process.env.KAOZ1_DESKTOP = prior;
  }
});
