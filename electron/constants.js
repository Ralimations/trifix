export const AI_ENDPOINT =
  process.env.TRIFIX_AI_ENDPOINT || "http://10.8.0.3:3011/api/v1/chat";

export const AGENTS = {
  junior: {
    id: "junior",
    name: "Junior Explainer",
    role: "Simple explanation",
    model: "google/gemma-4-e2b",
    color: "blue"
  },
  senior: {
    id: "senior",
    name: "Senior Critic",
    role: "Bugs, risks, bad practices",
    model: "gemma-4-e4b-uncensored-hauhaucs-aggressive",
    color: "red"
  },
  lead: {
    id: "lead",
    name: "Lead Architect",
    role: "Fix and recommendation",
    model: "google/gemma-4-e4b",
    color: "green"
  }
};

export const BLOCKED_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build"
]);

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
