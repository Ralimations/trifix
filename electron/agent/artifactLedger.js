import fs from "node:fs/promises";
import path from "node:path";
import { recordArtifact } from "./runState.js";

const AUTONOMY_DIR_NAME = ".trifix";
const ARTIFACTS_FILE = "artifacts.json";

export async function createArtifactLedger({ runPath, projectSlug = "", workspacePath = "" }) {
  const root = await normalizeProjectRoot(runPath || workspacePath);
  const current = await readJsonFile(path.join(root, AUTONOMY_DIR_NAME, ARTIFACTS_FILE), null);
  const ledger = {
    ...(current || {}),
    schemaVersion: 1,
    projectSlug: projectSlug || current?.projectSlug || path.basename(root),
    workspacePath: workspacePath || current?.workspacePath || root,
    filesPlanned: current?.filesPlanned || [],
    filesProposed: current?.filesProposed || [],
    filesWritten: current?.filesWritten || [],
    failedOperations: current?.failedOperations || [],
    commandRequests: current?.commandRequests || [],
    qaResult: current?.qaResult || "",
    finalReportPath: current?.finalReportPath || "",
    updatedAt: new Date().toISOString()
  };
  await saveArtifactLedger(root, ledger);
  return ledger;
}

export async function loadArtifactLedger(runPath) {
  const root = await normalizeProjectRoot(runPath);
  return readJsonFile(path.join(root, AUTONOMY_DIR_NAME, ARTIFACTS_FILE), null);
}

export async function saveArtifactLedger(runPath, patch) {
  const root = await normalizeProjectRoot(runPath);
  const current = (await loadArtifactLedger(root)) || (await createArtifactLedger({ runPath: root }));
  const next = {
    ...current,
    ...stripUndefined(patch),
    updatedAt: new Date().toISOString()
  };
  await writeJsonFile(path.join(root, AUTONOMY_DIR_NAME, ARTIFACTS_FILE), next);
  return next;
}

export async function trackPlannedFiles(runPath, files = []) {
  return updateUniquePathList(runPath, "filesPlanned", files, "planned-files");
}

export async function trackProposedFiles(runPath, files = []) {
  return updateUniquePathList(runPath, "filesProposed", files, "proposed-files");
}

export async function trackAppliedOperations(runPath, operations = []) {
  const normalized = (Array.isArray(operations) ? operations : [])
    .map((operation) => ({
      action: String(operation?.action || "write"),
      path: toProjectPath(operation?.path || ""),
      created: Boolean(operation?.created)
    }))
    .filter((operation) => operation.path);
  const ledger = await loadOrCreate(runPath);
  const next = await saveArtifactLedger(runPath, {
    filesWritten: mergeByPath(ledger.filesWritten || [], normalized)
  });
  await recordArtifact(runPath, {
    type: "applied-operations",
    count: normalized.length,
    files: normalized.map((operation) => operation.path)
  });
  return next;
}

export async function trackFailedOperations(runPath, operations = []) {
  const normalized = (Array.isArray(operations) ? operations : [])
    .map((operation) => ({
      action: String(operation?.action || ""),
      path: toProjectPath(operation?.path || ""),
      error: String(operation?.error || "")
    }))
    .filter((operation) => operation.path || operation.error);
  const ledger = await loadOrCreate(runPath);
  const next = await saveArtifactLedger(runPath, {
    failedOperations: [...(ledger.failedOperations || []), ...normalized]
  });
  await recordArtifact(runPath, {
    type: "failed-operations",
    count: normalized.length
  });
  return next;
}

export async function trackCommandRequests(runPath, commands = []) {
  const normalized = uniqueStrings(commands);
  const ledger = await loadOrCreate(runPath);
  const next = await saveArtifactLedger(runPath, {
    commandRequests: uniqueStrings([...(ledger.commandRequests || []), ...normalized])
  });
  await recordArtifact(runPath, {
    type: "command-requests",
    count: normalized.length
  });
  return next;
}

export async function trackQaResult(runPath, qaResult) {
  const next = await saveArtifactLedger(runPath, {
    qaResult: String(qaResult || "").trim()
  });
  await recordArtifact(runPath, {
    type: "qa-result",
    qaResult: String(qaResult || "").trim()
  });
  return next;
}

export async function trackFinalReportPath(runPath, finalReportPath) {
  const next = await saveArtifactLedger(runPath, {
    finalReportPath: toProjectPath(finalReportPath || "")
  });
  await recordArtifact(runPath, {
    type: "final-report",
    path: toProjectPath(finalReportPath || "")
  });
  return next;
}

export async function verifyWrittenArtifacts(runPath) {
  const root = await normalizeProjectRoot(runPath);
  const ledger = await loadOrCreate(root);
  const missingFiles = [];
  const emptyFiles = [];

  for (const file of ledger.filesWritten || []) {
    const relativePath = toProjectPath(file?.path || "");
    if (!relativePath) {
      continue;
    }
    const absolutePath = path.join(root, relativePath);
    try {
      const stat = await fs.stat(absolutePath);
      if (!stat.isFile()) {
        missingFiles.push(relativePath);
        continue;
      }
      if (stat.size === 0) {
        emptyFiles.push(relativePath);
      }
    } catch {
      missingFiles.push(relativePath);
    }
  }

  return {
    status: missingFiles.length === 0 && emptyFiles.length === 0 ? "passed" : "failed",
    missingFiles,
    emptyFiles
  };
}

async function updateUniquePathList(runPath, field, files, artifactType) {
  const normalized = uniquePaths(files);
  const ledger = await loadOrCreate(runPath);
  const next = await saveArtifactLedger(runPath, {
    [field]: uniqueStrings([...(ledger[field] || []), ...normalized])
  });
  await recordArtifact(runPath, {
    type: artifactType,
    count: normalized.length,
    files: normalized
  });
  return next;
}

async function loadOrCreate(runPath) {
  return (await loadArtifactLedger(runPath)) || createArtifactLedger({ runPath });
}

async function normalizeProjectRoot(projectRoot) {
  if (!projectRoot || typeof projectRoot !== "string") {
    throw new Error("Run path is missing.");
  }

  const requestedRoot = path.resolve(String(projectRoot));
  await fs.mkdir(requestedRoot, { recursive: true });
  const root = await fs.realpath(requestedRoot);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) {
    throw new Error("Artifact ledger path must be a directory.");
  }
  return root;
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function uniquePaths(files = []) {
  return uniqueStrings(
    (Array.isArray(files) ? files : []).map((file) =>
      typeof file === "string" ? file : file?.path || ""
    )
  );
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => toProjectPath(value)).filter(Boolean))];
}

function mergeByPath(current = [], incoming = []) {
  const next = new Map();
  for (const item of [...current, ...incoming]) {
    const filePath = toProjectPath(item?.path || "");
    if (!filePath) {
      continue;
    }
    next.set(filePath, {
      ...(next.get(filePath) || {}),
      ...item,
      path: filePath
    });
  }
  return [...next.values()];
}

function toProjectPath(value) {
  return String(value || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function stripUndefined(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entry]) => entry !== undefined)
  );
}
