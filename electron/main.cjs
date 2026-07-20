const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, shell, Tray } = require("electron");
const { autoUpdater } = require("electron-updater");
const { readDesktopPreferences, shouldHideWindowOnClose, writeDesktopPreferences } = require("./desktop-preferences.cjs");
const { updateErrorDetails } = require("./update-errors.cjs");
const { stopProcessTree } = require("./process-lifecycle.cjs");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

let mainWindow;
let nextServer;
let tray;
let applicationUrl;
let desktopPreferences;
let updateCheckPromise;
let installingUpdate = false;
let updateStatus = { state: "idle", currentVersion: app.getVersion(), supported: false };

const isDevelopment = Boolean(process.env.ELECTRON_START_URL);

app.setName("MrChicken");

function getMainWindowForEvent(event) {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  return senderWindow && senderWindow === mainWindow ? senderWindow : null;
}

function desktopPreferencesPath() {
  return path.join(app.getPath("userData"), "desktop-preferences.json");
}

function getDesktopPreferences() {
  if (!desktopPreferences) desktopPreferences = readDesktopPreferences(desktopPreferencesPath());
  return desktopPreferences;
}

function saveDesktopPreferences(next) {
  desktopPreferences = writeDesktopPreferences(desktopPreferencesPath(), next);
  return desktopPreferences;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (applicationUrl) createWindow(applicationUrl);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function quitApplication() {
  app.isQuitting = true;
  app.quit();
}

function createTray() {
  if (tray) return;
  const iconPath = path.join(__dirname, "..", "build", "icon.png");
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip("MrChicken");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir MrChicken", click: showMainWindow },
    { type: "separator" },
    { label: "Sair", click: quitApplication }
  ]));
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
}

function notifyTrayOnce() {
  const preferences = getDesktopPreferences();
  if (preferences.trayNoticeShown || !tray || process.platform !== "win32") return;
  tray.displayBalloon({
    iconType: "info",
    title: "MrChicken continua ativo",
    content: "O aplicativo foi mantido nos ícones ocultos. Use o ícone para abrir ou sair."
  });
  saveDesktopPreferences({ ...preferences, trayNoticeShown: true });
}

function updaterIsSupported() {
  return process.platform === "win32" && app.isPackaged;
}

function setUpdateStatus(next) {
  updateStatus = { ...updateStatus, ...next, currentVersion: app.getVersion(), supported: updaterIsSupported() };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("mrchicken-update:status", updateStatus);
  return updateStatus;
}

function configureAutoUpdater() {
  if (!updaterIsSupported()) return;

  const updaterLogDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(updaterLogDir, { recursive: true });
  const updaterLogPath = path.join(updaterLogDir, "updater.log");
  const writeUpdaterLog = (level, ...values) => {
    const line = values.map((value) => value instanceof Error ? value.message : String(value)).join(" ");
    fs.appendFileSync(updaterLogPath, `[${new Date().toISOString()}] [${level}] ${line}\n`, "utf8");
  };
  autoUpdater.logger = {
    debug: (...values) => writeUpdaterLog("debug", ...values),
    info: (...values) => writeUpdaterLog("info", ...values),
    warn: (...values) => writeUpdaterLog("warn", ...values),
    error: (...values) => writeUpdaterLog("error", ...values)
  };
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => setUpdateStatus({ state: "checking", error: undefined, errorCode: undefined, progress: undefined }));
  autoUpdater.on("update-available", (info) => setUpdateStatus({ state: "available", version: info.version, releaseDate: info.releaseDate, error: undefined, errorCode: undefined }));
  autoUpdater.on("update-not-available", () => setUpdateStatus({ state: "not-available", version: undefined, progress: undefined, error: undefined, errorCode: undefined }));
  autoUpdater.on("download-progress", (progress) => setUpdateStatus({ state: "downloading", progress: Math.round(progress.percent) }));
  autoUpdater.on("update-downloaded", (info) => setUpdateStatus({ state: "downloaded", version: info.version, progress: 100, error: undefined, errorCode: undefined }));
  autoUpdater.on("error", (error) => {
    console.error("[AutoUpdater]", error);
    setUpdateStatus({ state: "error", ...updateErrorDetails(error), progress: undefined });
  });
}

ipcMain.handle("mrchicken-update:get-status", (event) => {
  if (!getMainWindowForEvent(event)) return { state: "error", error: "Janela não autorizada." };
  return { ...updateStatus, currentVersion: app.getVersion(), supported: updaterIsSupported() };
});

ipcMain.handle("mrchicken-update:check", async (event) => {
  if (!getMainWindowForEvent(event)) return { state: "error", error: "Janela não autorizada." };
  if (!updaterIsSupported()) return setUpdateStatus({ state: "unsupported", error: "A atualização está disponível apenas no aplicativo Windows instalado." });
  if (!updateCheckPromise) {
    updateCheckPromise = autoUpdater.checkForUpdates().catch((error) => {
      setUpdateStatus({ state: "error", ...updateErrorDetails(error) });
      return null;
    }).finally(() => {
      updateCheckPromise = undefined;
    });
  }
  await updateCheckPromise;
  return updateStatus;
});

ipcMain.handle("mrchicken-update:download", async (event) => {
  if (!getMainWindowForEvent(event)) return { state: "error", error: "Janela não autorizada." };
  if (!updaterIsSupported()) return setUpdateStatus({ state: "unsupported", error: "A atualização está disponível apenas no aplicativo Windows instalado." });
  if (updateStatus.state !== "available") return updateStatus;
  try {
    setUpdateStatus({ state: "downloading", progress: 0, error: undefined, errorCode: undefined });
    await autoUpdater.downloadUpdate();
  } catch (error) {
    setUpdateStatus({ state: "error", ...updateErrorDetails(error), progress: undefined });
  }
  return updateStatus;
});

ipcMain.handle("mrchicken-update:install", async (event) => {
  if (!getMainWindowForEvent(event) || updateStatus.state !== "downloaded") return false;
  if (installingUpdate) return true;
  installingUpdate = true;
  try {
    setUpdateStatus({ state: "installing", error: undefined, errorCode: undefined });
    await stopProductionServer();
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  } catch (error) {
    installingUpdate = false;
    setUpdateStatus({ state: "error", ...updateErrorDetails(error), progress: undefined });
    return false;
  }
});

function sendWindowState(target) {
  if (!target || target.isDestroyed()) return;
  target.webContents.send("mrchicken-window:maximized-changed", target.isMaximized());
}

ipcMain.handle("mrchicken-window:minimize", (event) => {
  const target = getMainWindowForEvent(event);
  if (!target) return false;
  target.minimize();
  return true;
});

ipcMain.handle("mrchicken-window:toggle-maximize", (event) => {
  const target = getMainWindowForEvent(event);
  if (!target) return false;
  if (target.isMaximized()) target.unmaximize();
  else target.maximize();
  return true;
});

ipcMain.handle("mrchicken-window:close", (event) => {
  const target = getMainWindowForEvent(event);
  if (!target) return false;
  target.close();
  return true;
});

ipcMain.handle("mrchicken-window:is-maximized", (event) => {
  const target = getMainWindowForEvent(event);
  return Boolean(target && target.isMaximized());
});

ipcMain.handle("mrchicken-desktop:get-preferences", (event) => {
  if (!getMainWindowForEvent(event)) return null;
  const { closeToTray } = getDesktopPreferences();
  return { closeToTray };
});

ipcMain.handle("mrchicken-desktop:set-close-to-tray", (event, enabled) => {
  if (!getMainWindowForEvent(event) || typeof enabled !== "boolean") return null;
  const updated = saveDesktopPreferences({ ...getDesktopPreferences(), closeToTray: enabled });
  return { closeToTray: updated.closeToTray };
});

function findFreePort(start = 3210) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const server = net.createServer();
      server.unref();
      server.once("error", (error) => {
        if (error.code === "EADDRINUSE") return tryPort(port + 1);
        reject(error);
      });
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(port));
      });
    };
    tryPort(start);
  });
}

function waitForServer(url, attempts = 120) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const request = net.connect(Number(new URL(url).port), "127.0.0.1");
      request.once("connect", () => {
        request.destroy();
        resolve();
      });
      request.once("error", () => {
        request.destroy();
        if (--attempts <= 0) reject(new Error("O servidor local não iniciou a tempo."));
        else setTimeout(check, 250);
      });
    };
    check();
  });
}

function ensureUserDirectories() {
  const dataRoot = app.getPath("userData");
  for (const folder of ["storage", "generated", "uploads", "logs"]) {
    fs.mkdirSync(path.join(dataRoot, folder), { recursive: true });
  }
  const envPath = path.join(dataRoot, ".env.local");
  const examplePath = app.isPackaged
    ? path.join(process.resourcesPath, "config", ".env.example")
    : path.join(__dirname, "..", ".env.example");
  if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
  }
  return dataRoot;
}

function readUserEnvironment(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function startProductionServer() {
  const port = await findFreePort();
  const serverRoot = path.join(process.resourcesPath, "server");
  const serverEntry = path.join(serverRoot, "server.js");
  const dataRoot = ensureUserDirectories();
  const userEnvironment = readUserEnvironment(path.join(dataRoot, ".env.local"));

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Servidor empacotado não encontrado: ${serverEntry}`);
  }

  const env = {
    ...process.env,
    ...userEnvironment,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    APP_BASE_URL: `http://127.0.0.1:${port}`,
    MRCHICKEN_DESKTOP: "1",
    MRCHICKEN_DATA_DIR: path.join(dataRoot, "generated"),
    MRCHICKEN_STORAGE_DIR: path.join(dataRoot, "storage"),
    FLOW_DOWNLOAD_PATH: path.join(dataRoot, "storage", "generated"),
    FLOW_PROFILE_PATH: path.join(dataRoot, "storage", "browser-profile"),
    // Use the user's installed Chrome so a separate `npx playwright install` is unnecessary.
    FLOW_BROWSER_CHANNEL: userEnvironment.FLOW_BROWSER_CHANNEL || "chrome"
  };

  nextServer = spawn(process.execPath, [serverEntry], {
    cwd: serverRoot,
    env,
    windowsHide: true,
    stdio: "pipe"
  });

  const logPath = path.join(dataRoot, "logs", "server.log");
  const log = fs.createWriteStream(logPath, { flags: "a" });
  nextServer.stdout.pipe(log);
  nextServer.stderr.pipe(log);
  nextServer.once("exit", (code) => {
    if (code && !app.isQuitting) dialog.showErrorBox("MrChicken", `O servidor local encerrou com código ${code}. Consulte ${logPath}.`);
  });

  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url);
  return url;
}

async function stopProductionServer() {
  const server = nextServer;
  nextServer = undefined;
  if (!server) return;
  await stopProcessTree(server);
}

function createWindow(url) {
  applicationUrl = url;
  const appOrigin = new URL(url).origin;
  const isTrustedLocalOrigin = (candidate) => {
    try {
      const parsed = new URL(candidate);
      return parsed.origin === appOrigin && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
    } catch {
      return false;
    }
  };

  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return permission === "media" && isTrustedLocalOrigin(requestingOrigin);
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents.getURL();
    const isAudioRequest = !details.mediaTypes || details.mediaTypes.length === 0 || details.mediaTypes.includes("audio");
    callback(permission === "media" && isAudioRequest && isTrustedLocalOrigin(requestingUrl));
  });

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    frame: process.platform !== "win32",
    backgroundColor: "#09090b",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.removeMenu();
  mainWindow.on("maximize", () => sendWindowState(mainWindow));
  mainWindow.on("unmaximize", () => sendWindowState(mainWindow));
  mainWindow.on("close", (event) => {
    const shouldHide = shouldHideWindowOnClose({
      isQuitting: app.isQuitting,
      installingUpdate,
      closeToTray: getDesktopPreferences().closeToTray
    });
    if (!shouldHide) return;
    event.preventDefault();
    mainWindow.hide();
    notifyTrayOnce();
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    sendWindowState(mainWindow);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.loadURL(url);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.on("second-instance", () => {
  showMainWindow();
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  try {
    configureAutoUpdater();
    getDesktopPreferences();
    createTray();
    createWindow(isDevelopment ? process.env.ELECTRON_START_URL : await startProductionServer());
  } catch (error) {
    dialog.showErrorBox("Falha ao iniciar o MrChicken", error instanceof Error ? error.message : String(error));
    app.quit();
  }
});

app.on("activate", () => {
  showMainWindow();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  void stopProductionServer();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
