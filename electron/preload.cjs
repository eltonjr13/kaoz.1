const { contextBridge, ipcRenderer } = require("electron");

if (process.platform === "win32") {
  contextBridge.exposeInMainWorld("mrChickenDesktop", {
    minimize: () => ipcRenderer.invoke("mrchicken-window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("mrchicken-window:toggle-maximize"),
    close: () => ipcRenderer.invoke("mrchicken-window:close"),
    isMaximized: () => ipcRenderer.invoke("mrchicken-window:is-maximized"),
    getDesktopPreferences: () => ipcRenderer.invoke("mrchicken-desktop:get-preferences"),
    setCloseToTray: (enabled) => ipcRenderer.invoke("mrchicken-desktop:set-close-to-tray", enabled),
    getUpdateStatus: () => ipcRenderer.invoke("mrchicken-update:get-status"),
    checkForUpdates: () => ipcRenderer.invoke("mrchicken-update:check"),
    downloadUpdate: () => ipcRenderer.invoke("mrchicken-update:download"),
    installUpdate: () => ipcRenderer.invoke("mrchicken-update:install"),
    onUpdateStatus: (listener) => {
      const handler = (_event, status) => listener(status);
      ipcRenderer.on("mrchicken-update:status", handler);
      return () => ipcRenderer.removeListener("mrchicken-update:status", handler);
    },
    onMaximizedChanged: (listener) => {
      const handler = (_event, isMaximized) => listener(Boolean(isMaximized));
      ipcRenderer.on("mrchicken-window:maximized-changed", handler);
      return () => ipcRenderer.removeListener("mrchicken-window:maximized-changed", handler);
    }
  });
}
