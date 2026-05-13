const path = require("node:path");

const UI_QUALITY_SCHEMA_VERSION = 1;
const DEFAULT_UI_PRESET = "modern-saas-dashboard";

const UI_PRESETS = {
  "modern-saas-dashboard": {
    id: "modern-saas-dashboard",
    label: "Modern SaaS Dashboard",
    projectTypes: ["dashboard", "admin-panel"],
    visualGoal: "polished, modern, interactive, production-like UI",
    notes: [
      "clean cards",
      "spacious layout",
      "soft shadows",
      "professional blue/slate palette",
      "strong KPI sections",
      "useful filters/search"
    ]
  },
  "glassy-ai-control-room": {
    id: "glassy-ai-control-room",
    label: "Glassy AI Control Room",
    projectTypes: ["dashboard", "admin-panel"],
    visualGoal: "dark technical interface with restrained glassy surfaces and clear system status hierarchy",
    notes: [
      "dark background",
      "glass panels",
      "cyan/purple accents",
      "technical status cards",
      "animated but restrained feel"
    ]
  },
  "minimal-admin-panel": {
    id: "minimal-admin-panel",
    label: "Minimal Admin Panel",
    projectTypes: ["admin-panel", "form-app"],
    visualGoal: "practical, clear, high-contrast admin UI with restrained styling",
    notes: [
      "light theme",
      "high contrast",
      "clear table hierarchy",
      "restrained styling",
      "practical navigation"
    ]
  },
  "developer-console": {
    id: "developer-console",
    label: "Developer Console",
    projectTypes: ["dashboard", "admin-panel"],
    visualGoal: "dark console-like UI with compact information density and strong status affordances",
    notes: [
      "dark theme",
      "compact logs",
      "monospace output zones",
      "status badges",
      "terminal-like panels"
    ]
  },
  "warm-productivity-app": {
    id: "warm-productivity-app",
    label: "Warm Productivity App",
    projectTypes: ["form-app", "landing-page", "dashboard"],
    visualGoal: "friendly, calm, modern productivity UI with approachable interactions",
    notes: [
      "light theme",
      "soft rounded cards",
      "friendly colors",
      "approachable buttons",
      "calm spacing"
    ]
  }
};

const BASE_MUST_HAVE = [
  "clear visual hierarchy",
  "generous spacing",
  "responsive layout",
  "consistent component styling",
  "interactive states",
  "good empty/loading/error states where relevant",
  "accessible contrast",
  "realistic demo data",
  "cohesive color system"
];

const BASE_AVOID = [
  "plain tutorial layout",
  "cramped spacing",
  "unstyled buttons",
  "random colors",
  "default browser form styling",
  "flat unstructured lists",
  "walls of text",
  "misaligned cards",
  "generic AI dashboard slop"
];

const DASHBOARD_STANDARDS = {
  requiredSections: [
    "top navigation or header",
    "sidebar or navigation rail when useful",
    "KPI cards with meaningful labels",
    "data visualization area using CSS, SVG, or existing chart library if available",
    "search/filter controls",
    "recent activity or table section",
    "status badges",
    "action buttons"
  ],
  interactivity: [
    "search/filter",
    "theme toggle if useful",
    "tab or category switching",
    "hover/focus states",
    "clickable cards or actions"
  ]
};

function detectProjectType({ userPrompt = "", packageJson = null, rootPath = "" } = {}) {
  const text = `${userPrompt}\n${packageJson?.name || ""}\n${rootPath}`.toLowerCase();
  if (/landing|marketing|homepage|hero section/.test(text)) return "landing-page";
  if (/admin|backoffice|internal tool/.test(text)) return "admin-panel";
  if (/form|wizard|survey/.test(text)) return "form-app";
  if (/dashboard|analytics|kpi|metrics|reporting/.test(text)) return "dashboard";
  return "unknown";
}

function choosePresetForProject(projectType = "unknown", userPrompt = "") {
  const text = String(userPrompt || "").toLowerCase();
  if (/glassy|ai control|cyber|control room/.test(text)) return "glassy-ai-control-room";
  if (/developer console|terminal|log viewer/.test(text)) return "developer-console";
  if (/minimal admin|restrained admin/.test(text)) return "minimal-admin-panel";
  if (/warm|friendly|productivity/.test(text)) return "warm-productivity-app";
  if (projectType === "dashboard") return "modern-saas-dashboard";
  if (projectType === "admin-panel") return "minimal-admin-panel";
  return DEFAULT_UI_PRESET;
}

function buildUiQualityContract({ projectType = "unknown", preset = "", userPrompt = "" } = {}) {
  const normalizedType = projectType || detectProjectType({ userPrompt });
  const selectedPreset = UI_PRESETS[preset] ? preset : choosePresetForProject(normalizedType, userPrompt);
  return {
    schemaVersion: UI_QUALITY_SCHEMA_VERSION,
    projectType: normalizedType,
    qualityLevel: "portfolio-ready",
    visualGoal: UI_PRESETS[selectedPreset]?.visualGoal || "polished, modern, interactive, production-like UI",
    preset: selectedPreset,
    mustHave: [...BASE_MUST_HAVE],
    avoid: [...BASE_AVOID],
    dashboardStandards: {
      requiredSections: [...DASHBOARD_STANDARDS.requiredSections],
      interactivity: [...DASHBOARD_STANDARDS.interactivity]
    }
  };
}

function formatUiQualityMarkdown(contract = {}) {
  const preset = UI_PRESETS[contract.preset] || UI_PRESETS[DEFAULT_UI_PRESET];
  return [
    "# TriFix UI Quality Contract",
    "",
    `- Project type: ${contract.projectType || "unknown"}`,
    `- Quality level: ${contract.qualityLevel || "portfolio-ready"}`,
    `- Visual goal: ${contract.visualGoal || ""}`,
    `- Preset: ${preset.label}`,
    "",
    "## Must Have",
    ...(Array.isArray(contract.mustHave) ? contract.mustHave.map((item) => `- ${item}`) : []),
    "",
    "## Avoid",
    ...(Array.isArray(contract.avoid) ? contract.avoid.map((item) => `- ${item}`) : []),
    "",
    "## Dashboard Standards",
    ...(Array.isArray(contract.dashboardStandards?.requiredSections)
      ? contract.dashboardStandards.requiredSections.map((item) => `- Required section: ${item}`)
      : []),
    "",
    "## Interactivity Expectations",
    ...(Array.isArray(contract.dashboardStandards?.interactivity)
      ? contract.dashboardStandards.interactivity.map((item) => `- ${item}`)
      : []),
    "",
    "## Accessibility Expectations",
    "- Maintain accessible contrast.",
    "- Include focus states for interactive elements.",
    "- Avoid relying on color alone for status meaning.",
    "- Keep responsive hierarchy intact on smaller screens.",
    "",
    "## Preset Notes",
    ...(Array.isArray(preset.notes) ? preset.notes.map((item) => `- ${item}`) : [])
  ].join("\n");
}

function formatUiLibrariesMarkdown(registry = {}) {
  return [
    "# TriFix UI Library Memory",
    "",
    "## Recommended Defaults",
    "",
    "Dashboard:",
    "- shadcn/ui + Tailwind + lucide-react + Recharts + TanStack Table",
    "",
    "Enterprise data dashboard:",
    "- Ant Design + ECharts or Recharts",
    "",
    "Material-style app:",
    "- MUI",
    "",
    "Fast polished React app:",
    "- Mantine",
    "",
    "Small app:",
    "- Tailwind + custom components",
    "",
    "Single-file HTML:",
    "- plain CSS + CSS variables + inline SVG or CSS chart blocks",
    "",
    "## Rules",
    "- Do not mix component systems without reason.",
    "- Do not add heavy dependencies for tiny apps.",
    "- Prefer cohesive design over random libraries.",
    "- If dependencies fail to install, fallback to polished custom CSS.",
    "- Install only the libraries selected by the stack recommendation.",
    "- Preserve existing project constraints.",
    "",
    "## Registry",
    ...(Array.isArray(registry.libraries)
      ? registry.libraries.map((library) =>
          [
            `### ${library.name}`,
            `- Category: ${library.category}`,
            `- Best for: ${(library.bestFor || []).join(", ")}`,
            `- Strengths: ${(library.strengths || []).join(", ")}`,
            `- Tradeoffs: ${(library.tradeoffs || []).join(", ")}`,
            `- Guidance: ${library.agentGuidance || ""}`
          ].join("\n")
        )
      : [])
  ].join("\n");
}

function normalizeDependencies(packageJson = null) {
  return {
    ...(packageJson?.dependencies || {}),
    ...(packageJson?.devDependencies || {})
  };
}

function hasDependency(packageJson = null, name = "") {
  return Boolean(normalizeDependencies(packageJson)[name]);
}

function selectUiStackForProject({
  projectType = "unknown",
  userPrompt = "",
  uiQualityPreset = DEFAULT_UI_PRESET,
  allowedDependencies = true,
  existingPackageJson = null,
  projectConstraints = {}
} = {}) {
  const prompt = String(userPrompt || "").toLowerCase();
  const deps = normalizeDependencies(existingPackageJson);
  const warnings = [];
  const reasoning = [];
  const installPlan = [];

  const singleFile = Boolean(projectConstraints.singleFileHtml);
  const noTailwind = Boolean(projectConstraints.noTailwind);
  const prefersEnterprise = /enterprise|data-heavy|complex tables|back office/.test(prompt);
  const prefersMaterial = /material/.test(prompt);
  const prefersMantine = /mantine/.test(prompt);
  const prefersAntd = /ant design|antd/.test(prompt);
  const prefersMUI = /\bmui\b|material ui/.test(prompt);
  const prefersConsole = /terminal|developer console|log viewer/.test(prompt) || uiQualityPreset === "developer-console";
  const prefersSimple = /simple prototype|small prototype|tiny app/.test(prompt);

  const recommendedStack = {
    componentSystem: "custom-components",
    styling: "plain-css-with-design-tokens",
    icons: "lucide-react",
    charts: "css-or-svg",
    tables: "simple-custom-table",
    animation: "css-transitions-only",
    forms: "react-hook-form"
  };

  if (singleFile) {
    reasoning.push("Single-file HTML constraint detected.");
    recommendedStack.componentSystem = "none";
    recommendedStack.styling = "plain-css-with-design-tokens";
    recommendedStack.icons = "inline-svg";
    recommendedStack.charts = "css-or-svg";
    recommendedStack.tables = "simple-custom-table";
    recommendedStack.animation = "css-transitions-only";
    recommendedStack.forms = "native-forms";
  } else if (prefersEnterprise || prefersAntd || hasDependency(existingPackageJson, "antd")) {
    reasoning.push("Enterprise/data-heavy dashboard signals detected.");
    recommendedStack.componentSystem = "ant-design";
    recommendedStack.styling = "ant-design-tokens";
    recommendedStack.icons = hasDependency(existingPackageJson, "@ant-design/icons") ? "@ant-design/icons" : "lucide-react";
    recommendedStack.charts = hasDependency(existingPackageJson, "echarts") || hasDependency(existingPackageJson, "echarts-for-react") ? "echarts" : "recharts";
    recommendedStack.tables = hasDependency(existingPackageJson, "ag-grid-community") ? "ag-grid-community" : "tanstack-table";
    recommendedStack.animation = "css-transitions-only";
    recommendedStack.forms = "react-hook-form";
  } else if (prefersMaterial || prefersMUI || hasDependency(existingPackageJson, "@mui/material")) {
    reasoning.push("Material-style app preference detected.");
    recommendedStack.componentSystem = "mui";
    recommendedStack.styling = "mui-system";
    recommendedStack.icons = hasDependency(existingPackageJson, "@mui/icons-material") ? "@mui/icons-material" : "lucide-react";
    recommendedStack.charts = "recharts";
    recommendedStack.tables = "tanstack-table";
    recommendedStack.animation = "framer-motion";
    recommendedStack.forms = "react-hook-form";
  } else if (prefersMantine || hasDependency(existingPackageJson, "@mantine/core")) {
    reasoning.push("Mantine preference or existing Mantine dependency detected.");
    recommendedStack.componentSystem = "mantine";
    recommendedStack.styling = "mantine";
    recommendedStack.icons = "lucide-react";
    recommendedStack.charts = "recharts";
    recommendedStack.tables = "tanstack-table";
    recommendedStack.animation = "framer-motion";
    recommendedStack.forms = "react-hook-form";
  } else if (prefersConsole) {
    reasoning.push("Developer-console style request detected.");
    recommendedStack.componentSystem = "custom-components";
    recommendedStack.styling = noTailwind ? "plain-css-with-design-tokens" : "tailwindcss";
    recommendedStack.icons = "lucide-react";
    recommendedStack.charts = "css-or-svg";
    recommendedStack.tables = "simple-custom-table";
    recommendedStack.animation = "css-transitions-only";
    recommendedStack.forms = "react-hook-form";
  } else if (projectType === "dashboard" || projectType === "admin-panel") {
    reasoning.push("Dashboard/admin request detected.");
    reasoning.push(`UI preset selected: ${uiQualityPreset}.`);
    recommendedStack.componentSystem = noTailwind ? "mantine" : "shadcn-ui";
    recommendedStack.styling = noTailwind ? "mantine" : "tailwindcss";
    recommendedStack.icons = "lucide-react";
    recommendedStack.charts = "recharts";
    recommendedStack.tables = "tanstack-table";
    recommendedStack.animation = prefersSimple ? "css-transitions-only" : "framer-motion";
    recommendedStack.forms = "react-hook-form";
  } else {
    reasoning.push("Using lightweight polished frontend defaults.");
    recommendedStack.componentSystem = prefersSimple ? "custom-components" : "mantine";
    recommendedStack.styling = prefersSimple ? "plain-css-with-design-tokens" : "tailwindcss";
    recommendedStack.icons = "lucide-react";
    recommendedStack.charts = "css-or-svg";
    recommendedStack.tables = "simple-custom-table";
    recommendedStack.animation = "css-transitions-only";
    recommendedStack.forms = "react-hook-form";
  }

  if (hasDependency(existingPackageJson, "tailwindcss")) {
    reasoning.push("Tailwind already present.");
  }
  if (recommendedStack.componentSystem === "shadcn-ui") {
    reasoning.push("shadcn/ui pairs well with polished SaaS dashboards.");
  }
  if (!allowedDependencies) {
    warnings.push("Dependency installation is not currently allowed. Fall back to polished custom CSS if needed.");
  }

  const libraryToPackage = {
    "tailwindcss": "tailwindcss",
    "lucide-react": "lucide-react",
    "recharts": "recharts",
    "tanstack-table": "@tanstack/react-table",
    "framer-motion": "framer-motion",
    "react-hook-form": "react-hook-form",
    "zod": "zod",
    "ant-design": "antd",
    "mui": "@mui/material",
    "mantine": "@mantine/core"
  };

  const suggested = [
    recommendedStack.componentSystem,
    recommendedStack.styling,
    recommendedStack.icons,
    recommendedStack.charts,
    recommendedStack.tables,
    recommendedStack.animation,
    recommendedStack.forms
  ];
  for (const item of suggested) {
    const packageName = libraryToPackage[item];
    if (!packageName || deps[packageName]) {
      continue;
    }
    installPlan.push({
      library: item,
      command: `npm install ${packageName}`
    });
  }

  if (recommendedStack.componentSystem === "shadcn-ui" && !noTailwind) {
    installPlan.unshift({
      library: "shadcn-ui",
      command: "npx shadcn@latest init"
    });
    installPlan.splice(1, 0, {
      library: "shadcn-ui-components",
      command: "npx shadcn@latest add button card input table badge tabs dropdown-menu dialog"
    });
  }

  return {
    recommendedStack,
    reasoning,
    installPlan,
    warnings
  };
}

function buildDependencyPlan({ recommendation = null, existingPackageJson = null, requiresUserApproval = true } = {}) {
  const deps = normalizeDependencies(existingPackageJson);
  const selectedStack = recommendation?.recommendedStack || {};
  const requiredInstalls = [];
  const optionalInstalls = [];
  const alreadyInstalled = [];

  for (const item of recommendation?.installPlan || []) {
    const packageName = String(item.command || "").replace(/^npm install\s+/, "").trim();
    if (packageName && deps[packageName]) {
      alreadyInstalled.push(item.library);
    } else {
      requiredInstalls.push(item);
    }
  }

  if (selectedStack.animation === "framer-motion" && !deps["framer-motion"]) {
    optionalInstalls.push({ library: "framer-motion", command: "npm install framer-motion" });
  }
  if (selectedStack.forms === "react-hook-form" && !deps["react-hook-form"]) {
    optionalInstalls.push({ library: "react-hook-form", command: "npm install react-hook-form" });
  }

  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    selectedStack,
    requiredInstalls,
    optionalInstalls,
    alreadyInstalled,
    warnings: recommendation?.warnings || [],
    requiresUserApproval: Boolean(requiresUserApproval)
  };
}

function summarizeUiQualityForPrompt({ contract = null, stackRecommendation = null, dependencyPlan = null } = {}) {
  if (!contract && !stackRecommendation && !dependencyPlan) {
    return "";
  }
  const lines = [];
  if (contract) {
    lines.push(`UI_QUALITY_LEVEL: ${contract.qualityLevel || "portfolio-ready"}`);
    lines.push(`UI_VISUAL_GOAL: ${contract.visualGoal || ""}`);
    lines.push(`UI_PRESET: ${contract.preset || DEFAULT_UI_PRESET}`);
    lines.push(`UI_PROJECT_TYPE: ${contract.projectType || "unknown"}`);
    lines.push(`UI_MUST_HAVE: ${(contract.mustHave || []).slice(0, 6).join("; ")}`);
    lines.push(`UI_AVOID: ${(contract.avoid || []).slice(0, 6).join("; ")}`);
  }
  if (stackRecommendation?.recommendedStack) {
    lines.push(`UI_STACK: ${JSON.stringify(stackRecommendation.recommendedStack)}`);
    lines.push(`UI_STACK_REASONING: ${(stackRecommendation.reasoning || []).slice(0, 4).join(" | ")}`);
  }
  if (dependencyPlan) {
    lines.push(`UI_DEPENDENCY_PLAN_REQUIRES_APPROVAL: ${dependencyPlan.requiresUserApproval ? "yes" : "no"}`);
    if (Array.isArray(dependencyPlan.requiredInstalls) && dependencyPlan.requiredInstalls.length > 0) {
      lines.push(`UI_INSTALL_COMMANDS: ${dependencyPlan.requiredInstalls.map((item) => item.command).join(" | ")}`);
    }
    if (Array.isArray(dependencyPlan.warnings) && dependencyPlan.warnings.length > 0) {
      lines.push(`UI_DEPENDENCY_WARNINGS: ${dependencyPlan.warnings.join(" | ")}`);
    }
  }
  return lines.join("\n");
}

function buildDeterministicDesignReview({ domAudit = null, contract = null, dependencyPlan = null } = {}) {
  const review = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    reviewMode: "deterministic",
    scores: {
      layout: null,
      spacing: null,
      hierarchy: null,
      typography: null,
      color: null,
      accessibility: null,
      interactivity: null,
      polish: null
    },
    issues: [],
    recommendation: "manual_review",
    screenshotPath: String(domAudit?.desktopScreenshotPath || ""),
    notes: "",
    needsHumanVisualReview: true
  };

  if (!domAudit?.desktopScreenshotPath) {
    review.issues.push("Screenshot missing.");
    review.notes = "Deterministic review could not confirm visual quality because the screenshot is missing.";
    review.recommendation = "manual_review";
    return review;
  }

  if (!domAudit?.pageLoaded || Number(domAudit?.httpStatus || 0) < 200 || Number(domAudit?.httpStatus || 0) >= 300) {
    review.issues.push("Page failed to load cleanly.");
    review.recommendation = "needs_patch";
  }
  if ((domAudit?.consoleErrors || []).length > 0 || (domAudit?.pageErrors || []).length > 0) {
    review.issues.push("Console or page errors were detected.");
    review.recommendation = "needs_patch";
  }
  if (Number(domAudit?.bodyTextLength || 0) < 80) {
    review.issues.push("Body text is too sparse for a polished application.");
    review.recommendation = "needs_patch";
  }
  if (contract?.projectType === "dashboard") {
    if (Number(domAudit?.buttonCount || 0) < 3) review.issues.push("Too few buttons for a dashboard.");
    if (Number(domAudit?.cardLikeCount || 0) < 3) review.issues.push("Too few card-like sections for a dashboard.");
    if (Number(domAudit?.headingCount || 0) < 2) review.issues.push("Too few headings for a dashboard.");
    if (!domAudit?.hasSearchOrFilter) review.issues.push("Search or filter controls were not detected.");
    if (!domAudit?.hasTableLikeSection && Number(domAudit?.cardLikeCount || 0) < 4) review.issues.push("Table or structured activity section was not detected.");
    if (review.issues.length > 0) {
      review.recommendation = "needs_patch";
    }
  }

  const selectedStack = dependencyPlan?.selectedStack || {};
  if (contract?.projectType === "dashboard" && selectedStack.componentSystem === "none") {
    review.issues.push("Selected UI stack is too weak for the dashboard contract.");
    review.recommendation = "manual_review";
  }

  if (review.issues.length === 0) {
    review.recommendation = "pass_candidate";
    review.notes = "DOM structure and deterministic QA signals meet the MVP threshold. Human visual review is still recommended.";
  } else if (!review.notes) {
    review.notes = "Deterministic review found structure or runtime issues that should be patched before claiming UI polish.";
  }

  return review;
}

module.exports = {
  UI_PRESETS,
  DEFAULT_UI_PRESET,
  detectProjectType,
  choosePresetForProject,
  buildUiQualityContract,
  formatUiQualityMarkdown,
  formatUiLibrariesMarkdown,
  selectUiStackForProject,
  buildDependencyPlan,
  summarizeUiQualityForPrompt,
  buildDeterministicDesignReview
};
