const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kaoz1QuickAssistant", {
  hide: () => ipcRenderer.invoke("kaoz1-quick-assistant:hide"),
  openMain: (route) => ipcRenderer.invoke("kaoz1-quick-assistant:open-main", route),
  readClipboardText: () => ipcRenderer.invoke("kaoz1-quick-assistant:read-clipboard"),
});
