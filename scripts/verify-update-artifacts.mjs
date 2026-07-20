import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const releaseDir = path.join(root, "release");
const installerName = `MrChicken-Setup-${version}.exe`;
const required = [installerName, `${installerName}.blockmap`, "latest.yml"];

for (const name of required) {
  const file = path.join(releaseDir, name);
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    throw new Error(`Asset obrigatório ausente ou vazio: release/${name}`);
  }
}

const manifest = fs.readFileSync(path.join(releaseDir, "latest.yml"), "utf8");
if (!new RegExp(`^version:\\s*["']?${version.replaceAll(".", "\\.")}["']?\\s*$`, "m").test(manifest)) {
  throw new Error(`latest.yml não aponta para a versão ${version}.`);
}
if (!manifest.includes(installerName) || !/^sha512:\s*\S+/m.test(manifest)) {
  throw new Error(`latest.yml não referencia ${installerName} com sha512.`);
}

const installer = fs.readFileSync(path.join(releaseDir, installerName));
const sha256 = crypto.createHash("sha256").update(installer).digest("hex").toUpperCase();
console.log(`Release ${version} validada: ${required.join(", ")}`);
console.log(`SHA256 ${installerName}: ${sha256}`);
