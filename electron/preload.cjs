const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("trifix", {
  openProject: () => ipcRenderer.invoke("project:open"),
  openSandboxProject: (options) => ipcRenderer.invoke("project:sandbox", options),
  openTrackedProject: (entry) => ipcRenderer.invoke("project:open-tracked", entry),
  getProjectReviewData: (payload) => ipcRenderer.invoke("project:review-data", payload),
  openFolderPath: (folderPath) => ipcRenderer.invoke("project:open-folder", folderPath),
  refreshProject: (rootPath) => ipcRenderer.invoke("project:refresh", rootPath),
  getGraphStatus: (payload) => ipcRenderer.invoke("project:graph-status", payload),
  buildGraphIndex: (payload) => ipcRenderer.invoke("project:graph-build", payload),
  queryGraphIndex: (payload) => ipcRenderer.invoke("project:graph-query", payload),
  openGraphView: (payload) => ipcRenderer.invoke("project:graph-open", payload),
  uploadProjectContext: (payload) => ipcRenderer.invoke("project:context-upload", payload),
  runProjectCommand: (payload) => ipcRenderer.invoke("project:command", payload),
  stopProjectProcess: (payload) => ipcRenderer.invoke("project:process-stop", payload),
  restartProjectProcess: (payload) => ipcRenderer.invoke("project:process-restart", payload),
  listProjectProcesses: (payload) => ipcRenderer.invoke("project:process-list", payload),
  readProjectProcessLog: (payload) => ipcRenderer.invoke("project:process-log", payload),
  openExternalUrl: (url) => ipcRenderer.invoke("project:open-url", url),
  runPipeline: (payload) => ipcRenderer.invoke("pipeline:run", payload),
  startAutonomyRun: (payload) => ipcRenderer.invoke("autonomy:start", payload),
  getAutonomyStatus: (runId) => ipcRenderer.invoke("autonomy:status", runId),
  stopAutonomyRun: (runId) => ipcRenderer.invoke("autonomy:stop", runId),
  getLatestRunbook: (payload) => ipcRenderer.invoke("autonomy:get-latest-runbook", payload),
  listRunbooks: (payload) => ipcRenderer.invoke("autonomy:list-runbooks", payload),
  resumeRunbook: (payload) => ipcRenderer.invoke("autonomy:resume-runbook", payload),
  openRunbookFolder: (payload) => ipcRenderer.invoke("autonomy:open-runbook-folder", payload),
  markManualReviewComplete: (payload) => ipcRenderer.invoke("autonomy:mark-manual-review-complete", payload),
  testAgent: (payload) => ipcRenderer.invoke("pipeline:test-agent", payload),
  getLastResult: () => ipcRenderer.invoke("pipeline:last"),
  getSettings: () => ipcRenderer.invoke("app:settings"),
  getModelHealth: () => ipcRenderer.invoke("app:model-health"),
  saveDialogue: (dialogue) => ipcRenderer.invoke("app:dialogue:save", dialogue),
  saveGuiQaSettings: (payload) => ipcRenderer.invoke("app:gui-qa:save", payload),
  checkGuiQaCapability: (payload) => ipcRenderer.invoke("guiQa:check-capability", payload),
  getLatestGuiQaResult: (payload) => ipcRenderer.invoke("guiQa:get-latest-result", payload),
  runGuiSmokeTest: (payload) => ipcRenderer.invoke("guiQa:run-smoke-test", payload),
  createUiQualityContract: (payload) => ipcRenderer.invoke("designQuality:create-contract", payload),
  getLatestUiQuality: (payload) => ipcRenderer.invoke("designQuality:get-latest", payload),
  runUiQualityCheck: (payload) => ipcRenderer.invoke("designQuality:run-check", payload),
  runDesignPolishPass: (payload) => ipcRenderer.invoke("designQuality:run-polish-pass", payload),
  openDesignFolder: (payload) => ipcRenderer.invoke("designQuality:open-folder", payload),
  generateUiStackRecommendation: (payload) => ipcRenderer.invoke("designQuality:generate-ui-stack", payload),
  createDependencyPlan: (payload) => ipcRenderer.invoke("designQuality:create-dependency-plan", payload),
  runQualityLoop: (payload) => ipcRenderer.invoke("qualityLoop:run", payload),
  stopQualityLoop: (payload) => ipcRenderer.invoke("qualityLoop:stop", payload),
  getQualityLoopStatus: (payload) => ipcRenderer.invoke("qualityLoop:status", payload),
  runTerminalCommand: (payload) => ipcRenderer.invoke("terminal:run-command", payload),
  stopTerminalCommand: (payload) => ipcRenderer.invoke("terminal:stop-command", payload),
  getTerminalHistory: (payload) => ipcRenderer.invoke("terminal:get-history", payload),
  checkPlaywrightCapability: (payload) => ipcRenderer.invoke("app:playwright:capability", payload),
  listProjects: () => ipcRenderer.invoke("projects:list"),
  removeProject: (id) => ipcRenderer.invoke("projects:remove", id),
  updateProject: (payload) => ipcRenderer.invoke("projects:update", payload),
  acceptDecision: (payload) => ipcRenderer.invoke("decision:accept", payload),
  discardOutput: (payload) => ipcRenderer.invoke("decision:discard-output", payload),
  previewApply: (payload) => ipcRenderer.invoke("decision:preview-apply", payload),
  applyDecision: (payload) => ipcRenderer.invoke("decision:apply", payload),
  exportReviewData: (payload) => ipcRenderer.invoke("review:export-data", payload),
  finishReview: (payload) => ipcRenderer.invoke("review:finish", payload),
  onPipelineProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("pipeline:progress", listener);
    return () => ipcRenderer.removeListener("pipeline:progress", listener);
  },
  onAutonomyProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("autonomy:progress", listener);
    return () => ipcRenderer.removeListener("autonomy:progress", listener);
  },
  onQualityLoopProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("qualityLoop:progress", listener);
    return () => ipcRenderer.removeListener("qualityLoop:progress", listener);
  }
});
