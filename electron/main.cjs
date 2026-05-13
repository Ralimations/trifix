const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const { createRequire } = require("node:module");
const path = require("node:path");

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

let mainWindow = null;
let backend = null;
let settingsFilePath = null;
let projectsFilePath = null;
let projectsWriteQueue = Promise.resolve();
const autonomyQueue = [];
const autonomyRuns = new Map();
const managedProcesses = new Map();
const terminalSessions = new Map();
const qualityLoops = new Map();
let autonomyWorkerActive = false;
let activeRunLock = null;
const staleRunIds = new Set();

const AUTONOMY_DIR_NAME = ".trifix";
const RUN_STATE_FILE = "run-state.json";
const RUN_LOG_FILE = "run-log.jsonl";
const MEMORY_FILE = "memory.md";
const DECISIONS_FILE = "decisions.md";
const ARTIFACTS_FILE = "artifacts.json";
const GRAPH_DIR_NAME = "graph";
const GRAPH_STATUS_FILE = "index-status.json";
const PROCESS_DIR_NAME = "processes";
const PROCESS_REGISTRY_FILE = "processes.json";
const GUI_QA_DIR_NAME = "gui-qa";
const GUI_QA_RESULT_FILE = "latest-result.json";
const GUI_QA_SCREENSHOT_FILE = "latest-screenshot.png";
const GUI_QA_VERDICT_FILE = "latest-qa-verdict.json";
const GUI_QA_ROUNDS_DIR_NAME = "rounds";
const AUTONOMY_RUNBOOK_DIR_NAME = "autonomy";
const AUTONOMY_RUNS_DIR_NAME = "runs";
const AUTONOMY_LATEST_RUN_FILE = "latest-run.json";
const RUNBOOK_FILE = "runbook.json";
const RUNBOOK_TIMELINE_FILE = "timeline.jsonl";
const RUNBOOK_LATEST_STATE_FILE = "latest-state.json";
const RUNBOOK_NEXT_ACTION_FILE = "next-action.json";
const RUNBOOK_ARTIFACTS_INDEX_FILE = "artifacts-index.json";
const TERMINAL_DIR_NAME = "terminal";
const DEFAULT_AUTONOMY_RUNTIME_MS = 8 * 60 * 60 * 1000;
const MAX_AUTONOMY_RUNTIME_MS = 12 * 60 * 60 * 1000;
const DEFAULT_MAX_GUI_QA_REPAIR_ATTEMPTS = 2;
const DEFAULT_MAX_QUALITY_ROUNDS = 3;
const DEFAULT_GUI_QA_SETTINGS = Object.freeze({
  enabled: false,
  mode: "headless",
  browser: "chromium",
  slowMoMs: 0,
  autoRunAfterBuild: false,
  stopDevServerAfterQa: true,
  maxAttempts: 1
});

function logRunLock(event, payload = {}) {
  logStartupError(event, JSON.stringify(payload));
}

function acquireActiveRunLock(runId, source) {
  if (activeRunLock?.runId) {
    logRunLock("active-run-lock rejected", {
      requestedRunId: runId,
      existingRunId: activeRunLock.runId,
      source
    });
    const error = new Error("A run is already in progress. Stop it before starting another.");
    error.code = "ERUNACTIVE";
    error.activeRunId = activeRunLock.runId;
    throw error;
  }

  staleRunIds.delete(runId);
  activeRunLock = {
    runId,
    source,
    acquiredAt: new Date().toISOString()
  };
  logRunLock("active-run-lock acquired", { runId, source });
}

function releaseActiveRunLock(runId, reason) {
  if (!activeRunLock || activeRunLock.runId !== runId) {
    return;
  }

  logRunLock("active-run-lock released", { runId, reason });
  activeRunLock = null;
}

function markRunStale(runId, reason) {
  if (!runId || staleRunIds.has(runId)) {
    return;
  }

  staleRunIds.add(runId);
  logRunLock("stale-run-result ignored", {
    runId,
    activeRunId: activeRunLock?.runId || "",
    reason
  });
}

function isRunAuthoritative(runId) {
  if (!runId || staleRunIds.has(runId)) {
    return false;
  }

  if (!activeRunLock) {
    return false;
  }

  return activeRunLock.runId === runId;
}

function assertRunAuthoritative(runId, stage) {
  if (isRunAuthoritative(runId)) {
    return;
  }

  markRunStale(runId, stage);
  const error = new Error(`Late result ignored for stale runId: ${runId}`);
  error.code = "EAUTOSTALE";
  throw error;
}

app.whenReady().then(async () => {
  backend = await loadBackend();
  logRunLock("active-run-lock system ready", { active: false });
  logStartupError("timeout-policy", JSON.stringify(backend.TIMEOUT_POLICY || {}));
  settingsFilePath = path.join(app.getPath("userData"), "trifix-settings.json");
  projectsFilePath = path.join(app.getPath("userData"), "trifix-projects.json");
  registerIpc();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
}).catch((error) => {
  logStartupError("app.whenReady", error);
  try {
    dialog.showErrorBox("TriFix failed to start", formatStartupError(error));
  } catch {}
});

process.on("uncaughtException", (error) => {
  logStartupError("uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
  logStartupError("unhandledRejection", reason);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

async function loadBackend() {
  const [constants, fileSystem, orchestrator, runState, artifactLedger, verifier, modelHealth] = await Promise.all([
    import("./constants.js"),
    import("./fileSystem.js"),
    import("./agent/orchestrator.js"),
    import("./agent/runState.js"),
    import("./agent/artifactLedger.js"),
    import("./agent/verifier.js"),
    import("./agent/modelHealth.js")
  ]);

  return {
    AGENTS: constants.AGENTS,
    AI_ENDPOINT: constants.AI_ENDPOINT,
    DEV_ENDPOINT: constants.DEV_ENDPOINT,
    ARCHITECT_ENDPOINT: constants.ARCHITECT_ENDPOINT,
    REQUEST_TIMEOUT_MS: constants.REQUEST_TIMEOUT_MS,
    TIMEOUT_POLICY: constants.TIMEOUT_POLICY,
    DEFAULT_SANDBOX_PROJECT_NAME: constants.DEFAULT_SANDBOX_PROJECT_NAME,
    buildDefaultSandboxProject: fileSystem.buildDefaultSandboxProject,
    buildTaskSandboxProject: fileSystem.buildTaskSandboxProject,
    buildProjectTree: fileSystem.buildProjectTree,
    readSelectedProjectFiles: fileSystem.readSelectedProjectFiles,
    previewFilePatches: fileSystem.previewFilePatches,
    applyFilePatches: fileSystem.applyFilePatches,
    applyFileOperations: fileSystem.applyFileOperations,
    getLastResult: orchestrator.getLastResult,
    runPipeline: orchestrator.runPipeline,
    runAgentTest: orchestrator.runAgentTest,
    runGuiQaReview: orchestrator.runGuiQaReview,
    runGuiQaDevPatch: orchestrator.runGuiQaDevPatch,
    runGuiQaPmFinalization: orchestrator.runGuiQaPmFinalization,
    runState,
    artifactLedger,
    verifier,
    getModelHealth: modelHealth.getModelHealth,
    getAgentHealth: modelHealth.getAgentHealth
  };
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: "#10131a",
    title: "TriFix AI: Tiny Office Mode",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow?.isDestroyed()) {
      mainWindow.show();
    }
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) {
      return;
    }
    logStartupError("did-fail-load", new Error(`${errorCode}: ${errorDescription} (${validatedURL})`));
    void showWindowFallback(`Could not load ${validatedURL || "the TriFix UI"}.\n${errorDescription || "Unknown load failure."}`);
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    logStartupError("renderer-console", `level=${level} ${sourceId || "renderer"}:${line || 0} ${message}`);
  });

  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    logStartupError("preload-error", new Error(`${preloadPath}: ${formatStartupError(error)}`));
    void showWindowFallback(`The TriFix preload script failed.\n${formatStartupError(error)}`);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logStartupError("render-process-gone", new Error(`${details.reason || "unknown"} (exitCode=${details.exitCode ?? "n/a"})`));
    void showWindowFallback(`The TriFix renderer exited unexpectedly.\nReason: ${details.reason || "unknown"}`);
  });

  try {
    if (isDev) {
      await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
      await mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
    }
    const renderProbe = await mainWindow.webContents.executeJavaScript(`(() => {
      const root = document.getElementById('root');
      return {
        hasBridge: typeof window.trifix !== 'undefined',
        rootChildren: root ? root.children.length : -1,
        rootHtmlLength: root ? root.innerHTML.length : -1,
        bodyTextLength: document.body ? document.body.innerText.length : -1,
        title: document.title || ''
      };
    })()`);
    logStartupError("render-probe", JSON.stringify(renderProbe));
  } catch (error) {
    logStartupError("createWindow.load", error);
    await showWindowFallback(formatStartupError(error));
  }
}

async function showWindowFallback(message) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const safeMessage = escapeHtml(String(message || "TriFix could not load the UI."));
  await mainWindow.loadURL(`data:text/html,<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;background:#10131a;color:#f5f7fb;padding:24px"><h2>TriFix UI failed to load</h2><pre style="white-space:pre-wrap">${safeMessage}</pre></body></html>`);
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
}

function logStartupError(scope, error) {
  const line = `[${new Date().toISOString()}] ${scope}: ${formatStartupError(error)}\n`;
  try {
    console.error(line.trim());
  } catch {}
  try {
    const logPath = path.join(process.cwd(), "dev.current.stderr.log");
    void fs.appendFile(logPath, line, "utf8");
  } catch {}
}

function formatStartupError(error) {
  if (!error) {
    return "Unknown startup error.";
  }
  return error?.stack || error?.message || String(error);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function registerIpc() {
  ipcMain.handle("project:open", async () => {
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: "Open Project Folder",
      properties: ["openDirectory"]
    });

    if (selection.canceled || !selection.filePaths[0]) {
      return null;
    }

    const project = await backend.buildProjectTree(selection.filePaths[0]);
    const tracked = await upsertProjectEntry(projectToTrackedEntry(project, { type: "project" }));
    return attachTrackedProjectWithGraph(project, tracked);
  });

  ipcMain.handle("project:sandbox", async (_event, options = {}) => {
    if (options.path) {
      const project = await backend.buildProjectTree(options.path, { ensureSandboxFolder: false });
      const tracked = await upsertProjectEntry(
        projectToTrackedEntry(project, {
          type: "sandbox-task",
          id: options.id,
          status: options.status,
          loopCount: options.loopCount,
          decisionStatus: options.decisionStatus
        })
      );
      return attachTrackedProjectWithGraph(project, tracked);
    }

    const taskProject = await backend.buildTaskSandboxProject(app.getPath("documents"));
    const tracked = await upsertProjectEntry(
      projectToTrackedEntry(taskProject, {
        type: "sandbox-task",
        name: path.basename(taskProject.rootPath)
      })
    );
    return attachTrackedProjectWithGraph(taskProject, tracked);
  });

  ipcMain.handle("project:refresh", async (_event, rootPath) => {
    const project = await backend.buildProjectTree(rootPath, {
      ensureSandboxFolder: inferProjectType(rootPath) !== "sandbox-task"
    });
    const tracked = await findTrackedProjectByPath(project.rootPath);
    return attachTrackedProjectWithGraph(project, tracked);
  });

  ipcMain.handle("project:open-tracked", async (_event, entry) => {
    const rootPath = entry?.path;
    const project = await backend.buildProjectTree(rootPath);
    const tracked = await upsertProjectEntry({
      ...(entry || {}),
      path: project.rootPath,
      name: entry?.name || path.basename(project.rootPath),
      lastUpdated: new Date().toISOString()
    });
    return attachTrackedProjectWithGraph(project, tracked);
  });
  ipcMain.handle("project:review-data", async (_event, payload = {}) =>
    readProjectReviewData(payload?.projectRoot || payload?.path || "")
  );

  ipcMain.handle("project:open-folder", async (_event, folderPath) => {
    if (!folderPath) {
      return false;
    }

    const result = await shell.openPath(folderPath);
    return result === "";
  });
  ipcMain.handle("project:context-upload", async (_event, payload = {}) =>
    uploadProjectContext(payload)
  );
  ipcMain.handle("project:graph-status", async (_event, payload = {}) =>
    getGraphStatus(payload?.projectRoot, { detect: Boolean(payload?.detect) })
  );
  ipcMain.handle("project:graph-build", async (_event, payload = {}) =>
    buildGraphIndex(payload?.projectRoot)
  );
  ipcMain.handle("project:graph-query", async (_event, payload = {}) =>
    queryGraphIndex(payload?.projectRoot, payload?.query)
  );
  ipcMain.handle("project:graph-open", async (_event, payload = {}) =>
    openGraphView(payload?.projectRoot)
  );
  ipcMain.handle("project:command", async (_event, payload = {}) =>
    runProjectCommand(payload)
  );
  ipcMain.handle("project:process-stop", async (_event, payload = {}) =>
    stopManagedProjectProcess(payload)
  );
  ipcMain.handle("project:process-restart", async (_event, payload = {}) =>
    restartManagedProjectProcess(payload)
  );
  ipcMain.handle("project:process-list", async (_event, payload = {}) =>
    listProjectProcesses(payload)
  );
  ipcMain.handle("project:process-log", async (_event, payload = {}) =>
    readProjectProcessLog(payload)
  );
  ipcMain.handle("project:open-url", async (_event, url = "") =>
    openSafeProjectUrl(url)
  );

  ipcMain.handle("pipeline:last", async () => backend.getLastResult());
  ipcMain.handle("pipeline:test-agent", async (_event, payload) =>
    backend.runAgentTest(payload)
  );
  ipcMain.handle("autonomy:start", async (_event, payload = {}) =>
    startAutonomyRun(payload)
  );
  ipcMain.handle("autonomy:status", async (_event, runId = "") =>
    getAutonomyRunStatus(runId)
  );
  ipcMain.handle("autonomy:stop", async (_event, runId = "") =>
    stopAutonomyRun(runId)
  );
  ipcMain.handle("autonomy:get-latest-runbook", async (_event, payload = {}) =>
    getLatestRunbook(payload)
  );
  ipcMain.handle("autonomy:list-runbooks", async (_event, payload = {}) =>
    listRunbooks(payload)
  );
  ipcMain.handle("autonomy:resume-runbook", async (_event, payload = {}) =>
    resumeRunbook(payload)
  );
  ipcMain.handle("autonomy:open-runbook-folder", async (_event, payload = {}) =>
    openRunbookFolder(payload)
  );
  ipcMain.handle("autonomy:mark-manual-review-complete", async (_event, payload = {}) =>
    markManualReviewComplete(payload)
  );
  ipcMain.handle("projects:list", async () => listProjects());
  ipcMain.handle("projects:remove", async (_event, id) => removeTrackedProject(id));
  ipcMain.handle("projects:update", async (_event, payload) => updateTrackedProject(payload?.id, payload));

  ipcMain.handle("app:settings", async () => buildAppSettings());
  ipcMain.handle("app:model-health", async () => backend.getModelHealth());

  ipcMain.handle("app:dialogue:save", async (_event, dialoguePatch) => {
    const current = await readSettings();
    current.dialogue = {
      ...(current.dialogue || {}),
      ...(dialoguePatch || {})
    };
    await writeSettings(current);

    return buildAppSettings();
  });
  ipcMain.handle("app:gui-qa:save", async (_event, payload = {}) => {
    const current = await readSettings();
    current.guiQa = normalizeGuiQaSettings(payload);
    await writeSettings(current);
    return buildAppSettings();
  });
  ipcMain.handle("guiQa:check-capability", async (_event, payload = {}) =>
    detectPlaywrightCapability(payload)
  );
  ipcMain.handle("guiQa:get-latest-result", async (_event, payload = {}) =>
    getLatestGuiQaResult(payload)
  );
  ipcMain.handle("guiQa:run-smoke-test", async (_event, payload = {}) =>
    runGuiQaSmokeTest(payload)
  );
  ipcMain.handle("qualityLoop:run", async (_event, payload = {}) =>
    startQualityLoop(payload)
  );
  ipcMain.handle("qualityLoop:stop", async (_event, payload = {}) =>
    stopQualityLoop(payload)
  );
  ipcMain.handle("qualityLoop:status", async (_event, payload = {}) =>
    getQualityLoopStatus(payload)
  );
  ipcMain.handle("terminal:run-command", async (_event, payload = {}) =>
    runTerminalCommand(payload)
  );
  ipcMain.handle("terminal:stop-command", async (_event, payload = {}) =>
    stopTerminalCommand(payload)
  );
  ipcMain.handle("terminal:get-history", async (_event, payload = {}) =>
    getTerminalHistory(payload)
  );
  ipcMain.handle("app:playwright:capability", async (_event, payload = {}) =>
    detectPlaywrightCapability(payload)
  );

  ipcMain.handle("pipeline:run", async (event, payload) => {
    const runId = payload?.runId || `run-${Date.now()}`;
    logRunLock("run-start-request received", { channel: "pipeline:run", runId });
    acquireActiveRunLock(runId, "pipeline:run");
    try {
      const sandboxParentPath = app.getPath("documents");
      const files = payload?.projectRoot
        ? await backend.readSelectedProjectFiles(payload.projectRoot, payload.selectedFiles || [])
        : [];
      const graphContext = payload?.projectRoot
        ? await buildPipelineGraphContext(payload.projectRoot, payload, files)
        : null;
      const startedAt = new Date().toISOString();
      const existingTrackedEntry = await findTrackedProjectByPath(payload?.projectRoot);
      const trackedEntry = await upsertProjectEntry({
        ...(existingTrackedEntry || {}),
        id: payload?.projectId || existingTrackedEntry?.id,
        name: payload?.projectName || path.basename(payload?.projectRoot || "Task"),
        path: payload?.projectRoot || "",
        type: payload?.projectType || inferProjectType(payload?.projectRoot),
        status: "In progress",
        loopCount: Number(payload?.loopCount || 0),
        lastAgent: "junior",
        lastUpdated: new Date().toISOString(),
        affectedFiles: payload?.selectedFiles || [],
        decisionStatus: "pending",
        fsd: payload?.fsd || existingTrackedEntry?.fsd || null,
        prd: existingTrackedEntry?.prd || null,
        phases: existingTrackedEntry?.phases || [],
        tasks: existingTrackedEntry?.tasks || [],
        logs: existingTrackedEntry?.logs || [],
        commandHistory: existingTrackedEntry?.commandHistory || []
      });
      if (payload?.projectRoot) {
        await initializeAutonomyLedger(payload.projectRoot, {
          runId,
          mode: "manual",
          status: "running",
          startedAt,
          currentStage: "pipeline-start",
          currentPhase: "Planning",
          currentTask: "Supervisor scoping",
          selectedFiles: payload?.selectedFiles || [],
          changedFiles: [],
          lastValidationStatus: "pending",
          nextAction: "agent-pipeline"
        });
        await appendAutonomyLog(payload.projectRoot, {
          type: "run-start",
          runId,
          mode: "manual",
          selectedFiles: payload?.selectedFiles || [],
          inputSummary: trimText(payload?.input || "", 500),
          graphContextStatus: graphContext?.status || "unavailable"
        });
      }

      let activeTrackedEntry = trackedEntry;
      let result;
      result = await backend.runPipeline(
        {
          ...payload,
          runId,
          files,
          graphContext,
          mode: "manual",
          runPath: payload?.projectRoot || "",
          sandboxParentPath
        },
        (progress) => {
          if (!isRunAuthoritative(runId)) {
            markRunStale(runId, "pipeline-progress");
            return;
          }
          const progressRoot = payload?.projectRoot;
          if (progressRoot) {
            void updateAutonomyRunState(progressRoot, {
              runId,
              status: "running",
              currentStage: progress.stage || progress.agent || "agent-progress",
              currentPhase: progress?.partialResult?.workflow?.currentPhase || "",
              currentTask: progress?.partialResult?.workflow?.currentTask || "",
              changedFiles:
                progress?.partialResult?.decision?.affectedFiles ||
                progress?.partialResult?.architect?.affectedFiles ||
                [],
              nextAction: "waiting-for-agent"
            });
            void appendAutonomyLog(progressRoot, {
              type: "agent-progress",
              runId,
              agent: progress.agent,
              stage: progress.stage,
              status: progress.status,
              requestStatus: progress.requestStatus?.displayText || ""
            });
          }
          void updateTrackedProject(trackedEntry?.id, {
            status: "In progress",
            loopCount: Number(progress?.partialResult?.workflow?.loopCount ?? payload?.loopCount ?? 0),
            lastAgent: progress.agent,
            lastUpdated: new Date().toISOString(),
            affectedFiles:
              progress?.partialResult?.decision?.affectedFiles ||
              progress?.partialResult?.architect?.affectedFiles ||
              trackedEntry?.affectedFiles ||
              [],
            prd: progress?.partialResult?.project?.prd || trackedEntry?.prd || null,
            phases: progress?.partialResult?.project?.phases || trackedEntry?.phases || [],
            tasks: progress?.partialResult?.project?.tasks || trackedEntry?.tasks || []
          });
          event.sender.send("pipeline:progress", progress);
        }
      );

    if (payload?.projectRoot) {
      const fileOperations = Array.isArray(result?.dev?.fileOperations) ? result.dev.fileOperations : [];
      if (fileOperations.length > 0) {
        await updateAutonomyRunState(payload.projectRoot, {
          status: "running",
          currentStage: "apply_files",
          changedFiles: fileOperations.map((operation) => operation.path)
        });
        await appendAutonomyLog(payload.projectRoot, {
          type: "stage-detail",
          runId,
          event: "files applied started",
          fileOperations: fileOperations.map((operation) => operation.path)
        });
        const existingPatchResult = await applyFileOperationsToExistingProject(
          payload.projectRoot,
          result,
          payload?.selectedFiles || [],
          fileOperations
        );
        await backend.artifactLedger.trackPlannedFiles(payload.projectRoot, result?.project?.requiredFiles || []);
        await backend.artifactLedger.trackProposedFiles(payload.projectRoot, fileOperations);
        await backend.artifactLedger.trackAppliedOperations(payload.projectRoot, existingPatchResult.applied || []);
        await backend.artifactLedger.trackFailedOperations(payload.projectRoot, existingPatchResult.failedOperations || []);
        await updateAutonomyArtifacts(payload.projectRoot, {
          changedFiles: (existingPatchResult.applied || []).map((item) => item.path)
        });
        await updateAutonomyRunState(payload.projectRoot, {
          status: "running",
          currentStage: "apply_files",
          changedFiles: (existingPatchResult.applied || []).map((item) => item.path)
        });
        await appendAutonomyLog(payload.projectRoot, {
          type: "stage-detail",
          runId,
          event: "files applied done",
          applied: existingPatchResult.applied || [],
          failedOperations: existingPatchResult.failedOperations || []
        });
        result = attachExistingProjectPatchResult(result, existingPatchResult);
        activeTrackedEntry = await upsertProjectEntry(
          projectToTrackedEntry(existingPatchResult.project, {
            ...(activeTrackedEntry || {}),
            type: inferProjectType(existingPatchResult.project.rootPath),
            status: "Output ready",
            loopCount: Number(result?.workflow?.loopCount || payload?.loopCount || 0),
            lastAgent: "junior",
            affectedFiles: existingPatchResult.applied.map((item) => item.path),
            decisionStatus: "pending",
            fsd: result?.project?.fsd || payload?.fsd || activeTrackedEntry?.fsd || null,
            prd: result?.project?.prd || activeTrackedEntry?.prd || null,
            phases: result?.project?.phases || activeTrackedEntry?.phases || [],
            tasks: result?.project?.tasks || activeTrackedEntry?.tasks || [],
            logs: appendProjectLog(activeTrackedEntry?.logs, {
              type: "files",
              message: `Executor applied ${existingPatchResult.applied.length} existing-project file operation(s).`
            })
          })
        );
        event.sender.send("pipeline:progress", {
          runId: payload?.runId,
          agent: "junior",
          stage: "file-executor",
          status: "speaking",
          partialResult: result
        });
      }
    } else {
      const fileOperations = Array.isArray(result?.dev?.fileOperations) ? result.dev.fileOperations : [];
      if (fileOperations.length === 0) {
        throw new Error("DEV produced no valid fileOperations or path-tagged code blocks.");
      }

      const plannedRunPath = buildGeneratedTaskRoot(sandboxParentPath, result?.project?.projectSlug);
      if (plannedRunPath) {
        await updateAutonomyRunState(plannedRunPath, {
          status: "running",
          currentStage: "apply_files",
          changedFiles: fileOperations.map((operation) => operation.path)
        });
        await appendAutonomyLog(plannedRunPath, {
          type: "stage-detail",
          runId,
          event: "files applied started",
          fileOperations: fileOperations.map((operation) => operation.path)
        });
      }
      const generatedProject = await backend.applyFileOperations(
        sandboxParentPath,
        result?.project?.architecture || result?.project || {},
        fileOperations
      );
      result = attachGeneratedProjectResult(result, generatedProject);
      await initializeAutonomyLedger(generatedProject.rootPath, {
        runId,
        mode: "manual",
        status: "running",
        startedAt,
        currentStage: "apply_files",
        currentPhase: result?.workflow?.currentPhase || "Phase 1",
        currentTask: result?.workflow?.currentTask || "Review output",
        selectedFiles: generatedProject.applied.map((item) => item.path),
        changedFiles: generatedProject.applied.map((item) => item.path),
        lastValidationStatus: "pending",
        nextAction: "user-decision"
      });
      await backend.artifactLedger.trackPlannedFiles(generatedProject.rootPath, result?.project?.requiredFiles || []);
      await backend.artifactLedger.trackProposedFiles(generatedProject.rootPath, fileOperations);
      await backend.artifactLedger.trackAppliedOperations(generatedProject.rootPath, generatedProject.applied || []);
      await backend.artifactLedger.trackFailedOperations(generatedProject.rootPath, generatedProject.failedOperations || []);
      await backend.artifactLedger.trackCommandRequests(generatedProject.rootPath, [
        ...(result?.dev?.commandRequests || []),
        ...(result?.pm?.commandRequests || [])
      ]);
      await appendAutonomyLog(generatedProject.rootPath, {
        type: "files-written",
        runId,
        applied: generatedProject.applied || [],
        failedOperations: generatedProject.failedOperations || []
      });
      await updateAutonomyArtifacts(generatedProject.rootPath, {
        projectName: generatedProject.projectName,
        projectSlug: generatedProject.projectSlug,
        rootPath: generatedProject.rootPath,
        changedFiles: generatedProject.applied.map((item) => item.path),
        filesCreated: generatedProject.filesCreated || 0,
        filesModified: generatedProject.filesModified || 0,
        failedOperations: generatedProject.failedOperations || []
      });
      await appendAutonomyLog(generatedProject.rootPath, {
        type: "stage-detail",
        runId,
        event: "files applied done",
        applied: generatedProject.applied || [],
        failedOperations: generatedProject.failedOperations || []
      });
      activeTrackedEntry = await upsertProjectEntry(
        projectToTrackedEntry(generatedProject, {
          type: "sandbox-task",
          name: generatedProject.projectName,
          status: generatedProject.status,
          loopCount: Number(result?.workflow?.loopCount || payload?.loopCount || 0),
          lastAgent: "junior",
          affectedFiles: generatedProject.applied.map((item) => item.path),
          decisionStatus: "pending",
          fsd: result?.project?.fsd || payload?.fsd || null,
          prd: result?.project?.prd || null,
          phases: result?.project?.phases || [],
          tasks: result?.project?.tasks || [],
          logs: appendProjectLog(trackedEntry?.logs, {
            type: "files",
            message: `Executor applied ${generatedProject.applied.length} file operation(s).`
          })
        })
      );
      result = {
        ...result,
        project: {
          ...(result.project || {}),
          projectId: activeTrackedEntry?.id || ""
        }
      };
      event.sender.send("pipeline:progress", {
        runId: payload?.runId,
        agent: "junior",
        stage: "file-executor",
        status: "speaking",
        partialResult: result
      });
    }

    const autoRepairResult = await runAutoValidationAndRepair({
      event,
      payload,
      runId,
      startedAt,
      result,
      activeTrackedEntry
    });
    result = applyDeterministicDecisionOutcome(autoRepairResult.result);
    activeTrackedEntry = autoRepairResult.activeTrackedEntry || activeTrackedEntry;

      await updateTrackedProject(activeTrackedEntry?.id, {
      status: getPipelineTrackedStatus(result),
      loopCount: Number(result?.workflow?.loopCount || payload?.loopCount || 0),
      lastAgent: "architect",
      lastUpdated: new Date().toISOString(),
      affectedFiles: result?.decision?.affectedFiles || [],
      decisionStatus: result?.workflow?.decisionStatus || result?.decision?.decisionStatus || "pending",
      fsd: result?.project?.fsd || payload?.fsd || activeTrackedEntry?.fsd || null,
      prd: result?.project?.prd || activeTrackedEntry?.prd || null,
      phases: result?.project?.phases || activeTrackedEntry?.phases || [],
      tasks: result?.project?.tasks || activeTrackedEntry?.tasks || [],
      projectSlug: result?.project?.projectSlug || activeTrackedEntry?.projectSlug || "",
      filesCreated: result?.project?.filesCreated ?? activeTrackedEntry?.filesCreated,
      filesModified: result?.project?.filesModified ?? activeTrackedEntry?.filesModified,
      failedOperations: result?.project?.failedOperations || activeTrackedEntry?.failedOperations || [],
      logs: appendProjectLog(activeTrackedEntry?.logs, {
        type: "pipeline",
        message: result?.executor?.applied?.length
          ? "V2 team workflow wrote files to the task sandbox."
          : "V2 team workflow reached decision review."
      })
    });
    const resultRoot = result?.project?.rootPath || payload?.projectRoot;
    if (resultRoot) {
      const changedFiles = result?.decision?.affectedFiles || result?.executor?.applied?.map((item) => item.path) || [];
      const validationStatus = getEffectiveValidationStatus(result) || "pending";
      await updateAutonomyRunState(resultRoot, {
        runId,
        status: "needs_review",
        finishedAt: new Date().toISOString(),
        currentStage: result?.workflow?.currentStage || "decision",
        currentPhase: result?.workflow?.currentPhase || "",
        currentTask: result?.workflow?.currentTask || "",
        changedFiles,
        selectedFiles: changedFiles,
        lastValidationStatus: validationStatus,
        nextAction: "user-decision"
      });
      await appendAutonomyLog(resultRoot, {
        type: "run-complete",
        runId,
        status: "needs_review",
        changedFiles,
        summary: result?.decision?.summary || ""
      });
    }

      return result;
    } finally {
      releaseActiveRunLock(runId, "pipeline:run terminal");
    }
  });

  ipcMain.handle("decision:accept", async (_event, payload) => {
    await updateTrackedProject(payload?.projectId, {
      status: "Accepted",
      decisionStatus: "accepted",
      lastUpdated: new Date().toISOString(),
      affectedFiles: payload?.affectedFiles || []
    });
    if (payload?.projectRoot) {
      await updateAutonomyRunState(payload.projectRoot, {
        status: "accepted",
        lastDecision: "accepted",
        nextAction: "continue-or-finish"
      });
      await appendAutonomyDecision(payload.projectRoot, {
        decision: "accepted",
        summary: payload?.summary || "",
        affectedFiles: payload?.affectedFiles || []
      });
      await appendAutonomyLog(payload.projectRoot, {
        type: "decision",
        decision: "accepted",
        affectedFiles: payload?.affectedFiles || []
      });
    }
    return {
      acceptedAt: new Date().toISOString(),
      decisionStatus: "accepted",
      summary: payload?.summary || ""
    };
  });

  ipcMain.handle("decision:preview-apply", async (_event, payload) =>
    backend.previewFilePatches(
      payload?.projectRoot,
      payload?.patches || [],
      payload?.affectedFiles || []
    )
  );

  ipcMain.handle("decision:apply", async (_event, payload) => {
    const applied = await backend.applyFilePatches(
      payload?.projectRoot,
      payload?.patches || [],
      payload?.affectedFiles || []
    );
    await updateTrackedProject(payload?.projectId, {
      status: "Applied",
      decisionStatus: "applied",
      lastUpdated: new Date().toISOString(),
      affectedFiles: applied.applied.map((item) => item.path)
    });
    return applied;
  });

  ipcMain.handle("decision:discard-output", async (_event, payload = {}) =>
    discardGeneratedOutput(payload)
  );
  ipcMain.handle("review:export-data", async (_event, payload = {}) =>
    exportReviewData(payload)
  );
  ipcMain.handle("review:finish", async (_event, payload = {}) =>
    finishReview(payload)
  );
}

async function startAutonomyRun(payload = {}) {
  const runId = payload?.runId || `auto-${Date.now()}`;
  logRunLock("run-start-request received", { channel: "autonomy:start", runId });
  acquireActiveRunLock(runId, "autonomy:start");
  try {
    const maxRuntimeMs = normalizeAutonomyRuntimeMs(payload?.maxRuntimeMinutes);
    const queuedAt = new Date().toISOString();
    const task = {
      runId,
      payload: {
        ...payload,
        runId,
        autonomyMode: true,
        maxRuntimeMinutes: Math.round(maxRuntimeMs / 60000)
      },
      status: "queued",
      queuedAt,
      startedAt: "",
      finishedAt: "",
      deadlineAt: "",
      maxRuntimeMs,
      stopRequested: false,
      error: "",
      result: null,
      progress: [],
      projectRoot: payload?.projectRoot || ""
    };

    autonomyRuns.set(runId, task);
    autonomyQueue.push(task);
    if (task.projectRoot) {
      await upsertPersistentRunbook(task.projectRoot, {
        runId,
        projectName: path.basename(task.projectRoot),
        mode: "normal_autonomy",
        status: "running",
        userGoal: String(payload?.input || ""),
        currentStage: "queued",
        currentRound: 0,
        maxRounds: 3
      }, {
        type: "run-created",
        status: "running",
        message: "Runbook created for autonomy run."
      });
    }
    await persistAutonomyQueueState(task);
    processAutonomyQueue();
    return summarizeAutonomyTask(task);
  } catch (error) {
    releaseActiveRunLock(runId, "autonomy:start failed");
    throw error;
  }
}

function getAutonomyRunStatus(runId = "") {
  if (!runId) {
    return {
      active: Boolean(activeRunLock?.runId),
      queued: autonomyQueue.map((task) => summarizeAutonomyTask(task)),
      runs: Array.from(autonomyRuns.values()).map((task) => summarizeAutonomyTask(task))
    };
  }

  const task = autonomyRuns.get(String(runId));
  return task ? summarizeAutonomyTask(task) : null;
}

async function stopAutonomyRun(runId = "") {
  const task = autonomyRuns.get(String(runId));
  if (!task) {
    return null;
  }

  task.stopRequested = true;
  markRunStale(task.runId, "stop requested");
  if (task.status === "queued") {
    task.status = "stopped";
    task.finishedAt = new Date().toISOString();
  } else if (task.status === "running") {
    task.status = "stopping";
  }
  await persistAutonomyQueueState(task);
  if (task.projectRoot) {
    await upsertPersistentRunbook(task.projectRoot, {
      runId: task.runId,
      mode: "normal_autonomy",
      status: task.status === "stopping" ? "stopped" : task.status,
      stopReason: "Stop requested.",
      currentStage: "stopped"
    }, {
      type: "run-stopped",
      status: task.status,
      message: "Stop requested."
    }).catch(() => {});
  }
  releaseActiveRunLock(task.runId, task.status);
  return summarizeAutonomyTask(task);
}

async function processAutonomyQueue() {
  if (autonomyWorkerActive) {
    return;
  }

  autonomyWorkerActive = true;
  try {
  while (autonomyQueue.length > 0) {
    const task = autonomyQueue.shift();
    if (!task || task.status === "stopped" || task.stopRequested) {
      continue;
    }
      await executeAutonomyTask(task);
    }
  } finally {
    autonomyWorkerActive = false;
  }
}

async function executeAutonomyTask(task) {
  let finalResult = null;
  let activeTrackedEntry = null;
  task.status = "running";
  task.startedAt = new Date().toISOString();
  task.deadlineAt = new Date(Date.now() + task.maxRuntimeMs).toISOString();
  await persistAutonomyQueueState(task, {
    status: "running",
    maxRuntimeMs: task.maxRuntimeMs,
    deadlineAt: task.deadlineAt,
    currentStage: "autonomy-runner",
    currentTask: "Backend runner started",
    nextAction: "agent-pipeline"
  });
  sendAutonomyProgress(task, {
    agent: "architect",
    stage: "autonomy-runner",
    status: "running",
    message: "Backend autonomy runner started."
  });

  try {
    assertRunAuthoritative(task.runId, "before start");
    assertAutonomyCanContinue(task, "before start");

    activeTrackedEntry = task.payload?.projectRoot
      ? await findTrackedProjectByPath(task.payload.projectRoot)
      : null;
    const files = task.payload?.projectRoot
      ? await backend.readSelectedProjectFiles(task.payload.projectRoot, task.payload.selectedFiles || [])
      : [];
    const graphContext = task.payload?.projectRoot
      ? await buildPipelineGraphContext(task.payload.projectRoot, task.payload, files)
      : null;

    const result = await withAutonomyRuntimeLimit(
      task,
      backend.runPipeline(
        {
          ...task.payload,
          files,
          graphContext,
          mode: "autonomous",
          runPath: task.payload?.projectRoot || "",
          sandboxParentPath: app.getPath("documents")
        },
        (progress) => {
          if (!isRunAuthoritative(task.runId)) {
            markRunStale(task.runId, "autonomy-progress");
            return;
          }
          task.progress.push({
            at: new Date().toISOString(),
            agent: progress.agent,
            stage: progress.stage,
            status: progress.status
          });
          sendAutonomyProgress(task, progress);
        }
      ),
      "agent pipeline"
    );
    assertRunAuthoritative(task.runId, "after agent pipeline");
    assertAutonomyCanContinue(task, "after agent pipeline");

    finalResult = result;
    if (task.payload?.projectRoot) {
      const fileOperations = Array.isArray(result?.dev?.fileOperations) ? result.dev.fileOperations : [];
      if (fileOperations.length > 0) {
        assertRunAuthoritative(task.runId, "before applying existing-project file operations");
        const patchResult = await applyFileOperationsToExistingProject(
          task.payload.projectRoot,
          result,
          task.payload?.selectedFiles || [],
          fileOperations
        );
        finalResult = attachExistingProjectPatchResult(finalResult, patchResult);
      }
    } else {
      const fileOperations = Array.isArray(result?.dev?.fileOperations) ? result.dev.fileOperations : [];
      if (fileOperations.length === 0) {
        throw new Error("DEV produced no valid fileOperations or path-tagged code blocks.");
      }
      assertRunAuthoritative(task.runId, "before applying generated-project file operations");
      const generatedProject = await backend.applyFileOperations(
        app.getPath("documents"),
        result?.project?.architecture || result?.project || {},
        fileOperations
      );
      finalResult = attachGeneratedProjectResult(finalResult, generatedProject);
      activeTrackedEntry = await upsertProjectEntry(
        projectToTrackedEntry(generatedProject, {
          type: "sandbox-task",
          name: generatedProject.projectName,
          status: generatedProject.status,
          loopCount: Number(finalResult?.workflow?.loopCount || task.payload?.loopCount || 0),
          lastAgent: "junior",
          affectedFiles: generatedProject.applied.map((item) => item.path),
          decisionStatus: "pending",
          fsd: finalResult?.project?.fsd || task.payload?.fsd || null,
          prd: finalResult?.project?.prd || null,
          phases: finalResult?.project?.phases || [],
          tasks: finalResult?.project?.tasks || []
        })
      );
    }

    const eventLike = {
      sender: {
        send: (channel, payload) => {
          mainWindow?.webContents?.send(channel, payload);
          if (channel === "pipeline:progress") {
            sendAutonomyProgress(task, payload);
          }
        }
      }
    };
    const repaired = await withAutonomyRuntimeLimit(
      task,
      runAutoValidationAndRepair({
        event: eventLike,
        payload: task.payload,
        runId: task.runId,
        result: finalResult,
        activeTrackedEntry
      }),
      "validation and repair"
    );
    assertRunAuthoritative(task.runId, "after validation and repair");
    finalResult = applyDeterministicDecisionOutcome(repaired.result);
    activeTrackedEntry = repaired.activeTrackedEntry || activeTrackedEntry;

    const finalValidationStatus = getEffectiveValidationStatus(finalResult);
    const finalPmUnavailable = isFinalPmUnavailable(finalResult);
    const finalStatus = finalValidationStatus === "passed" && !isQaUnavailable(finalResult) && !finalPmUnavailable
      ? "completed"
      : "needs_review";
    task.status = finalStatus;
    const projectRoot = finalResult?.project?.rootPath || task.payload?.projectRoot || "";
    if (projectRoot) {
      task.projectRoot = projectRoot;
      const project = finalResult?.project || {};
      activeTrackedEntry = await upsertProjectEntry(
        projectToTrackedEntry(project, {
          ...(activeTrackedEntry || {}),
          status: getPipelineTrackedStatus(finalResult),
          loopCount: Number(finalResult?.workflow?.loopCount || task.payload?.loopCount || 0),
          lastAgent: "architect",
          affectedFiles: finalResult?.decision?.affectedFiles || [],
          decisionStatus: finalResult?.workflow?.decisionStatus || finalResult?.decision?.decisionStatus || "pending",
          fsd: finalResult?.project?.fsd || task.payload?.fsd || activeTrackedEntry?.fsd || null,
          prd: finalResult?.project?.prd || activeTrackedEntry?.prd || null,
          phases: finalResult?.project?.phases || activeTrackedEntry?.phases || [],
          tasks: finalResult?.project?.tasks || activeTrackedEntry?.tasks || []
        })
      );
      await writeAutonomyFinalReport(projectRoot, finalResult, task);
    }

    task.finishedAt = new Date().toISOString();
    task.result = finalResult;
    await persistAutonomyQueueState(task, {
      status: task.status,
      finishedAt: task.finishedAt,
      currentStage: finalResult?.workflow?.currentStage || "decision",
      currentTask: finalResult?.workflow?.currentTask || "Review output",
      nextAction: "user-decision"
    });
    sendAutonomyProgress(task, {
      agent: "architect",
      stage: "autonomy-complete",
      status: task.status,
      partialResult: finalResult
    });
    releaseActiveRunLock(task.runId, task.status);
  } catch (error) {
    if (error?.code === "EAUTOSTALE") {
      return;
    }
    const preserved = await classifyRecoverableAutonomyFailure({
      task,
      result: finalResult,
      error
    });
    task.status = preserved
      ? "needs_review"
      : error?.code === "EAUTORUNTIME"
        ? "timed_out"
        : task.stopRequested
          ? "stopped"
          : "failed";
    task.error = preserved
      ? buildRecoverableAutonomyMessage(error)
      : error?.message || String(error);
    task.finishedAt = new Date().toISOString();
    task.result = finalResult || task.result || null;
    if (preserved) {
      const projectRoot = finalResult?.project?.rootPath || task.projectRoot || task.payload?.projectRoot || "";
      if (projectRoot && finalResult) {
        task.projectRoot = projectRoot;
        await writeAutonomyFinalReport(projectRoot, finalResult, task);
      }
    }
    await persistAutonomyQueueState(task, {
      status: task.status,
      finishedAt: task.finishedAt,
      currentStage: preserved ? "final" : "autonomy-error",
      currentTask: task.error,
      nextAction: preserved ? "user-decision" : "blocked"
    });
    if (preserved) {
      sendAutonomyProgress(task, {
        agent: "architect",
        stage: "autonomy-complete",
        status: "needs_review",
        partialResult: finalResult,
        message: task.error
      });
    } else {
      sendAutonomyProgress(task, {
        agent: "architect",
        stage: "autonomy-error",
        status: "failed",
        message: task.error
      });
    }
    releaseActiveRunLock(task.runId, task.status);
  }
}

function sendAutonomyProgress(task, progress) {
  if (!isRunAuthoritative(task.runId)) {
    markRunStale(task.runId, "send-progress");
    return;
  }
  mainWindow?.webContents?.send("autonomy:progress", {
    runId: task.runId,
    autonomy: true,
    queueStatus: task.status,
    deadlineAt: task.deadlineAt,
    maxRuntimeMs: task.maxRuntimeMs,
    ...progress
  });
}

async function persistAutonomyQueueState(task, statePatch = {}) {
  if (!task?.projectRoot) {
    return;
  }

  await initializeAutonomyLedger(task.projectRoot, {
    runId: task.runId,
    mode: "autonomous",
    status: task.status,
    queuedAt: task.queuedAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    deadlineAt: task.deadlineAt,
    maxRuntimeMs: task.maxRuntimeMs,
    stopRequested: task.stopRequested,
    taskQueue: autonomyQueue.map((queuedTask) => ({
      runId: queuedTask.runId,
      status: queuedTask.status,
      queuedAt: queuedTask.queuedAt
    })),
    ...statePatch
  });
  await appendAutonomyLog(task.projectRoot, {
    type: "autonomy-runner",
    runId: task.runId,
    status: task.status,
    stage: statePatch.currentStage || "",
    message: statePatch.currentTask || task.error || ""
  });
  await upsertPersistentRunbook(task.projectRoot, {
    runId: task.runId,
    projectName: path.basename(task.projectRoot),
    mode: "normal_autonomy",
    status: mapRunStatus(task.status),
    userGoal: String(task.payload?.input || ""),
    currentStage: statePatch.currentStage || "autonomy-runner",
    currentRound: Number(statePatch.attempt || 0),
    maxRounds: Number(statePatch.maxAttempts || 3),
    stopReason: task.stopRequested ? "Stop requested." : "",
    latestEvidence: {
      autonomyStatus: task.status,
      deadlineAt: task.deadlineAt || ""
    }
  }, {
    type: statePatch.currentStage === "autonomy-runner" ? "run-started" : "preflight-result",
    status: mapRunStatus(task.status),
    message: statePatch.currentTask || task.error || ""
  }).catch(() => {});
}

async function writeAutonomyFinalReport(projectRoot, result, task) {
  const dir = await initializeAutonomyLedger(projectRoot);
  const reportPath = path.join(dir, "final-report.md");
  const ledger = await backend.artifactLedger.loadArtifactLedger(projectRoot);
  const runState = await backend.runState.loadRunState(projectRoot);
  const finalValidation = result?.autoRepair?.finalValidation || result?.validation || null;
  const verification = finalValidation?.verification || null;
  const validationEntry = finalValidation?.validation || null;
  const qaSummary = result?.qa?.finalReview || ledger?.qaResult || result?.qa?.parallelReview || "No QA summary recorded.";
  const projectType = finalValidation?.projectType || verification?.projectType || "generic";
  const validationMode = finalValidation?.validationMode || validationEntry?.validationMode || (projectType === "vite-react" ? "vite-structure" : projectType === "static-html" ? "direct-html-preview" : "structure-validation");
  const installStatus = finalValidation?.installStatus || "not_run";
  const buildStatus = finalValidation?.buildStatus || (validationEntry?.status || "not_run");
  const qaStatus = result?.finalization?.qaStatus || (isQaUnavailable(result) ? "unavailable" : "used");
  const finalPmStatus = result?.finalization?.pmStatus || "completed";
  const deterministicOverride = result?.finalization?.deterministicOverride || null;
  const preflight = task?.payload?.preflight || {};
  const preflightState = preflight.state || "not_recorded";
  const preflightRunMode = preflight.runMode || task?.payload?.executionMode || "normal";
  const unavailableModels = Array.isArray(preflight.unavailableModels) ? preflight.unavailableModels : [];
  const finalPmNote = finalPmStatus === "timed_out"
    ? `Final PM decision unavailable: ${result?.finalization?.pmError || "timed out"}. Generated files were preserved. Manual review required.`
    : finalPmStatus === "unavailable"
      ? "Developer-only degraded mode was used. PM planning was unavailable. Manual review required."
    : "";
  const nextActionText = projectType === "vite-react"
    ? "Vite project source generated. Use npm install and npm run dev/build to preview or validate."
    : task.status === "completed"
      ? "Review the written output and run any optional local commands listed in artifacts.json."
      : "Open the generated workspace, inspect verification failures, and decide whether to apply a manual patch.";
  const lines = [
    "# TriFix Final Report",
    "",
    `Run: ${task.runId}`,
    `Status: ${task.status}`,
    `Finished: ${task.finishedAt || new Date().toISOString()}`,
    "",
    "## Task Summary",
    "",
    result?.decision?.summary || result?.pm?.summary || runState?.taskInput || "No summary returned.",
    "",
    "## Project",
    "",
    `Project slug: ${result?.project?.projectSlug || ledger?.projectSlug || path.basename(projectRoot)}`,
    `Workspace: ${projectRoot}`,
    "",
    "## Preflight",
    "",
    `State: ${preflightState}`,
    `Run mode: ${preflightRunMode}`,
    ...(unavailableModels.length > 0
      ? ["Unavailable models:", ...unavailableModels.map((model) => `- ${model.name}: ${model.model || "unknown model"} @ ${model.endpoint || "unknown endpoint"}${model.reason ? ` (${model.reason})` : ""}`)]
      : ["Unavailable models: none"]),
    "",
    "## Stages Completed",
    "",
    `Final stage: ${runState?.stage || "final"}`,
    `Attempts: ${runState?.attempt ?? 0}/${runState?.maxAttempts ?? 3}`,
    "",
    "## Files Planned",
    "",
    ...((ledger?.filesPlanned || []).length
      ? ledger.filesPlanned.map((filePath) => `- ${filePath}`)
      : ["- none"]),
    "",
    "## Files Written",
    "",
    ...((ledger?.filesWritten || []).length
      ? ledger.filesWritten.map((file) => `- ${file.path}`)
      : ["- none"]),
    "",
    "## Failed Operations",
    "",
    ...((ledger?.failedOperations || []).length
      ? ledger.failedOperations.map((operation) => `- ${operation.path || "(unknown)"}: ${operation.error || "failed"}`)
      : ["- none"]),
    "",
    "## Verification Result",
    "",
    `Project type: ${projectType}`,
    `Validation mode: ${validationMode}`,
    `Status: ${verification?.status || result?.autoRepair?.status || result?.validation?.status || "not_run"}`,
    verification?.summary || "",
    `Install status: ${installStatus}`,
    `Build status: ${buildStatus}`,
    validationEntry?.command ? `Command: ${validationEntry.command}` : "Command: not_run",
    validationEntry?.status ? `Command status: ${validationEntry.status}` : "Command status: not_run",
    "",
    "## Repair Attempts",
    "",
    `Attempts used: ${runState?.attempt ?? 0}/${runState?.maxAttempts ?? 3}`,
    result?.autoRepair?.summary || "No auto-repair summary recorded.",
    "",
    "## QA Summary",
    "",
    `QA status: ${qaStatus}`,
    qaSummary,
    "",
    "## Final PM Decision",
    "",
    `Final PM status: ${finalPmStatus}`,
    finalPmNote,
    result?.decision?.recommendation || result?.pm?.recommendation || "No final PM decision recorded.",
    "",
    "## Deterministic Override",
    "",
    deterministicOverride?.applied
      ? `Applied: yes (${deterministicOverride.reason})`
      : "Applied: no",
    deterministicOverride?.applied && deterministicOverride?.originalVerdict
      ? `Original PM verdict: ${deterministicOverride.originalVerdict}`
      : "",
    "",
    "## Next Recommended Action",
    "",
    nextActionText,
    ""
  ].filter((line) => line !== "");
  await fs.writeFile(reportPath, `${lines.join("\n")}\n`, "utf8");
  await backend.artifactLedger.trackFinalReportPath(projectRoot, path.join(AUTONOMY_DIR_NAME, "final-report.md"));
}

function summarizeAutonomyTask(task) {
  return {
    runId: task.runId,
    status: task.status,
    queuedAt: task.queuedAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    deadlineAt: task.deadlineAt,
    maxRuntimeMs: task.maxRuntimeMs,
    stopRequested: task.stopRequested,
    error: task.error,
    projectRoot: task.projectRoot,
    progress: task.progress.slice(-20),
    result: task.result
  };
}

function normalizeAutonomyRuntimeMs(value) {
  const minutes = Number(value || 0);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return DEFAULT_AUTONOMY_RUNTIME_MS;
  }

  return Math.min(Math.max(5 * 60 * 1000, Math.round(minutes * 60 * 1000)), MAX_AUTONOMY_RUNTIME_MS);
}

function assertAutonomyCanContinue(task, label) {
  if (task.stopRequested) {
    const error = new Error(`Autonomy run stopped ${label}.`);
    error.code = "EAUTOSTOP";
    throw error;
  }

  if (task.deadlineAt && Date.now() > new Date(task.deadlineAt).getTime()) {
    const error = new Error(`Autonomy run exceeded runtime limit during ${label}.`);
    error.code = "EAUTORUNTIME";
    throw error;
  }
}

function withAutonomyRuntimeLimit(task, promise, label) {
  const deadlineMs = task.deadlineAt ? new Date(task.deadlineAt).getTime() : 0;
  const remainingMs = deadlineMs ? Math.max(0, deadlineMs - Date.now()) : task.maxRuntimeMs;
  if (remainingMs <= 0) {
    assertAutonomyCanContinue(task, label);
  }

  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(`Autonomy run exceeded runtime limit during ${label}.`);
      error.code = "EAUTORUNTIME";
      task.stopRequested = true;
      reject(error);
    }, Math.max(1, remainingMs));
    timeout?.unref?.();
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

async function uploadProjectContext(payload = {}) {
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: "Add FSD, docs, or design images",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Project Context", extensions: ["pdf", "txt", "md", "png", "jpg", "jpeg", "webp", "gif"] },
      { name: "Documents", extensions: ["pdf", "txt", "md"] },
      { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }
    ]
  });

  if (selection.canceled || selection.filePaths.length === 0) {
    return [];
  }

  const documents = [];
  for (const filePath of selection.filePaths.slice(0, 8)) {
    documents.push(await extractProjectContextFile(filePath));
  }

  if (payload.projectId) {
    const current = await findTrackedProjectByPath(payload.projectRoot);
    const previousDocs = Array.isArray(current?.fsd?.documents) ? current.fsd.documents : [];
    await updateTrackedProject(payload.projectId, {
      fsd: {
        documents: [...previousDocs, ...documents].slice(-16),
        summary: summarizeContextDocuments([...previousDocs, ...documents])
      },
      status: current?.status || "Not started",
      logs: appendProjectLog(current?.logs, {
        type: "context",
        message: `Added ${documents.length} context file(s).`
      })
    });
  }

  return documents;
}

async function extractProjectContextFile(filePath) {
  const stat = await fs.stat(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath);
  const type = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)
    ? "image"
    : extension === ".pdf"
      ? "pdf"
      : "document";
  let text = "";

  if (type === "document") {
    text = await fs.readFile(filePath, "utf8");
  } else if (type === "pdf") {
    const buffer = await fs.readFile(filePath);
    text = buffer
      .toString("latin1")
      .replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, " ")
      .replace(/\s+/g, " ");
  } else {
    text = `Image file provided for design context: ${base}. Local OCR is not available; use filename, size, and user notes as visual context.`;
  }

  return {
    id: createContextDocumentId(filePath, stat.mtimeMs),
    name: base,
    path: filePath,
    type,
    extension,
    size: stat.size,
    summary: summarizeContextText(text, type),
    excerpt: trimText(text, 2400),
    addedAt: new Date().toISOString()
  };
}

async function runProjectCommand(payload = {}) {
  const root = await normalizeCommandRoot(payload.projectRoot);
  const htmlEntry = await findLaunchableHtml(root);
  if (!payload.command && payload.mode === "validate" && htmlEntry) {
    const entry = {
      id: `cmd-${Date.now()}`,
      command: `validate ${htmlEntry.relativePath}`,
      mode: "validate",
      status: "passed",
      exitCode: 0,
      timedOut: false,
      output: `Found launchable HTML entry: ${htmlEntry.relativePath}.`,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    };

    if (payload.projectId) {
      const current = await findTrackedProjectByPath(root);
      await updateTrackedProject(payload.projectId, {
        status: "In progress",
        commandStatus: entry.status,
        commandHistory: [...(current?.commandHistory || []), entry].slice(-30),
        logs: appendProjectLog(current?.logs, {
          type: "command",
          message: `${entry.command} ${entry.status}`
        })
      });
    }
    await updateAutonomyRunState(root, {
      lastCommand: entry.command,
      lastCommandStatus: entry.status,
      lastValidationStatus: entry.status,
      nextAction: "continue"
    });
    await appendAutonomyLog(root, {
      type: "command",
      command: entry.command,
      mode: "validate",
      status: entry.status,
      exitCode: entry.exitCode,
      output: entry.output
    });

    return entry;
  }

  if (!payload.command && payload.mode === "run" && htmlEntry) {
    const openResult = await shell.openPath(htmlEntry.absolutePath);
    if (openResult) {
      throw new Error(openResult);
    }

    const entry = {
      id: `cmd-${Date.now()}`,
      command: `open ${htmlEntry.relativePath}`,
      mode: payload.mode || "custom",
      status: "passed",
      exitCode: 0,
      timedOut: false,
      output: `Opened ${htmlEntry.relativePath} in the default browser.`,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString()
    };

    if (payload.projectId) {
      const current = await findTrackedProjectByPath(root);
      await updateTrackedProject(payload.projectId, {
        status: "In progress",
        commandStatus: entry.status,
        commandHistory: [...(current?.commandHistory || []), entry].slice(-30),
        logs: appendProjectLog(current?.logs, {
          type: "command",
          message: `${entry.command} ${entry.status}`
        })
      });
    }
    await updateAutonomyRunState(root, {
      lastCommand: entry.command,
      lastCommandStatus: entry.status,
      nextAction: "continue"
    });
    await appendAutonomyLog(root, {
      type: "command",
      command: entry.command,
      mode: entry.mode,
      status: entry.status,
      exitCode: entry.exitCode,
      output: entry.output
    });

    return entry;
  }

  const command = await resolveProjectCommand(root, payload);
  const startedAt = new Date().toISOString();
  if (isManagedProcessCommand(command, payload.mode)) {
    const processEntry = await startManagedProjectProcess(root, command, startedAt);
    const entry = {
      id: `cmd-${Date.now()}`,
      command,
      mode: payload.mode || "run",
      status: processEntry.status,
      processId: processEntry.id,
      pid: processEntry.pid,
      port: processEntry.port,
      healthUrl: processEntry.healthUrl,
      stdoutLog: processEntry.stdoutLog,
      stderrLog: processEntry.stderrLog,
      exitCode: Number.isInteger(processEntry.exitCode) ? processEntry.exitCode : null,
      timedOut: false,
      output: processEntry.healthUrl
        ? `Started ${command} at ${processEntry.healthUrl}.`
        : processEntry.status === "running"
          ? `Started ${command}. Logs are being written to ${processEntry.stdoutLog} and ${processEntry.stderrLog}.`
          : (processEntry.outputPreview || `Could not keep ${command} running.`),
      startedAt,
      finishedAt: processEntry.finishedAt || ""
    };

    if (payload.projectId) {
      const current = await findTrackedProjectByPath(root);
      await updateTrackedProject(payload.projectId, {
        status: "In progress",
        commandStatus: processEntry.status,
        commandHistory: [...(current?.commandHistory || []), entry].slice(-30),
        logs: appendProjectLog(current?.logs, {
          type: "process",
          message: `${command} started${entry.healthUrl ? ` at ${entry.healthUrl}` : ""}`
        })
      });
    }
    await updateAutonomyRunState(root, {
      lastCommand: command,
      lastCommandStatus: processEntry.status,
      activeProcess: processEntry.status === "running" ? processEntry : null,
      nextAction: entry.healthUrl ? "open-app-url" : "monitor-process"
    });
    await appendAutonomyLog(root, {
      type: "process-start",
      command,
      processId: processEntry.id,
      pid: processEntry.pid,
      healthUrl: processEntry.healthUrl,
      stdoutLog: processEntry.stdoutLog,
      stderrLog: processEntry.stderrLog
    });

    return entry;
  }

  const result = await executeSafeCommand(command, root, payload.mode);
  const entry = {
    id: `cmd-${Date.now()}`,
    command,
    mode: payload.mode || "custom",
    status: result.exitCode === 0 ? "passed" : "failed",
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    output: trimText(result.output, 8000),
    startedAt,
    finishedAt: new Date().toISOString()
  };

  if (payload.projectId) {
    const current = await findTrackedProjectByPath(root);
    await updateTrackedProject(payload.projectId, {
      status: entry.status === "passed" ? "In progress" : "Needs review",
      commandStatus: entry.status,
      commandHistory: [...(current?.commandHistory || []), entry].slice(-30),
      logs: appendProjectLog(current?.logs, {
        type: "command",
        message: `${command} ${entry.status}`
      })
    });
  }
  await updateAutonomyRunState(root, {
    lastCommand: command,
    lastCommandStatus: entry.status,
    lastValidationStatus: payload.mode === "validate" ? entry.status : undefined,
    nextAction: entry.status === "passed" ? "continue" : "patch"
  });
  await appendAutonomyLog(root, {
    type: "command",
    command,
    mode: payload.mode || "custom",
    status: entry.status,
    exitCode: entry.exitCode,
    timedOut: entry.timedOut,
    output: trimText(entry.output || "", 2000)
  });

  return entry;
}

function isManagedProcessCommand(command, mode) {
  if (mode !== "run") {
    return false;
  }

  const parts = splitCommand(command);
  return parts[0] === "npm" && parts[1] === "run" && ["dev", "start"].includes(parts[2]);
}

async function startManagedProjectProcess(root, command, startedAt = new Date().toISOString()) {
  validateSafeCommand(command, root);
  const dir = await initializeAutonomyLedger(root);
  const processDir = path.join(dir, PROCESS_DIR_NAME);
  await fs.mkdir(processDir, { recursive: true });

  const id = `proc-${Date.now()}`;
  const stdoutPath = path.join(processDir, `${id}.stdout.log`);
  const stderrPath = path.join(processDir, `${id}.stderr.log`);
  const spawnSpec = buildSpawnSpec(command);
  const record = {
    id,
    command,
    cwd: root,
    pid: 0,
    port: 0,
    status: "starting",
    healthUrl: "",
    stdoutLog: toProjectRelativePath(root, stdoutPath),
    stderrLog: toProjectRelativePath(root, stderrPath),
    startedAt,
    finishedAt: "",
    exitCode: null,
    outputPreview: ""
  };
  logProcessEvent("process-spawn started", record);

  await fs.writeFile(stdoutPath, "", "utf8");
  await fs.writeFile(stderrPath, "", "utf8");

  let child;
  try {
    logProcessEvent("process-spawn resolved", record, {
      originalCommand: command,
      executable: spawnSpec.executable,
      args: spawnSpec.args,
      cwd: root,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    child = spawn(spawnSpec.executable, spawnSpec.args, {
      cwd: root,
      env: { ...process.env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    record.status = "failed";
    record.finishedAt = new Date().toISOString();
    record.outputPreview = `Could not start command "${command}": ${error?.message || error}`;
    await persistProcessRecord(root, record);
    await syncActiveProcessState(root);
    return record;
  }

  record.pid = child.pid || 0;
  record.status = "running";
  managedProcesses.set(id, {
    child,
    root,
    record,
    rollingOutput: ""
  });

  let resolveReady = null;
  let persistScheduled = false;
  const markReady = () => {
    if (!resolveReady) {
      return;
    }
    const resolve = resolveReady;
    resolveReady = null;
    resolve();
  };
  const schedulePersist = () => {
    if (persistScheduled) {
      return;
    }
    persistScheduled = true;
    setTimeout(() => {
      persistScheduled = false;
      void persistProcessRecord(root, record);
      void syncActiveProcessState(root);
    }, 150).unref?.();
  };
  const appendOutput = (streamName, chunk) => {
    const text = chunk.toString();
    logProcessEvent(`process-output ${streamName} chunk received`, record, {
      size: text.length
    });
    const logPath = streamName === "stdout" ? stdoutPath : stderrPath;
    void fs.appendFile(logPath, text, "utf8")
      .then(() => logProcessEvent(`process-output wrote ${streamName} log`, record, {
        logPath: toProjectRelativePath(root, logPath)
      }))
      .catch((error) => logProcessEvent(`process-output failed ${streamName} log`, record, {
        error: error?.message || String(error || "")
      }));
    const managed = managedProcesses.get(id);
    if (managed) {
      managed.rollingOutput = trimText(`${managed.rollingOutput || ""}${text}`, 16000);
      record.outputPreview = trimText(managed.rollingOutput, 8000);
    } else {
      record.outputPreview = trimText(`${record.outputPreview}${text}`, 8000);
    }
    logProcessEvent("process-url-detect scanning", record);
    const detected = detectProcessEndpoint(managed?.rollingOutput || text);
    if (detected && (!record.healthUrl || record.healthUrl !== detected.healthUrl || record.port !== detected.port)) {
      record.port = detected.port;
      record.healthUrl = detected.healthUrl;
      logProcessEvent("process-url-detect found", record, {
        detectedUrl: detected.healthUrl,
        detectedPort: detected.port
      });
    } else if (!detected) {
      logProcessEvent("process-url-detect no match", record);
    }
    schedulePersist();
    if (detected) {
      markReady();
    }
  };

  child.stdout?.on("data", (chunk) => appendOutput("stdout", chunk));
  child.stderr?.on("data", (chunk) => appendOutput("stderr", chunk));
  logProcessEvent("process-stdout-listener-attached", record);
  logProcessEvent("process-stderr-listener-attached", record);
  child.on("error", (error) => {
    record.status = "failed";
    record.finishedAt = new Date().toISOString();
    record.outputPreview = trimText(`${record.outputPreview}\n${error.message}`, 8000);
    managedProcesses.delete(id);
    void persistProcessRecord(root, record);
    void syncActiveProcessState(root);
    markReady();
  });
  child.on("close", (exitCode) => {
    record.status = record.status === "stopped" ? "stopped" : (exitCode === 0 ? "exited" : "failed");
    record.exitCode = exitCode ?? 0;
    record.finishedAt = new Date().toISOString();
    managedProcesses.delete(id);
    void persistProcessRecord(root, record);
    void syncActiveProcessState(root);
    markReady();
  });

  await persistProcessRecord(root, record);
  await syncActiveProcessState(root);
  await new Promise((resolve) => {
    resolveReady = resolve;
    if (record.healthUrl || record.status !== "running") {
      markReady();
      return;
    }
    setTimeout(markReady, 8000).unref?.();
  });
  await persistProcessRecord(root, record);
  await syncActiveProcessState(root);
  return { ...record };
}

async function stopManagedProjectProcess(payload = {}) {
  const root = await normalizeCommandRoot(payload.projectRoot);
  const processId = String(payload.processId || "").trim();
  if (!processId) {
    throw new Error("Process id is missing.");
  }

  const managed = managedProcesses.get(processId);
  const record = managed?.record || await readProcessRecord(root, processId);
  if (!record) {
    throw new Error("Process record was not found.");
  }

  const pid = managed?.child?.pid || record.pid;
  if (managed?.record) {
    managed.record.status = "stopped";
    managed.record.finishedAt = new Date().toISOString();
  }
  if (pid) {
    await terminateProcessTree(pid);
  }
  managedProcesses.delete(processId);

  const stoppedRecord = {
    ...record,
    status: "stopped",
    finishedAt: new Date().toISOString()
  };
  await persistProcessRecord(root, stoppedRecord);
  await syncActiveProcessState(root, {
    lastCommand: record.command,
    lastCommandStatus: "stopped",
    nextAction: "process-stopped"
  });
  await appendAutonomyLog(root, {
    type: "process-stop",
    processId,
    pid,
    command: record.command
  });

  return stoppedRecord;
}

async function restartManagedProjectProcess(payload = {}) {
  const root = await normalizeCommandRoot(payload.projectRoot);
  const processId = String(payload.processId || "").trim();
  if (!processId) {
    throw new Error("Process id is missing.");
  }

  const existing = await readProcessRecord(root, processId);
  if (!existing?.command) {
    throw new Error("Process record was not found.");
  }

  if (["running", "starting"].includes(existing.status)) {
    await stopManagedProjectProcess({
      projectRoot: root,
      processId
    });
  }

  const startedAt = new Date().toISOString();
  const restarted = await startManagedProjectProcess(root, existing.command, startedAt);
  const entry = {
    id: `cmd-${Date.now()}`,
    command: restarted.command,
    mode: "run",
    status: restarted.status,
    processId: restarted.id,
    pid: restarted.pid,
    port: restarted.port,
    healthUrl: restarted.healthUrl,
    stdoutLog: restarted.stdoutLog,
    stderrLog: restarted.stderrLog,
    exitCode: Number.isInteger(restarted.exitCode) ? restarted.exitCode : null,
    timedOut: false,
    output: restarted.healthUrl
      ? `Restarted ${restarted.command} at ${restarted.healthUrl}.`
      : restarted.outputPreview || `Restarted ${restarted.command}.`,
    startedAt,
    finishedAt: restarted.finishedAt || ""
  };

  if (payload.projectId) {
    const current = await findTrackedProjectByPath(root);
    await updateTrackedProject(payload.projectId, {
      status: "In progress",
      commandStatus: restarted.status,
      commandHistory: [...(current?.commandHistory || []), entry].slice(-30),
      logs: appendProjectLog(current?.logs, {
        type: "process",
        message: `${restarted.command} restarted${restarted.healthUrl ? ` at ${restarted.healthUrl}` : ""}`
      })
    });
  }
  await updateAutonomyRunState(root, {
    lastCommand: restarted.command,
    lastCommandStatus: restarted.status,
    activeProcess: restarted.status === "running" ? restarted : null,
    nextAction: restarted.healthUrl ? "open-app-url" : "monitor-process"
  });
  await appendAutonomyLog(root, {
    type: "process-restart",
    oldProcessId: processId,
    processId: restarted.id,
    pid: restarted.pid,
    command: restarted.command,
    healthUrl: restarted.healthUrl
  });

  return {
    process: restarted,
    entry,
    processes: await refreshProcessRecords(root)
  };
}

async function listProjectProcesses(payload = {}) {
  const root = await normalizeCommandRoot(payload.projectRoot);
  return refreshProcessRecords(root);
}

async function readProjectProcessLog(payload = {}) {
  const root = await normalizeCommandRoot(payload.projectRoot);
  const processId = String(payload.processId || "").trim();
  if (!processId) {
    throw new Error("Process id is missing.");
  }

  const record = await readProcessRecord(root, processId);
  if (!record) {
    throw new Error("Process record was not found.");
  }

  const stream = String(payload.stream || "all").toLowerCase();
  const maxChars = Math.min(Math.max(Number(payload.maxChars || 12000), 1000), 40000);
  const stdout = stream === "stdout" || stream === "all"
    ? await readProcessLogFile(root, record.stdoutLog, maxChars)
    : "";
  const stderr = stream === "stderr" || stream === "all"
    ? await readProcessLogFile(root, record.stderrLog, maxChars)
    : "";

  return {
    process: record,
    stream,
    stdout,
    stderr,
    output: [
      stdout ? `STDOUT\n${stdout}` : "",
      stderr ? `STDERR\n${stderr}` : ""
    ].filter(Boolean).join("\n\n")
  };
}

async function openSafeProjectUrl(url) {
  const text = String(url || "").trim();
  if (!isSafeLocalHttpUrl(text)) {
    throw new Error("Only local project URLs can be opened.");
  }

  await shell.openExternal(text);
  return {
    opened: true,
    url: text
  };
}

function buildSpawnSpec(command) {
  const npmSpec = parseManagedCommand(command);
  if (npmSpec) {
    return npmSpec;
  }

  const parts = splitCommand(command);
  return {
    executable: process.platform === "win32" && parts[0] === "python" ? "python.exe" : parts[0],
    args: parts.slice(1)
  };
}

function parseManagedCommand(commandText) {
  const parts = splitCommand(commandText);
  if (parts[0] !== "npm" || parts.length < 2) {
    return null;
  }

  if (process.platform === "win32") {
    const executable = process.env.ComSpec || "cmd.exe";
    const commandLine = ["npm.cmd", ...parts.slice(1).map(quoteCmdArg)].join(" ");
    return {
      executable,
      args: ["/d", "/s", "/c", commandLine]
    };
  }

  const executable = "npm";
  return {
    executable,
    args: parts.slice(1)
  };
}

function detectProcessEndpoint(text) {
  const value = stripAnsi(String(text || ""));
  const urlMatch = value.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'<>)]*)?/i);
  if (urlMatch?.[0]) {
    const normalizedUrl = urlMatch[0].replace("0.0.0.0", "127.0.0.1").replace("[::1]", "127.0.0.1");
    const port = Number(new URL(normalizedUrl).port || 80);
    return {
      port,
      healthUrl: normalizedUrl
    };
  }

  const portMatch = value.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/i);
  if (!portMatch?.[1]) {
    return null;
  }

  const port = Number(portMatch[1]);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }

  return {
    port,
    healthUrl: `http://127.0.0.1:${port}`
  };
}

function stripAnsi(value) {
  return String(value || "").replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

async function persistProcessRecord(root, record) {
  const dir = await initializeAutonomyLedger(root);
  const registryPath = path.join(dir, PROCESS_DIR_NAME, PROCESS_REGISTRY_FILE);
  const current = await readJsonFile(registryPath, []);
  const records = Array.isArray(current) ? current : [];
  const nextRecords = [
    ...records.filter((item) => item.id !== record.id),
    sanitizeProcessRecord(record)
  ].slice(-20);

  await writeProcessRecords(root, nextRecords);
  logProcessEvent("process-record persisted", record);
}

async function readProcessRecord(root, processId) {
  const records = await refreshProcessRecords(root);
  return records.find((record) => record.id === processId) || null;
}

async function readProcessRecordsRaw(root) {
  const dir = await initializeAutonomyLedger(root);
  const registryPath = path.join(dir, PROCESS_DIR_NAME, PROCESS_REGISTRY_FILE);
  const records = await readJsonFile(registryPath, []);
  return Array.isArray(records) ? records : [];
}

async function writeProcessRecords(root, records) {
  const dir = await initializeAutonomyLedger(root);
  const registryPath = path.join(dir, PROCESS_DIR_NAME, PROCESS_REGISTRY_FILE);
  const sanitized = (Array.isArray(records) ? records : []).map(sanitizeProcessRecord).slice(-20);
  await writeJsonFile(registryPath, sanitized);
  await updateAutonomyArtifacts(root, {
    processes: sanitized
  });
}

async function refreshProcessRecords(root) {
  const records = await readProcessRecordsRaw(root);
  let changed = false;
  const refreshed = await Promise.all(
    records.map(async (record) => {
      const managed = managedProcesses.get(record.id);
      if (managed?.record) {
        const nextRecord = sanitizeProcessRecord({
          ...record,
          ...managed.record
        });
        changed = changed || JSON.stringify(nextRecord) !== JSON.stringify(sanitizeProcessRecord(record));
        return nextRecord;
      }

      if (["running", "starting"].includes(record.status)) {
        const isRunning = record.pid ? await isPidRunning(record.pid) : false;
        if (!isRunning) {
          changed = true;
          return sanitizeProcessRecord({
            ...record,
            status: "exited",
            finishedAt: record.finishedAt || new Date().toISOString()
          });
        }
      }

      return sanitizeProcessRecord(record);
    })
  );

  const sorted = refreshed.sort((left, right) =>
    String(right.startedAt || "").localeCompare(String(left.startedAt || ""))
  );

  if (changed) {
    await writeProcessRecords(root, sorted);
  }

  return sorted;
}

async function readProcessLogFile(root, relativePath, maxChars) {
  if (!relativePath) {
    return "";
  }

  const logPath = resolveProjectRelativePath(root, relativePath);
  try {
    const raw = await fs.readFile(logPath, "utf8");
    return raw.length > maxChars ? raw.slice(-maxChars) : raw;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function resolveProjectRelativePath(root, relativePath) {
  const target = path.resolve(root, String(relativePath || ""));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes the project folder.");
  }

  return target;
}

async function isPidRunning(pid) {
  const numericPid = Number(pid || 0);
  if (!Number.isInteger(numericPid) || numericPid <= 0) {
    return false;
  }

  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function sanitizeProcessRecord(record) {
  return {
    id: record.id,
    command: record.command,
    cwd: record.cwd,
    pid: record.pid,
    port: record.port || 0,
    status: record.status,
    healthUrl: record.healthUrl || "",
    stdoutLog: record.stdoutLog || "",
    stderrLog: record.stderrLog || "",
    startedAt: record.startedAt || "",
    finishedAt: record.finishedAt || "",
    exitCode: record.exitCode ?? null,
    outputPreview: trimText(record.outputPreview || "", 8000)
  };
}

async function syncActiveProcessState(root, patch = {}) {
  const records = await refreshProcessRecords(root);
  const activeProcess = records.find((record) => ["running", "starting"].includes(record.status)) || null;
  const lastCommand = activeProcess?.command || patch.lastCommand || "";
  const lastCommandStatus = activeProcess?.status || patch.lastCommandStatus || "idle";
  const nextAction = activeProcess
    ? (activeProcess.healthUrl ? "open-app-url" : "monitor-process")
    : (patch.nextAction || (lastCommandStatus === "failed" ? "review-process-error" : "continue"));
  await updateAutonomyRunState(root, {
    ...patch,
    lastCommand,
    lastCommandStatus,
    activeProcess,
    nextAction
  });
  logProcessEvent("process-active-state updated", activeProcess || {
    id: "",
    command: lastCommand,
    cwd: root,
    pid: 0
  }, {
    activeProcessId: activeProcess?.id || "",
    healthUrl: activeProcess?.healthUrl || "",
    port: activeProcess?.port || 0
  });
}

function logProcessEvent(event, record, extra = {}) {
  logStartupError(event, JSON.stringify({
    processId: record?.id || "",
    command: record?.command || "",
    cwd: record?.cwd || "",
    pid: record?.pid || 0,
    healthUrl: record?.healthUrl || "",
    port: record?.port || 0,
    ...extra
  }));
}

function terminateProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid) {
      resolve();
      return;
    }

    const command = process.platform === "win32" ? "taskkill.exe" : "kill";
    const args = process.platform === "win32"
      ? ["/pid", String(pid), "/t", "/f"]
      : ["-TERM", `-${pid}`];
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false
    });
    child.on("error", () => resolve());
    child.on("close", () => resolve());
  });
}

function isSafeLocalHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) &&
      ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function toProjectRelativePath(root, targetPath) {
  return path.relative(root, targetPath).replaceAll(path.sep, "/");
}

async function runAutoValidationAndRepair({ event, payload, runId, result, activeTrackedEntry }) {
  const root = result?.project?.rootPath || payload?.projectRoot || "";
  let appliedFiles = result?.executor?.applied?.map((item) => item.path).filter(Boolean) || [];
  if (!root || appliedFiles.length === 0) {
    return { result, activeTrackedEntry };
  }

  const runState = await backend.runState.loadRunState(root);
  const maxRepairAttempts = Number(runState?.maxAttempts || 3);

  event.sender.send("pipeline:progress", {
    runId,
    agent: "supervisor",
    stage: "auto-validation",
    status: "testing",
    partialResult: {
      ...result,
      workflow: {
        ...(result?.workflow || {}),
        currentStage: "auto-validation",
        commandStatus: "running",
        projectStatus: "Running automatic validation",
        currentTask: "Validating written files"
      }
    }
  });
  await updateAutonomyRunState(root, {
    status: "running",
    currentStage: "verify",
    changedFiles: appliedFiles
  });
  await appendAutonomyLog(root, {
    type: "stage-detail",
    runId,
    event: "verification started"
  });

  const initialValidation = await executeAutomaticProjectSteps(root, activeTrackedEntry?.id, result);
  result = attachValidationResult(result, initialValidation);
  await updateAutonomyRunState(root, {
    status: initialValidation.status === "failed" ? "failed" : initialValidation.status === "needs_review" ? "needs_review" : "running",
    currentStage: "verify",
    changedFiles: appliedFiles,
    lastValidationStatus: initialValidation.status,
    lastError: initialValidation.status === "passed" ? "" : initialValidation.error || backend.verifier.buildVerificationReport(initialValidation.verification)
  });
  await appendAutonomyLog(root, {
    type: "stage-detail",
    runId,
    event: "verification done",
    verificationStatus: initialValidation.status,
    summary: initialValidation.verification?.summary || initialValidation.error || ""
  });
  event.sender.send("pipeline:progress", {
    runId,
    agent: "supervisor",
    stage: "auto-validation",
    status: initialValidation.status === "failed" ? "failed" : "done",
    partialResult: result
  });

  if (initialValidation.status === "passed" || initialValidation.status === "needs_review") {
    return { result, activeTrackedEntry };
  }

  let latestValidation = initialValidation;
  let previousValidationSignature = buildValidationSignature(initialValidation);

  for (let attempt = 1; attempt <= maxRepairAttempts; attempt += 1) {
    await updateAutonomyRunState(root, {
      attempt,
      status: "running",
      currentStage: "patch",
      changedFiles: appliedFiles,
      lastValidationStatus: latestValidation.status,
      lastError: latestValidation.error || backend.verifier.buildVerificationReport(latestValidation.verification)
    });
    await appendAutonomyLog(root, {
      type: "auto-repair-start",
      runId,
      attempt,
      validationCommand: latestValidation.validation?.command || "",
      validationOutput: trimText(latestValidation.validation?.output || latestValidation.error || "", 2000)
    });
    event.sender.send("pipeline:progress", {
      runId,
      agent: "junior",
      stage: "auto-repair",
      status: "coding",
      partialResult: {
        ...result,
        workflow: {
          ...(result?.workflow || {}),
          currentStage: "auto-repair",
          projectStatus: "Validation failed. Junior Dev is applying a targeted patch.",
          currentTask: `Repair validation failure (attempt ${attempt}/${maxRepairAttempts})`
        }
      }
    });

    const validationHints = extractProjectPathsFromValidationOutput(latestValidation.validation?.output || latestValidation.error || "");
    const repairSelectedFiles = uniqueStrings([
      ...appliedFiles,
      ...(payload?.selectedFiles || []),
      ...validationHints
    ]).slice(0, 12);
    const repairFiles = await backend.readSelectedProjectFiles(root, repairSelectedFiles);
    const repairGraphContext = await buildPipelineGraphContext(root, {
      ...payload,
      input: payload?.input || result?.decision?.summary || "",
      selectedFiles: repairSelectedFiles
    }, repairFiles);
    const repairFeedback = [
      `AUTO_REPAIR_VALIDATION_FAILURE_ATTEMPT_${attempt}:`,
      backend.verifier.buildVerificationReport(latestValidation.verification),
      `Command: ${latestValidation.validation?.command || "validation"}`,
      `Status: ${latestValidation.validation?.status || latestValidation.status}`,
      "Output:",
      trimText(latestValidation.validation?.output || latestValidation.error || "", 3500),
      validationHints.length > 0 ? `Focus files:\n${validationHints.map((filePath) => `- ${filePath}`).join("\n")}` : "",
      /missing devdependency vite|missing devdependency @vitejs\/plugin-react|missing dependency react|missing dependency react-dom/i.test(
        `${latestValidation.error || ""}\n${backend.verifier.buildVerificationReport(latestValidation.verification)}`
      )
        ? "Focus this repair on package.json dependencies/scripts only. Do not regenerate unrelated files."
        : "",
      "",
      "Apply the smallest patch needed. Fix the reported syntax/build error first. Do not redesign. Return machine-readable fileOperations only for changed files."
    ].filter(Boolean).join("\n");

    const repairResult = await backend.runPipeline(
      {
        ...payload,
        runId: `${runId}-repair-${attempt}`,
        projectRoot: root,
        projectId: activeTrackedEntry?.id || payload?.projectId,
        selectedFiles: repairSelectedFiles,
        files: repairFiles,
        graphContext: repairGraphContext,
        feedback: [payload?.feedback, repairFeedback].filter(Boolean).join("\n\n"),
        loopCount: Number(payload?.loopCount || 0) + attempt,
        mode: payload?.mode || "manual",
        runPath: root,
        sandboxParentPath: app.getPath("documents")
      },
      (progress) => {
        event.sender.send("pipeline:progress", {
          ...progress,
          runId,
          stage: progress.stage || "auto-repair"
        });
      }
    );

    const repairOperations = Array.isArray(repairResult?.dev?.fileOperations) ? repairResult.dev.fileOperations : [];
    if (repairOperations.length === 0) {
      result = attachAutoRepairResult(result, {
        status: "needs_review",
        summary: "DEV produced no valid fileOperations or path-tagged code blocks.",
        repairResult,
        validation: latestValidation
      });
      await updateAutonomyRunState(root, {
        attempt,
        status: "failed",
        currentStage: "patch",
        lastError: "DEV produced no valid fileOperations or path-tagged code blocks."
      });
      return { result, activeTrackedEntry };
    }

    const repairPatchResult = await applyFileOperationsToExistingProject(
      root,
      repairResult,
      repairSelectedFiles,
      repairOperations
    );
    appliedFiles = uniqueStrings([
      ...appliedFiles,
      ...(repairPatchResult.applied || []).map((item) => item.path)
    ]);
    const finalValidation = await executeAutomaticProjectSteps(root, activeTrackedEntry?.id, repairResult, {
      skipSetupCommands: true
    });
    result = mergeAutoRepairResult(result, repairResult, repairPatchResult, initialValidation, finalValidation);
    await backend.artifactLedger.trackProposedFiles(root, repairOperations);
    await backend.artifactLedger.trackAppliedOperations(root, repairPatchResult.applied || []);
    await backend.artifactLedger.trackFailedOperations(root, repairPatchResult.failedOperations || []);
    await updateAutonomyRunState(root, {
      attempt,
      status: finalValidation.status === "passed" ? "running" : "failed",
      currentStage: "verify",
      changedFiles: appliedFiles,
      lastValidationStatus: finalValidation.status,
      lastError: finalValidation.status === "passed" ? "" : finalValidation.error || backend.verifier.buildVerificationReport(finalValidation.verification)
    });

    const repairedProject = {
      ...(result?.project || {}),
      ...(repairPatchResult.project || {}),
      projectId: activeTrackedEntry?.id || payload?.projectId || ""
    };
    activeTrackedEntry = await upsertProjectEntry(
      projectToTrackedEntry(repairedProject, {
        ...(activeTrackedEntry || {}),
        status:
          finalValidation.status === "passed"
            ? "Output ready"
            : finalValidation.status === "needs_review"
              ? "Needs review"
              : "Validation failed",
        loopCount: Number(result?.workflow?.loopCount || payload?.loopCount || 0),
        lastAgent: "junior",
        affectedFiles: result?.decision?.affectedFiles || [],
        decisionStatus: "pending",
        fsd: result?.project?.fsd || payload?.fsd || activeTrackedEntry?.fsd || null,
        prd: result?.project?.prd || activeTrackedEntry?.prd || null,
        phases: result?.project?.phases || activeTrackedEntry?.phases || [],
        tasks: result?.project?.tasks || activeTrackedEntry?.tasks || [],
        logs: appendProjectLog(activeTrackedEntry?.logs, {
          type: "auto-repair",
          message: finalValidation.status === "passed"
            ? `Auto repair attempt ${attempt} patched files and validation passed.`
            : `Auto repair attempt ${attempt} patched files but validation still failed.`
        })
      })
    );

    await appendAutonomyLog(root, {
      type: "auto-repair-complete",
      runId,
      attempt,
      status: finalValidation.status,
      applied: repairPatchResult.applied || [],
      validationOutput: trimText(finalValidation.validation?.output || finalValidation.error || "", 2000)
    });

    if (finalValidation.status === "passed") {
      await appendAutonomyLog(root, {
        type: "stage-detail",
        runId,
        event: "verification done",
        verificationStatus: "passed"
      });
      event.sender.send("pipeline:progress", {
        runId,
        agent: "supervisor",
        stage: "auto-repair",
        status: "done",
        partialResult: result
      });
      return { result, activeTrackedEntry };
    }

    const nextValidationSignature = buildValidationSignature(finalValidation);
    if (nextValidationSignature && nextValidationSignature === previousValidationSignature) {
      result = attachAutoRepairResult(result, {
        status: "needs_review",
        summary: "Auto repair repeated the same validation failure. Manual review required.",
        repairResult,
        validation: finalValidation
      });
      break;
    }

    latestValidation = finalValidation;
    previousValidationSignature = nextValidationSignature;
  }

  event.sender.send("pipeline:progress", {
    runId,
    agent: "supervisor",
    stage: "auto-repair",
    status: "failed",
    partialResult: result
  });

  await updateAutonomyRunState(root, {
    attempt: maxRepairAttempts,
    status: "needs_review",
    currentStage: "final",
    changedFiles: appliedFiles,
    lastValidationStatus: latestValidation.status,
    lastError: latestValidation.error || backend.verifier.buildVerificationReport(latestValidation.verification)
  });

  return { result, activeTrackedEntry };
}

function buildValidationSignature(validation) {
  return [
    String(validation?.status || ""),
    String(validation?.error || ""),
    String(validation?.validation?.command || ""),
    String(validation?.validation?.output || "").slice(0, 400),
    ...((validation?.verification?.checks || [])
      .filter((check) => check?.status === "failed")
      .map((check) => `${check.name}:${check.message}`))
  ].join("|");
}

async function executeAutomaticProjectSteps(root, projectId, result, options = {}) {
  const entries = [];
  const commands = options.skipSetupCommands
    ? []
    : await collectAutomaticCommands(root, result);
  const verification = await backend.verifier.verifyArtifacts({
    rootPath: root,
    expectedFiles: result?.project?.requiredFiles || [],
    appliedOperations: result?.executor?.applied || result?.dev?.fileOperations || [],
    commandRequests: [
      ...(result?.pm?.commandRequests || []),
      ...(result?.dev?.commandRequests || []),
      ...(result?.dev?.commands || [])
    ]
  });

  if (verification.status !== "passed") {
    return {
      status: "failed",
      entries,
      verification,
      projectType: verification.projectType,
      validationMode: verification.projectType === "vite-react" ? "vite-structure" : verification.projectType === "static-html" ? "direct-html-preview" : "structure-validation",
      validation: null,
      installStatus: "not_run",
      buildStatus: "not_run",
      error: verification.summary
    };
  }

  if (verification.projectType === "static-html") {
    return {
      status: "passed",
      entries,
      verification,
      projectType: verification.projectType,
      validationMode: "direct-html-preview",
      validation: null,
      installStatus: "not_run",
      buildStatus: "not_run",
      error: "",
      previewMode: "file",
      nextAction: "open_index_html"
    };
  }

  try {
    let installStatus = "not_run";
    let buildStatus = "not_run";
    for (const command of commands) {
      const entry = await runProjectCommand({
        projectRoot: root,
        projectId,
        mode: "custom",
        command
      });
      entries.push(entry);
      const normalizedCommand = normalizeSuggestedCommand(entry.command).toLowerCase();
      if (normalizedCommand === "npm install") {
        installStatus = entry.status;
      }
      if (normalizedCommand === "npm run build") {
        buildStatus = entry.status;
      }
      if (entry.status !== "passed") {
        const installFailed = normalizedCommand === "npm install";
        return {
          status: "failed",
          entries,
          verification,
          projectType: verification.projectType,
          validationMode: verification.projectType === "vite-react" ? "vite-build" : "command-validation",
          validation: entry,
          installStatus,
          buildStatus: installFailed ? "blocked" : buildStatus,
          error: installFailed
            ? "Build was not run because dependencies were not installed."
            : `${entry.command} failed.`,
          nextAction: installFailed ? "fix_dependencies" : "patch_validation_failure"
        };
      }
    }

    let validation = null;
    try {
      validation = await runProjectCommand({
        projectRoot: root,
        projectId,
        mode: "validate"
      });
    } catch (error) {
      if (verification.projectType === "vite-react" && /No validation command is available/i.test(String(error?.message || ""))) {
        return {
          status: "needs_review",
          entries,
          verification,
          projectType: verification.projectType,
          validationMode: "vite-structure",
          validation: null,
          installStatus,
          buildStatus: "unverified",
          error: "Vite project source generated. Build unverified.",
          previewMode: "dev_server",
          nextAction: "run_npm_install_and_build"
        };
      }
      throw error;
    }
    entries.push(validation);
    return {
      status: validation.status,
      entries,
      verification,
      projectType: verification.projectType,
      validationMode: verification.projectType === "vite-react" ? "vite-build" : "command-validation",
      validation,
      installStatus,
      buildStatus: validation.status === "passed" ? "passed" : "failed",
      error: validation.status === "passed" ? "" : `${validation.command} failed.`,
      previewMode: verification.projectType === "vite-react" ? "dev_server" : "file",
      nextAction: verification.projectType === "vite-react" ? "review_build_result" : "open_index_html"
    };
  } catch (error) {
    return {
      status: "failed",
      entries,
      verification,
      projectType: verification.projectType,
      validationMode: verification.projectType === "vite-react" ? "vite-build" : "command-validation",
      validation: null,
      installStatus: entries.some((entry) => normalizeSuggestedCommand(entry.command).toLowerCase() === "npm install" && entry.status === "passed") ? "passed" : "not_run",
      buildStatus: "failed",
      error: error?.message || "Automatic validation failed."
    };
  }
}

async function collectAutomaticCommands(root, result) {
  const requestedCommands = uniqueStrings([
    ...(result?.pm?.commandRequests || []),
    ...(result?.dev?.commandRequests || []),
    ...(result?.dev?.commands || [])
  ]);
  const inferredCommands = await inferImplicitSetupCommands(root, requestedCommands);

  return sortAutomaticCommands(uniqueStrings([
    ...inferredCommands,
    ...requestedCommands
  ]))
    .map((command) => normalizeSuggestedCommand(command))
    .filter(Boolean)
    .filter((command) => !/\bnpm\s+run\s+(dev|start)\b|\bnpm\s+start\b/i.test(command))
    .slice(0, 3);
}

function sortAutomaticCommands(commands = []) {
  const weight = (command) => {
    const normalized = normalizeSuggestedCommand(command).toLowerCase();
    if (normalized === "npm install") return 0;
    if (normalized === "npm run build") return 1;
    return 2;
  };

  return [...commands].sort((left, right) => weight(left) - weight(right));
}

async function inferImplicitSetupCommands(root, requestedCommands = []) {
  const normalized = new Set((requestedCommands || []).map((command) => normalizeSuggestedCommand(command).toLowerCase()));
  const hasPackageJson = await fileExists(path.join(root, "package.json"));
  if (!hasPackageJson) {
    return [];
  }

  if (!normalized.has("npm install") && !(await directoryExists(path.join(root, "node_modules")))) {
    return ["npm install"];
  }

  return [];
}

async function applyFileOperationsToExistingProject(rootPath, result, selectedFiles = [], operations = []) {
  const patches = operations
    .filter((operation) => isWriteFileOperation(operation?.action))
    .map((operation) => ({
      path: operation.path,
      content: operation.content
    }))
    .filter((patch) => patch.path);

  if (patches.length === 0) {
    return {
      project: await backend.buildProjectTree(rootPath, { ensureSandboxFolder: false }),
      applied: []
    };
  }

  const allowedPaths = uniqueStrings([
    ...(selectedFiles || []),
    ...(result?.decision?.affectedFiles || []),
    ...(result?.architect?.affectedFiles || []),
    ...patches.map((patch) => patch.path)
  ]);
  const patchResult = await backend.applyFilePatches(rootPath, patches, allowedPaths);
  const project = await backend.buildProjectTree(rootPath, {
    ensureSandboxFolder: inferProjectType(rootPath) !== "sandbox-task"
  });
  const verification = await backend.verifier.verifyArtifacts({
    rootPath,
    expectedFiles: [],
    appliedOperations: patchResult.applied || []
  });
  const failedOperations = [
    ...(verification.missingFiles || []).map((filePath) => ({
      action: "write",
      path: filePath,
      error: "File was reported as written but was not found on disk."
    }))
  ];
  return {
    project,
    applied: patchResult.applied || [],
    backupRoot: patchResult.backupRoot || "",
    failedOperations,
    verification
  };
}

function isWriteFileOperation(actionValue) {
  const action = String(actionValue || "write").trim().toLowerCase();
  return !action || ["write", "create", "update", "modify", "edit", "replace", "overwrite", "upsert"].includes(action);
}

function attachExistingProjectPatchResult(result, patchResult) {
  const applied = patchResult.applied || [];
  const appliedFiles = applied.map((item) => item.path);
  return {
    ...result,
    executor: {
      ...(result?.executor || {}),
      status: applied.length > 0 ? "applied" : "skipped",
      rootPath: patchResult.project?.rootPath || result?.project?.rootPath,
      applied,
      backupRoot: patchResult.backupRoot || "",
      filesCreated: applied.filter((item) => item.created).length,
      filesModified: applied.filter((item) => !item.created).length,
      failedOperations: patchResult.failedOperations || []
    },
    project: {
      ...(result?.project || {}),
      ...(patchResult.project || {}),
      commandHistory: result?.project?.commandHistory || []
    },
    decision: {
      ...(result?.decision || {}),
      affectedFiles: appliedFiles,
      canApply: false,
      decisionStatus: "pending",
      summary: `${result?.decision?.summary || "DEV wrote files."} Executor applied ${applied.length} file operation(s).`
    },
    workflow: {
      ...(result?.workflow || {}),
      currentStage: "file-executor",
      projectStatus: "Output ready",
      currentTask: `Review ${applied.length} written file operation(s).`
    }
  };
}

function attachValidationResult(result, validation) {
  return {
    ...result,
    validation: {
      ...validation,
      projectType: validation.projectType || validation?.verification?.projectType || "generic",
      validationMode: validation.validationMode || "structure-validation"
    },
    project: {
      ...(result?.project || {}),
      commandHistory: validation.entries || result?.project?.commandHistory || []
    },
    workflow: {
      ...(result?.workflow || {}),
      commandStatus: validation.status,
      projectStatus: validation.status === "passed"
        ? "Validation passed"
        : validation.status === "needs_review"
          ? "Build unverified"
          : "Validation failed",
      currentStage: "auto-validation",
      currentTask: validation.status === "passed"
        ? "Review validated output"
        : validation.status === "needs_review"
          ? "Review generated source and optional build"
          : "Repair validation failure"
    }
  };
}

function attachAutoRepairResult(result, repair) {
  return {
    ...result,
    autoRepair: repair,
    workflow: {
      ...(result?.workflow || {}),
      currentStage: "auto-repair",
      projectStatus: "Auto repair needs manual patch",
      currentTask: repair.summary || "Review validation failure"
    }
  };
}

function mergeAutoRepairResult(initialResult, repairResult, repairPatchResult, initialValidation, finalValidation) {
  const initialApplied = initialResult?.executor?.applied || [];
  const repairApplied = repairPatchResult.applied || [];
  const affectedFiles = uniqueStrings([
    ...(initialResult?.decision?.affectedFiles || []),
    ...repairApplied.map((item) => item.path)
  ]);

  return {
    ...initialResult,
    autoRepair: {
      status: finalValidation.status,
      summary: finalValidation.status === "passed"
        ? "Auto repair patched files and validation passed."
        : "Auto repair patched files but validation still failed.",
      initialValidation,
      finalValidation,
      repairOutput: repairResult?.dev?.patchOutput || repairResult?.explanation || "",
      applied: repairApplied
    },
    executor: {
      ...(initialResult?.executor || {}),
      applied: [...initialApplied, ...repairApplied],
      backupRoot: repairPatchResult.backupRoot || initialResult?.executor?.backupRoot || "",
      filesCreated: [...initialApplied, ...repairApplied].filter((item) => item.created).length,
      filesModified: [...initialApplied, ...repairApplied].filter((item) => !item.created).length
    },
    project: {
      ...(initialResult?.project || {}),
      ...(repairPatchResult.project || {}),
      commandHistory: finalValidation.entries || initialValidation.entries || []
    },
    decision: {
      ...(initialResult?.decision || {}),
      affectedFiles,
      summary: finalValidation.status === "passed"
        ? `${initialResult?.decision?.summary || "DEV wrote files."} Auto repair passed validation.`
        : dedupeSummaryPhrases(`${initialResult?.decision?.summary || "DEV wrote files."} Auto repair still needs review.`)
    },
    workflow: {
      ...(initialResult?.workflow || {}),
      currentStage: "auto-repair",
      commandStatus: finalValidation.status,
      projectStatus: finalValidation.status === "passed" ? "Output ready" : "Validation failed",
      currentTask: finalValidation.status === "passed"
        ? "Review auto-repaired output"
        : "Review remaining validation failure"
    }
  };
}

function dedupeSummaryPhrases(value) {
  const pieces = String(value || "")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const unique = [];
  const seen = new Set();
  for (const piece of pieces) {
    const key = piece.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(piece);
  }
  return unique.join(" ").trim();
}

function applyDeterministicDecisionOutcome(result) {
  const validationStatus = getEffectiveValidationStatus(result);
  const projectType = result?.autoRepair?.finalValidation?.projectType || result?.validation?.projectType || "generic";
  const override = {
    applied: false,
    reason: "",
    originalDecisionStatus: result?.workflow?.decisionStatus || result?.decision?.decisionStatus || "pending",
    originalVerdict: result?.decision?.verdict || ""
  };

  if (validationStatus === "failed") {
    override.applied = true;
    override.reason = "validation_failed";
    return {
      ...result,
      decision: {
        ...(result?.decision || {}),
        decisionStatus: "needs_patch",
        verdict: "NEEDS PATCH",
        summary: dedupeSummaryPhrases(`${result?.decision?.summary || "Output generated."} Deterministic validation failed. Patch required.`)
      },
      workflow: {
        ...(result?.workflow || {}),
        currentStage: "decision",
        decisionStatus: "needs_patch",
        projectStatus: "Validation failed",
        currentTask: "Review deterministic validation failure"
      },
      finalization: {
        ...(result?.finalization || {}),
        deterministicOverride: override
      }
    };
  }

  if (validationStatus === "needs_review") {
    override.applied = true;
    override.reason = projectType === "vite-react" ? "build_unverified" : "needs_review";
    return {
      ...result,
      decision: {
        ...(result?.decision || {}),
        decisionStatus: "manual_review_required",
        verdict: projectType === "vite-react" ? "BUILD UNVERIFIED" : "NEEDS REVIEW",
        summary: dedupeSummaryPhrases(
          `${result?.decision?.summary || "Output generated."} ${
            projectType === "vite-react"
              ? "Vite structure is present but build was not verified."
              : "Deterministic evidence is incomplete. Manual review required."
          }`
        )
      },
      workflow: {
        ...(result?.workflow || {}),
        currentStage: "decision",
        decisionStatus: "manual_review_required",
        projectStatus: projectType === "vite-react" ? "Build unverified" : "Needs review",
        currentTask: projectType === "vite-react" ? "Review generated Vite source and optional build" : "Review generated output"
      },
      finalization: {
        ...(result?.finalization || {}),
        deterministicOverride: override
      }
    };
  }

  return {
    ...result,
    finalization: {
      ...(result?.finalization || {}),
      deterministicOverride: {
        ...override,
        applied: false,
        reason: ""
      }
    }
  };
}

function getPipelineTrackedStatus(result) {
  const validationStatus = getEffectiveValidationStatus(result);
  const outputCount = (result?.executor?.applied || []).length
    || (result?.decision?.affectedFiles || []).length
    || (result?.dev?.fileOperations || []).length;
  if (validationStatus === "failed") {
    return "Validation failed";
  }
  if (validationStatus === "needs_review") {
    return "Build unverified";
  }
  if ((result?.executor?.applied || []).length) {
    return "Output ready";
  }
  if (outputCount > 0) {
    return "Ready for review";
  }
  return "In progress";
}

function getEffectiveValidationStatus(result) {
  const autoRepairStatus = String(result?.autoRepair?.status || "").trim().toLowerCase();
  if (autoRepairStatus) {
    return autoRepairStatus;
  }

  const verificationStatus = String(result?.validation?.verification?.status || "").trim().toLowerCase();
  if (verificationStatus && verificationStatus !== "passed") {
    return verificationStatus;
  }

  return String(result?.validation?.status || "").trim().toLowerCase();
}

function isFinalPmUnavailable(result) {
  return /final pm decision unavailable|supervisor final status failed/i.test(
    String(result?.finalization?.pmError || "") + "\n" + String(result?.decision?.recommendation || "")
  );
}

async function classifyRecoverableAutonomyFailure({ task, result, error }) {
  const projectRoot = result?.project?.rootPath || task?.projectRoot || task?.payload?.projectRoot || "";
  const validationStatus = getEffectiveValidationStatus(result);
  if (validationStatus === "failed") {
    return false;
  }

  const resultOutputCount = (result?.executor?.applied || []).length
    || (result?.decision?.affectedFiles || []).length
    || (result?.dev?.fileOperations || []).length;
  if (resultOutputCount > 0 && /timed out|timeout/i.test(String(error?.message || error || ""))) {
    return true;
  }

  if (!projectRoot) {
    return false;
  }

  try {
    const ledger = await backend.artifactLedger.loadArtifactLedger(projectRoot);
    const writtenCount = Array.isArray(ledger?.filesWritten) ? ledger.filesWritten.length : 0;
    return writtenCount > 0 && /timed out|timeout/i.test(String(error?.message || error || ""));
  } catch {
    return false;
  }
}

function buildRecoverableAutonomyMessage(error) {
  const reason = String(error?.message || error || "Timed out").trim();
  return `Final PM decision unavailable: ${reason}. Generated files were preserved. Manual review required.`;
}

function isQaUnavailable(result) {
  const qaNotes = [
    result?.qa?.parallelReview,
    result?.qa?.finalReview,
    result?.qa?.qaResult
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");

  return /qa request timed out|review unavailable|final review unavailable|unavailable/i.test(qaNotes);
}

function extractProjectPathsFromValidationOutput(output) {
  const text = String(output || "");
  if (!text) {
    return [];
  }

  const matches = [
    ...text.matchAll(/(?:^|\s)(src\/[^\s:]+?\.[A-Za-z0-9]+)(?::\d+:\d+)?/g),
    ...text.matchAll(/(?:^|\s)([A-Za-z0-9._/-]+\/[A-Za-z0-9._/-]+?\.[A-Za-z0-9]+)(?::\d+:\d+)?/g)
  ];

  return uniqueStrings(
    matches
      .map((match) => String(match[1] || "").trim().replaceAll("\\", "/"))
      .filter((value) => value && !value.startsWith("node_modules/") && !value.startsWith("dist/"))
  ).slice(0, 8);
}

function uniqueStrings(values = []) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function mapRunStage(stage) {
  const normalized = String(stage || "").trim().toLowerCase();
  if (["pm_plan", "supervisor-spec", "pipeline-start", "planning"].includes(normalized)) return "pm_plan";
  if (["dev", "junior-initial", "coding"].includes(normalized)) return "dev";
  if (["apply_files", "file-executor"].includes(normalized)) return "apply_files";
  if (["verify", "auto-validation", "validation"].includes(normalized)) return "verify";
  if (["qa", "senior-parallel-review", "senior-final-review"].includes(normalized)) return "qa";
  if (["patch", "junior-patch", "auto-repair"].includes(normalized)) return "patch";
  if (["final", "supervisor-final", "decision"].includes(normalized)) return "final";
  return "pm_plan";
}

function mapRunStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (["completed", "done", "passed", "success"].includes(normalized)) return "completed";
  if (["needs_review", "waiting_for_decision", "waiting for decision"].includes(normalized)) return "needs_review";
  if (["failed", "error"].includes(normalized)) return "failed";
  if (["running", "thinking", "coding", "testing", "speaking", "pending", "queued", "idle"].includes(normalized)) return "running";
  return "pending";
}

function buildGeneratedTaskRoot(parentPath, projectSlug) {
  const normalizedParent = String(parentPath || "").trim();
  const normalizedSlug = sanitizeGeneratedSlug(projectSlug);
  if (!normalizedParent || !normalizedSlug) {
    return "";
  }
  return path.join(normalizedParent, backend.DEFAULT_SANDBOX_PROJECT_NAME, "sandbox", "tasks", normalizedSlug);
}

function sanitizeGeneratedSlug(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

async function discardGeneratedOutput(payload = {}) {
  const rootPath = String(payload?.projectRoot || "").trim();
  if (!rootPath) {
    throw new Error("No generated output folder was provided.");
  }

  const root = await fs.realpath(rootPath);
  const tasksRoot = path.join(app.getPath("documents"), backend.DEFAULT_SANDBOX_PROJECT_NAME, "sandbox", "tasks");
  const resolvedTasksRoot = await fs.realpath(tasksRoot);
  const relative = path.relative(resolvedTasksRoot, root);

  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Only generated task sandbox output can be discarded.");
  }

  await fs.rm(root, { recursive: true, force: true });

  if (payload.projectId) {
    await removeTrackedProject(payload.projectId);
  }

  return {
    discarded: true,
    rootPath: root,
    discardedAt: new Date().toISOString()
  };
}

async function exportReviewData(payload = {}) {
  console.log("download-review-data clicked");
  logStartupError("review:export-data clicked", JSON.stringify({
    runId: payload?.runId || payload?.autonomyRun?.runId || "",
    projectRoot: payload?.projectRoot || payload?.result?.project?.rootPath || ""
  }));
  const projectRoot = String(payload?.projectRoot || payload?.result?.project?.rootPath || "").trim();
  const fallbackDir = app.getPath("documents");
  let exportRoot = "";
  let ledgerDir = "";

  if (projectRoot) {
    try {
      exportRoot = await normalizeExistingProjectRoot(projectRoot);
      ledgerDir = await initializeAutonomyLedger(exportRoot);
    } catch (error) {
      logStartupError("review:export-data", error);
    }
  }

  const runId = String(payload?.runId || payload?.autonomyRun?.runId || payload?.result?.preflight?.runId || "").trim();
  const [artifacts, runState, finalReport, runLogRaw, agents] = await Promise.all([
    ledgerDir ? readJsonFile(path.join(ledgerDir, ARTIFACTS_FILE), null) : Promise.resolve(null),
    ledgerDir ? readJsonFile(path.join(ledgerDir, RUN_STATE_FILE), null) : Promise.resolve(null),
    ledgerDir ? fs.readFile(path.join(ledgerDir, "final-report.md"), "utf8").catch(() => "") : Promise.resolve(""),
    ledgerDir ? fs.readFile(path.join(ledgerDir, RUN_LOG_FILE), "utf8").catch(() => "") : Promise.resolve(""),
    getMergedAgents().catch(() => [])
  ]);
  const normalizedAgents = normalizeAgents(agents);
  const exportBaseName = sanitizeGeneratedSlug(
    runId
    || payload?.projectName
    || payload?.result?.project?.projectName
    || (exportRoot ? path.basename(exportRoot) : "run")
    || "run"
  ) || "run";

  const exportPayload = sanitizeReviewExport({
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    runId: runId || runState?.runId || "",
    projectName: payload?.result?.project?.projectName || payload?.projectName || (exportRoot ? path.basename(exportRoot) : null),
    projectRoot: exportRoot || projectRoot || null,
    userPrompt: payload?.input || runState?.taskInput || "",
    selectedRunMode: payload?.result?.preflight?.runMode || payload?.preflight?.runMode || "",
    preflight: payload?.preflight || payload?.result?.preflight || null,
    workflow: payload?.workflow || payload?.result?.workflow || null,
    activeModels: payload?.preflight?.activeModels || null,
    unavailableModels: payload?.preflight?.unavailableModels || null,
    timeoutPolicy: backend.TIMEOUT_POLICY || null,
    modelConfig: normalizedAgents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      model: agent.model,
      endpoint: agent.endpoint,
      timeoutMs: agent.timeoutMs
    })),
    resultSnapshot: payload?.result || null,
    artifacts,
    runState,
    finalReport,
    runLogExcerpts: collectReviewLogEntries(runLogRaw, runId),
    payloadSizes: {
      pmPlanLength: String(payload?.result?.pm?.plan || "").length,
      juniorOutputLength: String(payload?.result?.dev?.implementation || "").length,
      qaOutputLength: String(payload?.result?.qa?.finalReview || payload?.result?.qa?.parallelReview || "").length
    }
  });

  const defaultDirectory = exportRoot || fallbackDir;
  const defaultPath = path.join(
    defaultDirectory,
    `trifix-review-data-${exportBaseName}.json`
  );
  const saveDialog = await dialog.showSaveDialog(mainWindow, {
    title: "Download All Review Data",
    defaultPath,
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (saveDialog.canceled || !saveDialog.filePath) {
    return { cancelled: true };
  }

  await fs.writeFile(saveDialog.filePath, JSON.stringify(exportPayload, null, 2), "utf8");
  return {
    cancelled: false,
    path: saveDialog.filePath
  };
}

function normalizeAgents(value) {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        id: String(entry.id || entry.role || entry.name || "").trim(),
        role: String(entry.role || entry.id || entry.name || "").trim(),
        name: String(entry.name || entry.role || entry.id || "").trim(),
        model: String(entry.model || "").trim(),
        endpoint: String(entry.endpoint || "").trim(),
        timeoutMs: Number(entry.timeoutMs || 0) || 0,
        status: String(entry.status || "").trim()
      }));
  }

  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([, entry]) => entry && typeof entry === "object")
      .map(([key, entry]) => ({
        id: String(entry.id || key || "").trim(),
        role: String(entry.role || key || "").trim(),
        name: String(entry.name || entry.role || key || "").trim(),
        model: String(entry.model || "").trim(),
        endpoint: String(entry.endpoint || "").trim(),
        timeoutMs: Number(entry.timeoutMs || 0) || 0,
        status: String(entry.status || "").trim()
      }));
  }

  return [];
}

async function finishReview(payload = {}) {
  const projectRoot = String(payload?.projectRoot || payload?.result?.project?.rootPath || "").trim();
  const projectId = String(payload?.projectId || "").trim();
  const validationStatus = getEffectiveValidationStatus(payload?.result || {});
  const projectType = String(payload?.result?.autoRepair?.finalValidation?.projectType || payload?.result?.validation?.projectType || "").trim().toLowerCase();
  const decisionStatus = String(payload?.result?.decision?.decisionStatus || "").trim().toLowerCase();
  const finalPmStatus = String(payload?.result?.finalization?.pmStatus || "").trim().toLowerCase();
  const status = validationStatus === "failed" || decisionStatus === "needs_patch"
    ? "Review finished - patch recommended"
    : validationStatus === "needs_review"
      ? projectType === "vite-react"
        ? "Review finished - build still unverified"
        : "Review finished - follow-up prompt recommended"
      : finalPmStatus === "timed_out"
        ? "Review finished - follow-up prompt recommended"
        : "Ready for next prompt";

  if (projectId) {
    await updateTrackedProject(projectId, {
      status,
      decisionStatus: "acknowledged",
      lastUpdated: new Date().toISOString()
    });
  }

  if (projectRoot) {
    await updateAutonomyRunState(projectRoot, {
      status: "review_finished",
      lastDecision: "acknowledged",
      reviewAcknowledgedAt: new Date().toISOString(),
      nextAction: "next-prompt"
    });
    await appendAutonomyLog(projectRoot, {
      type: "decision",
      decision: "acknowledged",
      summary: status
    });
  }

  return {
    decisionStatus: "acknowledged",
    status
  };
}

async function buildAppSettings() {
  const current = await readSettings();
  return {
    endpoint: backend.AI_ENDPOINT,
    endpoints: {
      dev: backend.DEV_ENDPOINT,
      qa: backend.AI_ENDPOINT,
      pm: backend.ARCHITECT_ENDPOINT
    },
    agents: await getMergedAgents(),
    guiQa: normalizeGuiQaSettings(current.guiQa)
  };
}

async function readProjectReviewData(rootPath) {
  const projectRoot = String(rootPath || "").trim();
  if (!projectRoot) {
    return {
      projectRoot: "",
      finalReport: "",
      artifacts: null,
      runState: null,
      runLogExcerpts: [],
      reportAvailable: false
    };
  }

  let normalizedRoot = "";
  let ledgerDir = "";
  try {
    normalizedRoot = await normalizeExistingProjectRoot(projectRoot);
    ledgerDir = await initializeAutonomyLedger(normalizedRoot);
  } catch {
    return {
      projectRoot,
      finalReport: "",
      artifacts: null,
      runState: null,
      runLogExcerpts: [],
      reportAvailable: false
    };
  }

  const [artifacts, runState, finalReport, runLogRaw] = await Promise.all([
    readJsonFile(path.join(ledgerDir, ARTIFACTS_FILE), null).catch(() => null),
    readJsonFile(path.join(ledgerDir, RUN_STATE_FILE), null).catch(() => null),
    fs.readFile(path.join(ledgerDir, "final-report.md"), "utf8").catch(() => ""),
    fs.readFile(path.join(ledgerDir, RUN_LOG_FILE), "utf8").catch(() => "")
  ]);

  return {
    projectRoot: normalizedRoot,
    finalReport: typeof finalReport === "string" ? finalReport : "",
    artifacts: artifacts && typeof artifacts === "object" ? artifacts : null,
    runState: runState && typeof runState === "object" ? runState : null,
    runLogExcerpts: collectReviewLogEntries(runLogRaw, String(runState?.runId || "")).slice(-80),
    reportAvailable: Boolean(String(finalReport || "").trim())
  };
}

function normalizeGuiQaSettings(value = {}) {
  const candidate = value && typeof value === "object" ? value : {};
  const mode = String(candidate.mode || DEFAULT_GUI_QA_SETTINGS.mode).trim().toLowerCase();
  const browser = String(candidate.browser || DEFAULT_GUI_QA_SETTINGS.browser).trim().toLowerCase();
  const slowMoMs = Number(candidate.slowMoMs);
  const maxAttempts = Number(candidate.maxAttempts);
  return {
    enabled: Boolean(candidate.enabled),
    mode: ["headless", "live"].includes(mode) ? mode : DEFAULT_GUI_QA_SETTINGS.mode,
    browser: browser === "chromium" ? browser : DEFAULT_GUI_QA_SETTINGS.browser,
    slowMoMs: Number.isFinite(slowMoMs) ? Math.max(0, Math.round(slowMoMs)) : DEFAULT_GUI_QA_SETTINGS.slowMoMs,
    autoRunAfterBuild: Boolean(candidate.autoRunAfterBuild),
    stopDevServerAfterQa: candidate.stopDevServerAfterQa !== false,
    maxAttempts: Number.isFinite(maxAttempts) ? Math.max(1, Math.round(maxAttempts)) : DEFAULT_GUI_QA_SETTINGS.maxAttempts
  };
}

async function detectPlaywrightCapability(payload = {}) {
  let targetRoot = String(payload?.projectRoot || "").trim();
  if (targetRoot) {
    try {
      targetRoot = await normalizeExistingProjectRoot(targetRoot);
    } catch {
      targetRoot = "";
    }
  }
  if (!targetRoot) {
    targetRoot = process.cwd();
  }

  const resolvedTestPackage = resolveOptionalPackage("@playwright/test", targetRoot);
  if (!resolvedTestPackage) {
    return {
      status: "package_missing",
      packageStatus: "package_missing",
      browsersStatus: "not_checked",
      browser: "chromium",
      checkedAt: new Date().toISOString(),
      targetRoot,
      details: "@playwright/test is not installed for this workspace."
    };
  }

  const resolvedBrowserPackage = resolveOptionalPackage("playwright", targetRoot)
    || resolveOptionalPackage("playwright-core", targetRoot);
  if (!resolvedBrowserPackage) {
    return {
      status: "browsers_missing",
      packageStatus: "available",
      browsersStatus: "browsers_missing",
      browser: "chromium",
      checkedAt: new Date().toISOString(),
      targetRoot,
      details: "@playwright/test is installed, but the Playwright browser runtime package was not found."
    };
  }

  try {
    const playwright = loadOptionalPackage(resolvedBrowserPackage);
    const executablePath = typeof playwright?.chromium?.executablePath === "function"
      ? playwright.chromium.executablePath()
      : "";
    const browserInstalled = Boolean(executablePath) && await fileExists(executablePath);
    return {
      status: browserInstalled ? "available" : "browsers_missing",
      packageStatus: "available",
      browsersStatus: browserInstalled ? "available" : "browsers_missing",
      browser: "chromium",
      checkedAt: new Date().toISOString(),
      targetRoot,
      executablePath: browserInstalled ? executablePath : "",
      details: browserInstalled
        ? `Chromium is available at ${executablePath}.`
        : "Playwright is installed, but Chromium browser binaries were not found."
    };
  } catch (error) {
    return {
      status: "browsers_missing",
      packageStatus: "available",
      browsersStatus: "browsers_missing",
      browser: "chromium",
      checkedAt: new Date().toISOString(),
      targetRoot,
      details: error?.message || "Playwright package was found, but Chromium could not be resolved."
    };
  }
}

function resolveOptionalPackage(packageName, rootPath) {
  try {
    return require.resolve(`${packageName}/package.json`, { paths: [rootPath] });
  } catch {
    return "";
  }
}

function loadOptionalPackage(packageJsonPath) {
  if (!packageJsonPath) {
    return null;
  }

  const packageRequire = createRequire(packageJsonPath);
  const packageJson = packageRequire(packageJsonPath);
  return packageRequire(packageJson.name);
}

async function runGuiQaSmokeTest(payload = {}) {
  const root = await normalizeCommandRoot(payload.projectRoot);
  const current = await readSettings();
  const guiQa = normalizeGuiQaSettings(payload.guiQa || current.guiQa);
  const healthUrl = String(payload.healthUrl || "").trim();
  const processId = String(payload.processId || "").trim();
  const timestamp = new Date().toISOString();
  const { dir: guiQaDir, resultPath, screenshotPath } = await getGuiQaArtifactPaths(root);
  await fs.mkdir(guiQaDir, { recursive: true });

  if (!healthUrl) {
    const skippedResult = {
      status: "skipped_missing_health_url",
      baseURL: "",
      finalUrl: "",
      title: "",
      bodyTextLength: 0,
      consoleErrors: [],
      pageErrors: [],
      screenshotPath: "",
      resultPath,
      checkedAt: timestamp,
      message: "Start the project first. Waiting for dev server URL."
    };
    await writeJsonFile(resultPath, skippedResult);
    return skippedResult;
  }

  const validatedTarget = validateGuiQaTargetUrl(healthUrl);
  if (!validatedTarget.ok) {
    const errorResult = {
      status: "error",
      baseURL: healthUrl,
      finalUrl: "",
      title: "",
      bodyTextLength: 0,
      consoleErrors: [],
      pageErrors: [],
      screenshotPath: "",
      resultPath,
      checkedAt: timestamp,
      message: validatedTarget.message
    };
    await writeJsonFile(resultPath, errorResult);
    return errorResult;
  }

  const capability = await detectPlaywrightCapability({ projectRoot: root });
  if (capability.status !== "available") {
    const skippedResult = {
      status: "skipped_missing_playwright",
      baseURL: validatedTarget.url,
      finalUrl: "",
      title: "",
      bodyTextLength: 0,
      consoleErrors: [],
      pageErrors: [],
      screenshotPath: "",
      resultPath,
      checkedAt: timestamp,
      capability,
      message: capability.details || "Playwright is not available."
    };
    await writeJsonFile(resultPath, skippedResult);
    return skippedResult;
  }

  const resolvedBrowserPackage = resolveOptionalPackage("playwright", root)
    || resolveOptionalPackage("playwright-core", root);
  const playwright = loadOptionalPackage(resolvedBrowserPackage);
  const consoleErrors = [];
  const pageErrors = [];
  let browser;
  let context;
  let page;
  let stopProcessError = "";

  const result = {
    status: "error",
    baseURL: validatedTarget.url,
    finalUrl: "",
    title: "",
    bodyTextLength: 0,
    consoleErrors,
    pageErrors,
    screenshotPath: "",
    resultPath,
    checkedAt: timestamp,
    mode: guiQa.mode,
    browser: guiQa.browser,
    slowMoMs: guiQa.slowMoMs,
    capability
  };

  try {
    browser = await playwright.chromium.launch({
      headless: guiQa.mode !== "live",
      slowMo: guiQa.slowMoMs > 0 ? guiQa.slowMoMs : undefined
    });
    context = await browser.newContext({
      baseURL: validatedTarget.url
    });
    page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error?.message || String(error));
    });

    const response = await page.goto(validatedTarget.url, {
      waitUntil: "domcontentloaded",
      timeout: 20000
    });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await page.waitForSelector("body", { timeout: 10000 });

    const title = await page.title();
    const bodyText = await page.locator("body").innerText({ timeout: 10000 });
    await page.screenshot({
      path: screenshotPath,
      fullPage: true
    });

    result.finalUrl = page.url();
    result.title = title;
    result.bodyTextLength = bodyText.trim().length;
    result.screenshotPath = screenshotPath;
    result.httpStatus = response?.status?.() ?? null;
    result.pageLoaded = true;
    result.bodyExists = true;
    result.genericChecks = {
      pageLoads: true,
      bodyExists: true,
      bodyTextNotEmpty: result.bodyTextLength > 0,
      noUncaughtPageError: pageErrors.length === 0
    };
    result.status = result.genericChecks.bodyTextNotEmpty && result.genericChecks.noUncaughtPageError
      ? "passed"
      : "failed";
    result.message = result.status === "passed"
      ? "GUI smoke test passed."
      : "GUI smoke test failed one or more generic checks.";
  } catch (error) {
    result.status = "error";
    result.message = error?.message || "GUI smoke test failed.";
    if (page) {
      try {
        await page.screenshot({
          path: screenshotPath,
          fullPage: true
        });
        result.screenshotPath = screenshotPath;
      } catch {
        result.screenshotPath = "";
      }
      try {
        result.finalUrl = page.url();
      } catch {
        result.finalUrl = "";
      }
      try {
        result.title = await page.title();
      } catch {
        result.title = "";
      }
    }
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (guiQa.stopDevServerAfterQa && processId) {
      try {
        await stopManagedProjectProcess({
          projectRoot: root,
          processId
        });
      } catch (error) {
        stopProcessError = error?.message || "Could not stop dev server after GUI QA.";
      }
    }
  }

  if (stopProcessError) {
    result.stopDevServerError = stopProcessError;
  }
  await writeJsonFile(resultPath, result);
  return result;
}

function validateGuiQaTargetUrl(value) {
  try {
    const candidate = new URL(String(value || "").trim());
    const hostname = candidate.hostname.toLowerCase();
    if (!["localhost", "127.0.0.1"].includes(hostname)) {
      return {
        ok: false,
        message: "GUI QA MVP only supports local dev server URLs on localhost or 127.0.0.1."
      };
    }
    if (!["http:", "https:"].includes(candidate.protocol)) {
      return {
        ok: false,
        message: "GUI QA target URL must use http or https."
      };
    }
    return {
      ok: true,
      url: candidate.toString()
    };
  } catch {
    return {
      ok: false,
      message: "GUI QA target URL is invalid."
    };
  }
}

async function getGuiQaArtifactPaths(root) {
  const ledgerDir = await initializeAutonomyLedger(root);
  const dir = path.join(ledgerDir, GUI_QA_DIR_NAME);
  return {
    dir,
    resultPath: path.join(dir, GUI_QA_RESULT_FILE),
    screenshotPath: path.join(dir, GUI_QA_SCREENSHOT_FILE)
  };
}

async function getLatestGuiQaResult(payload = {}) {
  const root = await normalizeCommandRoot(payload.projectRoot);
  const { resultPath, screenshotPath } = await getGuiQaArtifactPaths(root);
  const screenshotExists = await fileExists(screenshotPath);

  try {
    const raw = await fs.readFile(resultPath, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        status: "error",
        message: "Stored GUI QA result could not be read.",
        resultPath,
        screenshotPath,
        screenshotExists
      };
    }

    const result = parsed && typeof parsed === "object" ? parsed : {};
    return {
      status: String(result.status || "not_checked"),
      checkedAt: typeof result.checkedAt === "string" ? result.checkedAt : "",
      baseURL: typeof result.baseURL === "string" ? result.baseURL : "",
      finalUrl: typeof result.finalUrl === "string" ? result.finalUrl : "",
      title: typeof result.title === "string" ? result.title : "",
      httpStatus: Number.isInteger(result.httpStatus) ? result.httpStatus : null,
      bodyTextLength: Number.isFinite(Number(result.bodyTextLength)) ? Math.max(0, Number(result.bodyTextLength)) : 0,
      consoleErrors: Array.isArray(result.consoleErrors) ? result.consoleErrors.map((item) => String(item || "")) : [],
      pageErrors: Array.isArray(result.pageErrors) ? result.pageErrors.map((item) => String(item || "")) : [],
      message: typeof result.message === "string" ? result.message : "",
      capability: result.capability && typeof result.capability === "object"
        ? {
            status: String(result.capability.status || "not_checked"),
            packageStatus: String(result.capability.packageStatus || "not_checked"),
            browsersStatus: String(result.capability.browsersStatus || "not_checked"),
            browser: String(result.capability.browser || "chromium"),
            checkedAt: typeof result.capability.checkedAt === "string" ? result.capability.checkedAt : "",
            targetRoot: typeof result.capability.targetRoot === "string" ? result.capability.targetRoot : "",
            details: typeof result.capability.details === "string" ? result.capability.details : ""
          }
        : null,
      resultPath,
      screenshotPath,
      screenshotExists
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        status: "not_checked",
        message: "No GUI QA result found for this project yet.",
        resultPath,
        screenshotPath,
        screenshotExists
      };
    }

    return {
      status: "error",
      message: "Stored GUI QA result could not be read.",
      resultPath,
      screenshotPath,
      screenshotExists
    };
  }
}

async function startQualityLoop(payload = {}) {
  const projectRoot = await normalizeCommandRoot(payload.projectRoot);
  const existing = Array.from(qualityLoops.values()).find((task) =>
    task.projectRoot === projectRoot
    && !["quality_loop_passed", "quality_loop_failed", "quality_loop_needs_review", "stopped", "gui_qa_failed", "qa_evidence_ready", "gui_qa_skipped_missing_playwright", "blocked_missing_health_url"].includes(String(task.status || "").toLowerCase())
  );
  if (existing) {
    return summarizeQualityLoop(existing);
  }

  const runId = `quality-${Date.now()}`;
  const mode = String(payload.mode || "").trim().toLowerCase() === "evidence_only" ? "evidence_only" : "full_ai_loop";
  const task = {
    runId,
    projectRoot,
    mode,
    status: "running",
    stopRequested: false,
    createdAt: new Date().toISOString(),
    currentRound: 0,
    maxRounds: Math.max(1, Number(payload.maxRounds || DEFAULT_MAX_QUALITY_ROUNDS) || DEFAULT_MAX_QUALITY_ROUNDS),
    maxGuiQaRepairAttempts: Math.max(1, Number(payload.maxGuiQaRepairAttempts || DEFAULT_MAX_GUI_QA_REPAIR_ATTEMPTS) || DEFAULT_MAX_GUI_QA_REPAIR_ATTEMPTS),
    buildStatus: "idle",
    devServerUrl: "",
    playwrightStatus: "not_checked",
    guiQaStatus: "idle",
    qaStatus: "idle",
    qaVerdict: "",
    devPatchStatus: "idle",
    finalPmStatus: "idle",
    message: "Quality loop queued.",
    latestStopReason: "",
    lastKnownIssue: "",
    originalRequest: String(payload.originalRequest || "").trim(),
    artifactDirPath: path.join(projectRoot, AUTONOMY_DIR_NAME, GUI_QA_DIR_NAME),
    latestResultPath: "",
    latestScreenshotPath: "",
    latestQaVerdictPath: "",
    previousAttempts: [],
    repeatedFailures: [],
    lastFailureSignature: ""
  };
  qualityLoops.set(runId, task);
  await upsertPersistentRunbook(projectRoot, {
    runId,
    projectName: path.basename(projectRoot),
    mode: mode === "evidence_only" ? "evidence_only" : "full_quality_loop",
    status: "running",
    userGoal: task.originalRequest,
    currentStage: "queued",
    currentRound: 0,
    maxRounds: task.maxRounds
  }, {
    type: "run-created",
    status: "running",
    message: "Runbook created for quality loop."
  });
  sendQualityLoopProgress(task, { message: "Quality loop started." });
  void executeQualityLoop(task, payload);
  return summarizeQualityLoop(task);
}

async function stopQualityLoop(payload = {}) {
  const task = qualityLoops.get(String(payload.runId || "").trim());
  if (!task) {
    return {
      runId: String(payload.runId || "").trim(),
      status: "stopped",
      latestStopReason: "Stop requested.",
      message: "Stop requested."
    };
  }
  task.stopRequested = true;
  task.status = "stopped";
  task.message = "Stop requested.";
  task.latestStopReason = "Stop requested.";
  task.lastKnownIssue = "Stop requested.";
  task.guiQaStatus = "idle";
  task.qaStatus = task.qaStatus === "running" ? "idle" : task.qaStatus;
  task.devPatchStatus = task.devPatchStatus === "dev_patching_gui_issue" ? "idle" : task.devPatchStatus;
  task.finalPmStatus = task.finalPmStatus === "running" ? "idle" : task.finalPmStatus;
  await updateAutonomyRunState(task.projectRoot, {
    status: "stopped",
    currentStage: "stopped",
    nextAction: "manual_review",
    lastError: task.message
  }).catch(() => {});
  sendQualityLoopProgress(task, { message: task.message });
  return summarizeQualityLoop(task);
}

async function getQualityLoopStatus(payload = {}) {
  const runId = String(payload.runId || "").trim();
  if (runId) {
    return summarizeQualityLoop(qualityLoops.get(runId) || null);
  }

  const projectRoot = String(payload.projectRoot || "").trim();
  if (!projectRoot) {
    return null;
  }
  const normalized = await normalizeCommandRoot(projectRoot).catch(() => "");
  const task = Array.from(qualityLoops.values()).find((entry) => entry.projectRoot === normalized) || null;
  return summarizeQualityLoop(task);
}

async function executeQualityLoop(task, payload = {}) {
  const root = task.projectRoot;
  const currentSettings = await readSettings().catch(() => ({}));
  const guiQaSettings = normalizeGuiQaSettings(payload.guiQa || currentSettings.guiQa);
  const runState = await backend.runState.loadRunState(root).catch(() => null);
  const reviewData = await readProjectReviewData(root).catch(() => null);
  const originalRequest = String(payload.originalRequest || runState?.taskInput || "").trim();
  const pmPlan = trimText(String(reviewData?.finalReport || ""), 2400);
  const health = await backend.getModelHealth().catch(() => ({}));
  const qaAvailable = Boolean(health?.supervisor?.online);
  const devAvailable = Boolean(health?.junior?.online);
  const pmAvailable = Boolean(health?.architect?.online);
  task.qaStatus = qaAvailable ? "idle" : "unavailable";
  task.finalPmStatus = pmAvailable ? "idle" : "unavailable";
  task.playwrightStatus = "not_checked";
  task.latestStopReason = "";
  task.lastKnownIssue = "";
  await logQualityLoopEvent(task, "quality-loop-start", {
    qaAvailable,
    devAvailable,
    pmAvailable
  });

  let guiPatchAttempts = 0;
  const buildFailureSignatures = new Set();
  const guiFailureSignatures = new Set();
  const qaIssueSignatures = new Set();

  for (let round = 1; round <= task.maxRounds; round += 1) {
    if (task.stopRequested) {
      break;
    }

    task.currentRound = round;
    task.message = `Quality round ${round}/${task.maxRounds} started.`;
    task.buildStatus = "running";
    task.playwrightStatus = "checking";
    task.guiQaStatus = "gui_qa_pending";
    task.qaStatus = qaAvailable ? "idle" : "unavailable";
    task.qaVerdict = "";
    task.devPatchStatus = "idle";
    await logQualityLoopEvent(task, "quality-loop-round-start", {
      round
    });
    sendQualityLoopProgress(task, {
      status: "gui_qa_pending",
      message: task.message
    });
    await updateAutonomyRunState(root, {
      status: "gui_qa_pending",
      currentStage: "gui_qa_pending",
      attempt: round,
      maxAttempts: task.maxRounds
    });

    await logQualityLoopEvent(task, "quality-loop-build-start");
    const validation = await executeAutomaticProjectSteps(root, "", { project: { requiredFiles: [] }, executor: { applied: [] }, pm: {}, dev: {} }, {
      skipSetupCommands: false
    });
    const buildEvidence = trimText([
      validation.error || "",
      validation.validation?.output || "",
      validation.verification?.summary || ""
    ].filter(Boolean).join("\n\n"), 6000);
    task.buildStatus = validation.status;
    await logQualityLoopEvent(task, "quality-loop-build-result", {
      buildStatus: validation.status,
      summary: validation.error || validation.verification?.summary || ""
    });
    sendQualityLoopProgress(task, {
      buildStatus: task.buildStatus,
      message: validation.status === "passed" ? "Deterministic build verification passed." : (validation.error || "Deterministic verification failed.")
    });
    task.lastKnownIssue = validation.status === "passed"
      ? ""
      : trimText(validation.error || validation.validation?.output || validation.verification?.summary || "Deterministic verification failed.", 400);

    const roundDir = await ensureGuiQaRoundDir(root, round);
    if (buildEvidence) {
      await fs.writeFile(path.join(roundDir, "build-log.txt"), buildEvidence, "utf8");
    }

    if (validation.status !== "passed" && task.mode !== "evidence_only") {
      const buildSignature = buildQualityFailureSignature("build", validation);
      if (buildFailureSignatures.has(buildSignature)) {
        task.repeatedFailures.push(buildSignature);
      }
      buildFailureSignatures.add(buildSignature);
      task.status = "quality_loop_needs_review";
      task.latestStopReason = buildFailureSignatures.size > 1
        ? "Same build error repeated."
        : "Build failed before GUI QA.";
      task.message = validation.status === "needs_review"
        ? "Build evidence is incomplete. Manual review required."
        : "Build failed. Manual review required.";
      task.lastKnownIssue = trimText(buildEvidence || task.message, 400);
      await updateAutonomyRunState(root, {
        status: "quality_loop_needs_review",
        currentStage: "quality_loop_failed",
        lastValidationStatus: validation.status,
        lastError: task.message
      });
      await logQualityLoopEvent(task, "quality-loop-stop-reason", {
        reason: task.latestStopReason,
        lastIssue: task.message
      });
      sendQualityLoopProgress(task, { status: task.status, message: task.message });
      break;
    }

    await logQualityLoopEvent(task, "quality-loop-run-project-start");
    const processInfo = await ensureQualityLoopProcess(root);
    task.devServerUrl = processInfo.healthUrl || "";
    await logQualityLoopEvent(task, "quality-loop-run-project-result", {
      processId: processInfo.processId,
      healthUrl: processInfo.healthUrl || ""
    });
    if (!task.devServerUrl) {
      task.status = "blocked_missing_health_url";
      task.guiQaStatus = "error";
      task.latestStopReason = "healthUrl missing.";
      task.message = "healthUrl missing. Manual review required.";
      task.lastKnownIssue = "No healthUrl was detected after starting or reusing Run Project.";
      await updateAutonomyRunState(root, {
        status: "quality_loop_needs_review",
        currentStage: "gui_qa_failed",
        lastError: task.message
      });
      await logQualityLoopEvent(task, "quality-loop-stop-reason", {
        reason: task.latestStopReason,
        lastIssue: task.message
      });
      sendQualityLoopProgress(task, { status: task.status, message: task.message });
      break;
    }
    await logQualityLoopEvent(task, "quality-loop-health-url-detected", {
      healthUrl: task.devServerUrl
    });

    const capability = await detectPlaywrightCapability({ projectRoot: root });
    task.playwrightStatus = capability.status;
    if (capability.status !== "available") {
      task.status = "gui_qa_skipped_missing_playwright";
      task.guiQaStatus = "gui_qa_skipped_missing_playwright";
      task.latestStopReason = "Playwright missing.";
      task.message = guiQaSettings.enabled === false
        ? "GUI QA is disabled. Manual review required."
        : "Playwright is missing. Install Playwright, then rerun the quality loop.";
      task.lastKnownIssue = capability.details || task.message;
      await updateAutonomyRunState(root, {
        status: "quality_loop_needs_review",
        currentStage: "gui_qa_failed",
        lastError: task.message
      });
      await logQualityLoopEvent(task, "quality-loop-stop-reason", {
        reason: task.latestStopReason,
        lastIssue: task.message
      });
      sendQualityLoopProgress(task, { status: task.status, message: task.message });
      break;
    }

    task.guiQaStatus = "gui_qa_running";
    await logQualityLoopEvent(task, "quality-loop-gui-qa-start", {
      healthUrl: task.devServerUrl
    });
    sendQualityLoopProgress(task, { guiQaStatus: task.guiQaStatus, message: "Running Playwright GUI QA." });
    const guiQaResult = await runGuiQaSmokeTest({
      projectRoot: root,
      processId: processInfo.processId,
      healthUrl: task.devServerUrl,
      guiQa: {
        ...guiQaSettings,
        stopDevServerAfterQa: false
      }
    });
    task.guiQaStatus = guiQaResult.status === "passed" ? "gui_qa_passed" : "gui_qa_failed";
    task.latestResultPath = guiQaResult.resultPath || "";
    task.latestScreenshotPath = guiQaResult.screenshotPath || "";
    await writeGuiQaRoundArtifacts(root, round, guiQaResult);
    await logQualityLoopEvent(task, "quality-loop-gui-qa-result", {
      guiQaStatus: task.guiQaStatus,
      httpStatus: guiQaResult.httpStatus ?? null,
      resultStatus: guiQaResult.status,
      screenshotPath: guiQaResult.screenshotPath || ""
    });

    const guiSignature = buildQualityFailureSignature("gui", guiQaResult);
    if (guiFailureSignatures.has(guiSignature)) {
      task.repeatedFailures.push(guiSignature);
    }
    guiFailureSignatures.add(guiSignature);

    if (task.mode === "evidence_only") {
      task.status = guiQaResult.status === "passed" ? "qa_evidence_ready" : "gui_qa_failed";
      task.latestStopReason = guiQaResult.status === "passed"
        ? "GUI QA evidence collected."
        : "GUI QA evidence collected with failures.";
      task.message = guiQaResult.status === "passed"
        ? "GUI QA evidence is ready."
        : (guiQaResult.message || "GUI QA evidence collected with failures.");
      task.lastKnownIssue = trimText(guiQaResult.message || task.latestStopReason, 400);
      await updateAutonomyRunState(root, {
        status: task.status,
        currentStage: task.guiQaStatus,
        nextAction: "manual_review"
      });
      await logQualityLoopEvent(task, "quality-loop-stop-reason", {
        reason: task.latestStopReason,
        lastIssue: task.message
      });
      sendQualityLoopProgress(task, { status: task.status, message: task.message });
      break;
    }

    if (!qaAvailable) {
      task.status = "quality_loop_needs_review";
      task.qaStatus = "unavailable";
      task.latestStopReason = "QA unavailable.";
      task.message = "QA unavailable. GUI QA evidence was collected, but AI repair loop cannot run.";
      task.lastKnownIssue = trimText(guiQaResult.message || "QA agent is offline or unavailable.", 400);
      await updateAutonomyRunState(root, {
        status: "quality_loop_needs_review",
        currentStage: "qa_reviewing_gui_evidence",
        nextAction: "manual_review",
        lastError: task.message
      });
      await logQualityLoopEvent(task, "quality-loop-stop-reason", {
        reason: task.latestStopReason,
        lastIssue: task.message
      });
      sendQualityLoopProgress(task, { status: task.status, message: task.message });
      break;
    }

    task.message = "QA reviewing GUI evidence.";
    task.qaStatus = "running";
    sendQualityLoopProgress(task, {
      guiQaStatus: task.guiQaStatus,
      qaStatus: task.qaStatus,
      status: "qa_reviewing_gui_evidence",
      message: task.message
    });

    await logQualityLoopEvent(task, "quality-loop-qa-start");
    const qaVerdict = await backend.runGuiQaReview({
      originalRequest,
      pmPlan,
      currentFilesSummary: await buildQualityLoopFileSummary(root),
      changedFiles: await collectQualityChangedFiles(root),
      buildEvidence,
      guiQaResult,
      screenshotPath: guiQaResult.screenshotPath || "",
      consoleErrors: guiQaResult.consoleErrors || [],
      pageErrors: guiQaResult.pageErrors || [],
      acceptanceCriteria: extractAcceptanceCriteria(reviewData?.finalReport || ""),
      previousAttempts: task.previousAttempts,
      repeatedFailures: task.repeatedFailures
    });
    await fs.writeFile(path.join(roundDir, "qa-verdict.raw.txt"), String(qaVerdict?.rawOutput || ""), "utf8");
    if (!qaVerdict?.validFormat) {
      task.status = "quality_loop_needs_review";
      task.qaStatus = "invalid_format";
      task.qaVerdict = "manual_review";
      task.latestStopReason = "QA returned invalid review format.";
      task.message = "QA returned invalid review format.";
      task.lastKnownIssue = trimText(String(qaVerdict?.rawOutput || ""), 400) || task.message;
      await fs.writeFile(path.join(roundDir, "qa-verdict.json"), JSON.stringify({
        status: "invalid_format",
        rawOutput: qaVerdict?.rawOutput || ""
      }, null, 2), "utf8");
      await logQualityLoopEvent(task, "quality-loop-qa-result", {
        validFormat: false,
        verdict: "manual_review"
      });
      await updateAutonomyRunState(root, {
        status: "quality_loop_needs_review",
        currentStage: "qa_reviewing_gui_evidence",
        nextAction: "manual_review",
        lastError: task.message
      });
      await logQualityLoopEvent(task, "quality-loop-stop-reason", {
        reason: task.latestStopReason,
        lastIssue: task.message
      });
      sendQualityLoopProgress(task, { status: task.status, message: task.message });
      break;
    }

    const deterministicVerdict = applyGuiQaDeterministicVerdict(qaVerdict, validation, guiQaResult, task.repeatedFailures);
    const qaIssueSignature = buildQaIssueSignature(deterministicVerdict);
    if (qaIssueSignatures.has(qaIssueSignature)) {
      task.repeatedFailures.push(qaIssueSignature);
      deterministicVerdict.verdict = "manual_review";
      deterministicVerdict.summary = "Same QA issue repeated. Manual review required.";
    }
    qaIssueSignatures.add(qaIssueSignature);
    await persistLatestGuiQaVerdict(root, deterministicVerdict);
    await fs.writeFile(path.join(roundDir, "qa-verdict.json"), JSON.stringify(deterministicVerdict, null, 2), "utf8");
    await logQualityLoopEvent(task, "quality-loop-qa-result", {
      validFormat: true,
      verdict: deterministicVerdict.verdict,
      summary: deterministicVerdict.summary
    });
    task.latestQaVerdictPath = path.join(root, AUTONOMY_DIR_NAME, GUI_QA_DIR_NAME, GUI_QA_VERDICT_FILE);
    task.qaStatus = "completed";
    task.qaVerdict = deterministicVerdict.verdict;
    task.lastKnownIssue = trimText(deterministicVerdict.summary || "", 400);
    task.previousAttempts.push({
      round,
      verdict: deterministicVerdict.verdict,
      summary: deterministicVerdict.summary
    });

    if (deterministicVerdict.verdict === "pass") {
      task.finalPmStatus = pmAvailable ? "running" : "unavailable";
      if (pmAvailable) {
        task.status = "quality_loop_passed";
        await logQualityLoopEvent(task, "quality-loop-finalize-start");
        const pmFinal = await backend.runGuiQaPmFinalization({
          originalRequest,
          pmPlan,
          qaVerdict: deterministicVerdict,
          guiQaResult,
          buildEvidence
        });
        task.finalPmStatus = pmFinal.finalStatus === "quality_loop_passed" ? "completed" : "manual_review";
      } else {
        task.status = "quality_loop_needs_review";
      }
      task.message = task.status === "quality_loop_passed"
        ? "Quality loop passed."
        : "PM unavailable. QA passed, but final approval requires manual review.";
      task.lastKnownIssue = trimText(deterministicVerdict.summary || task.message, 400);
      await updateAutonomyRunState(root, {
        status: task.status,
        currentStage: task.status === "quality_loop_passed" ? "quality_loop_passed" : "quality_loop_needs_review",
        nextAction: task.status === "quality_loop_passed" ? "finalize" : "manual_review"
      });
      await logQualityLoopEvent(task, "quality-loop-finalize-result", {
        finalPmStatus: task.finalPmStatus,
        verdict: deterministicVerdict.verdict
      });
      await logQualityLoopEvent(task, "quality-loop-stop-reason", {
        reason: task.status === "quality_loop_passed" ? "QA passed." : "PM unavailable after QA pass.",
        lastIssue: task.message
      });
      sendQualityLoopProgress(task, { status: task.status, message: task.message });
      break;
    }

    if (deterministicVerdict.verdict === "manual_review") {
      task.status = "quality_loop_needs_review";
      task.latestStopReason = deterministicVerdict.summary || "Manual review required.";
      task.message = deterministicVerdict.summary || "Manual review required.";
      task.lastKnownIssue = trimText(deterministicVerdict.summary || task.message, 400);
      await updateAutonomyRunState(root, {
        status: "quality_loop_needs_review",
        currentStage: "quality_loop_needs_review",
        nextAction: "manual_review",
        lastError: task.message
      });
      await logQualityLoopEvent(task, "quality-loop-stop-reason", {
        reason: task.latestStopReason,
        lastIssue: task.message
      });
      sendQualityLoopProgress(task, { status: task.status, message: task.message });
      break;
    }

    guiPatchAttempts += 1;
    if (guiPatchAttempts > task.maxGuiQaRepairAttempts || task.repeatedFailures.length > 0) {
      task.status = "quality_loop_needs_review";
      task.latestStopReason = task.repeatedFailures.length > 0
        ? `Repeated failure: ${task.repeatedFailures[task.repeatedFailures.length - 1]}`
        : "Max GUI QA repair attempts reached.";
      task.message = "GUI QA repair attempts exhausted or repeated failure detected. Recommended manual review.";
      task.lastKnownIssue = trimText(deterministicVerdict.summary || task.latestStopReason, 400);
      await updateAutonomyRunState(root, {
        status: "quality_loop_needs_review",
        currentStage: "quality_loop_failed",
        nextAction: "manual_review",
        lastError: task.message
      });
      await logQualityLoopEvent(task, "quality-loop-stop-reason", {
        reason: task.latestStopReason,
        lastIssue: task.message
      });
      sendQualityLoopProgress(task, { status: task.status, message: task.message });
      break;
    }

    if (!devAvailable) {
      task.status = "quality_loop_needs_review";
      task.latestStopReason = "DEV unavailable.";
      task.message = "DEV unavailable. QA evidence was collected, but patches cannot be generated.";
      task.lastKnownIssue = trimText(deterministicVerdict.summary || "DEV agent is offline or unavailable.", 400);
      await updateAutonomyRunState(root, {
        status: "quality_loop_needs_review",
        currentStage: "dev_patching_gui_issue",
        nextAction: "manual_review",
        lastError: task.message
      });
      await logQualityLoopEvent(task, "quality-loop-stop-reason", {
        reason: task.latestStopReason,
        lastIssue: task.message
      });
      sendQualityLoopProgress(task, { status: task.status, message: task.message });
      break;
    }

    task.devPatchStatus = "dev_patching_gui_issue";
    task.message = "DEV patching GUI issue.";
    await logQualityLoopEvent(task, "quality-loop-dev-patch-start");
    sendQualityLoopProgress(task, {
      status: task.devPatchStatus,
      message: task.message
    });

    const devPatch = await backend.runGuiQaDevPatch({
      originalRequest,
      qaVerdict: deterministicVerdict,
      guiQaResult,
      consoleErrors: guiQaResult.consoleErrors || [],
      pageErrors: guiQaResult.pageErrors || [],
      screenshotPath: guiQaResult.screenshotPath || "",
      relevantFileExcerpts: await readRelevantQualityFiles(root, await collectQualityChangedFiles(root)),
      currentFileTree: await buildQualityLoopFileSummary(root),
      failedAcceptanceCriteria: deterministicVerdict.requiredFixes || []
    });
    await fs.writeFile(path.join(roundDir, "dev-patch.json"), JSON.stringify(devPatch, null, 2), "utf8");
    await fs.writeFile(path.join(roundDir, "dev-patch.raw.txt"), String(devPatch?.rawOutput || ""), "utf8");
    if (!devPatch?.validFormat || !Array.isArray(devPatch.fileOperations) || devPatch.fileOperations.length === 0) {
      task.status = "quality_loop_needs_review";
      task.devPatchStatus = "failed";
      task.latestStopReason = "DEV returned no valid file operations.";
      task.message = "DEV returned no valid file operations.";
      task.lastKnownIssue = trimText(String(devPatch?.rawOutput || ""), 400) || task.message;
      await logQualityLoopEvent(task, "quality-loop-dev-patch-result", {
        validFormat: false,
        fileOperationCount: Array.isArray(devPatch?.fileOperations) ? devPatch.fileOperations.length : 0
      });
      await updateAutonomyRunState(root, {
        status: "quality_loop_needs_review",
        currentStage: "dev_patching_gui_issue",
        lastError: task.message
      });
      await logQualityLoopEvent(task, "quality-loop-stop-reason", {
        reason: task.latestStopReason,
        lastIssue: task.message
      });
      sendQualityLoopProgress(task, { status: task.status, message: task.message });
      break;
    }

    const devPatchValidation = validateQualityLoopFileOperations(root, devPatch.fileOperations);
    if (!devPatchValidation.validFormat) {
      task.status = "quality_loop_needs_review";
      task.devPatchStatus = "failed";
      task.latestStopReason = "DEV returned no valid file operations.";
      task.message = "DEV returned no valid file operations.";
      task.lastKnownIssue = devPatchValidation.message;
      await logQualityLoopEvent(task, "quality-loop-dev-patch-result", {
        validFormat: false,
        fileOperationCount: Array.isArray(devPatch?.fileOperations) ? devPatch.fileOperations.length : 0,
        invalidOperation: devPatchValidation.message
      });
      await updateAutonomyRunState(root, {
        status: "quality_loop_needs_review",
        currentStage: "dev_patching_gui_issue",
        lastError: task.message
      });
      await logQualityLoopEvent(task, "quality-loop-stop-reason", {
        reason: task.latestStopReason,
        lastIssue: task.message
      });
      sendQualityLoopProgress(task, { status: task.status, message: task.message });
      break;
    }

    if (!devPatchValidation.ok) {
      task.status = "quality_loop_needs_review";
      task.devPatchStatus = "failed";
      task.latestStopReason = "File operation safety violation.";
      task.message = devPatchValidation.message;
      task.lastKnownIssue = devPatchValidation.message;
      await logQualityLoopEvent(task, "quality-loop-dev-patch-result", {
        validFormat: true,
        safetyViolation: devPatchValidation.message
      });
      await updateAutonomyRunState(root, {
        status: "quality_loop_needs_review",
        currentStage: "dev_patching_gui_issue",
        lastError: task.message
      });
      await logQualityLoopEvent(task, "quality-loop-stop-reason", {
        reason: task.latestStopReason,
        lastIssue: task.message
      });
      sendQualityLoopProgress(task, { status: task.status, message: task.message });
      break;
    }

    const patchApply = await applyFileOperationsToExistingProject(root, {
      project: { rootPath: root },
      decision: { affectedFiles: devPatch.affectedFiles || [] }
    }, devPatch.affectedFiles || [], devPatch.fileOperations);
    if (!Array.isArray(patchApply.applied) || patchApply.applied.length === 0) {
      task.status = "quality_loop_needs_review";
      task.devPatchStatus = "failed";
      task.latestStopReason = "DEV produced no changes.";
      task.message = "No patch files were applied. Recommended manual review.";
      task.lastKnownIssue = trimText(devPatch.summary || task.latestStopReason, 400);
      await logQualityLoopEvent(task, "quality-loop-dev-patch-result", {
        validFormat: true,
        fileOperationCount: devPatch.fileOperations.length,
        appliedCount: 0
      });
      await updateAutonomyRunState(root, {
        status: "quality_loop_needs_review",
        currentStage: "dev_patching_gui_issue",
        lastError: task.message
      });
      await logQualityLoopEvent(task, "quality-loop-stop-reason", {
        reason: task.latestStopReason,
        lastIssue: task.message
      });
      sendQualityLoopProgress(task, { status: task.status, message: task.message });
      break;
    }

    task.devPatchStatus = "passed";
    task.message = `DEV patch applied. Continuing to round ${round + 1}.`;
    task.lastKnownIssue = trimText(devPatch.summary || task.message, 400);
    await logQualityLoopEvent(task, "quality-loop-files-applied", {
      appliedFiles: patchApply.applied.map((entry) => entry.path)
    });
    await logQualityLoopEvent(task, "quality-loop-dev-patch-result", {
      validFormat: true,
      fileOperationCount: devPatch.fileOperations.length,
      appliedCount: patchApply.applied.length
    });
    sendQualityLoopProgress(task, { status: task.devPatchStatus, message: task.message });
  }

  if (task.stopRequested) {
    task.status = "stopped";
    task.latestStopReason = task.latestStopReason || "Stop requested.";
    task.message = task.message || "Stop requested.";
    task.lastKnownIssue = task.lastKnownIssue || task.message;
    task.guiQaStatus = "idle";
    task.qaStatus = task.qaStatus === "running" ? "idle" : task.qaStatus;
    task.devPatchStatus = task.devPatchStatus === "dev_patching_gui_issue" ? "idle" : task.devPatchStatus;
    task.finalPmStatus = task.finalPmStatus === "running" ? "idle" : task.finalPmStatus;
    await updateAutonomyRunState(root, {
      status: "stopped",
      currentStage: "stopped",
      nextAction: "manual_review",
      lastError: task.message
    }).catch(() => {});
    await logQualityLoopEvent(task, "quality-loop-stop-reason", {
      reason: task.latestStopReason,
      lastIssue: task.message
    });
    sendQualityLoopProgress(task, { status: task.status, message: task.message });
  } else if (task.status === "running") {
    task.status = "quality_loop_failed";
    task.latestStopReason = "Max rounds reached.";
    task.message = "Quality loop reached max rounds. Recommended manual review.";
    task.lastKnownIssue = task.previousAttempts[task.previousAttempts.length - 1]?.summary || task.message;
    await logQualityLoopEvent(task, "quality-loop-stop-reason", {
      reason: task.latestStopReason,
      lastIssue: task.message
    });
    sendQualityLoopProgress(task, { status: task.status, message: task.message });
  }

  qualityLoops.delete(task.runId);
}

function summarizeQualityLoop(task) {
  if (!task) {
    return null;
  }
  return {
    runId: task.runId,
    projectRoot: task.projectRoot,
    mode: task.mode,
    status: task.status,
    stopRequested: Boolean(task.stopRequested),
    currentRound: task.currentRound,
    maxRounds: task.maxRounds,
    buildStatus: task.buildStatus,
    devServerUrl: task.devServerUrl,
    playwrightStatus: task.playwrightStatus,
    guiQaStatus: task.guiQaStatus,
    qaStatus: task.qaStatus,
    qaVerdict: task.qaVerdict,
    devPatchStatus: task.devPatchStatus,
    finalPmStatus: task.finalPmStatus,
    latestStopReason: task.latestStopReason,
    lastKnownIssue: task.lastKnownIssue,
    artifactDirPath: task.artifactDirPath,
    latestResultPath: task.latestResultPath,
    latestScreenshotPath: task.latestScreenshotPath,
    latestQaVerdictPath: task.latestQaVerdictPath,
    message: task.message,
    previousAttempts: task.previousAttempts
  };
}

function sendQualityLoopProgress(task, patch = {}) {
  Object.assign(task, patch);
  mainWindow?.webContents?.send("qualityLoop:progress", summarizeQualityLoop(task));
}

async function logQualityLoopEvent(task, event, extra = {}) {
  await appendAutonomyLog(task.projectRoot, {
    type: event,
    runId: task.runId,
    round: task.currentRound,
    mode: task.mode,
    status: task.status,
    stopReason: task.latestStopReason || "",
    ...extra
  });
  await syncQualityLoopRunbook(task, event, extra).catch(() => {});
}

async function ensureQualityLoopProcess(root) {
  let processes = await refreshProcessRecords(root);
  let active = processes.find((entry) => ["running", "starting"].includes(entry.status)) || null;
  if (!active) {
    await runProjectCommand({
      projectRoot: root,
      mode: "run"
    });
    processes = await waitForQualityLoopProcess(root);
    active = processes.find((entry) => ["running", "starting"].includes(entry.status)) || null;
  } else if (!active.healthUrl) {
    processes = await waitForQualityLoopProcess(root);
    active = processes.find((entry) => ["running", "starting"].includes(entry.status)) || active;
  }
  return {
    processId: active?.id || "",
    healthUrl: active?.healthUrl || ""
  };
}

async function waitForQualityLoopProcess(root, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const processes = await refreshProcessRecords(root);
    const active = processes.find((entry) => ["running", "starting"].includes(entry.status));
    if (active?.healthUrl) {
      return processes;
    }
    await delay(1000);
  }
  return refreshProcessRecords(root);
}

async function ensureGuiQaRoundDir(root, round) {
  const { dir } = await getGuiQaArtifactPaths(root);
  const roundsDir = path.join(dir, GUI_QA_ROUNDS_DIR_NAME);
  const roundDir = path.join(roundsDir, `round-${String(round).padStart(3, "0")}`);
  await fs.mkdir(roundDir, { recursive: true });
  return roundDir;
}

async function writeGuiQaRoundArtifacts(root, round, guiQaResult) {
  const roundDir = await ensureGuiQaRoundDir(root, round);
  await fs.writeFile(path.join(roundDir, "result.json"), JSON.stringify(guiQaResult || {}, null, 2), "utf8");
  if (guiQaResult?.screenshotPath && await fileExists(guiQaResult.screenshotPath)) {
    await fs.copyFile(guiQaResult.screenshotPath, path.join(roundDir, "screenshot.png"));
  }
}

async function persistLatestGuiQaVerdict(root, verdict) {
  const { dir } = await getGuiQaArtifactPaths(root);
  await fs.writeFile(path.join(dir, GUI_QA_VERDICT_FILE), JSON.stringify(verdict || {}, null, 2), "utf8");
}

function buildQualityFailureSignature(kind, payload = {}) {
  return [
    kind,
    String(payload?.status || ""),
    String(payload?.httpStatus || ""),
    String(payload?.message || payload?.error || ""),
    String(payload?.bodyTextLength || ""),
    String((payload?.pageErrors || []).join("|")).slice(0, 400),
    String((payload?.consoleErrors || []).join("|")).slice(0, 400),
    String(payload?.validation?.output || "").slice(0, 400)
  ].join("|");
}

function buildQaIssueSignature(verdict = {}) {
  return [
    String(verdict?.verdict || ""),
    String(verdict?.summary || "").slice(0, 300),
    ...((verdict?.issues || []).map((issue) => `${issue.source}:${issue.description}`).slice(0, 6))
  ].join("|");
}

function validateQualityLoopFileOperations(root, operations = []) {
  for (const operation of operations || []) {
    if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
      return {
        ok: false,
        validFormat: false,
        message: "DEV returned a malformed file operation."
      };
    }

    const action = String(operation?.action || "write").trim().toLowerCase();
    if (action !== "write") {
      return {
        ok: false,
        validFormat: false,
        message: `DEV returned unsupported file operation action: ${action || "unknown"}`
      };
    }

    const relativePath = String(operation?.path || "").trim();
    if (!relativePath) {
      return {
        ok: false,
        validFormat: false,
        message: "DEV returned a file operation with no path."
      };
    }
    if (typeof operation?.content !== "string") {
      return {
        ok: false,
        validFormat: false,
        message: `DEV returned a file operation with invalid content for ${relativePath}`
      };
    }

    try {
      const normalized = relativePath.replaceAll("\\", "/");
      if (path.isAbsolute(normalized) || normalized.split("/").includes("..")) {
        throw new Error(`Path escapes the project folder: ${relativePath}`);
      }
      const target = path.resolve(root, normalized);
      const relative = path.relative(root, target);
      if (relative.startsWith("..") || path.isAbsolute(relative) || !relative) {
        throw new Error(`Path escapes the project folder: ${relativePath}`);
      }
    } catch (error) {
      return {
        ok: false,
        validFormat: true,
        message: `Blocked file operation outside project root: ${relativePath}`
      };
    }
  }

  return { ok: true, validFormat: true };
}

function applyGuiQaDeterministicVerdict(qaVerdict, validation, guiQaResult, repeatedFailures = []) {
  const next = {
    ...(qaVerdict || {}),
    issues: Array.isArray(qaVerdict?.issues) ? qaVerdict.issues : [],
    requiredFixes: Array.isArray(qaVerdict?.requiredFixes) ? qaVerdict.requiredFixes : []
  };
  const httpOk = Number.isInteger(guiQaResult?.httpStatus) ? guiQaResult.httpStatus >= 200 && guiQaResult.httpStatus < 300 : true;
  const pageCrash = Array.isArray(guiQaResult?.pageErrors) && guiQaResult.pageErrors.length > 0;
  const bodyEmpty = Number(guiQaResult?.bodyTextLength || 0) <= 0;
  const guiStatus = String(guiQaResult?.status || "").trim().toLowerCase();

  if (validation?.status !== "passed") {
    next.verdict = "manual_review";
    next.summary = "Build verification did not pass. Manual review required.";
  } else if (["failed", "error"].includes(guiStatus) || pageCrash || !httpOk || bodyEmpty) {
    next.verdict = repeatedFailures.length > 0 ? "manual_review" : "needs_patch";
    next.summary = pageCrash || !httpOk
      ? "Playwright found a deterministic blocker."
      : "GUI smoke test did not pass cleanly.";
  }

  return next;
}

async function buildQualityLoopFileSummary(root) {
  const project = await backend.buildProjectTree(root, { ensureSandboxFolder: false });
  const files = Array.isArray(project?.files) ? project.files.slice(0, 120).map((file) => file.path) : [];
  return trimText(files.join("\n"), 2400);
}

async function collectQualityChangedFiles(root) {
  const runState = await backend.runState.loadRunState(root).catch(() => null);
  const ledger = await backend.artifactLedger.loadArtifactLedger(root).catch(() => null);
  return uniqueStrings([
    ...(runState?.changedFiles || []),
    ...((ledger?.filesWritten || []).map((entry) => entry.path).filter(Boolean))
  ]).slice(0, 30);
}

async function readRelevantQualityFiles(root, paths = []) {
  const excerpts = [];
  for (const relPath of (paths || []).slice(0, 8)) {
    try {
      const absPath = resolveProjectRelativePath(root, relPath);
      const raw = await fs.readFile(absPath, "utf8");
      excerpts.push(`FILE: ${relPath}\n${trimText(raw, 1200)}`);
    } catch {}
  }
  return excerpts.join("\n\n");
}

function extractAcceptanceCriteria(reportText = "") {
  const text = String(reportText || "");
  const matches = text.match(/^- .+/gm) || [];
  return matches.slice(0, 12).map((line) => line.replace(/^- /, "").trim()).filter(Boolean);
}

async function runTerminalCommand(payload = {}) {
  const root = await normalizeCommandRoot(payload.projectRoot);
  const command = normalizeSuggestedCommand(payload.command);
  if (!command) {
    throw new Error("Command is empty.");
  }

  const terminalDir = await ensureTerminalDir(root);
  const validation = validateTerminalCommand(command, root);
  if (!validation.allowed) {
    const blockedSession = await createTerminalSessionRecord({
      root,
      terminalDir,
      command,
      status: "blocked",
      exitCode: null,
      outputPreview: "Command blocked by safety policy.",
      warning: validation.warning || "",
      note: validation.note || "",
      blockedReason: validation.reason || "Command blocked by safety policy."
    });
    return {
      session: blockedSession,
      message: "Command blocked by safety policy."
    };
  }

  const session = await createTerminalSessionRecord({
    root,
    terminalDir,
    command,
    status: "running",
    exitCode: null,
    outputPreview: "",
    warning: validation.warning || "",
    note: validation.note || ""
  });
  const stdoutPath = path.join(root, session.stdoutLog);
  const stderrPath = path.join(root, session.stderrLog);
  const spawnSpec = buildTerminalSpawnSpec(command);

  let child;
  try {
    child = spawn(spawnSpec.executable, spawnSpec.args, {
      cwd: root,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    session.status = "failed";
    session.finishedAt = new Date().toISOString();
    session.outputPreview = trimText(error?.message || "Could not start command.", 8000);
    session.exitCode = 1;
    await persistTerminalSession(root, session);
    return {
      session,
      message: session.outputPreview
    };
  }

  session.pid = child.pid || 0;
  await persistTerminalSession(root, session);
  terminalSessions.set(session.sessionId, {
    root,
    child,
    session,
    outputPreview: ""
  });

  const appendChunk = async (targetPath, chunk, streamKey) => {
    const text = chunk.toString();
    await fs.appendFile(targetPath, text, "utf8");
    const active = terminalSessions.get(session.sessionId);
    if (!active) {
      return;
    }
    active.outputPreview = trimText(`${active.outputPreview || ""}${text}`, 8000);
    active.session.outputPreview = active.outputPreview;
    active.session[streamKey] = session[streamKey];
    await persistTerminalSession(root, active.session);
  };

  child.stdout?.on("data", (chunk) => {
    void appendChunk(stdoutPath, chunk, "stdoutLog");
  });
  child.stderr?.on("data", (chunk) => {
    void appendChunk(stderrPath, chunk, "stderrLog");
  });
  child.on("error", (error) => {
    void finalizeTerminalSession(session.sessionId, {
      status: "failed",
      exitCode: 1,
      appendedText: error?.message || "Terminal command failed to start."
    });
  });
  child.on("close", (exitCode) => {
    void finalizeTerminalSession(session.sessionId, {
      status: exitCode === 0 ? "passed" : "failed",
      exitCode: Number.isInteger(exitCode) ? exitCode : 0
    });
  });

  return {
    session,
    message: validation.warning || validation.note || ""
  };
}

async function stopTerminalCommand(payload = {}) {
  const root = await normalizeCommandRoot(payload.projectRoot);
  const sessionId = String(payload.sessionId || "").trim();
  if (!sessionId) {
    throw new Error("Terminal session id is missing.");
  }

  const active = terminalSessions.get(sessionId);
  if (!active || active.root !== root) {
    const existing = await readTerminalSession(root, sessionId);
    if (!existing) {
      throw new Error("Terminal session was not found.");
    }
    return existing;
  }

  active.session.status = "stopped";
  active.session.finishedAt = new Date().toISOString();
  await persistTerminalSession(root, active.session);
  await terminateProcessTree(active.child?.pid || active.session.pid || 0);
  return finalizeTerminalSession(sessionId, {
    status: "stopped",
    exitCode: active.session.exitCode
  });
}

async function getTerminalHistory(payload = {}) {
  const root = await normalizeCommandRoot(payload.projectRoot);
  const terminalDir = await ensureTerminalDir(root);
  const entries = await fs.readdir(terminalDir, { withFileTypes: true }).catch(() => []);
  const sessionFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(terminalDir, entry.name));

  const sessions = (await Promise.all(sessionFiles.map((filePath) => readJsonFile(filePath, null))))
    .filter(Boolean)
    .sort((left, right) => String(right.startedAt || "").localeCompare(String(left.startedAt || "")));

  const history = await Promise.all(sessions.map(async (session) => {
    const stdoutPath = path.join(root, session.stdoutLog || "");
    const stderrPath = path.join(root, session.stderrLog || "");
    const [stdout, stderr] = await Promise.all([
      readTextIfExists(stdoutPath),
      readTextIfExists(stderrPath)
    ]);
    return {
      ...session,
      output: trimText([stdout, stderr].filter(Boolean).join("\n"), 16000)
    };
  }));

  return {
    projectRoot: root,
    sessions: history
  };
}

function validateTerminalCommand(command, root) {
  const normalized = normalizeSuggestedCommand(command);
  if (!normalized) {
    return {
      allowed: false,
      reason: "Command blocked by safety policy."
    };
  }

  const lower = normalized.toLowerCase();
  if (/[|;&<>`$]/.test(normalized)) {
    return {
      allowed: false,
      reason: "Command blocked by safety policy."
    };
  }
  const blockedPatterns = [
    /\brm\s+-rf\b/i,
    /\bdel\s+\/s\b/i,
    /\bformat\b/i,
    /\bshutdown\b/i,
    /\breg\s+delete\b/i,
    /\btaskkill\s+\/f\s+\/im\s+\*/i,
    /\brd\s+\/s\b/i,
    /\brmdir\s+\/s\b/i
  ];
  if (blockedPatterns.some((pattern) => pattern.test(lower))) {
    return {
      allowed: false,
      reason: "Command blocked by safety policy."
    };
  }

  const parts = splitCommand(normalized);
  const [bin, first, second, third] = parts;
  const allowed =
    (bin === "npm" && (
      first === "install"
      || first === "--version"
      || first === "-v"
      || (first === "run" && ["build", "dev", "preview", "test"].includes(second))
      || (first === "exec" && Boolean(second))
    )) ||
    (bin === "npx" && first === "playwright" && (
      (second === "install" && third === "chromium")
      || second === "test"
    ));

  if (!allowed) {
    return {
      allowed: false,
      reason: "Command blocked by safety policy."
    };
  }

  for (const arg of parts.slice(1)) {
    if (arg.includes("..") || path.isAbsolute(arg)) {
      return {
        allowed: false,
        reason: "Command blocked by safety policy."
      };
    }
  }

  const response = {
    allowed: true,
    reason: "",
    warning: "",
    note: ""
  };
  if (bin === "npm" && first === "run" && second === "dev") {
    response.note = "For dev servers, Run Project is recommended because it detects healthUrl for Open App and GUI QA.";
  }
  if ((bin === "npm" && first === "install" && parts.includes("@playwright/test"))
    || (bin === "npx" && first === "playwright" && second === "install" && third === "chromium")) {
    response.warning = "After installation, run GUI QA capability check again.";
  }

  return response;
}

function buildTerminalSpawnSpec(commandText) {
  if (process.platform === "win32") {
    return {
      executable: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", commandText]
    };
  }

  return {
    executable: "sh",
    args: ["-lc", commandText]
  };
}

async function createTerminalSessionRecord({
  root,
  terminalDir,
  command,
  status,
  exitCode,
  outputPreview,
  warning = "",
  note = "",
  blockedReason = ""
}) {
  const sessionId = `term-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const stdoutPath = path.join(terminalDir, `${sessionId}.stdout.log`);
  const stderrPath = path.join(terminalDir, `${sessionId}.stderr.log`);
  await fs.writeFile(stdoutPath, "", "utf8");
  await fs.writeFile(stderrPath, "", "utf8");
  const session = {
    sessionId,
    pid: 0,
    command,
    cwd: root,
    status,
    exitCode,
    startedAt,
    finishedAt: status === "running" ? "" : startedAt,
    stdoutLog: toProjectRelativePath(root, stdoutPath),
    stderrLog: toProjectRelativePath(root, stderrPath),
    outputPreview: trimText(outputPreview || "", 8000),
    warning,
    note,
    blockedReason
  };
  await persistTerminalSession(root, session);
  return session;
}

async function finalizeTerminalSession(sessionId, patch = {}) {
  const active = terminalSessions.get(sessionId);
  if (!active) {
    return null;
  }

  const session = active.session;
  session.status = patch.status || session.status || "failed";
  session.exitCode = patch.exitCode ?? session.exitCode ?? null;
  session.finishedAt = new Date().toISOString();
  if (patch.appendedText) {
    active.outputPreview = trimText(`${active.outputPreview || ""}${patch.appendedText}`, 8000);
  }
  session.outputPreview = trimText(active.outputPreview || session.outputPreview || "", 8000);
  await persistTerminalSession(active.root, session);
  terminalSessions.delete(sessionId);
  return session;
}

async function ensureTerminalDir(root) {
  const ledgerDir = await initializeAutonomyLedger(root);
  const dir = path.join(ledgerDir, TERMINAL_DIR_NAME);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function persistTerminalSession(root, session) {
  const terminalDir = await ensureTerminalDir(root);
  const filePath = path.join(terminalDir, `${session.sessionId}.json`);
  await writeJsonFile(filePath, session);
}

async function readTerminalSession(root, sessionId) {
  const terminalDir = await ensureTerminalDir(root);
  return readJsonFile(path.join(terminalDir, `${sessionId}.json`), null);
}

async function readTextIfExists(filePath) {
  if (!filePath) {
    return "";
  }

  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function collectReviewLogEntries(raw, runId = "") {
  const entries = String(raw || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (!runId) {
    return entries.slice(-50);
  }

  return entries.filter((entry) => String(entry.runId || "").startsWith(runId)).slice(-80);
}

function sanitizeReviewExport(value, key = "") {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeReviewExport(item, key));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeReviewExport(entryValue, entryKey)
      ])
    );
  }

  if (typeof value === "string") {
    if (/(token|secret|password|authorization|api[_-]?key)/i.test(key)) {
      return "[redacted]";
    }
    return value.replace(/(sk-[A-Za-z0-9_-]{10,})/g, "[redacted]");
  }

  return value ?? null;
}

async function normalizeCommandRoot(rootPath) {
  if (!rootPath || typeof rootPath !== "string") {
    throw new Error("Project folder is missing.");
  }

  const root = await fs.realpath(rootPath);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) {
    throw new Error("Command cwd must be a project folder.");
  }

  return root;
}

async function resolveProjectCommand(root, payload) {
  const explicit = normalizeSuggestedCommand(payload.command);
  if (explicit) {
    validateSafeCommand(explicit, root);
    return explicit;
  }

  const scripts = await readPackageScripts(root);
  if (payload.mode === "debug") {
    if (scripts.build) return "npm run build";
    if (scripts.test) return "npm test";
    if (await findLaunchableHtml(root)) {
      throw new Error("HTML-only projects do not have a debug command. Type /debug-project only for script-based projects.");
    }
    return "npm test";
  }

  if (payload.mode === "validate") {
    if (scripts.build) return "npm run build";
    if (scripts.test) return "npm test";
    throw new Error("No validation command is available for this project.");
  }

  if (payload.mode === "install") {
    return "npm install";
  }

  if (scripts.dev) return "npm run dev";
  if (scripts.start) return "npm run start";
  if (scripts.build) return "npm run build";
  return "npm test";
}

async function findLaunchableHtml(root) {
  const packageScripts = await readPackageScripts(root);
  if (packageScripts.dev || packageScripts.start || packageScripts.build) {
    return null;
  }

  const preferred = path.join(root, "index.html");
  if (await fileExists(preferred)) {
    return {
      absolutePath: preferred,
      relativePath: "index.html"
    };
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  const htmlFile = entries.find((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".html");
  if (!htmlFile) {
    return null;
  }

  return {
    absolutePath: path.join(root, htmlFile.name),
    relativePath: htmlFile.name
  };
}

async function readPackageScripts(root) {
  try {
    const raw = await fs.readFile(path.join(root, "package.json"), "utf8");
    const parsed = JSON.parse(raw);
    return parsed.scripts || {};
  } catch {
    return {};
  }
}

async function fileExists(targetPath) {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function validateSafeCommand(command, root) {
  const normalized = normalizeSuggestedCommand(command);
  if (!normalized) {
    throw new Error("Command is empty.");
  }

  if (/[|;&<>`$]/.test(normalized) || /\b(rm\s+-rf|del\s+\/s|format|shutdown|curl\s+.*\||powershell\s+.*https?:)/i.test(normalized)) {
    throw new Error("Blocked unsafe command syntax.");
  }

  const parts = splitCommand(normalized);
  const [bin, first, second] = parts;
  const allowed =
    (bin === "npm" && (first === "install" || first === "test" || (first === "run" && ["build", "dev", "start", "test"].includes(second)))) ||
    ((bin === "node" || bin === "python") && Boolean(first)) ||
    (bin === "mkdir" && Boolean(first));

  if (!allowed) {
    throw new Error(`Unsupported command: ${command}`);
  }

  for (const arg of parts.slice(1)) {
    if (arg.includes("..") || path.isAbsolute(arg)) {
      throw new Error("Command arguments cannot access paths outside the project.");
    }
  }

  return root;
}

async function executeSafeCommand(command, root, mode) {
  const normalized = normalizeSuggestedCommand(command);
  validateSafeCommand(normalized, root);
  const parts = splitCommand(normalized);
  const isLongRunningRun =
    mode === "run" &&
    parts[0] === "npm" &&
    parts[1] === "run" &&
    ["dev", "start"].includes(parts[2]);

  if (parts[0] === "mkdir") {
    const target = path.resolve(root, parts.slice(1).join(" "));
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("mkdir target escapes the project folder.");
    }
    await fs.mkdir(target, { recursive: true });
    return { exitCode: 0, timedOut: false, output: `Created ${relative}` };
  }

  const executable = process.platform === "win32" && parts[0] === "npm"
    ? (process.env.ComSpec || "cmd.exe")
    : (process.platform === "win32" && parts[0] === "python" ? "python.exe" : parts[0]);
  const args = process.platform === "win32" && parts[0] === "npm"
    ? ["/d", "/s", "/c", normalized]
    : parts.slice(1);
  const timeoutMs = isLongRunningRun ? 10000 : (mode === "run" ? 20000 : 120000);

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(executable, args, {
        cwd: root,
        shell: false,
        windowsHide: true,
        detached: isLongRunningRun,
        stdio: isLongRunningRun ? "ignore" : ["ignore", "pipe", "pipe"]
      });
      if (isLongRunningRun) {
        child.unref();
      }
    } catch (error) {
      resolve({
        exitCode: 1,
        timedOut: false,
        output: `Could not start command "${normalized}": ${error?.message || error}`
      });
      return;
    }
    let output = "";
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      if (isLongRunningRun) {
        resolve({
          exitCode: 0,
          timedOut: false,
          output: `${output}\n[TriFix started "${normalized}" as a long-running project process.]`
        });
        return;
      }

      child.kill();
      resolve({ exitCode: 124, timedOut: true, output: `${output}\n[TriFix stopped the command after ${timeoutMs / 1000}s.]` });
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: 1, timedOut: false, output: error.message });
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: exitCode ?? 0, timedOut: false, output });
    });
  });
}

function splitCommand(command) {
  return String(command || "").match(/"[^"]+"|'[^']+'|\S+/g)?.map((part) => part.replace(/^["']|["']$/g, "")) || [];
}

function normalizeSuggestedCommand(command) {
  let value = command;
  if (value && typeof value === "object") {
    value = value.command || value.value || value.text || value.label || "";
  }

  const normalized = String(value || "")
    .replace(/^[\s`*-]+/, "")
    .replace(/[`]+/g, "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/^(none|n\/a|na|no command|no commands|nothing)$/i.test(normalized)) {
    return "";
  }

  return normalized;
}

function summarizeContextDocuments(documents) {
  return trimText(
    (documents || [])
      .map((doc) => `${doc.name} (${doc.type}): ${doc.summary}`)
      .join("\n"),
    4000
  );
}

function summarizeContextText(text, type) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) {
    return type === "image" ? "Image context attached." : "No readable text extracted.";
  }

  return trimText(clean, type === "pdf" ? 1800 : 1400);
}

function appendProjectLog(logs, entry) {
  return [
    ...(Array.isArray(logs) ? logs : []),
    {
      id: `log-${Date.now()}`,
      at: new Date().toISOString(),
      ...entry
    }
  ].slice(-80);
}

async function ensureAutonomyRunbookRoot(rootPath) {
  const root = await normalizeExistingProjectRoot(rootPath);
  const baseDir = path.join(root, AUTONOMY_DIR_NAME, AUTONOMY_RUNBOOK_DIR_NAME);
  const runsDir = path.join(baseDir, AUTONOMY_RUNS_DIR_NAME);
  await fs.mkdir(runsDir, { recursive: true });
  return { root, baseDir, runsDir };
}

function buildDefaultRunbook(root, payload = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    runId: String(payload.runId || ""),
    projectRoot: root,
    projectName: String(payload.projectName || path.basename(root)),
    mode: String(payload.mode || "normal_autonomy"),
    status: String(payload.status || "idle"),
    createdAt: payload.createdAt || now,
    updatedAt: now,
    userGoal: String(payload.userGoal || ""),
    currentStage: String(payload.currentStage || "idle"),
    currentRound: Number(payload.currentRound || 0),
    maxRounds: Number(payload.maxRounds || 3),
    models: {
      pm: {
        available: Boolean(payload.models?.pm?.available),
        model: String(payload.models?.pm?.model || ""),
        endpoint: String(payload.models?.pm?.endpoint || "")
      },
      dev: {
        available: Boolean(payload.models?.dev?.available),
        model: String(payload.models?.dev?.model || ""),
        endpoint: String(payload.models?.dev?.endpoint || "")
      },
      qa: {
        available: Boolean(payload.models?.qa?.available),
        model: String(payload.models?.qa?.model || ""),
        endpoint: String(payload.models?.qa?.endpoint || "")
      }
    },
    stages: Array.isArray(payload.stages) ? payload.stages : [],
    latestEvidence: payload.latestEvidence && typeof payload.latestEvidence === "object" ? payload.latestEvidence : {},
    latestQaVerdict: payload.latestQaVerdict ?? null,
    latestDevPatch: payload.latestDevPatch ?? null,
    latestPmFinal: payload.latestPmFinal ?? null,
    stopReason: String(payload.stopReason || ""),
    nextAction: normalizeRunbookNextAction(payload.nextAction)
  };
}

function normalizeRunbookNextAction(value = {}) {
  const action = value && typeof value === "object" ? value : {};
  return {
    type: String(action.type || "none"),
    label: String(action.label || ""),
    safeToResume: Boolean(action.safeToResume),
    requiresUser: Boolean(action.requiresUser),
    requiresModels: Array.isArray(action.requiresModels) ? action.requiresModels.map((item) => String(item || "").trim()).filter(Boolean) : [],
    suggestedCommands: Array.isArray(action.suggestedCommands) ? action.suggestedCommands.map((item) => String(item || "").trim()).filter(Boolean) : []
  };
}

function normalizeRunbookStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (["queued", "running", "stopping"].includes(normalized)) return "running";
  if (["stopped"].includes(normalized)) return "stopped";
  if (["completed", "quality_loop_passed", "qa_evidence_ready"].includes(normalized)) return "completed";
  if (["needs_review", "quality_loop_needs_review", "blocked_missing_health_url", "gui_qa_skipped_missing_playwright", "gui_qa_failed"].includes(normalized)) return "needs_review";
  if (["failed", "quality_loop_failed", "timed_out"].includes(normalized)) return "failed";
  return normalized || "idle";
}

async function getRunbookPaths(rootPath, runId) {
  const { root, baseDir, runsDir } = await ensureAutonomyRunbookRoot(rootPath);
  const safeRunId = String(runId || "").trim();
  if (!safeRunId) {
    throw new Error("Runbook runId is missing.");
  }
  const runDir = path.join(runsDir, safeRunId);
  return {
    root,
    baseDir,
    runsDir,
    runDir,
    latestRunPath: path.join(baseDir, AUTONOMY_LATEST_RUN_FILE),
    runbookPath: path.join(runDir, RUNBOOK_FILE),
    timelinePath: path.join(runDir, RUNBOOK_TIMELINE_FILE),
    latestStatePath: path.join(runDir, RUNBOOK_LATEST_STATE_FILE),
    nextActionPath: path.join(runDir, RUNBOOK_NEXT_ACTION_FILE),
    artifactsIndexPath: path.join(runDir, RUNBOOK_ARTIFACTS_INDEX_FILE)
  };
}

async function loadRunbook(rootPath, runId) {
  const paths = await getRunbookPaths(rootPath, runId);
  const runbook = await readJsonFile(paths.runbookPath, null);
  return runbook && typeof runbook === "object" ? runbook : null;
}

function deriveRunbookNextAction(runbook = {}) {
  const mode = String(runbook.mode || "");
  const status = String(runbook.status || "").toLowerCase();
  const stopReason = String(runbook.stopReason || "").toLowerCase();
  const evidence = runbook.latestEvidence || {};
  const models = runbook.models || {};
  const qaVerdict = String(runbook.latestQaVerdict?.verdict || "").toLowerCase();

  if (String(evidence.playwrightStatus || "").toLowerCase() === "package_missing" || String(evidence.playwrightStatus || "").toLowerCase() === "browsers_missing") {
    return normalizeRunbookNextAction({
      type: "install_playwright",
      label: "Install Playwright and Chromium",
      safeToResume: false,
      requiresUser: true,
      suggestedCommands: [
        "npm install -D @playwright/test",
        "npx playwright install chromium"
      ]
    });
  }

  if (stopReason.includes("healthurl") || !String(evidence.healthUrl || "").trim()) {
    return normalizeRunbookNextAction({
      type: "start_project",
      label: "Start the project dev server",
      safeToResume: true,
      requiresUser: false
    });
  }

  if (status === "stopped" || stopReason.includes("stop requested")) {
    return normalizeRunbookNextAction({
      type: mode === "evidence_only" ? "resume_gui_qa_only" : "resume_quality_loop",
      label: mode === "evidence_only" ? "Resume GUI QA Only" : "Resume Quality Loop",
      safeToResume: true,
      requiresUser: true
    });
  }

  if (status === "quality_loop_needs_review" && !models.qa?.available && mode === "full_quality_loop") {
    return normalizeRunbookNextAction({
      type: "manual_review",
      label: "QA unavailable. Review GUI QA evidence manually.",
      safeToResume: false,
      requiresUser: true,
      requiresModels: ["qa"]
    });
  }

  if (qaVerdict === "needs_patch" && !models.dev?.available) {
    return normalizeRunbookNextAction({
      type: "resume_dev_patch",
      label: "Resume DEV patch from latest QA verdict.",
      safeToResume: true,
      requiresUser: false,
      requiresModels: ["dev"]
    });
  }

  if (qaVerdict === "pass" && !models.pm?.available) {
    return normalizeRunbookNextAction({
      type: "resume_pm_finalize",
      label: "Resume PM finalization when PM is available.",
      safeToResume: true,
      requiresUser: false,
      requiresModels: ["pm"]
    });
  }

  if (status === "qa_evidence_ready") {
    return normalizeRunbookNextAction({
      type: "manual_review",
      label: "GUI QA evidence is ready for manual review.",
      safeToResume: false,
      requiresUser: true
    });
  }

  if (status === "completed" || status === "quality_loop_passed") {
    return normalizeRunbookNextAction({
      type: "none",
      label: "No further action required.",
      safeToResume: false,
      requiresUser: false
    });
  }

  if (status === "running") {
    return normalizeRunbookNextAction({
      type: "none",
      label: "Run in progress.",
      safeToResume: false,
      requiresUser: false
    });
  }

  return normalizeRunbookNextAction({
    type: mode === "evidence_only" ? "resume_gui_qa_only" : "resume_quality_loop",
    label: mode === "evidence_only" ? "Resume GUI QA Only" : "Resume Quality Loop",
    safeToResume: true,
    requiresUser: false
  });
}

function toRunbookEventType(event) {
  const map = {
    "quality-loop-start": "run-started",
    "quality-loop-round-start": "preflight-started",
    "quality-loop-build-start": "build-started",
    "quality-loop-build-result": "build-passed",
    "quality-loop-run-project-start": "dev-server-started",
    "quality-loop-run-project-result": "dev-server-started",
    "quality-loop-health-url-detected": "health-url-detected",
    "quality-loop-gui-qa-start": "gui-qa-started",
    "quality-loop-gui-qa-result": "gui-qa-passed",
    "quality-loop-qa-start": "qa-review-started",
    "quality-loop-qa-result": "qa-review-passed",
    "quality-loop-dev-patch-start": "dev-patch-started",
    "quality-loop-dev-patch-result": "dev-patch-applied",
    "quality-loop-finalize-start": "pm-finalize-started",
    "quality-loop-finalize-result": "pm-finalize-completed",
    "quality-loop-stop-reason": "manual-review-required"
  };
  return map[event] || event;
}

function createRunbookStageSnapshot(runbook, eventType, message = "") {
  const stages = Array.isArray(runbook.stages) ? runbook.stages : [];
  const nextStage = {
    at: new Date().toISOString(),
    name: String(runbook.currentStage || eventType || "idle"),
    status: String(runbook.status || "idle"),
    message: String(message || "")
  };
  return [...stages, nextStage].slice(-60);
}

async function writeRunbookFiles(paths, runbook, timelineEntry = null, latestState = null, nextAction = null, artifactsIndex = null) {
  await fs.mkdir(paths.runDir, { recursive: true });
  await writeJsonFile(paths.runbookPath, runbook);
  await writeJsonFile(paths.latestStatePath, latestState || {
    runId: runbook.runId,
    status: runbook.status,
    currentStage: runbook.currentStage,
    currentRound: runbook.currentRound,
    stopReason: runbook.stopReason,
    nextAction: runbook.nextAction,
    updatedAt: runbook.updatedAt
  });
  await writeJsonFile(paths.nextActionPath, nextAction || runbook.nextAction);
  await writeJsonFile(paths.artifactsIndexPath, artifactsIndex || {});
  if (timelineEntry) {
    await fs.appendFile(paths.timelinePath, `${JSON.stringify(timelineEntry)}\n`, "utf8");
  } else {
    await ensureFile(paths.timelinePath, "");
  }
  await writeJsonFile(paths.latestRunPath, {
    runId: runbook.runId,
    projectRoot: runbook.projectRoot,
    projectName: runbook.projectName,
    status: runbook.status,
    mode: runbook.mode,
    updatedAt: runbook.updatedAt,
    runDir: paths.runDir
  });
}

async function buildRunbookArtifactsIndex(rootPath, runbook = {}) {
  const root = await normalizeExistingProjectRoot(rootPath);
  const { dir: guiQaDir } = await getGuiQaArtifactPaths(root);
  const reviewData = await readProjectReviewData(root).catch(() => null);
  const latestResultPath = String(runbook.latestEvidence?.guiQaResultPath || "");
  const latestScreenshotPath = String(runbook.latestEvidence?.guiQaScreenshotPath || "");
  const latestQaVerdictPath = String(runbook.latestEvidence?.qaVerdictPath || "");
  const roundResults = await collectRunbookRoundArtifacts(guiQaDir);
  const candidatePaths = [
    path.join(root, AUTONOMY_DIR_NAME, "final-report.md"),
    latestResultPath,
    latestScreenshotPath,
    latestQaVerdictPath,
    String(runbook.latestEvidence?.buildLogPath || "")
  ].filter(Boolean);
  const existingArtifacts = [];
  for (const candidate of candidatePaths) {
    const exists = await pathExists(candidate);
    if (exists) {
      existingArtifacts.push(candidate);
    }
  }
  return {
    runId: runbook.runId,
    projectRoot: root,
    finalReport: await pathExists(path.join(root, AUTONOMY_DIR_NAME, "final-report.md")) ? path.join(root, AUTONOMY_DIR_NAME, "final-report.md") : "",
    guiQaLatestResult: latestResultPath,
    guiQaScreenshot: latestScreenshotPath,
    roundResultFiles: roundResults,
    qaVerdicts: uniqueStrings([latestQaVerdictPath, ...(roundResults.filter((item) => item.endsWith("qa-verdict.json")))]),
    devPatches: roundResults.filter((item) => item.endsWith("dev-patch.json")),
    buildLogs: roundResults.filter((item) => item.endsWith("build-log.txt")),
    processLogs: (reviewData?.runLogExcerpts || []).length > 0 ? [path.join(root, AUTONOMY_DIR_NAME, RUN_LOG_FILE)] : [],
    exportedReviewData: [],
    allExistingArtifacts: uniqueStrings(existingArtifacts.concat(roundResults))
  };
}

async function collectRunbookRoundArtifacts(guiQaDir) {
  const roundsDir = path.join(guiQaDir, GUI_QA_ROUNDS_DIR_NAME);
  try {
    const roundEntries = await fs.readdir(roundsDir, { withFileTypes: true });
    const artifacts = [];
    for (const roundEntry of roundEntries) {
      if (!roundEntry.isDirectory()) {
        continue;
      }
      const roundDir = path.join(roundsDir, roundEntry.name);
      const files = await fs.readdir(roundDir, { withFileTypes: true });
      for (const file of files) {
        if (file.isFile()) {
          artifacts.push(path.join(roundDir, file.name));
        }
      }
    }
    return artifacts;
  } catch {
    return [];
  }
}

async function upsertPersistentRunbook(rootPath, runbookPatch = {}, event = null) {
  const root = await normalizeExistingProjectRoot(rootPath);
  const runId = String(runbookPatch.runId || "").trim();
  if (!runId) {
    throw new Error("Runbook runId is missing.");
  }
  const paths = await getRunbookPaths(root, runId);
  const existing = await readJsonFile(paths.runbookPath, null);
  const next = {
    ...(existing || buildDefaultRunbook(root, runbookPatch)),
    ...stripUndefined(runbookPatch),
    projectRoot: root,
    projectName: runbookPatch.projectName || existing?.projectName || path.basename(root),
    status: normalizeRunbookStatus(runbookPatch.status ?? existing?.status ?? "idle"),
    models: {
      pm: {
        ...(existing?.models?.pm || {}),
        ...(runbookPatch.models?.pm || {})
      },
      dev: {
        ...(existing?.models?.dev || {}),
        ...(runbookPatch.models?.dev || {})
      },
      qa: {
        ...(existing?.models?.qa || {}),
        ...(runbookPatch.models?.qa || {})
      }
    },
    latestEvidence: {
      ...(existing?.latestEvidence || {}),
      ...(runbookPatch.latestEvidence || {})
    },
    updatedAt: new Date().toISOString()
  };
  next.stages = event ? createRunbookStageSnapshot(next, event.type, event.message || "") : (Array.isArray(next.stages) ? next.stages : []);
  next.nextAction = deriveRunbookNextAction(next);
  const artifactsIndex = await buildRunbookArtifactsIndex(root, next);
  const timelineEntry = event ? {
    at: new Date().toISOString(),
    runId: next.runId,
    round: Number(next.currentRound || 0),
    type: String(event.type || "error"),
    status: String(event.status || next.status || "idle"),
    message: String(event.message || ""),
    data: event.data && typeof event.data === "object" ? event.data : {}
  } : null;
  await writeRunbookFiles(paths, next, timelineEntry, null, next.nextAction, artifactsIndex);
  return {
    ...next,
    artifactIndexPath: paths.artifactsIndexPath,
    nextActionPath: paths.nextActionPath,
    latestStatePath: paths.latestStatePath,
    timelinePath: paths.timelinePath,
    runDir: paths.runDir
  };
}

async function getLatestRunbook(payload = {}) {
  const root = await normalizeExistingProjectRoot(payload.projectRoot);
  const { baseDir } = await ensureAutonomyRunbookRoot(root);
  const latest = await readJsonFile(path.join(baseDir, AUTONOMY_LATEST_RUN_FILE), null);
  if (!latest?.runId) {
    return null;
  }
  const runbook = await loadRunbook(root, latest.runId);
  if (!runbook) {
    return null;
  }
  const paths = await getRunbookPaths(root, latest.runId);
  const nextAction = await readJsonFile(paths.nextActionPath, runbook.nextAction || normalizeRunbookNextAction());
  const artifactsIndex = await readJsonFile(paths.artifactsIndexPath, {});
  return {
    ...runbook,
    nextAction: normalizeRunbookNextAction(nextAction),
    artifactsIndex,
    runDir: paths.runDir
  };
}

async function listRunbooks(payload = {}) {
  const root = await normalizeExistingProjectRoot(payload.projectRoot);
  const { runsDir } = await ensureAutonomyRunbookRoot(root);
  const entries = await fs.readdir(runsDir, { withFileTypes: true }).catch(() => []);
  const runbooks = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const runbook = await readJsonFile(path.join(runsDir, entry.name, RUNBOOK_FILE), null);
    if (runbook?.runId) {
      runbooks.push({
        runId: runbook.runId,
        status: runbook.status,
        mode: runbook.mode,
        currentStage: runbook.currentStage,
        updatedAt: runbook.updatedAt,
        stopReason: runbook.stopReason || "",
        runDir: path.join(runsDir, entry.name)
      });
    }
  }
  return runbooks.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

async function openRunbookFolder(payload = {}) {
  const root = await normalizeExistingProjectRoot(payload.projectRoot);
  const targetRunId = String(payload.runId || "").trim();
  if (targetRunId) {
    const paths = await getRunbookPaths(root, targetRunId);
    const result = await shell.openPath(paths.runDir);
    return result === "";
  }
  const latest = await getLatestRunbook({ projectRoot: root });
  if (!latest?.runId) {
    return false;
  }
  const paths = await getRunbookPaths(root, latest.runId);
  const result = await shell.openPath(paths.runDir);
  return result === "";
}

async function markManualReviewComplete(payload = {}) {
  const root = await normalizeExistingProjectRoot(payload.projectRoot);
  const latest = payload.runId ? await loadRunbook(root, payload.runId) : await getLatestRunbook({ projectRoot: root });
  if (!latest?.runId) {
    return null;
  }
  return upsertPersistentRunbook(root, {
    runId: latest.runId,
    status: "completed",
    stopReason: "",
    currentStage: "manual_review_completed"
  }, {
    type: "manual-review-completed",
    status: "completed",
    message: "Manual review marked complete."
  });
}

async function resumeRunbook(payload = {}) {
  const root = await normalizeExistingProjectRoot(payload.projectRoot);
  const latest = payload.runId ? await loadRunbook(root, payload.runId) : await getLatestRunbook({ projectRoot: root });
  if (!latest?.runId) {
    throw new Error("No runbook available to resume.");
  }
  const action = normalizeRunbookNextAction(latest.nextAction || deriveRunbookNextAction(latest));
  const reviewData = await readProjectReviewData(root).catch(() => null);
  const originalRequest = String(latest.userGoal || reviewData?.runState?.taskInput || "").trim();
  const missingModels = (action.requiresModels || []).filter((modelName) => latest.models?.[modelName]?.available === false);

  await upsertPersistentRunbook(root, {
    runId: latest.runId,
    status: "running",
    currentStage: "resume_requested",
    stopReason: ""
  }, {
    type: "run-resumed",
    status: "running",
    message: action.label || "Runbook resume requested.",
    data: { nextActionType: action.type }
  });

  if (!action.safeToResume) {
    return {
      resumed: false,
      blocked: true,
      runId: latest.runId,
      nextAction: action,
      message: action.label || "Runbook cannot be resumed automatically."
    };
  }

  if (missingModels.length > 0) {
    return {
      resumed: false,
      blocked: true,
      runId: latest.runId,
      nextAction: action,
      message: `${action.label || "Resume blocked."} Missing models: ${missingModels.join(", ")}.`
    };
  }

  if (["resume_gui_qa_only", "resume_quality_loop", "resume_dev_patch", "resume_pm_finalize", "start_project"].includes(action.type)) {
    const mode = latest.mode === "evidence_only" ? "evidence_only" : "full_ai_loop";
    const state = await startQualityLoop({
      projectRoot: root,
      mode,
      originalRequest
    });
    return {
      resumed: true,
      runId: state?.runId || latest.runId,
      nextAction: action,
      state
    };
  }

  return {
    resumed: false,
    blocked: true,
    runId: latest.runId,
    nextAction: action,
    message: action.label || "Resume requires manual action."
  };
}

async function syncQualityLoopRunbook(task, event, extra = {}) {
  const health = await backend.getModelHealth().catch(() => ({}));
  const eventType = toRunbookEventType(event);
  let mappedType = eventType;
  if (event === "quality-loop-build-result" && String(extra.buildStatus || "").toLowerCase() !== "passed") {
    mappedType = "build-failed";
  }
  if (event === "quality-loop-gui-qa-result" && String(extra.resultStatus || "").toLowerCase() !== "passed") {
    mappedType = "gui-qa-failed";
  }
  if (event === "quality-loop-qa-result") {
    mappedType = extra.validFormat === false
      ? "qa-review-invalid"
      : String(extra.verdict || "").toLowerCase() === "needs_patch"
        ? "qa-review-needs-patch"
        : String(extra.verdict || "").toLowerCase() === "pass"
          ? "qa-review-passed"
          : "manual-review-required";
  }
  if (event === "quality-loop-dev-patch-result") {
    mappedType = extra.validFormat === false ? "dev-patch-invalid" : "dev-patch-applied";
  }
  if (event === "quality-loop-stop-reason" && String(extra.reason || "").toLowerCase().includes("repeated failure")) {
    mappedType = "repeated-failure-detected";
  }
  if (event === "quality-loop-stop-reason" && String(extra.reason || "").toLowerCase().includes("max rounds")) {
    mappedType = "max-rounds-reached";
  }

  return upsertPersistentRunbook(task.projectRoot, {
    runId: task.runId,
    projectName: path.basename(task.projectRoot),
    mode: task.mode === "evidence_only" ? "evidence_only" : "full_quality_loop",
    status: task.status,
    userGoal: String(task.originalRequest || ""),
    currentStage: task.guiQaStatus || task.qaStatus || task.devPatchStatus || task.status,
    currentRound: Number(task.currentRound || 0),
    maxRounds: Number(task.maxRounds || DEFAULT_MAX_QUALITY_ROUNDS),
    models: {
      pm: {
        available: Boolean(health?.architect?.online),
        model: String(health?.architect?.model || ""),
        endpoint: String(health?.architect?.endpoint || "")
      },
      dev: {
        available: Boolean(health?.junior?.online),
        model: String(health?.junior?.model || ""),
        endpoint: String(health?.junior?.endpoint || "")
      },
      qa: {
        available: Boolean(health?.supervisor?.online),
        model: String(health?.supervisor?.model || ""),
        endpoint: String(health?.supervisor?.endpoint || "")
      }
    },
    latestEvidence: {
      healthUrl: task.devServerUrl || "",
      guiQaResultPath: task.latestResultPath || "",
      guiQaScreenshotPath: task.latestScreenshotPath || "",
      qaVerdictPath: task.latestQaVerdictPath || "",
      buildLogPath: Number(task.currentRound || 0) > 0 ? path.join(task.artifactDirPath, GUI_QA_ROUNDS_DIR_NAME, `round-${String(task.currentRound).padStart(3, "0")}`, "build-log.txt") : "",
      playwrightStatus: task.playwrightStatus || ""
    },
    latestQaVerdict: task.qaVerdict ? {
      verdict: task.qaVerdict,
      path: task.latestQaVerdictPath || "",
      summary: task.lastKnownIssue || ""
    } : null,
    latestDevPatch: task.devPatchStatus && task.devPatchStatus !== "idle" ? {
      status: task.devPatchStatus,
      summary: task.lastKnownIssue || ""
    } : null,
    latestPmFinal: task.finalPmStatus && task.finalPmStatus !== "idle" ? {
      status: task.finalPmStatus,
      summary: task.message || ""
    } : null,
    stopReason: task.latestStopReason || ""
  }, {
    type: mappedType,
    status: task.status,
    message: task.message || extra.summary || extra.reason || "",
    data: extra
  });
}

async function initializeAutonomyLedger(rootPath, statePatch = {}) {
  const root = await normalizeExistingProjectRoot(rootPath);
  const dir = path.join(root, AUTONOMY_DIR_NAME);
  const graphDir = path.join(dir, GRAPH_DIR_NAME);
  const processDir = path.join(dir, PROCESS_DIR_NAME);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(graphDir, { recursive: true });
  await fs.mkdir(processDir, { recursive: true });

  await ensureFile(path.join(dir, MEMORY_FILE), "# TriFix Memory\n\n");
  await ensureFile(path.join(dir, DECISIONS_FILE), "# TriFix Decisions\n\n");
  await ensureJsonFile(path.join(graphDir, GRAPH_STATUS_FILE), createDefaultGraphStatus(root));
  await ensureJsonFile(path.join(processDir, PROCESS_REGISTRY_FILE), []);
  await backend.runState.createRunState({
    runId: statePatch.runId || "",
    taskInput: statePatch.taskInput || "",
    projectRoot: root,
    mode: statePatch.mode || "manual"
  });
  const existingState = await backend.runState.loadRunState(root);
  await backend.runState.saveRunState(root, {
    ...existingState,
    runId: statePatch.runId ?? existingState?.runId ?? "",
    mode: statePatch.mode ?? existingState?.mode ?? "manual",
    status: mapRunStatus(statePatch.status ?? existingState?.status ?? "pending"),
    stage: mapRunStage(statePatch.currentStage ?? statePatch.stage ?? existingState?.stage ?? "pm_plan"),
    attempt: Number(statePatch.attempt ?? existingState?.attempt ?? 0),
    maxAttempts: Number(statePatch.maxAttempts ?? existingState?.maxAttempts ?? 3),
    taskInput: statePatch.taskInput ?? existingState?.taskInput ?? "",
    projectSlug: statePatch.projectSlug ?? existingState?.projectSlug ?? path.basename(root),
    workspacePath: root,
    changedFiles: uniqueStrings(statePatch.changedFiles ?? existingState?.changedFiles ?? []),
    lastError: statePatch.lastError ?? existingState?.lastError ?? "",
    lastValidationStatus: statePatch.lastValidationStatus ?? existingState?.lastValidationStatus ?? ""
  });
  await backend.artifactLedger.createArtifactLedger({
    runPath: root,
    projectSlug: statePatch.projectSlug || path.basename(root),
    workspacePath: root
  });
  await backend.artifactLedger.saveArtifactLedger(root, {
    projectName: statePatch.projectName || "",
    projectSlug: statePatch.projectSlug || path.basename(root),
    rootPath: root,
    changedFiles: uniqueStrings(statePatch.changedFiles || []),
    processes: [],
    graph: {
      status: "not_checked",
      reportPath: path.join(AUTONOMY_DIR_NAME, GRAPH_DIR_NAME, "GRAPH_REPORT.md"),
      graphPath: path.join(AUTONOMY_DIR_NAME, GRAPH_DIR_NAME, "graph.json")
    }
  });

  return dir;
}

async function getGraphStatus(rootPath, options = {}) {
  const dir = await initializeAutonomyLedger(rootPath);
  const root = path.dirname(dir);
  const graphDir = path.join(dir, GRAPH_DIR_NAME);
  const statusPath = path.join(graphDir, GRAPH_STATUS_FILE);
  const current = await readJsonFile(statusPath, createDefaultGraphStatus(root));

  if (!options.detect) {
    return current;
  }

  const detected = await detectGraphifyTool();
  const nextStatus = {
    ...current,
    status: detected.available ? "tool_available" : "tool_missing",
    toolAvailable: detected.available,
    toolName: detected.toolName,
    toolPath: detected.toolPath,
    version: detected.version,
    checkedAt: new Date().toISOString(),
    message: detected.available
      ? `${detected.toolName} is available. Graph indexing can be enabled next.`
      : "Graphify is not installed. Install graphifyy, then check again."
  };

  await writeJsonFile(statusPath, nextStatus);
  await updateAutonomyArtifacts(root, {
    graph: {
      status: nextStatus.status,
      toolAvailable: nextStatus.toolAvailable,
      toolName: nextStatus.toolName,
      checkedAt: nextStatus.checkedAt,
      reportPath: nextStatus.reportPath,
      graphPath: nextStatus.graphPath
    }
  });
  await appendAutonomyLog(root, {
    type: "graph-detect",
    status: nextStatus.status,
    toolName: nextStatus.toolName,
    message: nextStatus.message
  });

  return nextStatus;
}

async function buildGraphIndex(rootPath) {
  const dir = await initializeAutonomyLedger(rootPath);
  const root = path.dirname(dir);
  const graphDir = path.join(dir, GRAPH_DIR_NAME);
  const statusPath = path.join(graphDir, GRAPH_STATUS_FILE);
  const detected = await detectGraphifyTool();

  if (!detected.available) {
    const status = {
      ...(await readJsonFile(statusPath, createDefaultGraphStatus(root))),
      status: "tool_missing",
      toolAvailable: false,
      checkedAt: new Date().toISOString(),
      message: "Graphify is not installed. Install with: pip install graphifyy && graphify install"
    };
    await writeJsonFile(statusPath, status);
    return status;
  }

  await ensureGraphifyIgnore(root);
  const startedAt = new Date().toISOString();
  const indexingStatus = {
    ...(await readJsonFile(statusPath, createDefaultGraphStatus(root))),
    status: "indexing",
    toolAvailable: true,
    toolName: detected.toolName,
    toolPath: detected.toolPath,
    version: detected.version,
    checkedAt: startedAt,
    message: "Graphify indexing started."
  };
  await writeJsonFile(statusPath, indexingStatus);
  await appendAutonomyLog(root, {
    type: "graph-build-start",
    toolName: detected.toolName
  });

  const result = await runGraphifyBuildCli(detected.toolName, root, 20 * 60 * 1000);
  const graphifyOut = path.join(root, "graphify-out");
  const graphJson = path.join(graphifyOut, "graph.json");
  const graphReport = path.join(graphifyOut, "GRAPH_REPORT.md");
  const graphHtml = path.join(graphifyOut, "graph.html");
  const copied = await copyGraphOutputs(graphifyOut, graphDir);
  const graphExists = await fileExists(graphJson);
  const reportExists = await fileExists(graphReport);
  const finishedAt = new Date().toISOString();
  const success = result.exitCode === 0 && (graphExists || reportExists);
  const nextStatus = {
    ...indexingStatus,
    status: success ? "indexed" : "index_failed",
    lastIndexedAt: success ? finishedAt : indexingStatus.lastIndexedAt || "",
    graphPath: copied.graphJson ? path.join(AUTONOMY_DIR_NAME, GRAPH_DIR_NAME, "graph.json") : "graphify-out/graph.json",
    reportPath: copied.graphReport ? path.join(AUTONOMY_DIR_NAME, GRAPH_DIR_NAME, "GRAPH_REPORT.md") : "graphify-out/GRAPH_REPORT.md",
    htmlPath: copied.graphHtml ? path.join(AUTONOMY_DIR_NAME, GRAPH_DIR_NAME, "graph.html") : "graphify-out/graph.html",
    outputRoot: "graphify-out",
    buildCommand: result.command,
    exitCode: result.exitCode,
    message: success
      ? "Graph index built. TriFix copied graph outputs into .trifix/graph."
      : `Graphify build failed for "${result.command}": ${trimText(result.output || "No output captured.", 700)}`,
    lastOutput: trimText(result.output || "", 4000)
  };

  await writeJsonFile(statusPath, nextStatus);
  await updateAutonomyArtifacts(root, {
    graph: {
      status: nextStatus.status,
      toolAvailable: true,
      toolName: detected.toolName,
      lastIndexedAt: nextStatus.lastIndexedAt,
      graphPath: nextStatus.graphPath,
      reportPath: nextStatus.reportPath,
      htmlPath: nextStatus.htmlPath,
      outputRoot: nextStatus.outputRoot
    }
  });
  await appendAutonomyLog(root, {
    type: "graph-build-complete",
    status: nextStatus.status,
    exitCode: result.exitCode,
    command: result.command,
    output: trimText(result.output || "", 2000)
  });

  return nextStatus;
}

async function queryGraphIndex(rootPath, query) {
  const text = String(query || "").trim();
  if (!text) {
    throw new Error("Graph query is empty.");
  }
  if (/[|;&<>`$]/.test(text)) {
    throw new Error("Graph query contains unsupported shell syntax.");
  }

  const dir = await initializeAutonomyLedger(rootPath);
  const root = path.dirname(dir);
  const detected = await detectGraphifyTool();
  if (!detected.available) {
    throw new Error("Graphify is not installed.");
  }

  const graphPath = await resolveGraphJsonPath(root);
  if (!graphPath) {
    throw new Error("No graph.json found. Build the graph first.");
  }

  const graphArg = toGraphCliPath(root, graphPath);
  const result = await runGraphifyCli(detected.toolName, ["query", text, "--graph", graphArg], root, 2 * 60 * 1000);
  await appendAutonomyLog(root, {
    type: "graph-query",
    query: text,
    status: result.exitCode === 0 ? "passed" : "failed",
    output: trimText(result.output || "", 2000)
  });

  return {
    query: text,
    status: result.exitCode === 0 ? "passed" : "failed",
    output: trimText(result.output || "", 8000)
  };
}

async function openGraphView(rootPath) {
  const dir = await initializeAutonomyLedger(rootPath);
  const graphDir = path.join(dir, GRAPH_DIR_NAME);
  const candidates = [
    path.join(graphDir, "graph.html"),
    path.join(graphDir, "GRAPH_REPORT.md"),
    path.join(path.dirname(dir), "graphify-out", "graph.html"),
    path.join(path.dirname(dir), "graphify-out", "GRAPH_REPORT.md")
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      const result = await shell.openPath(candidate);
      if (result) {
        throw new Error(result);
      }
      await appendAutonomyLog(path.dirname(dir), {
        type: "graph-open",
        path: path.relative(path.dirname(dir), candidate)
      });
      return {
        opened: true,
        path: candidate
      };
    }
  }

  throw new Error("No Graphify view found. Build the graph first.");
}

async function buildPipelineGraphContext(rootPath, payload = {}, files = []) {
  try {
    const dir = await initializeAutonomyLedger(rootPath);
    const root = path.dirname(dir);
    const statusPath = path.join(dir, GRAPH_DIR_NAME, GRAPH_STATUS_FILE);
    const status = await readJsonFile(statusPath, createDefaultGraphStatus(root));
    const graphPath = await resolveGraphJsonPath(root);
    const reportPath = path.join(dir, GRAPH_DIR_NAME, "GRAPH_REPORT.md");
    const reportSummary = await readGraphReportSummary(reportPath);

    if (!graphPath && !reportSummary) {
      return {
        status: status.status || "not_indexed",
        message: status.message || "Graph context is not indexed yet.",
        reportSummary: "",
        query: "",
        queryOutput: "",
        relatedFiles: []
      };
    }

    const query = buildAutomaticGraphQuery(payload, files);
    let queryOutput = "";
    if (graphPath && query) {
      const detected = await detectGraphifyTool();
      if (detected.available) {
        const graphArg = toGraphCliPath(root, graphPath);
        const result = await runGraphifyCli(detected.toolName, ["query", query, "--graph", graphArg], root, 90 * 1000);
        queryOutput = result.exitCode === 0
          ? trimText(result.output || "", 4000)
          : `Graph query failed: ${trimText(result.output || "", 1000)}`;
        await appendAutonomyLog(root, {
          type: "graph-context-query",
          query,
          status: result.exitCode === 0 ? "passed" : "failed",
          output: trimText(result.output || "", 1200)
        });
      }
    }

    return {
      status: graphPath ? "indexed" : status.status || "report_only",
      message: "Graph context attached to agent prompt.",
      graphPath: graphPath ? path.relative(root, graphPath) : "",
      reportPath: reportSummary ? path.relative(root, reportPath) : "",
      reportSummary,
      query,
      queryOutput,
      relatedFiles: extractRelatedFilesFromGraphText(`${reportSummary}\n${queryOutput}`)
    };
  } catch (error) {
    return {
      status: "unavailable",
      message: `Graph context unavailable: ${error?.message || String(error)}`,
      reportSummary: "",
      query: "",
      queryOutput: "",
      relatedFiles: []
    };
  }
}

async function readGraphReportSummary(reportPath) {
  try {
    const raw = await fs.readFile(reportPath, "utf8");
    return trimText(raw, 3500);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function buildAutomaticGraphQuery(payload = {}, files = []) {
  const selectedPaths = files
    .map((file) => file?.path)
    .filter(Boolean)
    .slice(0, 6)
    .join(" ");
  const input = String(payload?.input || "")
    .replace(/[`$|;&<>]/g, " ")
    .replace(/[^A-Za-z0-9_.@()[\]\-\\/:\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const query = [selectedPaths, input].filter(Boolean).join(" ");
  return query.slice(0, 220).replace(/["\r\n]/g, " ").trim();
}

function extractRelatedFilesFromGraphText(text) {
  const matches = String(text || "").match(/[A-Za-z0-9_.@()[\]\-\\/]+\.[A-Za-z0-9]{1,8}/g) || [];
  return [...new Set(matches)]
    .filter((filePath) => !/(node_modules|\.git|dist|build|\.trifix)/i.test(filePath))
    .slice(0, 20);
}

function createDefaultGraphStatus(root) {
  return {
    schemaVersion: 1,
    status: "not_checked",
    toolAvailable: false,
    toolName: "",
    toolPath: "",
    version: "",
    checkedAt: "",
    lastIndexedAt: "",
    staleFiles: [],
    graphPath: path.join(AUTONOMY_DIR_NAME, GRAPH_DIR_NAME, "graph.json"),
    reportPath: path.join(AUTONOMY_DIR_NAME, GRAPH_DIR_NAME, "GRAPH_REPORT.md"),
    htmlPath: path.join(AUTONOMY_DIR_NAME, GRAPH_DIR_NAME, "graph.html"),
    rootPath: root,
    message: "Graphify has not been checked for this project."
  };
}

async function detectGraphifyTool() {
  for (const toolName of ["graphify", "graphifyy"]) {
    const found = await findExecutable(toolName);
    if (!found.available) {
      continue;
    }

    const version = await readToolVersion(toolName);
    return {
      available: true,
      toolName,
      toolPath: found.toolPath,
      version
    };
  }

  return {
    available: false,
    toolName: "",
    toolPath: "",
    version: ""
  };
}

async function ensureGraphifyIgnore(root) {
  const ignorePath = path.join(root, ".graphifyignore");
  const defaults = [
    ".git/",
    ".trifix/",
    ".trifix-backups/",
    "node_modules/",
    "dist/",
    "build/",
    "graphify-out/cache/"
  ];

  try {
    const current = await fs.readFile(ignorePath, "utf8");
    const missing = defaults.filter((line) => !current.includes(line));
    if (missing.length > 0) {
      await fs.appendFile(ignorePath, `\n# TriFix graph context ignores\n${missing.join("\n")}\n`, "utf8");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    await fs.writeFile(ignorePath, `# TriFix graph context ignores\n${defaults.join("\n")}\n`, "utf8");
  }
}

async function copyGraphOutputs(graphifyOut, graphDir) {
  const copies = {
    graphJson: false,
    graphReport: false,
    graphHtml: false
  };
  await fs.mkdir(graphDir, { recursive: true });

  copies.graphJson = await copyIfExists(path.join(graphifyOut, "graph.json"), path.join(graphDir, "graph.json"));
  copies.graphReport = await copyIfExists(path.join(graphifyOut, "GRAPH_REPORT.md"), path.join(graphDir, "GRAPH_REPORT.md"));
  copies.graphHtml = await copyIfExists(path.join(graphifyOut, "graph.html"), path.join(graphDir, "graph.html"));

  return copies;
}

async function copyIfExists(source, destination) {
  try {
    await fs.copyFile(source, destination);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function resolveGraphJsonPath(root) {
  const trifixGraph = path.join(root, AUTONOMY_DIR_NAME, GRAPH_DIR_NAME, "graph.json");
  if (await fileExists(trifixGraph)) {
    return trifixGraph;
  }

  const graphifyGraph = path.join(root, "graphify-out", "graph.json");
  if (await fileExists(graphifyGraph)) {
    return graphifyGraph;
  }

  return "";
}

function toGraphCliPath(root, graphPath) {
  const relative = path.relative(root, graphPath || "");
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return String(graphPath || "").replaceAll("\\", "/");
  }

  return relative.replaceAll("\\", "/");
}

async function runGraphifyBuildCli(toolName, root, timeoutMs) {
  const candidates = [
    ["update", "."],
    ["."]
  ];
  let lastResult = {
    exitCode: 1,
    output: "Graphify did not run.",
    command: `${toolName} update .`
  };

  for (const args of candidates) {
    const result = await runGraphifyCli(toolName, args, root, timeoutMs);
    const command = `${toolName} ${args.join(" ")}`;
    lastResult = {
      ...result,
      command
    };

    if (result.exitCode === 0 || !isUnknownGraphifyCommand(result.output)) {
      return lastResult;
    }
  }

  return lastResult;
}

function isUnknownGraphifyCommand(output) {
  return /unknown command|usage:\s*graphify\s+<command>/i.test(String(output || ""));
}

function runGraphifyCli(toolName, args, cwd, timeoutMs) {
  if (process.platform === "win32") {
    const command = [toolName, ...args.map(quoteCmdArg)].join(" ");
    return runQuickProcess(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command], cwd, timeoutMs);
  }

  return runQuickProcess(toolName, args, cwd, timeoutMs);
}

function quoteCmdArg(value) {
  const text = String(value || "");
  if (/^[A-Za-z0-9._:/\\-]+$/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '\\"')}"`;
}

async function findExecutable(toolName) {
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "sh";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", `where ${toolName}`]
    : ["-lc", `command -v ${toolName}`];
  const result = await runQuickProcess(command, args, process.cwd(), 4000);
  const firstLine = result.output.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  return {
    available: result.exitCode === 0 && Boolean(firstLine),
    toolPath: firstLine
  };
}

async function readToolVersion(toolName) {
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : toolName;
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", `${toolName} --version`]
    : ["--version"];
  const result = await runQuickProcess(command, args, process.cwd(), 4000);
  return trimText(result.output || "", 240);
}

function runQuickProcess(command, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        windowsHide: true,
        shell: false
      });
    } catch (error) {
      resolve({ exitCode: 1, output: error?.message || String(error) });
      return;
    }

    let output = "";
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      child.kill();
      resolve({ exitCode: 124, output });
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: 1, output: error?.message || String(error) });
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: exitCode ?? 0, output });
    });
  });
}

async function updateAutonomyRunState(rootPath, statePatch = {}) {
  await initializeAutonomyLedger(rootPath);
  const current = await backend.runState.loadRunState(rootPath);
  await backend.runState.saveRunState(rootPath, {
    ...current,
    ...stripUndefined(statePatch),
    status: mapRunStatus(statePatch.status ?? current?.status ?? "running"),
    stage: mapRunStage(statePatch.currentStage ?? statePatch.stage ?? current?.stage ?? "pm_plan"),
    changedFiles: uniqueStrings(statePatch.changedFiles ?? current?.changedFiles ?? []),
    lastValidationStatus: statePatch.lastValidationStatus ?? current?.lastValidationStatus ?? "",
    lastError: statePatch.lastError ?? current?.lastError ?? ""
  });
}

async function appendAutonomyLog(rootPath, entry = {}) {
  const dir = await initializeAutonomyLedger(rootPath);
  const line = JSON.stringify({
    at: new Date().toISOString(),
    ...entry
  });
  await fs.appendFile(path.join(dir, RUN_LOG_FILE), `${line}\n`, "utf8");
}

async function appendAutonomyDecision(rootPath, entry = {}) {
  const dir = await initializeAutonomyLedger(rootPath);
  const lines = [
    `## ${new Date().toISOString()}`,
    "",
    `Decision: ${entry.decision || "unknown"}`,
    entry.summary ? `Summary: ${entry.summary}` : "",
    Array.isArray(entry.affectedFiles) && entry.affectedFiles.length
      ? `Affected files:\n${entry.affectedFiles.map((filePath) => `- ${filePath}`).join("\n")}`
      : "",
    ""
  ].filter(Boolean).join("\n");
  await fs.appendFile(path.join(dir, DECISIONS_FILE), `${lines}\n`, "utf8");
}

async function updateAutonomyArtifacts(rootPath, patch = {}) {
  await initializeAutonomyLedger(rootPath);
  await backend.artifactLedger.saveArtifactLedger(rootPath, patch);
}

async function normalizeExistingProjectRoot(rootPath) {
  if (!rootPath || typeof rootPath !== "string") {
    throw new Error("Project folder is missing.");
  }

  const root = await fs.realpath(rootPath);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) {
    throw new Error("Project path is not a folder.");
  }
  return root;
}

async function ensureFile(filePath, content) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, content, "utf8");
  }
}

async function ensureJsonFile(filePath, value) {
  try {
    await fs.access(filePath);
  } catch {
    await writeJsonFile(filePath, value);
  }
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return safeParseJson(raw, fallback, filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function stripUndefined(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, item]) => item !== undefined)
  );
}

function attachGeneratedProjectResult(result, generatedProject) {
  const appliedFiles = (generatedProject.applied || []).map((item) => item.path);
  const failedOperations = generatedProject.failedOperations || [];
  const executor = {
    status: appliedFiles.length > 0 ? "applied" : "failed",
    projectName: generatedProject.projectName,
    projectSlug: generatedProject.projectSlug,
    rootPath: generatedProject.rootPath,
    filesCreated: generatedProject.filesCreated || 0,
    filesModified: generatedProject.filesModified || 0,
    failedOperations,
    applied: generatedProject.applied || []
  };

  return {
    ...result,
    executor,
    project: {
      ...(result?.project || {}),
      ...generatedProject,
      rootPath: generatedProject.rootPath,
      projectName: generatedProject.projectName,
      projectSlug: generatedProject.projectSlug,
      filesCreated: executor.filesCreated,
      filesModified: executor.filesModified,
      failedOperations,
      commandHistory: result?.project?.commandHistory || []
    },
    decision: {
      ...(result?.decision || {}),
      affectedFiles: appliedFiles,
      canApply: false,
      decisionStatus: "pending",
      summary: `${result?.decision?.summary || "DEV wrote files."} Executor applied ${appliedFiles.length} file operation(s).`
    },
    workflow: {
      ...(result?.workflow || {}),
      folderLoaded: true,
      contextReady: true,
      currentStage: "file-executor",
      decisionStatus: "pending",
      projectStatus: failedOperations.length > 0 ? "Output ready with issues" : "Output ready",
      currentTask: `Review ${appliedFiles.length} written file operation(s).`
    }
  };
}

function trimText(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 40))}\n[...trimmed...]`;
}

function createContextDocumentId(filePath, mtimeMs) {
  return Buffer.from(`${filePath}:${mtimeMs}`).toString("base64url");
}

function attachTrackedProject(project, tracked) {
  return {
    ...project,
    name: tracked?.name || path.basename(project?.rootPath || ""),
    projectSlug: tracked?.projectSlug || project?.projectSlug || "",
    filesCreated: tracked?.filesCreated ?? project?.filesCreated,
    filesModified: tracked?.filesModified ?? project?.filesModified,
    failedOperations: tracked?.failedOperations || project?.failedOperations || [],
    projectId: tracked?.id || "",
    projectType: tracked?.type || inferProjectType(project?.rootPath),
    projectStatus: tracked?.status || "Not started",
    fsd: tracked?.fsd || null,
    prd: tracked?.prd || null,
    phases: tracked?.phases || [],
    tasks: tracked?.tasks || [],
    logs: tracked?.logs || [],
    commandHistory: tracked?.commandHistory || [],
    processes: tracked?.processes || project?.processes || []
  };
}

async function attachTrackedProjectWithGraph(project, tracked) {
  const attached = attachTrackedProject(project, tracked);
  try {
    const autonomyState = await readAutonomyStateForProject(attached.rootPath);
    return {
      ...attached,
      graphStatus: await getGraphStatus(attached.rootPath, { detect: false }),
      autonomyState,
      processes: await refreshProcessRecords(attached.rootPath)
    };
  } catch {
    return attached;
  }
}

function projectToTrackedEntry(project, overrides = {}) {
  const rootPath = project?.rootPath || "";
  return {
    id: overrides.id || createTrackedProjectId(rootPath),
    name: overrides.name || project?.projectName || project?.name || path.basename(rootPath),
    path: rootPath,
    type: overrides.type || inferProjectType(rootPath),
    status: overrides.status || "Not started",
    loopCount: Number(overrides.loopCount || 0),
    lastAgent: overrides.lastAgent || "",
    lastUpdated: overrides.lastUpdated || new Date().toISOString(),
    affectedFiles: overrides.affectedFiles || [],
    decisionStatus: overrides.decisionStatus || "pending",
    fsd: overrides.fsd || null,
    prd: overrides.prd || null,
    phases: overrides.phases || [],
    tasks: overrides.tasks || [],
    projectSlug: overrides.projectSlug || project?.projectSlug || "",
    filesCreated: overrides.filesCreated ?? project?.filesCreated,
    filesModified: overrides.filesModified ?? project?.filesModified,
    failedOperations: overrides.failedOperations || project?.failedOperations || [],
    logs: overrides.logs || [],
    commandHistory: overrides.commandHistory || [],
    processes: overrides.processes || project?.processes || []
  };
}

function createTrackedProjectId(rootPath) {
  return Buffer.from(String(rootPath || "")).toString("base64url");
}

function inferProjectType(rootPath) {
  return String(rootPath || "").includes(`${path.sep}sandbox${path.sep}tasks${path.sep}`) ? "sandbox-task" : "project";
}

async function getMergedAgents() {
  const settings = await readSettings();
  const dialogue = settings.dialogue || {};
  const mergedAgents = {};

  for (const [agentId, agent] of Object.entries(backend.AGENTS)) {
    mergedAgents[agentId] = {
      ...agent,
      dialogue: {
        ...(agent.dialogue || {}),
        ...(dialogue[agentId] || {})
      }
    };
  }

  return mergedAgents;
}

async function readSettings() {
  if (!settingsFilePath) {
    return {};
  }

  try {
    const raw = await fs.readFile(settingsFilePath, "utf8");
    return safeParseJson(raw, {}, settingsFilePath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function writeSettings(settings) {
  await fs.mkdir(path.dirname(settingsFilePath), { recursive: true });
  await fs.writeFile(settingsFilePath, JSON.stringify(settings, null, 2), "utf8");
}

async function listProjects() {
  await projectsWriteQueue;
  const items = await readProjects();
  const enriched = await Promise.all(
    items.map(async (item) => ({
      ...item,
      autonomyState: await readAutonomyStateForProject(item.path)
    }))
  );
  return enriched.sort((left, right) => String(right.lastUpdated || "").localeCompare(String(left.lastUpdated || "")));
}

async function readAutonomyStateForProject(rootPath) {
  if (!rootPath) {
    return null;
  }

  try {
    const statePath = path.join(await fs.realpath(rootPath), AUTONOMY_DIR_NAME, RUN_STATE_FILE);
    const state = await readJsonFile(statePath, null);
    if (!state || state.mode !== "autonomous") {
      return null;
    }

    return {
      runId: state.runId || "",
      mode: state.mode,
      status: state.status || "",
      currentStage: state.stage || state.currentStage || "",
      currentTask: state.currentTask || "",
      queuedAt: state.queuedAt || "",
      startedAt: state.startedAt || "",
      finishedAt: state.finishedAt || "",
      deadlineAt: state.deadlineAt || "",
      maxRuntimeMs: state.maxRuntimeMs || 0,
      stopRequested: Boolean(state.stopRequested),
      nextAction: state.nextAction || ""
    };
  } catch {
    return null;
  }
}

async function readProjects() {
  if (!projectsFilePath) {
    return [];
  }

  try {
    const raw = await fs.readFile(projectsFilePath, "utf8");
    const parsed = safeParseJson(raw, [], projectsFilePath);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeProjectsFile(projects) {
  await fs.mkdir(path.dirname(projectsFilePath), { recursive: true });
  const nextContent = JSON.stringify(projects, null, 2);
  const tempPath = `${projectsFilePath}.tmp`;
  await fs.writeFile(tempPath, nextContent, "utf8");
  await fs.rename(tempPath, projectsFilePath);
}

async function mutateProjects(mutator) {
  let result = null;
  projectsWriteQueue = projectsWriteQueue.then(async () => {
    const projects = await readProjects();
    const nextProjects = Array.isArray(projects) ? [...projects] : [];
    result = await mutator(nextProjects);
    await writeProjectsFile(nextProjects);
  });

  await projectsWriteQueue;
  return result;
}

async function findTrackedProjectByPath(rootPath) {
  await projectsWriteQueue;
  const projects = await readProjects();
  return projects.find((item) => item.path === rootPath) || null;
}

async function upsertProjectEntry(entry) {
  if (!entry?.path) {
    return entry || null;
  }

  return mutateProjects(async (projects) => {
    const index = projects.findIndex((item) => item.id === entry.id || item.path === entry.path);
    const nextEntry = {
      ...entry,
      lastUpdated: entry.lastUpdated || new Date().toISOString()
    };

    if (index >= 0) {
      projects[index] = {
        ...projects[index],
        ...nextEntry
      };
    } else {
      projects.push(nextEntry);
    }

    return index >= 0 ? projects[index] : nextEntry;
  });
}

async function updateTrackedProject(id, patch) {
  if (!id) {
    return null;
  }

  return mutateProjects(async (projects) => {
    const index = projects.findIndex((item) => item.id === id);
    if (index < 0) {
      return null;
    }

    projects[index] = {
      ...projects[index],
      ...(patch || {}),
      lastUpdated: patch?.lastUpdated || new Date().toISOString()
    };
    return projects[index];
  });
}

async function removeTrackedProject(id) {
  if (!id) {
    return [];
  }

  return mutateProjects(async (projects) => {
    const nextProjects = projects.filter((item) => item.id !== id);
    projects.splice(0, projects.length, ...nextProjects);
    return nextProjects;
  });
}

function safeParseJson(raw, fallback, filePath) {
  try {
    return JSON.parse(raw);
  } catch {
    void backupInvalidJson(filePath, raw, fallback);
    return fallback;
  }
}

async function backupInvalidJson(filePath, raw, fallback) {
  if (!filePath) {
    return;
  }

  try {
    const invalidPath = `${filePath}.invalid-${Date.now()}.json`;
    await fs.writeFile(invalidPath, String(raw || ""), "utf8");
    await fs.writeFile(filePath, JSON.stringify(fallback, null, 2), "utf8");
  } catch {}
}
