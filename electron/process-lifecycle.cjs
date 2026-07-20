const { spawn } = require("node:child_process");

function waitForExit(child, timeoutMs = 5_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
}

function runTaskkill(pid, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    const killer = spawnProcess("taskkill.exe", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore"
    });
    killer.once("error", reject);
    killer.once("exit", (code) => code === 0 || code === 128
      ? resolve()
      : reject(new Error(`Nao foi possivel encerrar o servidor local (taskkill ${code}).`)));
  });
}

async function stopProcessTree(child, options = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const platform = options.platform || process.platform;
  const timeoutMs = options.timeoutMs || 5_000;

  if (platform === "win32" && child.pid) {
    await runTaskkill(child.pid, options.spawnProcess);
    await waitForExit(child, timeoutMs);
    return;
  }

  child.kill("SIGTERM");
  if (await waitForExit(child, timeoutMs)) return;
  child.kill("SIGKILL");
  await waitForExit(child, timeoutMs);
}

module.exports = { runTaskkill, stopProcessTree, waitForExit };
