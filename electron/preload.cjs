const { contextBridge, ipcRenderer } = require("electron");

if (process.platform === "win32") {
  contextBridge.exposeInMainWorld("mrChickenDesktop", {
    minimize: () => ipcRenderer.invoke("mrchicken-window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("mrchicken-window:toggle-maximize"),
    close: () => ipcRenderer.invoke("mrchicken-window:close"),
    isMaximized: () => ipcRenderer.invoke("mrchicken-window:is-maximized"),
    onMaximizedChanged: (listener) => {
      const handler = (_event, isMaximized) => listener(Boolean(isMaximized));
      ipcRenderer.on("mrchicken-window:maximized-changed", handler);
      return () => ipcRenderer.removeListener("mrchicken-window:maximized-changed", handler);
    }
  });
}
