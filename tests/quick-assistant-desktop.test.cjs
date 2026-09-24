const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "electron", "main.cjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "electron", "quick-assistant-preload.cjs"), "utf8");
const desktopPreload = fs.readFileSync(path.join(root, "electron", "preload.cjs"), "utf8");

test("painel rápido abre a rota dedicada pela bandeja e por atalho global", () => {
  assert.match(main, /const QUICK_ASSISTANT_PATH = "\/quick-assistant"/);
  assert.match(main, /globalShortcut\.register\(QUICK_ASSISTANT_SHORTCUT, toggleQuickAssistant\)/);
  assert.match(main, /tray\.on\("click", toggleQuickAssistant\)/);
  assert.match(main, /label: "Painel rápido \(Ctrl\+Alt\+K\)"/);
  assert.match(main, /quickAssistantWindow\.loadURL\(panelUrl\)/);
});

test("janela rápida conserva a sessão e não expõe Node ou navegação externa", () => {
  assert.match(main, /preload: path\.join\(__dirname, "quick-assistant-preload\.cjs"\)/);
  assert.match(main, /contextIsolation: true,[\s\S]*?nodeIntegration: false,[\s\S]*?sandbox: true/);
  assert.match(main, /quickAssistantWindow\.webContents\.setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/);
  assert.match(main, /if \(target !== panelUrl\) event\.preventDefault\(\)/);
  assert.match(main, /if \(app\.isQuitting \|\| installingUpdate\) return;[\s\S]*?event\.preventDefault\(\);[\s\S]*?quickAssistantWindow\.hide\(\)/);
  assert.match(main, /backgroundThrottling: false/g);
  assert.doesNotMatch(preload, /require\("node:/);
  assert.doesNotMatch(preload, /kaoz1Desktop/);
});

test("painel comunica rotas permitidas à janela principal sem recarregá-la", () => {
  assert.match(main, /route === "\/flow" \|\| route === "\/meeting-notes"/);
  assert.match(main, /webContents\.send\("kaoz1-navigation:open-route", route\)/);
  assert.match(preload, /openMain: \(route\) => ipcRenderer\.invoke\("kaoz1-quick-assistant:open-main", route\)/);
  assert.match(desktopPreload, /onMainRouteRequested: \(listener\) =>/);
  assert.match(desktopPreload, /openQuickAssistant: \(\) => ipcRenderer\.invoke\("kaoz1-quick-assistant:show"\)/);
});
