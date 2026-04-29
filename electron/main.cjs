const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

let mainWindow = null;
let backend = null;
let settingsFilePath = null;

app.whenReady().then(async () => {
  backend = await loadBackend();
  settingsFilePath = path.join(app.getPath("userData"), "trifix-settings.json");
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
    buildProjectTree: fileSystem.buildProjectTree,
    readSelectedProjectFiles: fileSystem.readSelectedProjectFiles,
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

    return backend.buildProjectTree(selection.filePaths[0]);
  });

  ipcMain.handle("project:refresh", async (_event, rootPath) => backend.buildProjectTree(rootPath));

  ipcMain.handle("pipeline:last", async () => backend.getLastResult());

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

    return backend.runPipeline(
      {
        ...payload,
        files
      },
      (progress) => {
        event.sender.send("pipeline:progress", progress);
      }
    );
  });
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
    return JSON.parse(raw);
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
