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
  const [constants, fileSystem, orchestrator] = await Promise.all([
    import("./constants.js"),
    import("./fileSystem.js"),
    import("./agent/orchestrator.js")
  ]);

  return {
    AGENTS: constants.AGENTS,
    AI_ENDPOINT: constants.AI_ENDPOINT,
    DEV_ENDPOINT: constants.DEV_ENDPOINT,
    ARCHITECT_ENDPOINT: constants.ARCHITECT_ENDPOINT,
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
    runAgentTest: orchestrator.runAgentTest
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
    return attachTrackedProject(project, tracked);
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
      return attachTrackedProject(project, tracked);
    }

    const taskProject = await backend.buildTaskSandboxProject(app.getPath("documents"));
    const tracked = await upsertProjectEntry(
      projectToTrackedEntry(taskProject, {
        type: "sandbox-task",
        name: path.basename(taskProject.rootPath)
      })
    );
    return attachTrackedProject(taskProject, tracked);
  });

  ipcMain.handle("project:refresh", async (_event, rootPath) => {
    const project = await backend.buildProjectTree(rootPath, {
      ensureSandboxFolder: inferProjectType(rootPath) !== "sandbox-task"
    });
    const tracked = await findTrackedProjectByPath(project.rootPath);
    return attachTrackedProject(project, tracked);
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
    return attachTrackedProject(project, tracked);
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
  ipcMain.handle("project:command", async (_event, payload = {}) =>
    runProjectCommand(payload)
  );

  ipcMain.handle("pipeline:last", async () => backend.getLastResult());
  ipcMain.handle("pipeline:test-agent", async (_event, payload) =>
    backend.runAgentTest(payload)
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
    const files = payload?.projectRoot
      ? await backend.readSelectedProjectFiles(payload.projectRoot, payload.selectedFiles || [])
      : [];
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

    let activeTrackedEntry = trackedEntry;
    let result = await backend.runPipeline(
      {
        ...payload,
        files
      },
      (progress) => {
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

    if (!payload?.projectRoot) {
      const fileOperations = Array.isArray(result?.dev?.fileOperations) ? result.dev.fileOperations : [];
      if (fileOperations.length === 0) {
        throw new Error("DEV proposed changes but no valid file operations were found.");
      }

      const generatedProject = await backend.applyFileOperations(
        app.getPath("documents"),
        result?.project?.architecture || result?.project || {},
        fileOperations
      );
      result = attachGeneratedProjectResult(result, generatedProject);
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

    await updateTrackedProject(activeTrackedEntry?.id, {
      status: result?.executor?.applied?.length ? "Output ready" : "Waiting for decision",
      loopCount: Number(result?.workflow?.loopCount || payload?.loopCount || 0),
      lastAgent: "architect",
      lastUpdated: new Date().toISOString(),
      affectedFiles: result?.decision?.affectedFiles || [],
      decisionStatus: "pending",
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

    return result;
  });

  ipcMain.handle("decision:accept", async (_event, payload) => {
    await updateTrackedProject(payload?.projectId, {
      status: "Accepted",
      decisionStatus: "accepted",
      lastUpdated: new Date().toISOString(),
      affectedFiles: payload?.affectedFiles || []
    });
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

    return entry;
  }

  const command = await resolveProjectCommand(root, payload);
  const startedAt = new Date().toISOString();
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

  return entry;
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
  return String(command || "")
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
    commandHistory: tracked?.commandHistory || []
  };
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
    commandHistory: overrides.commandHistory || []
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
  return items.sort((left, right) => String(right.lastUpdated || "").localeCompare(String(left.lastUpdated || "")));
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
