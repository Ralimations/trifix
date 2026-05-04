const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("trifix", {
  openProject: () => ipcRenderer.invoke("project:open"),
  openSandboxProject: (options) => ipcRenderer.invoke("project:sandbox", options),
  openTrackedProject: (entry) => ipcRenderer.invoke("project:open-tracked", entry),
  openFolderPath: (folderPath) => ipcRenderer.invoke("project:open-folder", folderPath),
  refreshProject: (rootPath) => ipcRenderer.invoke("project:refresh", rootPath),
  uploadProjectContext: (payload) => ipcRenderer.invoke("project:context-upload", payload),
  runProjectCommand: (payload) => ipcRenderer.invoke("project:command", payload),
  runPipeline: (payload) => ipcRenderer.invoke("pipeline:run", payload),
  testAgent: (payload) => ipcRenderer.invoke("pipeline:test-agent", payload),
  getLastResult: () => ipcRenderer.invoke("pipeline:last"),
  getSettings: () => ipcRenderer.invoke("app:settings"),
  saveDialogue: (dialogue) => ipcRenderer.invoke("app:dialogue:save", dialogue),
  listProjects: () => ipcRenderer.invoke("projects:list"),
  removeProject: (id) => ipcRenderer.invoke("projects:remove", id),
  updateProject: (payload) => ipcRenderer.invoke("projects:update", payload),
  acceptDecision: (payload) => ipcRenderer.invoke("decision:accept", payload),
  previewApply: (payload) => ipcRenderer.invoke("decision:preview-apply", payload),
  applyDecision: (payload) => ipcRenderer.invoke("decision:apply", payload),
  onPipelineProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("pipeline:progress", listener);
    return () => ipcRenderer.removeListener("pipeline:progress", listener);
  }
});
