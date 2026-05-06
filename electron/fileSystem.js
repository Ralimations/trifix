import fs from "node:fs/promises";
import path from "node:path";
import {
  ALLOWED_EXTENSIONS,
  BLOCKED_NAMES,
  DEFAULT_SANDBOX_PROJECT_NAME,
  MAX_FILE_SIZE_BYTES,
  MAX_SELECTED_FILES,
  MAX_TREE_ENTRIES,
  SANDBOX_FOLDER_NAME
} from "./constants.js";

const textDecoder = new TextDecoder("utf-8", { fatal: false });
const SANDBOX_BLOCKED_NAMES = new Set(["node_modules", ".git", ".trifix", ".trifix-backups"]);
const BINARY_CONTEXT_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export async function buildDefaultSandboxProject(parentPath) {
  if (!parentPath || typeof parentPath !== "string") {
    throw new Error("Sandbox parent folder is missing.");
  }

  const root = path.join(parentPath, DEFAULT_SANDBOX_PROJECT_NAME);
  await fs.mkdir(root, { recursive: true });
  return buildProjectTree(root);
}

export async function buildTaskSandboxProject(parentPath, taskId = createTaskSandboxId()) {
  if (!parentPath || typeof parentPath !== "string") {
    throw new Error("Sandbox parent folder is missing.");
  }

  const root = path.join(parentPath, DEFAULT_SANDBOX_PROJECT_NAME, "sandbox", "tasks", taskId);
  await fs.mkdir(root, { recursive: true });
  return {
    ...(await buildProjectTree(root)),
    taskId
  };
}

export async function buildProjectTree(rootPath, options = {}) {
  const root = await normalizeRoot(rootPath);
  const sandboxPath = path.join(root, SANDBOX_FOLDER_NAME);
  const ensureSandboxFolder = options.ensureSandboxFolder !== false;
  if (ensureSandboxFolder) {
    await fs.mkdir(sandboxPath, { recursive: true });
  }
  let entryCount = 0;

  async function walk(currentPath, relativePath = "", depth = 0) {
    if (entryCount >= MAX_TREE_ENTRIES || depth > 10) {
      return [];
    }

    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    const nodes = [];

    for (const entry of entries) {
      if (entryCount >= MAX_TREE_ENTRIES) {
        break;
      }

      const childRelativePath = toProjectPath(path.join(relativePath, entry.name));
      const inSandbox = isSandboxPath(childRelativePath);

      if (isBlockedName(entry.name, inSandbox)) {
        continue;
      }

      const absolutePath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        const children = await walk(absolutePath, childRelativePath, depth + 1);
        if (children.length > 0 || (ensureSandboxFolder && childRelativePath === SANDBOX_FOLDER_NAME)) {
          entryCount += 1;
          nodes.push({
            type: "directory",
            name: entry.name,
            path: childRelativePath,
            children
          });
        }
        continue;
      }

      if (!entry.isFile() || !isAllowedProjectFile(childRelativePath, entry.name)) {
        continue;
      }

      const stat = await fs.stat(absolutePath);
      entryCount += 1;
      nodes.push({
        type: "file",
        name: entry.name,
        path: childRelativePath,
        size: stat.size,
        selectable: stat.size <= MAX_FILE_SIZE_BYTES,
        reason:
          stat.size > MAX_FILE_SIZE_BYTES
            ? `File is larger than ${Math.round(MAX_FILE_SIZE_BYTES / 1024)} KB`
            : ""
      });
    }

    return nodes.sort(sortNodes);
  }

  const tree = await walk(root);
  const defaultSelectedFiles = [];
  collectSelectableFiles(tree, defaultSelectedFiles, 6);

  return {
    rootPath: root,
    sandboxPath,
    sandboxRelativePath: SANDBOX_FOLDER_NAME,
    tree,
    defaultSelectedFiles,
    limits: {
      maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
      maxSelectedFiles: MAX_SELECTED_FILES,
      maxTreeEntries: MAX_TREE_ENTRIES
    },
    allowedExtensions: Array.from(ALLOWED_EXTENSIONS).sort()
  };
}

export async function readSelectedProjectFiles(rootPath, relativePaths) {
  const root = await normalizeRoot(rootPath);
  const uniquePaths = [...new Set(relativePaths || [])].slice(0, MAX_SELECTED_FILES);
  const files = [];

  for (const relativePath of uniquePaths) {
    const absolutePath = await resolveInsideRoot(root, relativePath);
    const baseName = path.basename(absolutePath);

    if (isBlockedPath(relativePath) || !isAllowedProjectFile(relativePath, baseName)) {
      throw new Error(`Blocked or unsupported file: ${relativePath}`);
    }

    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      continue;
    }

    if (stat.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `${relativePath} is too large (${Math.round(stat.size / 1024)} KB). Limit is ${Math.round(
          MAX_FILE_SIZE_BYTES / 1024
        )} KB.`
      );
    }

    const extension = path.extname(baseName).toLowerCase();
    const buffer = await fs.readFile(absolutePath);
    files.push({
      path: toProjectPath(relativePath),
      size: stat.size,
      extension,
      content: BINARY_CONTEXT_EXTENSIONS.has(extension)
        ? summarizeBinaryContextFile(relativePath, extension, stat.size)
        : textDecoder.decode(buffer)
    });
  }

  return files;
}

function summarizeBinaryContextFile(relativePath, extension, size) {
  if (extension === ".pdf") {
    return `PDF document selected as project context: ${relativePath} (${size} bytes). Use uploaded document summary or filename-level context; do not assume full PDF text is available from file selection.`;
  }

  return `Image/design file selected as project context: ${relativePath} (${size} bytes). Use uploaded image metadata and user notes; local OCR is not available.`;
}

export async function previewFilePatches(rootPath, patches, allowedPaths = []) {
  const root = await normalizeRoot(rootPath);
  const previews = [];
  const allowedSet = new Set((allowedPaths || []).map((value) => toProjectPath(value)));

  for (const patch of patches || []) {
    const requestedPath = toProjectPath(patch.path);
    if (!requestedPath) {
      continue;
    }

    const { targetPath, absolutePath, allowCreate, redirected } =
      await resolvePatchWriteTarget(root, requestedPath, allowedSet);
    const previous = await readExistingPatchTarget(absolutePath, targetPath, allowCreate);
    const nextContent = String(patch.content || "");

    previews.push({
      path: targetPath,
      requestedPath,
      redirected,
      diff: createDiffPreview(previous.content, nextContent),
      previousSize: previous.content.length,
      nextSize: nextContent.length,
      created: previous.created
    });
  }

  return previews;
}

export async function applyFilePatches(rootPath, patches, allowedPaths = []) {
  const root = await normalizeRoot(rootPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(root, ".trifix-backups", timestamp);
  const allowedSet = new Set((allowedPaths || []).map((value) => toProjectPath(value)));
  const applied = [];

  for (const patch of patches || []) {
    const requestedPath = toProjectPath(patch.path);
    if (!requestedPath) {
      continue;
    }

    const { targetPath, absolutePath, allowCreate, redirected } =
      await resolvePatchWriteTarget(root, requestedPath, allowedSet);
    const previous = await readExistingPatchTarget(absolutePath, targetPath, allowCreate);
    const backupPath = path.join(backupRoot, targetPath);

    if (!previous.created) {
      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.writeFile(backupPath, previous.content, "utf8");
    }

    if (previous.created) {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    }

    await fs.writeFile(absolutePath, String(patch.content || ""), "utf8");

    applied.push({
      path: targetPath,
      requestedPath,
      redirected,
      created: previous.created,
      backupPath: previous.created ? "" : toProjectPath(path.relative(root, backupPath))
    });
  }

  return {
    backupRoot: applied.some((item) => !item.created) ? toProjectPath(path.relative(root, backupRoot)) : "",
    applied
  };
}

export async function applyFileOperations(parentPath, projectSpec = {}, operations = []) {
  if (!parentPath || typeof parentPath !== "string") {
    throw new Error("Sandbox parent folder is missing.");
  }

  const fileOperations = Array.isArray(operations) ? operations : [];
  if (fileOperations.length === 0) {
    throw new Error("DEV produced no valid fileOperations.");
  }

  const tasksRoot = path.join(parentPath, DEFAULT_SANDBOX_PROJECT_NAME, "sandbox", "tasks");
  const projectName = normalizeProjectName(projectSpec?.projectName, projectSpec?.projectSlug);
  const requestedSlug = sanitizeProjectSlug(projectSpec?.projectSlug || projectName);
  const projectSlug = await createUniqueProjectSlug(tasksRoot, requestedSlug || createTaskSandboxId());
  const root = path.join(tasksRoot, projectSlug);
  const applied = [];
  const failedOperations = [];
  let rootCreated = false;

  for (const operation of fileOperations) {
    const action = normalizeFileOperationAction(operation?.action);
    const requestedPath = normalizeFileOperationPath(operation?.path || "", projectSlug, requestedSlug);

    if (action !== "write") {
      failedOperations.push({
        action,
        path: requestedPath,
        error: `Unsupported file operation: ${action || "missing"}`
      });
      continue;
    }

    try {
      if (!requestedPath) {
        throw new Error("File path is missing.");
      }

      const absolutePath = resolveProjectWritePath(root, requestedPath);
      const created = !(await fileExists(absolutePath));
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      rootCreated = true;
      await fs.writeFile(absolutePath, String(operation?.content || ""), "utf8");
      applied.push({
        action: "write",
        path: requestedPath,
        created
      });
    } catch (error) {
      failedOperations.push({
        action,
        path: requestedPath,
        error: error?.message || "Could not write file."
      });
    }
  }

  if (applied.length === 0) {
    if (rootCreated) {
      await fs.rm(root, { recursive: true, force: true });
    }

    throw new Error("DEV produced no valid fileOperations.");
  }

  const verification = await verifyWrittenOperations(root, applied);
  for (const missingPath of verification.missingFiles) {
    failedOperations.push({
      action: "write",
      path: missingPath,
      error: "File was reported as written but was not found on disk."
    });
  }

  const project = await buildProjectTree(root, { ensureSandboxFolder: false });
  const filesCreated = applied.filter((operation) => operation.created).length;
  const filesModified = applied.length - filesCreated;

  return {
    ...project,
    projectName,
    projectSlug,
    name: projectName,
    taskId: projectSlug,
    projectType: "sandbox-task",
    status: failedOperations.length > 0 ? "Files written with issues" : "Files written",
    filesCreated,
    filesModified,
    failedOperations,
    applied,
    verification
  };
}

async function normalizeRoot(rootPath) {
  if (!rootPath || typeof rootPath !== "string") {
    throw new Error("Project folder is missing.");
  }

  const root = await fs.realpath(rootPath);
  const stat = await fs.stat(root);

  if (!stat.isDirectory()) {
    throw new Error("Selected project path is not a folder.");
  }

  return root;
}

async function resolveInsideRoot(root, relativePath) {
  if (!relativePath || typeof relativePath !== "string") {
    throw new Error("File path is missing.");
  }

  const targetRelativePath = toProjectPath(relativePath);

  if (path.isAbsolute(relativePath)) {
    throw new Error("Absolute paths are not allowed.");
  }

  if (targetRelativePath.split("/").includes("..")) {
    throw new Error(`Path traversal is not allowed: ${relativePath}`);
  }

  if (isBlockedPath(targetRelativePath)) {
    throw new Error(`Blocked path: ${targetRelativePath}`);
  }

  const target = path.resolve(root, targetRelativePath);
  const normalizedRoot = path.normalize(root);
  const relativeFromRoot = path.relative(normalizedRoot, target);

  if (
    relativeFromRoot.startsWith("..") ||
    path.isAbsolute(relativeFromRoot) ||
    relativeFromRoot === ""
  ) {
    throw new Error(`Path escapes the project folder: ${targetRelativePath}`);
  }

  return target;
}

function resolveProjectWritePath(root, relativePath) {
  const targetRelativePath = toProjectPath(relativePath);

  if (path.isAbsolute(relativePath)) {
    throw new Error("Absolute paths are not allowed.");
  }

  if (targetRelativePath.split("/").includes("..")) {
    throw new Error(`Path traversal is not allowed: ${relativePath}`);
  }

  if (isBlockedPath(targetRelativePath)) {
    throw new Error(`Blocked path: ${targetRelativePath}`);
  }

  const baseName = path.basename(targetRelativePath);
  if (!isAllowedFile(baseName)) {
    throw new Error(`Unsupported file type: ${targetRelativePath}`);
  }

  const target = path.resolve(root, targetRelativePath);
  const relativeFromRoot = path.relative(path.normalize(root), target);

  if (
    relativeFromRoot.startsWith("..") ||
    path.isAbsolute(relativeFromRoot) ||
    relativeFromRoot === ""
  ) {
    throw new Error(`Path escapes the project folder: ${targetRelativePath}`);
  }

  return target;
}

function normalizeFileOperationPath(value, projectSlug, requestedSlug = "") {
  const targetPath = toProjectPath(value);
  const parts = targetPath.split("/").filter(Boolean);

  if (parts[0]?.toLowerCase() === SANDBOX_FOLDER_NAME.toLowerCase()) {
    parts.shift();
  }

  if (
    parts[0]?.toLowerCase() === "sandbox" &&
    parts[1]?.toLowerCase() === "tasks"
  ) {
    parts.splice(0, 3);
  }

  if (parts[0]?.toLowerCase() === String(projectSlug || "").toLowerCase()) {
    parts.shift();
  }

  if (parts[0]?.toLowerCase() === String(requestedSlug || "").toLowerCase()) {
    parts.shift();
  }

  return toProjectPath(parts.join("/"));
}

function isAllowedFile(fileName) {
  return ALLOWED_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function isAllowedProjectFile(relativePath, fileName) {
  return isSandboxPath(relativePath) || isAllowedFile(fileName);
}

function isBlockedName(name, inSandbox = false) {
  const blockedNames = inSandbox ? SANDBOX_BLOCKED_NAMES : BLOCKED_NAMES;
  return blockedNames.has(name) || name === ".env" || name.startsWith(".env.");
}

function isBlockedPath(relativePath) {
  const targetPath = toProjectPath(relativePath);
  const inSandbox = isSandboxPath(targetPath);
  return targetPath.split("/").some((part) => isBlockedName(part, inSandbox));
}

function isSandboxPath(relativePath) {
  const firstPart = toProjectPath(relativePath).split("/")[0] || "";
  return firstPart.toLowerCase() === SANDBOX_FOLDER_NAME.toLowerCase();
}

function isAllowedPatchTarget(targetPath, allowedSet) {
  if (allowedSet.size === 0 || allowedSet.has(targetPath)) {
    return true;
  }

  if (!isSandboxPath(targetPath)) {
    return false;
  }

  for (const allowedPath of allowedSet) {
    if (targetPath.startsWith(`${allowedPath}/`)) {
      return true;
    }
  }

  return false;
}

async function resolvePatchWriteTarget(root, requestedPath, allowedSet) {
  if (!isAllowedPatchTarget(requestedPath, allowedSet)) {
    throw new Error(`Patch target is not listed in affectedFiles: ${requestedPath}`);
  }

  const requestedAbsolutePath = await resolveInsideRoot(root, requestedPath);
  const requestedSandboxTarget = isSandboxPath(requestedPath);
  const requestedExists = await fileExists(requestedAbsolutePath);
  const allowExplicitCreate = allowedSet.has(requestedPath);

  if (requestedSandboxTarget || requestedExists || allowExplicitCreate) {
    return {
      targetPath: requestedPath,
      absolutePath: requestedAbsolutePath,
      allowCreate: requestedSandboxTarget || allowExplicitCreate,
      redirected: false
    };
  }

  const sandboxPath = toProjectPath(path.join(SANDBOX_FOLDER_NAME, requestedPath));

  return {
    targetPath: sandboxPath,
    absolutePath: await resolveInsideRoot(root, sandboxPath),
    allowCreate: true,
    redirected: true
  };
}

function normalizeFileOperationAction(value) {
  const action = String(value || "write").trim().toLowerCase();
  if (!action || ["write", "create", "update", "modify", "edit", "replace", "overwrite", "upsert"].includes(action)) {
    return "write";
  }

  return action;
}

async function fileExists(absolutePath) {
  try {
    const stat = await fs.stat(absolutePath);
    return stat.isFile();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function verifyWrittenOperations(root, operations = []) {
  const missingFiles = [];

  for (const operation of operations) {
    const relativePath = toProjectPath(operation?.path || "");
    if (!relativePath) {
      continue;
    }

    try {
      const stat = await fs.stat(path.join(root, relativePath));
      if (!stat.isFile()) {
        missingFiles.push(relativePath);
      }
    } catch {
      missingFiles.push(relativePath);
    }
  }

  return {
    status: missingFiles.length === 0 ? "passed" : "failed",
    missingFiles
  };
}

async function directoryExists(absolutePath) {
  try {
    const stat = await fs.stat(absolutePath);
    return stat.isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function createUniqueProjectSlug(tasksRoot, requestedSlug) {
  await fs.mkdir(tasksRoot, { recursive: true });
  const baseSlug = sanitizeProjectSlug(requestedSlug) || createTaskSandboxId();
  let candidate = baseSlug;
  let suffix = 2;

  while (await directoryExists(path.join(tasksRoot, candidate))) {
    const suffixText = `-${suffix}`;
    candidate = `${baseSlug.slice(0, Math.max(1, 40 - suffixText.length))}${suffixText}`;
    suffix += 1;
  }

  return candidate;
}

function normalizeProjectName(projectName, projectSlug) {
  const cleanName = String(projectName || "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleanName) {
    return cleanName;
  }

  const slug = sanitizeProjectSlug(projectSlug);
  return slug || createTaskSandboxId();
}

function sanitizeProjectSlug(value) {
  const ascii = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40)
    .replace(/-+$/g, "");

  return ascii || "";
}

async function readExistingPatchTarget(absolutePath, relativePath, allowCreate) {
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      throw new Error(`Patch target is not a file: ${relativePath}`);
    }

    return {
      content: await fs.readFile(absolutePath, "utf8"),
      created: false
    };
  } catch (error) {
    if (error?.code === "ENOENT" && allowCreate) {
      return {
        content: "",
        created: true
      };
    }

    if (error?.code === "ENOENT") {
      throw new Error(
        `Patch target does not exist outside ${SANDBOX_FOLDER_NAME}: ${relativePath}`
      );
    }

    throw error;
  }
}

function sortNodes(a, b) {
  if (a.type !== b.type) {
    return a.type === "directory" ? -1 : 1;
  }

  return a.name.localeCompare(b.name);
}

function toProjectPath(value) {
  return String(value)
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function collectSelectableFiles(nodes, output, limit) {
  const candidates = [];
  collectSelectableCandidates(nodes, candidates);
  candidates
    .sort((left, right) => {
      const scoreDiff = scoreSelectableFile(right.path) - scoreSelectableFile(left.path);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      const depthDiff = left.path.split("/").length - right.path.split("/").length;
      if (depthDiff !== 0) {
        return depthDiff;
      }

      return left.path.localeCompare(right.path);
    })
    .slice(0, limit)
    .forEach((node) => output.push(node.path));
}

function collectSelectableCandidates(nodes, output) {
  for (const node of nodes || []) {
    if (node.type === "file" && node.selectable) {
      output.push(node);
      continue;
    }

    if (node.children) {
      collectSelectableCandidates(node.children, output);
    }
  }
}

function scoreSelectableFile(filePath) {
  const normalized = toProjectPath(filePath).toLowerCase();

  if (normalized === "package.json") return 100;
  if (["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"].includes(normalized)) return 96;
  if (["tsconfig.json", "jsconfig.json", "vite.config.ts", "vite.config.js", "vite.config.mjs", "next.config.js", "next.config.mjs"].includes(normalized)) return 92;
  if (["index.html", "src/main.tsx", "src/main.jsx", "src/index.tsx", "src/index.jsx", "src/app.tsx", "src/app.jsx"].includes(normalized)) return 88;
  if (normalized === "readme.md") return 84;
  if (/^src\/.*\.(tsx|jsx|ts|js|css|html)$/.test(normalized)) return 60;
  if (/\.(tsx|jsx|ts|js|css|html|json|md)$/.test(normalized)) return 40;

  return 10;
}

function createDiffPreview(previousContent, nextContent) {
  const before = String(previousContent || "").split(/\r?\n/);
  const after = String(nextContent || "").split(/\r?\n/);
  const preview = [];
  const maxLines = Math.max(before.length, after.length);

  for (let index = 0; index < maxLines; index += 1) {
    const oldLine = before[index];
    const newLine = after[index];

    if (oldLine === newLine) {
      if (preview.length < 120) {
        preview.push(`  ${oldLine ?? ""}`);
      }
      continue;
    }

    if (typeof oldLine !== "undefined") {
      preview.push(`- ${oldLine}`);
    }

    if (typeof newLine !== "undefined") {
      preview.push(`+ ${newLine}`);
    }

    if (preview.length >= 120) {
      break;
    }
  }

  if (preview.length === 0) {
    return "No textual changes detected.";
  }

  return preview.slice(0, 120).join("\n");
}

function createTaskSandboxId() {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `task-${year}${month}${day}-${hours}${minutes}${seconds}`;
}
