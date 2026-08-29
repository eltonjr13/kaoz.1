import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const output = path.join(root, "dist", "electron-shell");

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(output, "build"), { recursive: true });
fs.cpSync(path.join(root, "electron"), path.join(output, "electron"), { recursive: true });
fs.copyFileSync(path.join(root, "build", "icon.png"), path.join(output, "build", "icon.png"));
fs.copyFileSync(path.join(root, "build", "icon.ico"), path.join(output, "build", "icon.ico"));

const manifest = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  description: sourcePackage.description,
  author: sourcePackage.author,
  private: true,
  main: "electron/main.cjs",
  dependencies: {
    "electron-updater": sourcePackage.dependencies["electron-updater"],
  },
};

fs.writeFileSync(path.join(output, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Shell Electron minimo preparado em ${output}`);
