import fs from "node:fs/promises";
import path from "node:path";

const AUTONOMY_DIR_NAME = ".trifix";
const RUN_STATE_FILE = "run-state.json";
const RUN_LOG_FILE = "run-log.jsonl";
const ARTIFACTS_FILE = "artifacts.json";
const FINAL_REPORT_FILE = "final-report.md";

export async function createRunState({ runId, taskInput, projectRoot, mode = "manual" }) {
  const root = await normalizeProjectRoot(projectRoot);
  const dir = path.join(root, AUTONOMY_DIR_NAME);
  const now = new Date().toISOString();
  const projectSlug = path.basename(root);
  const existing = await readJsonFile(path.join(dir, RUN_STATE_FILE), null);
  const nextState = {
    ...(existing || {}),
    runId: String(runId || ""),
    mode: mode === "autonomous" ? "autonomous" : "manual",
    status: existing?.status || "pending",
    stage: existing?.stage || "pm_plan",
    attempt: existing?.attempt || 0,
    maxAttempts: existing?.maxAttempts || 3,
    taskInput: String(taskInput || existing?.taskInput || ""),
    projectSlug: existing?.projectSlug || projectSlug,
    workspacePath: root,
    changedFiles: existing?.changedFiles || [],
    lastError: existing?.lastError || "",
    lastValidationStatus: existing?.lastValidationStatus || "",
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  await ensureRunFiles(dir, nextState);
  return nextState;
}

export async function loadRunState(runPath) {
  const root = await normalizeProjectRoot(runPath);
  const statePath = path.join(root, AUTONOMY_DIR_NAME, RUN_STATE_FILE);
  return readJsonFile(statePath, null);
}

export async function saveRunState(runPath, patch) {
  const root = await normalizeProjectRoot(runPath);
  const dir = path.join(root, AUTONOMY_DIR_NAME);
  const current = (await loadRunState(root)) || (await createRunState({
    runId: "",
    taskInput: "",
    projectRoot: root,
    mode: "manual"
  }));
  const nextState = {
    ...current,
    ...stripUndefined(patch),
    workspacePath: root,
    updatedAt: new Date().toISOString()
  };
  await ensureRunFiles(dir, nextState);
  await writeJsonFile(path.join(dir, RUN_STATE_FILE), nextState);
  return nextState;
}

export async function appendRunLog(runPath, event) {
  const root = await normalizeProjectRoot(runPath);
  const dir = path.join(root, AUTONOMY_DIR_NAME);
  await ensureRunFiles(dir);
  const line = JSON.stringify({
    at: new Date().toISOString(),
    ...stripUndefined(event)
  });
  await fs.appendFile(path.join(dir, RUN_LOG_FILE), `${line}\n`, "utf8");
}

export async function markStage(runPath, stage, status, metadata = {}) {
  const normalizedStage = String(stage || "").trim() || "pm_plan";
  const normalizedStatus = String(status || "").trim() || "running";
  const patch = {
    stage: normalizedStage,
    status: normalizedStatus,
    ...stripUndefined(metadata)
  };
  const nextState = await saveRunState(runPath, patch);
  await appendRunLog(runPath, {
    type: "stage",
    stage: normalizedStage,
    status: normalizedStatus,
    metadata: stripUndefined(metadata)
  });
  return nextState;
}

export async function recordArtifact(runPath, artifact) {
  const root = await normalizeProjectRoot(runPath);
  const artifactsPath = path.join(root, AUTONOMY_DIR_NAME, ARTIFACTS_FILE);
  const current = await readJsonFile(artifactsPath, {
    schemaVersion: 1,
    records: []
  });
  const next = {
    ...current,
    records: [
      ...(Array.isArray(current.records) ? current.records : []),
      {
        at: new Date().toISOString(),
        ...stripUndefined(artifact)
      }
    ],
    updatedAt: new Date().toISOString()
  };
  await writeJsonFile(artifactsPath, next);
  return next;
}

async function ensureRunFiles(dir, state = null) {
  await fs.mkdir(dir, { recursive: true });
  if (state) {
    await writeJsonFile(path.join(dir, RUN_STATE_FILE), state);
  } else {
    const statePath = path.join(dir, RUN_STATE_FILE);
    try {
      await fs.access(statePath);
    } catch {
      await writeJsonFile(statePath, {});
    }
  }

  await ensureFile(path.join(dir, RUN_LOG_FILE), "");
  await ensureJsonFile(path.join(dir, ARTIFACTS_FILE), {
    schemaVersion: 1,
    records: []
  });
  await ensureFile(path.join(dir, FINAL_REPORT_FILE), "");
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

async function normalizeProjectRoot(projectRoot) {
  if (!projectRoot || typeof projectRoot !== "string") {
    throw new Error("Project root is missing.");
  }

  const requestedRoot = path.resolve(String(projectRoot));
  await fs.mkdir(requestedRoot, { recursive: true });
  const root = await fs.realpath(requestedRoot);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) {
    throw new Error("Run path must be a directory.");
  }
  return root;
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function stripUndefined(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entry]) => entry !== undefined)
  );
}
