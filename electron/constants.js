import { AGENT_CONFIGS } from "../shared/agentConfig.js";

const normalizeLocalEndpoint = (endpoint) =>
  String(endpoint || "").replace("http://localhost:3010/", "http://127.0.0.1:3010/");

export const AI_ENDPOINT =
  process.env.TRIFIX_QA_ENDPOINT ||
  process.env.TRIFIX_AI_ENDPOINT ||
  AGENT_CONFIGS.supervisor.endpoint;

export const ARCHITECT_ENDPOINT = normalizeLocalEndpoint(
  process.env.TRIFIX_PM_ENDPOINT ||
  process.env.TRIFIX_ARCHITECT_ENDPOINT ||
  AGENT_CONFIGS.architect.endpoint
);

export const DEV_ENDPOINT = normalizeLocalEndpoint(
  process.env.TRIFIX_DEV_ENDPOINT ||
  process.env.TRIFIX_JUNIOR_ENDPOINT ||
  AGENT_CONFIGS.junior.endpoint
);

export const ARCHITECT_MODEL =
  process.env.TRIFIX_PM_MODEL ||
  process.env.TRIFIX_ARCHITECT_MODEL ||
  AGENT_CONFIGS.architect.model;
export const DEV_MODEL =
  process.env.TRIFIX_DEV_MODEL ||
  process.env.TRIFIX_JUNIOR_MODEL ||
  AGENT_CONFIGS.junior.model;
export const QA_MODEL =
  process.env.TRIFIX_QA_MODEL || AGENT_CONFIGS.supervisor.model;
export const REQUEST_TIMEOUT_MS = Number(process.env.TRIFIX_REQUEST_TIMEOUT_MS || 0);
const resolveTimeout = (specificTimeout) => REQUEST_TIMEOUT_MS > 0 ? REQUEST_TIMEOUT_MS : specificTimeout;

export const AGENTS = {
  ...AGENT_CONFIGS,
  junior: {
    ...AGENT_CONFIGS.junior,
    model: DEV_MODEL,
    endpoint: DEV_ENDPOINT,
    timeoutMs: resolveTimeout(AGENT_CONFIGS.junior.timeoutMs)
  },
  supervisor: {
    ...AGENT_CONFIGS.supervisor,
    model: QA_MODEL,
    endpoint: process.env.TRIFIX_SUPERVISOR_ENDPOINT || AI_ENDPOINT,
    timeoutMs: resolveTimeout(AGENT_CONFIGS.supervisor.timeoutMs)
  },
  architect: {
    ...AGENT_CONFIGS.architect,
    model: ARCHITECT_MODEL,
    endpoint: ARCHITECT_ENDPOINT,
    timeoutMs: resolveTimeout(AGENT_CONFIGS.architect.timeoutMs)
  }
};

export const BLOCKED_NAMES = new Set([
  "node_modules",
  ".git",
  ".trifix",
  ".trifix-backups",
  "dist",
  "build"
]);

export const SANDBOX_FOLDER_NAME = "Sandbox folder";
export const DEFAULT_SANDBOX_PROJECT_NAME = "TriFix AI Sandbox";

export const ALLOWED_EXTENSIONS = new Set([
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".json",
  ".css",
  ".html",
  ".md",
  ".txt",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".cpp",
  ".h",
  ".hpp",
  ".py",
  ".sql"
]);

export const MAX_FILE_SIZE_BYTES = 180 * 1024;
export const MAX_SELECTED_FILES = 10;
export const MAX_CONTEXT_CHARS_PER_FILE = 6500;
export const MAX_CONTEXT_CHARS_TOTAL = 30000;
export const MAX_TREE_ENTRIES = 1800;
