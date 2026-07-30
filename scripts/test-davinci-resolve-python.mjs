import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const explicit =
  process.env.KAOZ_TEST_PYTHON?.trim() ||
  process.env.RESOLVE_PYTHON_EXECUTABLE?.trim();
const candidates = [
  explicit,
  path.join(
    root,
    "build",
    "runtime",
    "parakeet",
    "python",
    process.platform === "win32" ? "python.exe" : "python",
  ),
  process.platform === "win32" ? "py.exe" : "python3",
  process.platform === "win32" ? "python.exe" : "python",
].filter(Boolean);

const python = candidates.find(canRunPython);
if (!python) {
  throw new Error(
    "Python não encontrado para os testes do bridge DaVinci. Defina " +
      "KAOZ_TEST_PYTHON com o caminho absoluto do executável configurado.",
  );
}

const result = spawnSync(
  python,
  [
    "-m",
    "unittest",
    "discover",
    "-s",
    path.join("services", "mcp-servers", "davinci-resolve"),
    "-p",
    "test_*.py",
    "-v",
  ],
  {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  },
);

if (result.error) throw result.error;
if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}

function canRunPython(candidate) {
  if (
    (path.isAbsolute(candidate) || candidate.includes(path.sep)) &&
    !fs.existsSync(candidate)
  ) {
    return false;
  }
  const probe = spawnSync(candidate, ["--version"], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
    timeout: 10_000,
  });
  return !probe.error && probe.status === 0;
}
