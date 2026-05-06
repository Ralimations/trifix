const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
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
let autonomyWorkerActive = false;

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
const DEFAULT_AUTONOMY_RUNTIME_MS = 8 * 60 * 60 * 1000;
const MAX_AUTONOMY_RUNTIME_MS = 12 * 60 * 60 * 1000;

app.whenReady().then(async () => {
  backend = await loadBackend();
  settingsFilePath = path.join(app.getPath("userData"), "trifix-settings.json");
  projectsFilePath = path.join(app.getPath("userData"), "trifix-projects.json");
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
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
    runState,
    artifactLedger,
    verifier,
    getModelHealth: modelHealth.getModelHealth
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: "#10131a",
    title: "TriFix AI: Tiny Office Mode",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
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
  ipcMain.handle("projects:list", async () => listProjects());
  ipcMain.handle("projects:remove", async (_event, id) => removeTrackedProject(id));
  ipcMain.handle("projects:update", async (_event, payload) => updateTrackedProject(payload?.id, payload));

  ipcMain.handle("app:settings", async () => ({
    endpoint: backend.AI_ENDPOINT,
    endpoints: {
      dev: backend.DEV_ENDPOINT,
      qa: backend.AI_ENDPOINT,
      pm: backend.ARCHITECT_ENDPOINT
    },
    agents: await getMergedAgents()
  }));
  ipcMain.handle("app:model-health", async () => backend.getModelHealth());

  ipcMain.handle("app:dialogue:save", async (_event, dialoguePatch) => {
    const current = await readSettings();
    current.dialogue = {
      ...(current.dialogue || {}),
      ...(dialoguePatch || {})
    };
    await writeSettings(current);

    return {
      endpoint: backend.AI_ENDPOINT,
      endpoints: {
        dev: backend.DEV_ENDPOINT,
        qa: backend.AI_ENDPOINT,
        pm: backend.ARCHITECT_ENDPOINT
      },
      agents: await getMergedAgents()
    };
  });

  ipcMain.handle("pipeline:run", async (event, payload) => {
    const sandboxParentPath = app.getPath("documents");
    const files = payload?.projectRoot
      ? await backend.readSelectedProjectFiles(payload.projectRoot, payload.selectedFiles || [])
      : [];
    const graphContext = payload?.projectRoot
      ? await buildPipelineGraphContext(payload.projectRoot, payload, files)
      : null;
    const runId = payload?.runId || `run-${Date.now()}`;
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
    let result = await backend.runPipeline(
      {
        ...payload,
        files,
        graphContext,
        mode: "manual",
        runPath: payload?.projectRoot || "",
        sandboxParentPath
      },
      (progress) => {
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
        throw new Error("DEV produced no valid fileOperations.");
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
    result = autoRepairResult.result;
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
}

async function startAutonomyRun(payload = {}) {
  const runId = payload?.runId || `auto-${Date.now()}`;
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
  await persistAutonomyQueueState(task);
  processAutonomyQueue();
  return summarizeAutonomyTask(task);
}

function getAutonomyRunStatus(runId = "") {
  if (!runId) {
    return {
      active: autonomyWorkerActive,
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
  if (task.status === "queued") {
    task.status = "stopped";
    task.finishedAt = new Date().toISOString();
  }
  await persistAutonomyQueueState(task);
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
    assertAutonomyCanContinue(task, "before start");

    let activeTrackedEntry = task.payload?.projectRoot
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
    assertAutonomyCanContinue(task, "after agent pipeline");

    let finalResult = result;
    if (task.payload?.projectRoot) {
      const fileOperations = Array.isArray(result?.dev?.fileOperations) ? result.dev.fileOperations : [];
      if (fileOperations.length > 0) {
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
        throw new Error("DEV produced no valid fileOperations.");
      }
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
    finalResult = repaired.result;
    activeTrackedEntry = repaired.activeTrackedEntry || activeTrackedEntry;

    const finalValidationStatus = getEffectiveValidationStatus(finalResult);
    const finalStatus = finalValidationStatus === "passed" && !isQaUnavailable(finalResult)
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
  } catch (error) {
    task.status = error?.code === "EAUTORUNTIME"
      ? "timed_out"
      : task.stopRequested
        ? "stopped"
        : "failed";
    task.error = error?.message || String(error);
    task.finishedAt = new Date().toISOString();
    await persistAutonomyQueueState(task, {
      status: task.status,
      finishedAt: task.finishedAt,
      currentStage: "autonomy-error",
      currentTask: task.error,
      nextAction: "blocked"
    });
    sendAutonomyProgress(task, {
      agent: "architect",
      stage: "autonomy-error",
      status: "failed",
      message: task.error
    });
  }
}

function sendAutonomyProgress(task, progress) {
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
}

async function writeAutonomyFinalReport(projectRoot, result, task) {
  const dir = await initializeAutonomyLedger(projectRoot);
  const reportPath = path.join(dir, "final-report.md");
  const ledger = await backend.artifactLedger.loadArtifactLedger(projectRoot);
  const runState = await backend.runState.loadRunState(projectRoot);
  const verification = result?.autoRepair?.finalValidation?.verification || result?.validation?.verification || null;
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
    `Status: ${verification?.status || result?.autoRepair?.status || result?.validation?.status || "not_run"}`,
    verification?.summary || "",
    result?.validation?.validation?.command ? `Command: ${result.validation.validation.command}` : "",
    "",
    "## QA Summary",
    "",
    ledger?.qaResult || result?.qa?.finalReview || result?.qa?.parallelReview || "No QA summary recorded.",
    "",
    "## Final PM Decision",
    "",
    result?.decision?.recommendation || result?.pm?.recommendation || "No final PM decision recorded.",
    "",
    "## Next Recommended Action",
    "",
    task.status === "completed"
      ? "Review the written output and run any optional local commands listed in artifacts.json."
      : "Open the generated workspace, inspect verification failures, and decide whether to apply a manual patch.",
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
      status: entry.status === "passed" ? "In progress" : "Waiting for decision",
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

  await fs.writeFile(stdoutPath, "", "utf8");
  await fs.writeFile(stderrPath, "", "utf8");

  let child;
  try {
    child = spawn(spawnSpec.executable, spawnSpec.args, {
      cwd: root,
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    record.status = "failed";
    record.finishedAt = new Date().toISOString();
    record.outputPreview = `Could not start command "${command}": ${error?.message || error}`;
    await persistProcessRecord(root, record);
    return record;
  }

  record.pid = child.pid || 0;
  record.status = "running";
  managedProcesses.set(id, {
    child,
    root,
    record
  });

  let resolveReady = null;
  const markReady = () => {
    if (!resolveReady) {
      return;
    }
    const resolve = resolveReady;
    resolveReady = null;
    resolve();
  };
  const appendOutput = (streamName, chunk) => {
    const text = chunk.toString();
    const logPath = streamName === "stdout" ? stdoutPath : stderrPath;
    void fs.appendFile(logPath, text, "utf8");
    record.outputPreview = trimText(`${record.outputPreview}${text}`, 1800);
    const detected = detectProcessEndpoint(text);
    if (detected && !record.healthUrl) {
      record.port = detected.port;
      record.healthUrl = detected.healthUrl;
      void persistProcessRecord(root, record);
      markReady();
    }
  };

  child.stdout?.on("data", (chunk) => appendOutput("stdout", chunk));
  child.stderr?.on("data", (chunk) => appendOutput("stderr", chunk));
  child.on("error", (error) => {
    record.status = "failed";
    record.finishedAt = new Date().toISOString();
    record.outputPreview = trimText(`${record.outputPreview}\n${error.message}`, 1800);
    managedProcesses.delete(id);
    void persistProcessRecord(root, record);
    markReady();
  });
  child.on("close", (exitCode) => {
    record.status = record.status === "stopped" ? "stopped" : (exitCode === 0 ? "exited" : "failed");
    record.exitCode = exitCode ?? 0;
    record.finishedAt = new Date().toISOString();
    managedProcesses.delete(id);
    void persistProcessRecord(root, record);
    markReady();
  });

  await persistProcessRecord(root, record);
  await new Promise((resolve) => {
    resolveReady = resolve;
    if (record.healthUrl || record.status !== "running") {
      markReady();
      return;
    }
    setTimeout(markReady, 8000).unref?.();
  });
  await persistProcessRecord(root, record);
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
  await updateAutonomyRunState(root, {
    lastCommand: record.command,
    lastCommandStatus: "stopped",
    activeProcess: null,
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
  const parts = splitCommand(command);
  if (process.platform === "win32" && parts[0] === "npm") {
    return {
      executable: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", command]
    };
  }

  return {
    executable: process.platform === "win32" && parts[0] === "python" ? "python.exe" : parts[0],
    args: parts.slice(1)
  };
}

function detectProcessEndpoint(text) {
  const value = String(text || "");
  const urlMatch = value.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?[^\s"'<>)]*/i);
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
    outputPreview: trimText(record.outputPreview || "", 1800)
  };
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
    status: initialValidation.status === "passed" ? "running" : "failed",
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
    status: initialValidation.status === "passed" ? "done" : "failed",
    partialResult: result
  });

  if (initialValidation.status === "passed") {
    return { result, activeTrackedEntry };
  }

  let latestValidation = initialValidation;

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
        summary: "DEV produced no valid fileOperations.",
        repairResult,
        validation: latestValidation
      });
      await updateAutonomyRunState(root, {
        attempt,
        status: "failed",
        currentStage: "patch",
        lastError: "DEV produced no valid fileOperations."
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
        status: finalValidation.status === "passed" ? "Output ready" : "Waiting for decision",
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

    latestValidation = finalValidation;
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
      validation: null,
      error: verification.summary
    };
  }

  try {
    for (const command of commands) {
      const entry = await runProjectCommand({
        projectRoot: root,
        projectId,
        mode: "custom",
        command
      });
      entries.push(entry);
      if (entry.status !== "passed") {
      return {
        status: "failed",
        entries,
        verification,
        validation: entry,
        error: `${entry.command} failed.`
      };
      }
    }

    const validation = await runProjectCommand({
      projectRoot: root,
      projectId,
      mode: "validate"
    });
    entries.push(validation);
    return {
      status: validation.status,
      entries,
      verification,
      validation,
      error: validation.status === "passed" ? "" : `${validation.command} failed.`
    };
  } catch (error) {
    return {
      status: "failed",
      entries,
      verification,
      validation: null,
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

  return uniqueStrings([
    ...inferredCommands,
    ...requestedCommands
  ])
    .map((command) => normalizeSuggestedCommand(command))
    .filter(Boolean)
    .filter((command) => !/\bnpm\s+run\s+(dev|start)\b|\bnpm\s+start\b/i.test(command))
    .slice(0, 3);
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
    validation,
    project: {
      ...(result?.project || {}),
      commandHistory: validation.entries || result?.project?.commandHistory || []
    },
    workflow: {
      ...(result?.workflow || {}),
      commandStatus: validation.status,
      projectStatus: validation.status === "passed" ? "Validation passed" : "Validation failed",
      currentStage: "auto-validation",
      currentTask: validation.status === "passed" ? "Review validated output" : "Repair validation failure"
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
        : `${initialResult?.decision?.summary || "DEV wrote files."} Auto repair still needs review.`
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

function getPipelineTrackedStatus(result) {
  const validationStatus = getEffectiveValidationStatus(result);
  if (validationStatus && validationStatus !== "passed") {
    return "Validation failed";
  }
  if (result?.executor?.applied?.length) {
    return "Output ready";
  }
  return "Waiting for decision";
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

  return String(value || "")
    .replace(/^[\s`*-]+/, "")
    .replace(/[`]+/g, "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
