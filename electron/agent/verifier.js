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
  const projectType = await detectProjectType(normalizedRoot);
  pushCheck(checks, "workspace-exists", true, `Workspace exists: ${normalizedRoot}`);
  pushCheck(checks, "workspace-not-empty", visibleEntries.length > 0, visibleEntries.length > 0
    ? `Workspace contains ${visibleEntries.length} visible entr${visibleEntries.length === 1 ? "y" : "ies"}.`
    : "Workspace folder is empty.");
  pushCheck(checks, `project-type:${projectType}`, true, `Detected project type: ${projectType}.`);

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

  const htmlResult = await verifyHtmlProject(normalizedRoot, { projectType });
  const packageResult = await verifyPackageProject(normalizedRoot, { projectType, expectedFiles: requiredFiles });
  checks.push(...htmlResult.checks, ...packageResult.checks);
  warnings.push(...htmlResult.warnings, ...packageResult.warnings);

  const normalizedCommands = uniquePaths(commandRequests);
  if (normalizedCommands.length > 0) {
    warnings.push(`Command requests were recorded but not auto-run: ${normalizedCommands.join(", ")}`);
  }

  return finalizeResult({ checks, missingFiles, emptyFiles, warnings, projectType });
}

export async function detectProjectType(rootPath) {
  const packageInfo = await readPackageInfo(rootPath);
  const hasViteConfig = await fileExists(path.join(rootPath, "vite.config.js"))
    || await fileExists(path.join(rootPath, "vite.config.mjs"))
    || await fileExists(path.join(rootPath, "vite.config.ts"));
  const hasSrcMain = await fileExists(path.join(rootPath, "src", "main.jsx"))
    || await fileExists(path.join(rootPath, "src", "main.js"))
    || await fileExists(path.join(rootPath, "src", "main.tsx"))
    || await fileExists(path.join(rootPath, "src", "main.ts"));
  const hasSrcApp = await fileExists(path.join(rootPath, "src", "App.jsx"))
    || await fileExists(path.join(rootPath, "src", "App.js"))
    || await fileExists(path.join(rootPath, "src", "App.tsx"))
    || await fileExists(path.join(rootPath, "src", "App.ts"));
  const scripts = packageInfo?.scripts || {};
  const deps = {
    ...(packageInfo?.dependencies || {}),
    ...(packageInfo?.devDependencies || {})
  };
  const mentionsVite = Boolean(
    deps.vite
    || /\bvite\b/i.test(String(scripts.dev || ""))
    || /\bvite\b/i.test(String(scripts.build || ""))
    || hasViteConfig
    || hasSrcMain
    || hasSrcApp
  );

  if (mentionsVite) {
    return "vite-react";
  }

  const hasIndexHtml = await fileExists(path.join(rootPath, "index.html"));
  if (hasIndexHtml && !packageInfo && !hasViteConfig && !hasSrcMain && !hasSrcApp) {
    return "static-html";
  }

  return hasIndexHtml ? "html" : "generic";
}

export async function verifyHtmlProject(rootPath, { projectType = "generic" } = {}) {
  const checks = [];
  const warnings = [];
  const htmlPath = path.join(rootPath, "index.html");

  try {
    const content = await fs.readFile(htmlPath, "utf8");
    const expectsFullDocument = /<html[\s>]/i.test(content) || /<body[\s>]/i.test(content) || /<head[\s>]/i.test(content);
    const hasValidHtml5Doctype = /^\s*<!doctype html>/i.test(content);
    const hasHtmlTag = /<html[\s>]/i.test(content);
    const hasHeadTag = /<head[\s>]/i.test(content);
    const hasBodyTag = /<body[\s>]/i.test(content);

    if (expectsFullDocument) {
      pushCheck(
        checks,
        "index.html-doctype",
        hasValidHtml5Doctype,
        hasValidHtml5Doctype ? "index.html contains a valid HTML5 doctype." : "Invalid or missing HTML5 doctype."
      );
      pushCheck(checks, "index.html-html-tag", hasHtmlTag, hasHtmlTag
        ? "index.html contains an html tag."
        : "index.html is missing an html tag.");
      pushCheck(checks, "index.html-head-tag", hasHeadTag, hasHeadTag
        ? "index.html contains a head tag."
        : "index.html is missing a head tag.");
      pushCheck(checks, "index.html-body-tag", hasBodyTag, hasBodyTag
        ? "index.html contains a body tag."
        : "index.html is missing a body tag.");
      if (projectType === "static-html") {
        pushCheck(checks, "index.html-direct-preview", true, "Static HTML can be previewed directly with file://.");
      } else if (projectType === "vite-react") {
        warnings.push("Vite source index.html is an app shell and is not expected to render directly via file://.");
      }
    } else {
      warnings.push("index.html appears to be an HTML fragment; skipping full-document doctype validation.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      warnings.push(`Could not inspect index.html: ${error.message}`);
    }
  }

  return { checks, warnings };
}

export async function verifyPackageProject(rootPath, { projectType = "generic", expectedFiles = [] } = {}) {
  const checks = [];
  const warnings = [];
  const packagePath = path.join(rootPath, "package.json");
  const packageInfo = await readPackageInfo(rootPath);

  if (await fileExists(packagePath)) {
    pushCheck(checks, "package.json-parse", Boolean(packageInfo), packageInfo
      ? "package.json parses as JSON."
      : "package.json is not valid JSON.");
  } else if (projectType === "vite-react" || expectedFiles.includes("package.json")) {
    pushCheck(checks, "package.json-parse", false, "package.json is missing.");
  }

  if (projectType === "vite-react") {
    const scripts = packageInfo?.scripts || {};
    const dependencies = packageInfo?.dependencies || {};
    const devDependencies = packageInfo?.devDependencies || {};
    const allDependencies = {
      ...dependencies,
      ...devDependencies
    };
    const hasDevScript = typeof scripts.dev === "string" && /\bvite\b/i.test(scripts.dev);
    const hasBuildScript = typeof scripts.build === "string" && /\bvite\b/i.test(scripts.build);
    const mainEntry = await firstExistingPath(rootPath, ["src/main.jsx", "src/main.js", "src/main.tsx", "src/main.ts"]);
    const appEntry = await firstExistingPath(rootPath, ["src/App.jsx", "src/App.js", "src/App.tsx", "src/App.ts"]);
    const cssEntry = await firstExistingPath(rootPath, ["src/index.css", "src/styles.css", "src/app.css"]);
    const viteConfig = await firstExistingPath(rootPath, ["vite.config.js", "vite.config.mjs", "vite.config.ts"]);
    const viteConfigContent = viteConfig ? await readTextFile(path.join(rootPath, viteConfig)) : "";
    const importsVite = /\bfrom\s+['"]vite['"]|\brequire\(['"]vite['"]\)/i.test(viteConfigContent);
    const importsReactPlugin = /\bfrom\s+['"]@vitejs\/plugin-react['"]|\brequire\(['"]@vitejs\/plugin-react['"]\)/i.test(viteConfigContent);

    pushCheck(checks, "vite-script-dev", hasDevScript, hasDevScript
      ? "package.json includes a vite dev script."
      : "package.json is missing a vite dev script.");
    pushCheck(checks, "vite-script-build", hasBuildScript, hasBuildScript
      ? "package.json includes a vite build script."
      : "package.json is missing a vite build script.");
    pushCheck(checks, "vite-main-entry", Boolean(mainEntry), mainEntry
      ? `${mainEntry} exists.`
      : "Missing src/main.* entry file.");
    pushCheck(checks, "vite-app-entry", Boolean(appEntry), appEntry
      ? `${appEntry} exists.`
      : "Missing src/App.* entry file.");
    pushCheck(checks, "vite-css-entry", Boolean(cssEntry), cssEntry
      ? `${cssEntry} exists.`
      : "Missing src/index.css or equivalent CSS entry file.");
    if (expectedFiles.includes("vite.config.js") || viteConfig) {
      pushCheck(checks, "vite-config", Boolean(viteConfig), viteConfig
        ? `${viteConfig} exists.`
        : "Expected vite.config.js but it is missing.");
    }
    pushCheck(checks, "vite-dependency-react", Boolean(allDependencies.react), allDependencies.react
      ? "package.json includes dependency react."
      : "package.json missing dependency react.");
    pushCheck(checks, "vite-dependency-react-dom", Boolean(allDependencies["react-dom"]), allDependencies["react-dom"]
      ? "package.json includes dependency react-dom."
      : "package.json missing dependency react-dom.");
    pushCheck(checks, "vite-dependency-vite", Boolean(allDependencies.vite), allDependencies.vite
      ? "package.json includes vite."
      : "package.json missing devDependency vite.");
    if (importsVite) {
      pushCheck(checks, "vite-config-import-vite", Boolean(allDependencies.vite), allDependencies.vite
        ? "vite.config imports vite and package.json includes it."
        : "vite.config imports vite but package.json is missing devDependency vite.");
    }
    if (importsReactPlugin) {
      pushCheck(checks, "vite-dependency-plugin-react", Boolean(allDependencies["@vitejs/plugin-react"]), allDependencies["@vitejs/plugin-react"]
        ? "package.json includes @vitejs/plugin-react."
        : "package.json missing devDependency @vitejs/plugin-react.");
    }

    if (mainEntry) {
      const mainChecks = await verifyRelativeImports(rootPath, mainEntry);
      checks.push(...mainChecks);
    }
    if (appEntry) {
      const appChecks = await verifyRelativeImports(rootPath, appEntry);
      checks.push(...appChecks);
    }
  }

  return { checks, warnings };
}

export function buildVerificationReport(result) {
  const failedChecks = Array.isArray(result?.checks)
    ? result.checks.filter((check) => check?.status === "failed" && check?.message)
    : [];
  const lines = [
    `Verification status: ${result?.status || "failed"}`,
    result?.summary || "",
    failedChecks.length
      ? `Issues:\n${failedChecks.map((check) => `- ${check.message}`).join("\n")}`
      : "",
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

function finalizeResult({ checks, missingFiles, emptyFiles, warnings, projectType = "generic" }) {
  const failedChecks = checks.filter((check) => check.status === "failed");
  return {
    status: failedChecks.length === 0 ? "passed" : "failed",
    projectType,
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

async function readPackageInfo(rootPath) {
  try {
    const content = await fs.readFile(path.join(rootPath, "package.json"), "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function readTextFile(targetPath) {
  try {
    return await fs.readFile(targetPath, "utf8");
  } catch {
    return "";
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

async function firstExistingPath(rootPath, candidates = []) {
  for (const relativePath of candidates) {
    if (await fileExists(path.join(rootPath, relativePath))) {
      return relativePath;
    }
  }
  return "";
}

async function verifyRelativeImports(rootPath, relativeFilePath) {
  const checks = [];
  try {
    const absolutePath = path.join(rootPath, relativeFilePath);
    const content = await fs.readFile(absolutePath, "utf8");
    const importMatches = [...content.matchAll(/from\s+["'](\.[^"']+)["']|import\s+["'](\.[^"']+)["']/g)];
    for (const match of importMatches) {
      const importPath = String(match[1] || match[2] || "").trim();
      if (!importPath) {
        continue;
      }
      const resolved = await resolveImportPath(path.dirname(absolutePath), importPath);
      pushCheck(
        checks,
        `import-exists:${relativeFilePath}:${importPath}`,
        Boolean(resolved),
        resolved
          ? `${relativeFilePath} imports ${importPath} and it exists.`
          : `${relativeFilePath} imports missing path ${importPath}.`
      );
    }
  } catch {}
  return checks;
}

async function resolveImportPath(baseDir, importPath) {
  const candidates = [
    importPath,
    `${importPath}.js`,
    `${importPath}.jsx`,
    `${importPath}.ts`,
    `${importPath}.tsx`,
    `${importPath}.css`,
    `${importPath}/index.js`,
    `${importPath}/index.jsx`,
    `${importPath}/index.ts`,
    `${importPath}/index.tsx`
  ];

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(path.resolve(baseDir, candidate));
      if (stat.isFile()) {
        return candidate;
      }
    } catch {}
  }

  return "";
}
