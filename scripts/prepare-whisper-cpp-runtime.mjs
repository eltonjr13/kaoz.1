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

function vulkanBuildDefinitions() {
  const sdkRoot = process.env.VULKAN_SDK?.trim();
  if (!sdkRoot) return null;
  const include = path.join(sdkRoot, "Include");
  const library = path.join(sdkRoot, "Lib", "vulkan-1.lib");
  const glslc = path.join(sdkRoot, "Bin", "glslc.exe");
  if (![path.join(include, "vulkan", "vulkan.h"), library, glslc].every(fs.existsSync)) return null;
  return [
    "-DGGML_VULKAN=ON",
    `-DVulkan_INCLUDE_DIR=${include}`,
    `-DVulkan_LIBRARY=${library}`,
    `-DVulkan_GLSLC_EXECUTABLE=${glslc}`,
  ];
}

function buildVulkanRuntime() {
  const definitions = vulkanBuildDefinitions();
  if (definitions) {
    buildRuntime("vulkan", definitions);
    return true;
  }
  const message = "Vulkan SDK incompleto ou ausente. Configure VULKAN_SDK com Include, Lib/vulkan-1.lib e Bin/glslc.exe.";
  if (process.env.REQUIRE_WHISPER_VULKAN === "1") throw new Error(message);
  console.warn(`${message} O pacote local sera preparado apenas com o fallback CPU.`);
  return false;
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
const vulkanReady = buildVulkanRuntime();

console.log(`Runtime whisper.cpp ${vulkanReady ? "CPU/Vulkan" : "CPU"} preparado em ${runtimeRoot}`);
