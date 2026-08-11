import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const VERSION = "v1.9.2";
const root = process.cwd();
const cacheRoot = path.join(root, "build", "cache", `whisper.cpp-${VERSION}`);
const archive = path.join(cacheRoot, "source.zip");
const sourceParent = path.join(cacheRoot, "source");
const sourceRoot = path.join(sourceParent, `whisper.cpp-${VERSION.slice(1)}`);
const runtimeRoot = path.join(root, "build", "runtime", "whisper-cpp");

function run(file, args) {
  execFileSync(file, args, { cwd: root, stdio: "inherit" });
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download falhou (${response.status}): ${url}`);
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

function copyRelease(buildRoot, destination) {
  const release = path.join(buildRoot, "bin", "Release");
  if (!fs.existsSync(path.join(release, "whisper-server.exe"))) {
    throw new Error(`whisper-server.exe nao foi gerado em ${release}`);
  }
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(release, destination, { recursive: true });
}

function buildRuntime(name, definitions) {
  const destination = path.join(runtimeRoot, name);
  if (fs.existsSync(path.join(destination, "whisper-server.exe"))) return;
  const buildRoot = path.join(cacheRoot, `build-${name}`);
  run("cmake", ["-S", sourceRoot, "-B", buildRoot, "-DGGML_NATIVE=OFF", "-DWHISPER_BUILD_TESTS=OFF", ...definitions]);
  run("cmake", ["--build", buildRoot, "--config", "Release", "-j"]);
  copyRelease(buildRoot, destination);
}

if (process.platform !== "win32") {
  console.log("Runtime whisper.cpp desktop e preparado apenas para Windows.");
  process.exit(0);
}

fs.mkdirSync(cacheRoot, { recursive: true });
fs.mkdirSync(runtimeRoot, { recursive: true });

if (!fs.existsSync(sourceRoot)) {
  if (!fs.existsSync(archive)) {
    console.log(`Baixando fontes do whisper.cpp ${VERSION}...`);
    await download(`https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${VERSION}.zip`, archive);
  }
  fs.rmSync(sourceParent, { recursive: true, force: true });
  run("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${sourceParent}' -Force`]);
}

buildRuntime("cpu", ["-DGGML_VULKAN=OFF"]);
buildRuntime("vulkan", ["-DGGML_VULKAN=ON"]);

console.log(`Runtime whisper.cpp CPU/Vulkan preparado em ${runtimeRoot}`);
