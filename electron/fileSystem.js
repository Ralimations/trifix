import fs from "node:fs/promises";
import path from "node:path";
import {
  ALLOWED_EXTENSIONS,
  BLOCKED_NAMES,
  MAX_FILE_SIZE_BYTES,
  MAX_SELECTED_FILES,
  MAX_TREE_ENTRIES
} from "./constants.js";

const textDecoder = new TextDecoder("utf-8", { fatal: false });

export async function buildProjectTree(rootPath) {
  const root = await normalizeRoot(rootPath);
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

      if (isBlockedName(entry.name)) {
        continue;
      }

      const absolutePath = path.join(currentPath, entry.name);
      const childRelativePath = toProjectPath(path.join(relativePath, entry.name));

      if (entry.isDirectory()) {
        const children = await walk(absolutePath, childRelativePath, depth + 1);
        if (children.length > 0) {
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

      if (!entry.isFile() || !isAllowedFile(entry.name)) {
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

  return {
    rootPath: root,
    tree: await walk(root),
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

    if (isBlockedPath(relativePath) || !isAllowedFile(baseName)) {
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

    const buffer = await fs.readFile(absolutePath);
    files.push({
      path: toProjectPath(relativePath),
      size: stat.size,
      extension: path.extname(baseName).toLowerCase(),
      content: textDecoder.decode(buffer)
    });
  }

  return files;
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

  if (path.isAbsolute(relativePath)) {
    throw new Error("Absolute paths are not allowed.");
  }

  if (isBlockedPath(relativePath)) {
    throw new Error(`Blocked path: ${relativePath}`);
  }

  const target = path.resolve(root, relativePath);
  const normalizedRoot = path.normalize(root);
  const relativeFromRoot = path.relative(normalizedRoot, target);

  if (
    relativeFromRoot.startsWith("..") ||
    path.isAbsolute(relativeFromRoot) ||
    relativeFromRoot === ""
  ) {
    throw new Error(`Path escapes the project folder: ${relativePath}`);
  }

  return target;
}

function isAllowedFile(fileName) {
  return ALLOWED_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function isBlockedName(name) {
  return BLOCKED_NAMES.has(name) || name === ".env" || name.startsWith(".env.");
}

function isBlockedPath(relativePath) {
  return toProjectPath(relativePath)
    .split("/")
    .some((part) => isBlockedName(part));
}

function sortNodes(a, b) {
  if (a.type !== b.type) {
    return a.type === "directory" ? -1 : 1;
  }

  return a.name.localeCompare(b.name);
}

function toProjectPath(value) {
  return String(value).replaceAll("\\", "/");
}
