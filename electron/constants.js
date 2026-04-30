import { AGENT_CONFIGS } from "../shared/agentConfig.js";

export const AI_ENDPOINT =
  process.env.TRIFIX_AI_ENDPOINT || "http://10.8.0.3:3011/api/v1/chat";

export const ARCHITECT_ENDPOINT =
  process.env.TRIFIX_ARCHITECT_ENDPOINT ||
  "http://localhost:3010/api/v1/chat";

export const ARCHITECT_MODEL =
  process.env.TRIFIX_ARCHITECT_MODEL || AGENT_CONFIGS.architect.model;

export const AGENTS = {
  ...AGENT_CONFIGS,
  junior: {
    ...AGENT_CONFIGS.junior,
    endpoint: process.env.TRIFIX_JUNIOR_ENDPOINT || AI_ENDPOINT
  },
  supervisor: {
    ...AGENT_CONFIGS.supervisor,
    endpoint: process.env.TRIFIX_SUPERVISOR_ENDPOINT || AI_ENDPOINT
  },
  architect: {
    ...AGENT_CONFIGS.architect,
    model: ARCHITECT_MODEL,
    endpoint: process.env.TRIFIX_ARCHITECT_ENDPOINT || ARCHITECT_ENDPOINT
  }
};

export const BLOCKED_NAMES = new Set([
  "node_modules",
  ".git",
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
