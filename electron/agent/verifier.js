import fs from "node:fs/promises";
import path from "node:path";

export async function verifyArtifacts({ rootPath, expectedFiles = [], appliedOperations = [], commandRequests = [] }) {
  const checks = [];
  const missingFiles = [];
  const emptyFiles = [];
  const warnings = [];
  const normalizedRoot = await normalizeRoot(rootPath, checks);
  if (!normalizedRoot) {
    return finalizeResult({ checks, missingFiles, emptyFiles, warnings });
  }

  const visibleEntries = await listVisibleEntries(normalizedRoot);
  pushCheck(checks, "workspace-exists", true, `Workspace exists: ${normalizedRoot}`);
  pushCheck(checks, "workspace-not-empty", visibleEntries.length > 0, visibleEntries.length > 0
    ? `Workspace contains ${visibleEntries.length} visible entr${visibleEntries.length === 1 ? "y" : "ies"}.`
    : "Workspace folder is empty.");

  const requiredFiles = uniquePaths([
    ...expectedFiles,
    ...(Array.isArray(appliedOperations) ? appliedOperations.map((operation) => operation?.path || "") : [])
  ]);

  for (const relativePath of requiredFiles) {
    const absolutePath = path.join(normalizedRoot, relativePath);
    try {
      const stat = await fs.stat(absolutePath);
      const exists = stat.isFile();
      pushCheck(checks, `file-exists:${relativePath}`, exists, exists ? `${relativePath} exists.` : `${relativePath} is not a file.`);
      if (!exists) {
        missingFiles.push(relativePath);
        continue;
      }
      if (stat.size === 0) {
        emptyFiles.push(relativePath);
        pushCheck(checks, `file-non-empty:${relativePath}`, false, `${relativePath} is empty.`);
      } else {
        pushCheck(checks, `file-non-empty:${relativePath}`, true, `${relativePath} has content.`);
      }
    } catch {
      missingFiles.push(relativePath);
      pushCheck(checks, `file-exists:${relativePath}`, false, `${relativePath} is missing.`);
    }
  }

  const htmlResult = await verifyHtmlProject(normalizedRoot);
  const packageResult = await verifyPackageProject(normalizedRoot);
  checks.push(...htmlResult.checks, ...packageResult.checks);
  warnings.push(...htmlResult.warnings, ...packageResult.warnings);

  const normalizedCommands = uniquePaths(commandRequests);
  if (normalizedCommands.length > 0) {
    warnings.push(`Command requests were recorded but not auto-run: ${normalizedCommands.join(", ")}`);
  }

  return finalizeResult({ checks, missingFiles, emptyFiles, warnings });
}

export async function verifyHtmlProject(rootPath) {
  const checks = [];
  const warnings = [];
  const htmlPath = path.join(rootPath, "index.html");

  try {
    const content = await fs.readFile(htmlPath, "utf8");
    const hasHtmlStructure = /<!doctype html>/i.test(content) && /<html[\s>]/i.test(content) && /<body[\s>]/i.test(content);
    pushCheck(checks, "index.html-structure", hasHtmlStructure, hasHtmlStructure
      ? "index.html contains basic HTML structure."
      : "index.html is missing basic HTML structure.");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      warnings.push(`Could not inspect index.html: ${error.message}`);
    }
  }

  return { checks, warnings };
}

export async function verifyPackageProject(rootPath) {
  const checks = [];
  const warnings = [];
  const packagePath = path.join(rootPath, "package.json");

  try {
    const content = await fs.readFile(packagePath, "utf8");
    let parsed = null;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = null;
    }
    pushCheck(checks, "package.json-parse", Boolean(parsed), parsed
      ? "package.json parses as JSON."
      : "package.json is not valid JSON.");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      warnings.push(`Could not inspect package.json: ${error.message}`);
    }
  }

  return { checks, warnings };
}

export function buildVerificationReport(result) {
  const lines = [
    `Verification status: ${result?.status || "failed"}`,
    result?.summary || "",
    Array.isArray(result?.missingFiles) && result.missingFiles.length
      ? `Missing files:\n${result.missingFiles.map((filePath) => `- ${filePath}`).join("\n")}`
      : "",
    Array.isArray(result?.emptyFiles) && result.emptyFiles.length
      ? `Empty files:\n${result.emptyFiles.map((filePath) => `- ${filePath}`).join("\n")}`
      : "",
    Array.isArray(result?.warnings) && result.warnings.length
      ? `Warnings:\n${result.warnings.map((warning) => `- ${warning}`).join("\n")}`
      : ""
  ].filter(Boolean);

  return lines.join("\n\n");
}

async function normalizeRoot(rootPath, checks) {
  if (!rootPath || typeof rootPath !== "string") {
    pushCheck(checks, "workspace-exists", false, "Workspace path is missing.");
    return "";
  }

  try {
    const root = await fs.realpath(rootPath);
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) {
      pushCheck(checks, "workspace-exists", false, "Workspace path is not a directory.");
      return "";
    }
    return root;
  } catch {
    pushCheck(checks, "workspace-exists", false, "Workspace folder does not exist.");
    return "";
  }
}

async function listVisibleEntries(rootPath) {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  return entries.filter((entry) => ![".trifix", ".trifix-backups"].includes(entry.name));
}

function finalizeResult({ checks, missingFiles, emptyFiles, warnings }) {
  const failedChecks = checks.filter((check) => check.status === "failed");
  return {
    status: failedChecks.length === 0 ? "passed" : "failed",
    checks,
    missingFiles: uniquePaths(missingFiles),
    emptyFiles: uniquePaths(emptyFiles),
    warnings: [...new Set((warnings || []).filter(Boolean))],
    summary: failedChecks.length === 0
      ? "Verifier confirmed the written artifacts on disk."
      : `Verifier found ${failedChecks.length} failing check${failedChecks.length === 1 ? "" : "s"}.`
  };
}

function pushCheck(checks, name, passed, message) {
  checks.push({
    name,
    status: passed ? "passed" : "failed",
    message
  });
}

function uniquePaths(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => toProjectPath(value)).filter(Boolean))];
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
