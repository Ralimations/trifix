const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
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
    buildDefaultSandboxProject: fileSystem.buildDefaultSandboxProject,
    buildTaskSandboxProject: fileSystem.buildTaskSandboxProject,
    buildProjectTree: fileSystem.buildProjectTree,
    readSelectedProjectFiles: fileSystem.readSelectedProjectFiles,
    previewFilePatches: fileSystem.previewFilePatches,
    applyFilePatches: fileSystem.applyFilePatches,
    getLastResult: orchestrator.getLastResult,
    runPipeline: orchestrator.runPipeline
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
      const project = await backend.buildProjectTree(options.path);
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
    const project = await backend.buildProjectTree(rootPath);
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

  ipcMain.handle("pipeline:last", async () => backend.getLastResult());
  ipcMain.handle("projects:list", async () => listProjects());
  ipcMain.handle("projects:remove", async (_event, id) => removeTrackedProject(id));
  ipcMain.handle("projects:update", async (_event, payload) => updateTrackedProject(payload?.id, payload));

  ipcMain.handle("app:settings", async () => ({
    endpoint: backend.AI_ENDPOINT,
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
      decisionStatus: "pending"
    });

    const result = await backend.runPipeline(
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
            []
        });
        event.sender.send("pipeline:progress", progress);
      }
    );

    await updateTrackedProject(trackedEntry?.id, {
      status: "Waiting for decision",
      loopCount: Number(result?.workflow?.loopCount || payload?.loopCount || 0),
      lastAgent: "architect",
      lastUpdated: new Date().toISOString(),
      affectedFiles: result?.decision?.affectedFiles || [],
      decisionStatus: "pending"
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
}

function attachTrackedProject(project, tracked) {
  return {
    ...project,
    name: tracked?.name || path.basename(project?.rootPath || ""),
    projectId: tracked?.id || "",
    projectType: tracked?.type || inferProjectType(project?.rootPath),
    projectStatus: tracked?.status || "Not started"
  };
}

function projectToTrackedEntry(project, overrides = {}) {
  const rootPath = project?.rootPath || "";
  return {
    id: overrides.id || createTrackedProjectId(rootPath),
    name: overrides.name || path.basename(rootPath),
    path: rootPath,
    type: overrides.type || inferProjectType(rootPath),
    status: overrides.status || "Not started",
    loopCount: Number(overrides.loopCount || 0),
    lastAgent: overrides.lastAgent || "",
    lastUpdated: overrides.lastUpdated || new Date().toISOString(),
    affectedFiles: overrides.affectedFiles || [],
    decisionStatus: overrides.decisionStatus || "pending"
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
