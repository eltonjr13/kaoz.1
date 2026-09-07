import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { load } = createRequire(require.resolve("electron-updater"))("js-yaml");

const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const releaseDir = path.join(root, "release");
const installerName = `Kaoz.1-Setup-${version}.exe`;
const required = [installerName, `${installerName}.blockmap`, "latest.yml"];

for (const name of required) {
  const file = path.join(releaseDir, name);
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    throw new Error(`Asset obrigatório ausente ou vazio: release/${name}`);
  }
}

const manifest = load(fs.readFileSync(path.join(releaseDir, "latest.yml"), "utf8"));
if (manifest?.version !== version) {
  throw new Error(`latest.yml não aponta para a versão ${version}.`);
}
const installerEntry = manifest.files?.find((file) => file.url === installerName);
if (manifest.path !== installerName || !installerEntry) {
  throw new Error(`latest.yml não referencia ${installerName} com sha512.`);
}

const installer = fs.readFileSync(path.join(releaseDir, installerName));
const sha512 = crypto.createHash("sha512").update(installer).digest("base64");
if (manifest.sha512 !== sha512 || installerEntry.sha512 !== sha512 || installerEntry.size !== installer.length) {
  throw new Error("O tamanho ou SHA512 do instalador nao corresponde ao latest.yml.");
}
const sha256 = crypto.createHash("sha256").update(installer).digest("hex").toUpperCase();
console.log(`Release ${version} validada: ${required.join(", ")}`);
console.log(`SHA256 ${installerName}: ${sha256}`);
