import fs from "node:fs/promises";
import path from "node:path";

const ENV = typeof process !== "undefined" && process?.env ? process.env : {};
const DEFAULT_BRAIN_DIR = ".trifix-brain";
const DEFAULT_BRAIN_MAX_CHARS = 2500;
const DEFAULT_PM_BRAIN_MAX_CHARS = 1200;
const DEFAULT_JUNIOR_BRAIN_MAX_CHARS = 2500;
const DEFAULT_QA_BRAIN_MAX_CHARS = 2200;

const STARTER_DOCS = {
  "core-rules.md": `# TriFix Core Rules
TriFix is a local-first AI software pipeline.
The system should create real files, verify actual disk output, and avoid pretending success.
If evidence is incomplete, use needs_review.
Keep scope compact.
Do not invent dependencies unless requested.
Prefer working minimal implementations over bloated architecture.
`,
  "model-roles.md": `# Model Roles
PM / Architect converts user requests into compact implementation plans.
Junior Dev generates actual files and may request commands through commandRequests.
Senior Dev / QA reviews plans, outputs, constraints, verifier results, and suggests minimal fixes.
QA is optional. If unavailable, continue with deterministic verification and mark needs_review.
`,
  "output-contract.md": `# Junior Output Contract
Junior must return actual files, not advice.
Allowed outputs:
1. JSON fileOperations.
2. Path-tagged code blocks.
For Vite/React, prefer path-tagged code blocks:
\`\`\`file: package.json
...
\`\`\`

\`\`\`file: src/App.jsx
...
\`\`\`

Do not output apologies, tutorials, general suggestions, or Thinking Process.
All paths must be project-relative.
`,
  "command-policy.md": `# Command Policy
Models cannot run commands directly.
Junior may request commands through commandRequests.
TriFix decides whether to execute or surface commands.
No destructive, admin, system, or out-of-sandbox commands.
For Vite/React, npm install and npm run build may be requested for validation.
`,
  "qa-policy.md": `# QA Policy
QA checks whether output matches the user request and PM plan.
QA must not expand scope unnecessarily.
QA must check forbidden dependencies/files.
QA must check missing files, broken interactions, verifier failures, and build issues.
If QA is unavailable, mark unavailable/skipped, not error.
`,
  "vite-react-standard.md": `# Vite React Standard
Default Vite React files:

* package.json
* index.html
* vite.config.js
* src/main.jsx
* src/App.jsx
* src/index.css
  package.json should include:
* dependencies.react
* dependencies.react-dom
* devDependencies.vite
* devDependencies.@vitejs/plugin-react
  Optional:
* src/data.js
  If Tailwind is requested, include:
* tailwind.config.js
* postcss.config.js
* Tailwind directives in src/index.css
  If Tailwind is not requested, use plain CSS.
  Required scripts:
* dev: vite --host 127.0.0.1
* build: vite build --base ./
* preview: vite preview --host 127.0.0.1
  If vite.config.js imports vite or @vitejs/plugin-react, package.json must include them.
`,
  "static-html-standard.md": `# Static HTML Standard
For single-file HTML tasks, create index.html only.
Full HTML documents must start with <!doctype html>.
Use embedded CSS/JS if requested.
Do not create external files unless requested.
`,
  "verifier-rules.md": `# Verifier Rules
Verification checks actual files on disk, not model claims.
index.html must use valid <!doctype html> for full documents.
Generated files must be non-empty.
Do not claim build success unless a build command actually ran and passed.
`,
  "known-failures.md": `# Known Failures
Qwen may output advice instead of files. Enforce file-only output.
Reasoning models may output Thinking Process. Parser should ignore reasoning.
Malformed <doctype html> must be corrected to <!doctype html>.
QA offline should be unavailable/skipped, not error.
Vite Electron builds need base ./.
Do not create Tailwind files unless Tailwind is requested.
`,
  "demo-rules.md": `# Demo Rules
For supervisor demos, prefer controlled prompts.
Show generated folder, browser preview, .trifix artifacts, and final-report.md.
Avoid live mega-prompts.
If QA is offline, explain needs_review honestly.
`
};

export function resolveBrainPath(rootPath = process.cwd()) {
  const configured = String(ENV.TRIFIX_BRAIN_PATH || "").trim();
  if (!configured) {
    return path.resolve(rootPath, DEFAULT_BRAIN_DIR);
  }

  return path.isAbsolute(configured)
    ? path.resolve(configured)
    : path.resolve(rootPath, configured);
}

export async function ensureBrainFolder(rootPath = process.cwd()) {
  const brainPath = resolveBrainPath(rootPath);
  await fs.mkdir(brainPath, { recursive: true });

  for (const [filename, content] of Object.entries(STARTER_DOCS)) {
    const filePath = path.join(brainPath, filename);
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, content, "utf8");
    }
  }

  return brainPath;
}

export async function loadBrainDocs(brainPath = resolveBrainPath()) {
  const entries = await fs.readdir(brainPath, { withFileTypes: true });
  const docs = [];

  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
      continue;
    }

    const filePath = path.join(brainPath, entry.name);
    const content = await fs.readFile(filePath, "utf8");
    docs.push({
      name: entry.name,
      path: filePath,
      content
    });
  }

  docs.sort((left, right) => left.name.localeCompare(right.name));
  return docs;
}

export function detectTaskType(text) {
  const normalized = String(text || "").toLowerCase();
  if (/\btailwind\b/.test(normalized)) {
    return "tailwind-react";
  }
  if (/\b(vite|react|package\.json|src\/app\.jsx|src\/main\.jsx)\b/.test(normalized)) {
    return "vite-react";
  }
  if (/\b(index\.html only|static html|single html|embedded css)\b/.test(normalized) || /\bindex\.html\b/.test(normalized)) {
    return "static-html";
  }
  if (/\bcrud\b|\bcreate\b|\bedit\b|\bdelete\b|\bupdate\b/.test(normalized)) {
    return "crud";
  }
  if (/\bdemo\b|\bsupervisor\b|\bpresentation\b/.test(normalized)) {
    return "demo";
  }
  return "general";
}

export function selectBrainDocs({ role, taskType, input = "", docs = [] }) {
  const docMap = new Map((docs || []).map((doc) => [doc.name, doc]));
  const selectedNames = [];
  const push = (name) => {
    if (docMap.has(name) && !selectedNames.includes(name)) {
      selectedNames.push(name);
    }
  };

  push("core-rules.md");
  push("model-roles.md");

  if (role === "architect") {
    if (taskType === "vite-react" || taskType === "tailwind-react") push("vite-react-standard.md");
    if (taskType === "static-html") push("static-html-standard.md");
    if (/\bdemo\b|\bsupervisor\b|\bpresentation\b/i.test(input)) push("demo-rules.md");
  } else if (role === "junior") {
    push("output-contract.md");
    push("command-policy.md");
    if (taskType === "vite-react" || taskType === "tailwind-react") push("vite-react-standard.md");
    if (taskType === "static-html") push("static-html-standard.md");
    push("known-failures.md");
  } else if (role === "supervisor") {
    push("qa-policy.md");
    push("verifier-rules.md");
    push("known-failures.md");
    if (taskType === "vite-react" || taskType === "tailwind-react") push("vite-react-standard.md");
    if (taskType === "static-html") push("static-html-standard.md");
  }

  return selectedNames.map((name) => docMap.get(name)).filter(Boolean);
}

export function resolveBrainCharLimit(role, fallback = DEFAULT_BRAIN_MAX_CHARS) {
  const globalMax = Math.max(
    500,
    Number(ENV.TRIFIX_BRAIN_MAX_CHARS || fallback || DEFAULT_BRAIN_MAX_CHARS) || DEFAULT_BRAIN_MAX_CHARS
  );

  if (role === "architect") {
    return Math.max(
      500,
      Number(ENV.TRIFIX_BRAIN_PM_MAX_CHARS || globalMax || DEFAULT_PM_BRAIN_MAX_CHARS) || DEFAULT_PM_BRAIN_MAX_CHARS
    );
  }

  if (role === "junior") {
    return Math.max(
      500,
      Number(ENV.TRIFIX_BRAIN_JUNIOR_MAX_CHARS || globalMax || DEFAULT_JUNIOR_BRAIN_MAX_CHARS) || DEFAULT_JUNIOR_BRAIN_MAX_CHARS
    );
  }

  if (role === "supervisor") {
    return Math.max(
      500,
      Number(ENV.TRIFIX_BRAIN_QA_MAX_CHARS || globalMax || DEFAULT_QA_BRAIN_MAX_CHARS) || DEFAULT_QA_BRAIN_MAX_CHARS
    );
  }

  return globalMax;
}

export async function buildBrainContext({ role, taskType = "", input = "", maxChars = DEFAULT_BRAIN_MAX_CHARS }) {
  const enabled = !/^(false|0|off)$/i.test(String(ENV.TRIFIX_BRAIN_ENABLED ?? "true").trim());
  const normalizedMaxChars = resolveBrainCharLimit(role, maxChars);
  const pathRoot = process.cwd();
  const brainPath = resolveBrainPath(pathRoot);

  if (!enabled) {
    return {
      enabled: false,
      path: brainPath,
      taskType: taskType || detectTaskType(input),
      selectedFiles: [],
      charCount: 0,
      text: "",
      warning: ""
    };
  }

  try {
    await ensureBrainFolder(pathRoot);
    const docs = await loadBrainDocs(brainPath);
    const resolvedTaskType = taskType || detectTaskType(input);
    const selectedDocs = selectBrainDocs({ role, taskType: resolvedTaskType, input, docs });
    const sections = [];
    let usedChars = 0;

    for (const doc of selectedDocs) {
      const section = `## ${doc.name}\n${String(doc.content || "").trim()}`;
      const remaining = normalizedMaxChars - usedChars;
      if (remaining <= 0) {
        break;
      }

      const safeSection = section.length <= remaining
        ? section
        : `${section.slice(0, Math.max(0, remaining - 24)).trim()}\n[truncated]`;
      if (!safeSection.trim()) {
        continue;
      }

      sections.push(safeSection);
      usedChars += safeSection.length + 2;
    }

    return {
      enabled: true,
      path: brainPath,
      taskType: resolvedTaskType,
      selectedFiles: selectedDocs.map((doc) => doc.name),
      charCount: sections.join("\n\n").length,
      text: sections.join("\n\n"),
      warning: ""
    };
  } catch (error) {
    return {
      enabled: false,
      path: brainPath,
      taskType: taskType || detectTaskType(input),
      selectedFiles: [],
      charCount: 0,
      text: "",
      warning: error?.message || "Brain loading failed."
    };
  }
}

export function injectBrainContext(existingContext, brainContext) {
  const brainText = String(brainContext || "").trim();
  const currentContext = String(existingContext || "").trim();
  if (!brainText) {
    return currentContext;
  }

  return [
    "GLOBAL TRIFIX BRAIN:",
    brainText,
    currentContext
  ].filter(Boolean).join("\n\n");
}
