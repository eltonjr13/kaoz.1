const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

test("desktop shell stays inside the viewport area below the titlebar", () => {
  const appShell = fs.readFileSync(
    path.join(projectRoot, "components", "layout", "app-shell.tsx"),
    "utf8",
  );
  const globalCss = fs.readFileSync(path.join(projectRoot, "app", "globals.css"), "utf8");

  assert.match(appShell, /kaoz1-app-shell h-full min-h-0 max-h-full/);
  assert.doesNotMatch(appShell, /kaoz1-app-shell[^\n]*min-h-screen/);
  assert.match(
    globalCss,
    /html\[data-kaoz1-desktop="true"\] \.kaoz1-app-shell\s*\{[^}]*height:\s*calc\(100dvh - var\(--kaoz1-titlebar-height\)\);[^}]*min-height:\s*0;[^}]*max-height:\s*calc\(100dvh - var\(--kaoz1-titlebar-height\)\);[^}]*\}/s,
  );
});

test("desktop titlebar exposes secure navigation controls and live navigation state", () => {
  const titlebar = fs.readFileSync(path.join(projectRoot, "components", "layout", "desktop-titlebar.tsx"), "utf8");
  const preload = fs.readFileSync(path.join(projectRoot, "electron", "preload.cjs"), "utf8");
  const main = fs.readFileSync(path.join(projectRoot, "electron", "main.cjs"), "utf8");

  assert.match(titlebar, /aria-label="Voltar"/);
  assert.match(titlebar, /aria-label="Avan\u00e7ar"/);
  assert.match(titlebar, /aria-label="Atualizar"/);
  assert.match(preload, /goBack: \(\) => ipcRenderer\.invoke\("kaoz1-navigation:back"\)/);
  assert.match(preload, /onNavigationStateChanged/);
  assert.match(main, /navigationHistory\.canGoBack\(\)/);
  assert.match(main, /navigationHistory\.goForward\(\)/);
  assert.match(main, /webContents\.reload\(\)/);
  assert.match(main, /did-navigate-in-page/);
});

test("desktop titlebar shows route context, command launcher, and real update state", () => {
  const titlebar = fs.readFileSync(path.join(projectRoot, "components", "layout", "desktop-titlebar.tsx"), "utf8");

  assert.match(titlebar, /contextForPath\(pathname\)/);
  assert.match(titlebar, /Pesquisar ou executar/);
  assert.match(titlebar, /event\.key\.toLowerCase\(\) === "k"/);
  assert.match(titlebar, /bridge\.onUpdateStatus\(setUpdateStatus\)/);
  assert.match(titlebar, /router\.push\("\/settings"\)/);
});

test("settings persist automatic update downloads without automatic installation", () => {
  const panel = fs.readFileSync(path.join(projectRoot, "components", "settings", "AppUpdatesPanel.tsx"), "utf8");
  const preload = fs.readFileSync(path.join(projectRoot, "electron", "preload.cjs"), "utf8");
  const main = fs.readFileSync(path.join(projectRoot, "electron", "main.cjs"), "utf8");

  assert.match(panel, /aria-label="Baixar atualiza\u00e7\u00f5es automaticamente"/);
  assert.match(panel, /bridge\.setAutoDownloadUpdates\(next\)/);
  assert.match(preload, /setAutoDownloadUpdates: \(enabled\) => ipcRenderer\.invoke\("kaoz1-desktop:set-auto-download-updates", enabled\)/);
  assert.match(main, /autoUpdater\.autoDownload = getDesktopPreferences\(\)\.autoDownloadUpdates/);
  assert.match(main, /getDesktopPreferences\(\)\.autoDownloadUpdates\) \{\s*void requestUpdateCheck\(\)/);
  assert.match(main, /autoUpdater\.autoInstallOnAppQuit = false/);
});

test("aula única seleciona somente arquivos de vídeo e preserva o seletor de pasta do lote", () => {
  const panel = fs.readFileSync(path.join(projectRoot, "components", "settings", "DavinciFreePanel.tsx"), "utf8");
  const preload = fs.readFileSync(path.join(projectRoot, "electron", "preload.cjs"), "utf8");
  const main = fs.readFileSync(path.join(projectRoot, "electron", "main.cjs"), "utf8");

  assert.match(panel, /window\.kaoz1Desktop\.chooseVideoFile\(\)/);
  assert.match(panel, /Selecionar Vídeo/);
  assert.match(preload, /chooseVideoFile: \(\) => ipcRenderer\.invoke\("kaoz1-desktop:choose-video-file"\)/);
  assert.match(main, /ipcMain\.handle\("kaoz1-desktop:choose-video-file"/);
  assert.match(main, /extensions: \["mp4", "mov", "mxf", "avi", "mkv", "webm"\]/);
  assert.match(main, /properties: \["openFile"\]/);
  assert.match(main, /properties: \["openDirectory"\]/);
});

test("video editor footer uses the installed application version", () => {
  const panel = fs.readFileSync(path.join(projectRoot, "components", "settings", "DavinciFreePanel.tsx"), "utf8");
  const appVersion = fs.readFileSync(path.join(projectRoot, "lib", "app-version.ts"), "utf8");

  assert.match(appVersion, /import packageJson from "@\/package\.json"/);
  assert.match(appVersion, /export const BUILD_VERSION = packageJson\.version/);
  assert.match(panel, /const \[applicationVersion, setApplicationVersion\] = useState\(BUILD_VERSION\)/);
  assert.match(panel, /bridge\.getUpdateStatus\(\)/);
  assert.match(panel, /setApplicationVersion\(updateStatus\.currentVersion\)/);
  assert.match(panel, /Kaoz\.1 v\{applicationVersion\}/);
  assert.doesNotMatch(panel, /Kaoz\.1 v0\.2\.33/);
});
