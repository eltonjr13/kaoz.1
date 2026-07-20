const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const { stopProcessTree } = require("../electron/process-lifecycle.cjs");

test("encerra toda a arvore do servidor no Windows antes da atualizacao", async () => {
  const child = new EventEmitter();
  child.pid = 4321;
  child.exitCode = null;
  child.signalCode = null;
  const calls = [];
  const spawnProcess = (command, args, options) => {
    calls.push({ command, args, options });
    const killer = new EventEmitter();
    queueMicrotask(() => {
      child.exitCode = 0;
      child.emit("exit", 0);
      killer.emit("exit", 0);
    });
    return killer;
  };

  await stopProcessTree(child, { platform: "win32", spawnProcess, timeoutMs: 50 });
  assert.equal(calls[0].command, "taskkill.exe");
  assert.deepEqual(calls[0].args, ["/pid", "4321", "/T", "/F"]);
});
