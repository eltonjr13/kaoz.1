import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const runtimeRoot = path.join(root, "build", "runtime", "parakeet");
const pythonRoot = path.join(runtimeRoot, "python");
const packagesRoot = path.join(runtimeRoot, "packages");
const pythonExe = path.join(pythonRoot, "python.exe");
const marker = path.join(packagesRoot, "onnx_asr", "__init__.py");
const pythonZip = path.join(runtimeRoot, "python-embed.zip");
const getPip = path.join(runtimeRoot, "get-pip.py");

function run(file, args) {
  execFileSync(file, args, { cwd: root, stdio: "inherit" });
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download falhou (${response.status}): ${url}`);
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

fs.mkdirSync(runtimeRoot, { recursive: true });

if (!fs.existsSync(pythonExe)) {
  console.log("Baixando runtime Python portatil para o Parakeet...");
  await download("https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip", pythonZip);
  run("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${pythonZip}' -DestinationPath '${pythonRoot}' -Force`]);
}

// The embedded Python runs in isolated mode and deliberately ignores
// PYTHONPATH. Register our sibling dependency folder in its ._pth file so the
// packaged server can import onnx_asr, onnxruntime and soundfile.
const pth = path.join(pythonRoot, "python312._pth");
fs.writeFileSync(pth, "python312.zip\n.\n../packages\nimport site\n", "utf8");

if (!fs.existsSync(marker)) {
  console.log("Preparando dependencias locais do Parakeet...");
  await download("https://bootstrap.pypa.io/get-pip.py", getPip);
  run(pythonExe, [getPip, "--no-warn-script-location"]);
  run(pythonExe, ["-m", "pip", "install", "--no-cache-dir", "--target", packagesRoot, "onnx-asr==0.11.0", "onnxruntime==1.27.0", "soundfile==0.14.0", "huggingface_hub==1.23.0"]);
}

console.log(`Runtime Parakeet preparado em ${runtimeRoot}`);
