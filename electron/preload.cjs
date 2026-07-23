const { contextBridge, ipcRenderer } = require("electron");

if (process.platform === "win32") {
  contextBridge.exposeInMainWorld("kaoz1Desktop", {
    minimize: () => ipcRenderer.invoke("kaoz1-window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("kaoz1-window:toggle-maximize"),
    close: () => ipcRenderer.invoke("kaoz1-window:close"),
    isMaximized: () => ipcRenderer.invoke("kaoz1-window:is-maximized"),
    getDesktopPreferences: () => ipcRenderer.invoke("kaoz1-desktop:get-preferences"),
    setCloseToTray: (enabled) => ipcRenderer.invoke("kaoz1-desktop:set-close-to-tray", enabled),
    getUpdateStatus: () => ipcRenderer.invoke("kaoz1-update:get-status"),
    checkForUpdates: () => ipcRenderer.invoke("kaoz1-update:check"),
    downloadUpdate: () => ipcRenderer.invoke("kaoz1-update:download"),
    installUpdate: () => ipcRenderer.invoke("kaoz1-update:install"),
    onUpdateStatus: (listener) => {
      const handler = (_event, status) => listener(status);
      ipcRenderer.on("kaoz1-update:status", handler);
      return () => ipcRenderer.removeListener("kaoz1-update:status", handler);
    },
    onMaximizedChanged: (listener) => {
      const handler = (_event, isMaximized) => listener(Boolean(isMaximized));
      ipcRenderer.on("kaoz1-window:maximized-changed", handler);
      return () => ipcRenderer.removeListener("kaoz1-window:maximized-changed", handler);
    }
  });
}
