const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("trifix", {
  openProject: () => ipcRenderer.invoke("project:open"),
  refreshProject: (rootPath) => ipcRenderer.invoke("project:refresh", rootPath),
  runPipeline: (payload) => ipcRenderer.invoke("pipeline:run", payload),
  getLastResult: () => ipcRenderer.invoke("pipeline:last"),
  getSettings: () => ipcRenderer.invoke("app:settings"),
  saveDialogue: (dialogue) => ipcRenderer.invoke("app:dialogue:save", dialogue),
  onPipelineProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("pipeline:progress", listener);
    return () => ipcRenderer.removeListener("pipeline:progress", listener);
  }
});
