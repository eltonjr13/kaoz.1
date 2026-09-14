/**
 * Confere que o pacote instalado no runtime do Electron é íntegro e que o motor
 * o resolve quando KAOZ1_DATA_DIR aponta para lá (como no app empacotado).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const electronRoot = path.join(os.homedir(), "AppData", "Roaming", "Kaoz.1", "generated");
const repoPackage = path.resolve(".generated/local-data/cortex-engine/packages/male-cns-v1.0");
const electronPackage = path.join(
  electronRoot,
  "local-data",
  "cortex-engine",
  "packages",
  "male-cns-v1.0"
);

console.log("runtime do Electron:", electronRoot);
console.log("pacote esperado em :", electronPackage);

const a = JSON.parse(fs.readFileSync(path.join(repoPackage, "integrity.json"), "utf8"));
const b = JSON.parse(fs.readFileSync(path.join(electronPackage, "integrity.json"), "utf8"));
console.log("\nhashes identicos entre repo e Electron:", JSON.stringify(a) === JSON.stringify(b));
for (const k of Object.keys(a)) {
  console.log(`   ${k}: ${a[k] === b[k] ? "IDENTICO" : "DIFERENTE"}`);
}

// Simula o app empacotado: o runtime root passa a ser o do Electron.
process.env.KAOZ1_DATA_DIR = electronRoot;
const st = await import("../../services/cortex-engine/engine-status.ts");
const cfg = await import("../../services/cortex-engine/cortex-engine.settings.ts");

console.log("\npacoteDir resolvido:", st.defaultPackageDir());
const settings = await cfg.loadSettings();
const s = await st.engineStatus(settings);
console.log("\n=== estado do motor como o APP EMPACOTADO veria ===");
console.log("  packageAvailable:", s.packageAvailable);
console.log("  packageVersion  :", s.packageVersion);
console.log("  readoutAvailable:", s.readoutAvailable);
console.log("  readoutVersion  :", s.readoutVersion);
console.log("  configuredMode  :", s.configuredMode);
console.log("  effectiveMode   :", s.effectiveMode);
console.log("  status          :", s.status);
console.log("\n  scopeNotice:", s.scopeNotice);
