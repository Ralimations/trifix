import { randomUUID } from "node:crypto";
import {
  AGENTS,
  AI_ENDPOINT,
  MAX_CONTEXT_CHARS_PER_FILE,
  MAX_CONTEXT_CHARS_TOTAL,
  SANDBOX_FOLDER_NAME
} from "../constants.js";

const REQUEST_TIMEOUT_MS = 45000;
const SPEAKING_DELAY_MS = 800;
let lastResult = null;

export function getLastResult() {
  return lastResult;
}

export async function runPipeline(payload, emitProgress = () => {}) {
  const input = String(payload?.input || "").trim();
  const language = String(payload?.language || "auto");
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const contextDocuments = Array.isArray(payload?.contextDocuments) ? payload.contextDocuments : [];
  const projectFsd = payload?.fsd || null;
  const feedback = String(payload?.feedback || "").trim();
  const loopCount = Number(payload?.loopCount || 0);
  const runId = payload?.runId || randomUUID();

  if (!input && files.length === 0 && contextDocuments.length === 0) {
    throw new Error("Add an instruction, upload context, or select at least one project file.");
  }

  const filesAnalyzed = files.map((file) => ({
    path: file.path,
    size: file.size,
    extension: file.extension
  }));
  const compactContext = buildCompactContext({ input, files, language, feedback, contextDocuments, projectFsd });
  const revisionBrief = feedback
    ? await createRevisionBrief({
        compactContext,
        feedback,
        loopCount
      })
    : "";

  emitProgress({ runId, agent: "architect", stage: "pm-plan", status: "thinking" });
  const pmPlan = await callAgent({
    agent: AGENTS.architect,
    systemPrompt: buildSystemPrompt(AGENTS.architect),
    input: buildPmPlanningContext({ compactContext, feedback, revisionBrief, loopCount })
  });
  const prd = buildPrd(pmPlan, contextDocuments, input);
  const projectPlan = buildProjectPlan(prd);
  emitProgress({
    runId,
    agent: "architect",
    stage: "pm-plan",
    status: "speaking",
    partialResult: {
      architect: buildPmResult(pmPlan, "PM created the PRD and phase direction."),
      project: {
        fsd: buildFsdState(projectFsd, contextDocuments),
        prd,
        phases: projectPlan.phases,
        tasks: projectPlan.tasks
      },
      workflow: buildV2Workflow({ loopCount, currentStage: "pm-plan", projectPlan })
    }
  });
  await delay(SPEAKING_DELAY_MS);
  emitProgress({
    runId,
    agent: "architect",
    stage: "pm-plan",
    status: "done",
    partialResult: {
      architect: buildPmResult(pmPlan, "PM created the PRD and phase direction."),
      project: {
        fsd: buildFsdState(projectFsd, contextDocuments),
        prd,
        phases: projectPlan.phases,
        tasks: projectPlan.tasks
      },
      workflow: buildV2Workflow({ loopCount, currentStage: "qa-scope", projectPlan })
    }
  });

  emitProgress({ runId, agent: "supervisor", stage: "qa-scope", status: "thinking" });
  const qaInstructions = await callAgent({
    agent: AGENTS.supervisor,
    systemPrompt: buildSystemPrompt(AGENTS.supervisor),
    input: buildQaInstructionContext({ compactContext, prd, pmPlan, feedback, revisionBrief, loopCount })
  });
  const qaInstructionResult = buildSupervisorResult(qaInstructions);
  emitProgress({
    runId,
    agent: "supervisor",
    stage: "qa-scope",
    status: "speaking",
    partialResult: {
      supervisor: qaInstructionResult,
      critique: qaInstructions.trim(),
      workflow: buildV2Workflow({ loopCount, currentStage: "qa-scope", projectPlan })
    }
  });
  await delay(SPEAKING_DELAY_MS);
  emitProgress({
    runId,
    agent: "supervisor",
    stage: "qa-scope",
    status: "done",
    partialResult: {
      supervisor: qaInstructionResult,
      critique: qaInstructions.trim(),
      workflow: buildV2Workflow({ loopCount, currentStage: "dev-implementation", projectPlan })
    }
  });

  emitProgress({ runId, agent: "junior", stage: "dev-implementation", status: "coding" });
  const devOutput = await callAgent({
    agent: AGENTS.junior,
    systemPrompt: buildSystemPrompt(AGENTS.junior),
    input: buildDevImplementationContext({ compactContext, prd, pmPlan, qaInstructions, language, feedback, revisionBrief, loopCount })
  });
  const devLeadResult = parseLeadOutput(devOutput, filesAnalyzed);
  const devResult = buildJuniorResult(devOutput);
  emitProgress({
    runId,
    agent: "junior",
    stage: "dev-implementation",
    status: "speaking",
    partialResult: {
      junior: devResult,
      explanation: devOutput.trim(),
      architect: {
        affectedFiles: devLeadResult.affectedFiles,
        patches: devLeadResult.patches,
        fixedCode: devLeadResult.fixedCode,
        proposedChanges: devLeadResult.proposedChanges
      },
      workflow: buildV2Workflow({ loopCount, currentStage: "dev-implementation", projectPlan })
    }
  });
  await delay(SPEAKING_DELAY_MS);
  emitProgress({
    runId,
    agent: "junior",
    stage: "dev-implementation",
    status: "done",
    partialResult: {
      junior: devResult,
      explanation: devOutput.trim(),
      architect: {
        affectedFiles: devLeadResult.affectedFiles,
        patches: devLeadResult.patches,
        fixedCode: devLeadResult.fixedCode,
        proposedChanges: devLeadResult.proposedChanges
      },
      workflow: buildV2Workflow({ loopCount, currentStage: "qa-review", projectPlan })
    }
  });

  emitProgress({ runId, agent: "supervisor", stage: "qa-review", status: "testing" });
  const qaReview = await callAgent({
    agent: AGENTS.supervisor,
    systemPrompt: buildSystemPrompt(AGENTS.supervisor),
    input: buildQaReviewContext({ compactContext, prd, pmPlan, qaInstructions, devOutput, devLeadResult, feedback, revisionBrief, loopCount })
  });
  const qaReviewResult = buildSupervisorResult(qaReview);
  emitProgress({
    runId,
    agent: "supervisor",
    stage: "qa-review",
    status: "speaking",
    partialResult: {
      supervisor: qaReviewResult,
      critique: qaReview.trim(),
      workflow: buildV2Workflow({ loopCount, currentStage: "qa-review", projectPlan })
    }
  });
  await delay(SPEAKING_DELAY_MS);
  emitProgress({
    runId,
    agent: "supervisor",
    stage: "qa-review",
    status: "done",
    partialResult: {
      supervisor: qaReviewResult,
      critique: qaReview.trim(),
      workflow: buildV2Workflow({ loopCount, currentStage: "pm-decision", projectPlan })
    }
  });

  emitProgress({ runId, agent: "architect", stage: "pm-decision", status: "thinking" });
  const pmDecision = await callAgent({
    agent: AGENTS.architect,
    systemPrompt: buildSystemPrompt(AGENTS.architect),
    input: buildPmDecisionContext({ compactContext, prd, pmPlan, qaInstructions, devOutput, qaReview, devLeadResult, language, feedback, revisionBrief, loopCount })
  });
  const pmDecisionResult = buildPmResult(pmDecision, devLeadResult.summary);
  const pipelineResult = buildPipelineResult({
    explanation: devOutput,
    critique: qaReview,
    files,
    filesAnalyzed,
    leadResult: {
      ...devLeadResult,
      summary: pmDecisionResult.summary || devLeadResult.summary,
      rationale: pmDecisionResult.rationale || qaReview,
      recommendation: pmDecisionResult.recommendation || pmDecision
    },
    loopCount,
    project: {
      fsd: buildFsdState(projectFsd, contextDocuments),
      prd,
      phases: projectPlan.phases,
      tasks: projectPlan.tasks
    },
    qaInstructions,
    pmPlan,
    pmDecision
  });
  emitProgress({ runId, agent: "architect", stage: "pm-decision", status: "speaking", partialResult: pipelineResult });
  await delay(SPEAKING_DELAY_MS);
  emitProgress({ runId, agent: "architect", stage: "pm-decision", status: "done", partialResult: pipelineResult });

  lastResult = pipelineResult;

  return lastResult;
}

async function callAgent({ agent, systemPrompt, input }) {
  const controller = new AbortController();
  const requestTimeoutMs = agent.timeoutMs || REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const endpoint = agent.endpoint || AI_ENDPOINT;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json"
  };

  if (endpoint.includes("ngrok-free.dev")) {
    headers["ngrok-skip-browser-warning"] = "true";
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: agent.model,
        system_prompt: systemPrompt,
        input
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(formatAgentHttpError({ agent, endpoint, status: response.status, body }));
    }

    const text = await response.text();
    const parsed = parseChatResponse(text);

    if (!parsed.trim()) {
      throw new Error(`${agent.name} returned an empty response.`);
    }

    return parsed;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${agent.name} timed out after ${Math.round(requestTimeoutMs / 1000)} seconds.`);
    }

    if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(error?.message || "")) {
      throw new Error(
        `${agent.name} could not reach ${endpoint}. Confirm the endpoint is online${endpoint.includes("10.8.0.3") ? " and the VPN is connected" : ""}.`
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildCompactContext({ input, files, language, feedback, contextDocuments = [], projectFsd = null }) {
  const chunks = [
    `LANGUAGE: ${language}`,
    [
      "SANDBOX_WORKSPACE:",
      `The AIs may create new files and folders only under "${SANDBOX_FOLDER_NAME}/".`,
      `For new projects, target paths like "${SANDBOX_FOLDER_NAME}/project-name/src/index.js".`,
      "Outside that sandbox, patches must target existing project files."
    ].join("\n")
  ];

  if (input) {
    chunks.push(`USER_INPUT:\n${trimForPrompt(input, 9000)}`);
  }

  if (files.length > 0) {
    chunks.push(
      `FILES_SELECTED:\n${files
        .map((file) => `- ${file.path} (${Math.round(file.size / 1024)} KB)`)
        .join("\n")}`
    );
  }

  if (feedback) {
    chunks.push(`DECISION_FEEDBACK:\n${trimForPrompt(feedback, 1500)}`);
  }

  const documentSummary = buildDocumentContextSummary(contextDocuments, projectFsd);
  if (documentSummary) {
    chunks.push(`PROJECT_CONTEXT_SUMMARY:\n${documentSummary}`);
  }

  let remaining = MAX_CONTEXT_CHARS_TOTAL - chunks.join("\n\n").length;

  for (const file of files) {
    if (remaining <= 500) {
      break;
    }

    const summary = summarizeFile(file);
    const budget = Math.min(MAX_CONTEXT_CHARS_PER_FILE, remaining);
    const chunk = trimForPrompt(
      `FILE: ${file.path}\nSUMMARY:\n${summary}\nSNIPPET:\n${file.content}`,
      budget
    );

    chunks.push(chunk);
    remaining -= chunk.length;
  }

  return chunks.join("\n\n");
}

function buildDocumentContextSummary(contextDocuments = [], projectFsd = null) {
  const docs = Array.isArray(contextDocuments) ? contextDocuments : [];
  const chunks = [];

  if (projectFsd?.summary) {
    chunks.push(`Existing FSD summary:\n${trimForPrompt(projectFsd.summary, 2600)}`);
  }

  for (const doc of docs.slice(0, 8)) {
    chunks.push(
      [
        `Document: ${doc.name || "context"} (${doc.type || doc.extension || "unknown"})`,
        `Summary: ${trimForPrompt(doc.summary || "", 1200)}`,
        doc.excerpt ? `Excerpt: ${trimForPrompt(doc.excerpt, 1600)}` : ""
      ].filter(Boolean).join("\n")
    );
  }

  return trimForPrompt(chunks.join("\n\n"), 7000);
}

function summarizeFile(file) {
  const lines = String(file.content || "").split(/\r?\n/);
  const imports = [];
  const declarations = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (
      imports.length < 12 &&
      /^(import|export\s+.*from|const\s+\w+\s*=\s*require|#include|using\s+|from\s+\S+\s+import|require\()/.test(
        trimmed
      )
    ) {
      imports.push(trimmed);
      continue;
    }

    if (
      declarations.length < 24 &&
      /^(export\s+)?(async\s+)?function\s+\w+|^(export\s+)?class\s+\w+|^(const|let|var)\s+\w+\s*=\s*(async\s*)?\(|^def\s+\w+|^class\s+\w+|^[\w:<>~]+\s+\w+\s*\([^)]*\)\s*\{?/.test(
        trimmed
      )
    ) {
      declarations.push(trimmed);
    }
  }

  const summaryParts = [
    `Path: ${file.path}`,
    `Size: ${file.size} bytes`,
    imports.length ? `Imports/includes:\n${imports.join("\n")}` : "",
    declarations.length ? `Key declarations:\n${declarations.join("\n")}` : ""
  ].filter(Boolean);

  return summaryParts.join("\n");
}

function parseChatResponse(responseText) {
  try {
    const json = JSON.parse(responseText);
    return readChatText(json) || responseText;
  } catch {
    return responseText;
  }
}

function readChatText(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const publicItems = value.filter((item) => !isReasoningItem(item));
    const items = publicItems.length > 0 ? publicItems : value;

    return items.map(readChatText).filter(Boolean).join("\n").trim();
  }

  if (typeof value !== "object") {
    return "";
  }

  if (isReasoningItem(value)) {
    return "";
  }

  for (const key of ["output", "result", "text", "response"]) {
    const text = readChatText(value[key]);
    if (text) {
      return text;
    }
  }

  const messageContent = readChatText(value.message?.content);
  if (messageContent) {
    return messageContent;
  }

  const choiceContent = readChatText(value.choices?.[0]?.message?.content || value.choices?.[0]?.text);
  if (choiceContent) {
    return choiceContent;
  }

  return readChatText(value.content);
}

function isReasoningItem(value) {
  return typeof value === "object" && value !== null && /^(reasoning|analysis)$/i.test(String(value.type || ""));
}

function formatAgentHttpError({ agent, endpoint, status, body }) {
  const trimmedBody = String(body || "").trim();
  const serverError = parseServerError(trimmedBody);
  const serverMessage = serverError?.message || "";
  const serverCode = serverError?.code || "";
  const agentEnvPrefix = `TRIFIX_${String(agent.id || agent.name || "AGENT").toUpperCase()}`;

  if (/model_not_found|invalid model/i.test(`${serverCode} ${serverMessage}`)) {
    return [
      `${agent.name} model "${agent.model}" is not available at ${endpoint}.`,
      serverMessage,
      `Set ${agentEnvPrefix}_MODEL to a downloaded model or update shared/agentConfig.js.`
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (status === 404 && /^<!doctype html|^<html/i.test(trimmedBody)) {
    return [
      `${agent.name} endpoint ${endpoint} returned an HTML 404 page.`,
      `Set ${agentEnvPrefix}_ENDPOINT to the full chat API URL, usually ending in /api/v1/chat.`
    ].join(" ");
  }

  return `${agent.name} request failed with HTTP ${status}${
    trimmedBody ? `: ${trimmedBody.slice(0, 300)}` : ""
  }`;
}

function parseServerError(body) {
  try {
    const parsed = JSON.parse(body);
    const error = parsed.error || parsed;

    return {
      code: error.code || parsed.code || "",
      message: error.message || parsed.message || ""
    };
  } catch {
    return null;
  }
}

function parseLeadOutput(output, filesAnalyzed = []) {
  const summary = extractSection(output, "SUMMARY");
  const rationale = extractSection(output, "RATIONALE");
  const proposedChanges = extractListSection(output, "PROPOSED_CHANGES");
  const recommendation = extractSection(output, "RECOMMENDATION");
  const affectedFiles = extractListSection(output, "AFFECTED_FILES");
  const commandRequests = extractListSection(output, "COMMAND_REQUESTS");
  const patches = extractPatches(output);
  const fallbackCodeFence = output.match(/```[\w+-]*\n([\s\S]*?)```/);

  let normalizedPatches = patches;
  if (normalizedPatches.length === 0 && filesAnalyzed.length === 1 && fallbackCodeFence?.[1]) {
    normalizedPatches = [
      {
        path: filesAnalyzed[0].path,
        content: cleanCode(fallbackCodeFence[1])
      }
    ];
  }

  const normalizedAffectedFiles =
    affectedFiles.length > 0
      ? affectedFiles
      : normalizedPatches.map((patch) => patch.path).filter(Boolean);

  return {
    summary: summary || "DEV completed an implementation pass.",
    rationale: rationale || "Reviewed the project context, likely failure points, and the recommended fix.",
    proposedChanges:
      proposedChanges.length > 0
        ? proposedChanges
        : normalizedPatches.map((patch) => `Update ${patch.path} with the DEV implementation.`),
    affectedFiles: normalizedAffectedFiles,
    commandRequests,
    patches: normalizedPatches,
    fixedCode: normalizedPatches[0]?.content || cleanCode(fallbackCodeFence?.[1] || output),
    recommendation: recommendation || output.trim()
  };
}

function buildPrd(pmPlan, contextDocuments = [], input = "") {
  const goals = extractListSection(pmPlan, "PRD_GOALS");
  const features = extractListSection(pmPlan, "FEATURES");
  const constraints = extractListSection(pmPlan, "CONSTRAINTS");
  const phases = extractListSection(pmPlan, "PHASES");
  const tasks = extractListSection(pmPlan, "TASKS");

  return {
    summary: extractSection(pmPlan, "QA_INSTRUCTION") || summarizePlan(pmPlan, input),
    goals: goals.length ? goals : ["Deliver the requested software change within the selected project context."],
    features: features.length ? features : ["Implement the user-requested functionality."],
    constraints: constraints.length ? constraints : [`Keep new files under "${SANDBOX_FOLDER_NAME}/" unless updating selected existing files.`],
    phases: phases.length ? phases : ["Phase 1: Setup", "Phase 2: Core Features", "Phase 3: Testing"],
    tasks: tasks.length ? tasks : ["[Phase 1] Confirm scope", "[Phase 2] Implement feature", "[Phase 3] Run checks"],
    sourceDocuments: (contextDocuments || []).map((doc) => ({
      name: doc.name,
      type: doc.type,
      summary: doc.summary
    })),
    generatedAt: new Date().toISOString(),
    raw: trimForPrompt(pmPlan, 5000)
  };
}

function buildProjectPlan(prd) {
  const phases = (prd.phases || []).map((phase, index) => ({
    id: `phase-${index + 1}`,
    name: normalizePhaseName(phase, index),
    status: index === 0 ? "in_progress" : "not_started"
  }));
  const tasks = (prd.tasks || []).map((task, index) => ({
    id: `task-${index + 1}`,
    title: task.replace(/^\[[^\]]+\]\s*/, "").trim() || `Task ${index + 1}`,
    phase: extractTaskPhase(task, phases, index),
    status: index === 0 ? "in_progress" : "not_started"
  }));

  return { phases, tasks };
}

function buildPmResult(output, fallbackSummary) {
  return {
    summary: extractSection(output, "SUMMARY") || extractSection(output, "QA_INSTRUCTION") || fallbackSummary,
    rationale: extractSection(output, "RATIONALE") || toPublicRationale(output),
    affectedFiles: extractListSection(output, "AFFECTED_FILES"),
    proposedChanges: extractListSection(output, "PROPOSED_CHANGES"),
    patches: [],
    recommendation: extractSection(output, "RECOMMENDATION") || output.trim(),
    fixedCode: ""
  };
}

function buildFsdState(projectFsd, contextDocuments) {
  return {
    ...(projectFsd || {}),
    documents: contextDocuments || projectFsd?.documents || [],
    summary: buildDocumentContextSummary(contextDocuments || projectFsd?.documents || [], projectFsd)
  };
}

function buildV2Workflow({ loopCount, currentStage, projectPlan }) {
  return {
    folderLoaded: true,
    contextReady: true,
    currentStage,
    loopCount,
    decisionStatus: "pending",
    currentPhase: projectPlan?.phases?.find((phase) => phase.status === "in_progress")?.name || "Phase 1",
    currentTask: projectPlan?.tasks?.find((task) => task.status === "in_progress")?.title || "Plan current work",
    iterationCount: loopCount,
    projectStatus: "In progress",
    commandStatus: "idle"
  };
}

function buildJuniorResult(explanation) {
  return {
    rationale: toPublicRationale(explanation),
    recommendation: toShortRecommendation(explanation)
  };
}

function buildSupervisorResult(critique) {
  return {
    critique: toPublicRationale(critique),
    suggestedChanges: toShortRecommendation(critique)
  };
}

function buildPipelineResult({ explanation, critique, files, filesAnalyzed, leadResult, loopCount, project, qaInstructions, pmPlan, pmDecision }) {
  return {
    junior: buildJuniorResult(explanation),
    supervisor: buildSupervisorResult(critique),
    architect: {
      summary: leadResult.summary,
      rationale: leadResult.rationale,
      affectedFiles: leadResult.affectedFiles,
      proposedChanges: leadResult.proposedChanges,
      patches: leadResult.patches,
      recommendation: leadResult.recommendation,
      fixedCode: leadResult.fixedCode
    },
    decision: {
      summary: leadResult.summary,
      affectedFiles: leadResult.affectedFiles,
      proposedChanges: leadResult.proposedChanges,
      canApply: leadResult.patches.length > 0,
      decisionStatus: "pending"
    },
    workflow: {
      folderLoaded: true,
      contextReady: files.length > 0 || Boolean(project?.fsd),
      currentStage: "decision",
      loopCount,
      decisionStatus: "pending",
      currentPhase: project?.phases?.[0]?.name || "Phase 1",
      currentTask: project?.tasks?.find((task) => task.status !== "done")?.title || "Review decision",
      iterationCount: loopCount,
      projectStatus: "Waiting for decision",
      commandStatus: "idle"
    },
    project,
    pm: {
      plan: pmPlan,
      decision: pmDecision
    },
    qa: {
      instructions: qaInstructions,
      review: critique.trim()
    },
    dev: {
      implementation: explanation.trim(),
      commandRequests: leadResult.commandRequests || []
    },
    filesAnalyzed,
    explanation: explanation.trim(),
    critique: critique.trim(),
    fixedCode: leadResult.fixedCode,
    recommendation: leadResult.recommendation
  };
}

function buildSystemPrompt(agent) {
  const parts = [agent.prompts?.system, agent.prompts?.output];

  if (agent.speech?.prefix) {
    parts.push(`Speaking habit: may start with "${agent.speech.prefix}" when speaking naturally.`);
  }

  if (agent.speech?.habit) {
    parts.push(`Style note: ${agent.speech.habit}`);
  }

  return parts.filter(Boolean).join(" ");
}

async function createRevisionBrief({ compactContext, feedback, loopCount }) {
  const output = await callAgent({
    agent: AGENTS.architect,
    systemPrompt:
      "Rewrite the user's denial feedback into a concise revised instruction for the DEV and QA loop. Public instruction only. Maximum four lines.",
    input: [
      trimForPrompt(compactContext, 4000),
      `DENIAL_FEEDBACK_LOOP_${loopCount}:\n${trimForPrompt(feedback, 1200)}`
    ].join("\n\n")
  });

  return trimForPrompt(output, 800);
}

function buildPmPlanningContext({ compactContext, feedback, revisionBrief, loopCount }) {
  return [
    trimForPrompt(compactContext, 14000),
    feedback
      ? `Previous result was denied in loop ${loopCount}. Address this feedback in the plan:\n${trimForPrompt(feedback, 1200)}`
      : "",
    revisionBrief ? `REVISION_BRIEF:\n${trimForPrompt(revisionBrief, 800)}` : "",
    [
      "Create a concise PRD from the provided FSD/docs/request.",
      "Do not output raw code.",
      "Output public content only using these sections:",
      "PRD_GOALS:",
      "- goal",
      "FEATURES:",
      "- feature",
      "CONSTRAINTS:",
      "- constraint",
      "PHASES:",
      "- Phase 1: name",
      "TASKS:",
      "- [Phase 1] task",
      "QA_INSTRUCTION:",
      "one concise instruction for QA"
    ].join("\n")
  ].filter(Boolean).join("\n\n");
}

function buildQaInstructionContext({ compactContext, prd, pmPlan, feedback, revisionBrief, loopCount }) {
  return [
    trimForPrompt(compactContext, 9000),
    `PM_PRD:\n${formatPrdForPrompt(prd)}`,
    `PM_PLAN:\n${trimForPrompt(pmPlan, 3000)}`,
    feedback ? `DENIAL_FEEDBACK_LOOP_${loopCount}:\n${trimForPrompt(feedback, 1200)}` : "",
    revisionBrief ? `REVISION_BRIEF:\n${trimForPrompt(revisionBrief, 800)}` : "",
    [
      "Convert PM scope into actionable DEV steps.",
      "Keep the DEV inside the current phase and sandbox rules.",
      "Output public content only using:",
      "DEV_STEPS:",
      "- step",
      "ACCEPTANCE_CHECKS:",
      "- check",
      "RISKS:",
      "- risk",
      "MESSAGE_TO_DEV:"
    ].join("\n")
  ].filter(Boolean).join("\n\n");
}

function buildDevImplementationContext({ compactContext, prd, pmPlan, qaInstructions, language, feedback, revisionBrief, loopCount }) {
  return [
    trimForPrompt(compactContext, 7000),
    `PRD:\n${formatPrdForPrompt(prd, { compact: true })}`,
    `PM_DIRECTION:\n${trimForPrompt(pmPlan, 1400)}`,
    `QA_DEV_STEPS:\n${trimForPrompt(qaInstructions, 1800)}`,
    `Preferred language: ${language}`,
    feedback ? `DENIAL_FEEDBACK_LOOP_${loopCount}:\n${trimForPrompt(feedback, 1200)}` : "",
    revisionBrief ? `REVISION_BRIEF:\n${trimForPrompt(revisionBrief, 800)}` : "",
    [
      "Implement only the current task scope.",
      `New files, folders, or full projects must be placed under "${SANDBOX_FOLDER_NAME}/".`,
      "If a command is needed, request one safe command in COMMAND_REQUESTS; do not invent command output.",
      "Output public content only using exactly these sections when possible:",
      "SUMMARY:",
      "RATIONALE:",
      "AFFECTED_FILES:",
      "- relative/path",
      "PROPOSED_CHANGES:",
      "- concise change",
      "COMMAND_REQUESTS:",
      "- npm run build",
      "PATCHES:",
      "FILE: relative/path",
      "```language",
      "full replacement content",
      "```",
      "RECOMMENDATION:"
    ].join("\n")
  ].filter(Boolean).join("\n\n");
}

function buildQaReviewContext({ compactContext, prd, pmPlan, qaInstructions, devOutput, devLeadResult, feedback, revisionBrief, loopCount }) {
  return [
    trimForPrompt(compactContext, 9000),
    `PRD:\n${formatPrdForPrompt(prd, { compact: true })}`,
    `PM_DIRECTION:\n${trimForPrompt(pmPlan, 1600)}`,
    `QA_ORIGINAL_INSTRUCTIONS:\n${trimForPrompt(qaInstructions, 2200)}`,
    `DEV_OUTPUT:\n${trimForPrompt(devOutput, 4200)}`,
    `DEV_AFFECTED_FILES:\n${(devLeadResult.affectedFiles || []).join("\n")}`,
    feedback ? `DENIAL_FEEDBACK_LOOP_${loopCount}:\n${trimForPrompt(feedback, 1200)}` : "",
    revisionBrief ? `REVISION_BRIEF:\n${trimForPrompt(revisionBrief, 800)}` : "",
    [
      "Review DEV output against the PRD and current phase.",
      "Do not output raw code unless quoting a tiny issue snippet.",
      "Output public content only using:",
      "QA_RESULT: pass|needs_changes",
      "BUGS:",
      "- bug",
      "ALIGNMENT:",
      "- note",
      "TESTS:",
      "- test",
      "REPORT_TO_PM:"
    ].join("\n")
  ].filter(Boolean).join("\n\n");
}

function buildPmDecisionContext({ compactContext, prd, pmPlan, qaInstructions, devOutput, qaReview, devLeadResult, language, feedback, revisionBrief, loopCount }) {
  return [
    trimForPrompt(compactContext, 8000),
    `PRD:\n${formatPrdForPrompt(prd, { compact: true })}`,
    `PM_INITIAL_PLAN:\n${trimForPrompt(pmPlan, 2200)}`,
    `QA_INSTRUCTIONS:\n${trimForPrompt(qaInstructions, 1800)}`,
    `DEV_IMPLEMENTATION:\n${trimForPrompt(devOutput, 3000)}`,
    `QA_REVIEW:\n${trimForPrompt(qaReview, 2800)}`,
    `DEV_PATCH_PATHS:\n${(devLeadResult.affectedFiles || []).join("\n")}`,
    `Preferred language: ${language}`,
    feedback ? `DENIAL_FEEDBACK_LOOP_${loopCount}:\n${trimForPrompt(feedback, 1200)}` : "",
    revisionBrief ? `REVISION_BRIEF:\n${trimForPrompt(revisionBrief, 800)}` : "",
    [
      "Make a PM decision. Do not output raw code.",
      "Summarize whether the DEV work aligns with PRD and what the user should decide.",
      "Output public content only using:",
      "SUMMARY:",
      "RATIONALE:",
      "PROPOSED_CHANGES:",
      "- concise change",
      "RECOMMENDATION:"
    ].join("\n")
  ].filter(Boolean).join("\n\n");
}

function buildJuniorContext({ compactContext, feedback, revisionBrief, loopCount }) {
  const parts = [
    trimForPrompt(compactContext, 12000),
    "Respond with concise public rationale only. Include: what was inspected, why the issue likely happens, and what change is recommended."
  ];

  if (feedback) {
    parts.push(`User denied the previous result in loop ${loopCount}. Address this feedback directly:\n${trimForPrompt(feedback, 1200)}`);
  }

  if (revisionBrief) {
    parts.push(`ARCHITECT_REVISION_BRIEF:\n${trimForPrompt(revisionBrief, 800)}`);
  }

  return parts.join("\n\n");
}

function buildSupervisorContext({ compactContext, explanation, feedback, revisionBrief, loopCount }) {
  const parts = [
    trimForPrompt(compactContext, 11000),
    `JUNIOR_OUTPUT:\n${trimForPrompt(explanation, 2600)}`,
    "Respond with concise public rationale only. Review the junior output, identify likely issues, and suggest concrete corrections."
  ];

  if (feedback) {
    parts.push(`User denied the previous result in loop ${loopCount}. Make sure the critique addresses:\n${trimForPrompt(feedback, 1200)}`);
  }

  if (revisionBrief) {
    parts.push(`ARCHITECT_REVISION_BRIEF:\n${trimForPrompt(revisionBrief, 800)}`);
  }

  return parts.join("\n\n");
}

function buildArchitectContext({ compactContext, explanation, critique, language, feedback, revisionBrief, loopCount }) {
  return [
    trimForPrompt(compactContext, 12000),
    `JUNIOR_EXPLANATION:\n${trimForPrompt(explanation, 2200)}`,
    `SUPERVISOR_CRITIQUE:\n${trimForPrompt(critique, 2600)}`,
    `Preferred language: ${language}`,
    feedback
      ? `User denied the previous result in loop ${loopCount}. Revised instruction:\n${trimForPrompt(feedback, 1500)}`
      : "",
    revisionBrief ? `ARCHITECT_REVISION_BRIEF:\n${trimForPrompt(revisionBrief, 800)}` : "",
    [
      "Return concise public rationale only. Do not expose hidden reasoning.",
      `New files, folders, or full projects must be placed under "${SANDBOX_FOLDER_NAME}/".`,
      `Use patch paths such as "${SANDBOX_FOLDER_NAME}/project-name/package.json".`,
      "Output exactly these sections:",
      "SUMMARY:",
      "RATIONALE:",
      "AFFECTED_FILES:",
      "- relative/path",
      "PROPOSED_CHANGES:",
      "- concise change",
      "PATCHES:",
      "FILE: relative/path",
      "```language",
      "full replacement content",
      "```",
      "RECOMMENDATION:"
    ].join("\n")
  ].join("\n\n");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanCode(value) {
  return String(value || "")
    .replace(/^```[\w+-]*\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function summarizePlan(pmPlan, input) {
  const firstLine = String(pmPlan || input || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return trimForPrompt(firstLine || "PM created a project plan from the supplied context.", 500);
}

function normalizePhaseName(value, index) {
  const text = String(value || "").replace(/^[-*]\s*/, "").trim();
  if (!text) {
    return `Phase ${index + 1}`;
  }
  return text.replace(/^Phase\s*\d+\s*:\s*/i, (match) => match.trim().replace(/:$/, ""));
}

function extractTaskPhase(task, phases, index) {
  const match = String(task || "").match(/^\[([^\]]+)\]/);
  if (match?.[1]) {
    return match[1].trim();
  }
  return phases[index]?.name || phases[0]?.name || "Phase 1";
}

function formatPrdForPrompt(prd, options = {}) {
  if (!prd) {
    return "No PRD generated yet.";
  }

  const compact = Boolean(options.compact);
  const goals = (prd.goals || []).slice(0, compact ? 4 : prd.goals?.length || 0);
  const features = (prd.features || []).slice(0, compact ? 6 : prd.features?.length || 0);
  const constraints = (prd.constraints || []).slice(0, compact ? 4 : prd.constraints?.length || 0);
  const phases = (prd.phases || []).slice(0, compact ? 4 : prd.phases?.length || 0);
  const tasks = (prd.tasks || []).slice(0, compact ? 6 : prd.tasks?.length || 0);

  return [
    `Summary: ${trimForPrompt(prd.summary || "", compact ? 700 : 1400)}`,
    `Goals:\n${goals.map((item) => `- ${item}`).join("\n")}`,
    `Features:\n${features.map((item) => `- ${item}`).join("\n")}`,
    `Constraints:\n${constraints.map((item) => `- ${item}`).join("\n")}`,
    `Phases:\n${phases.map((item) => `- ${item}`).join("\n")}`,
    `Tasks:\n${tasks.map((item) => `- ${item}`).join("\n")}`
  ].join("\n\n");
}

function trimForPrompt(value, maxChars) {
  const text = String(value || "");

  if (text.length <= maxChars) {
    return text;
  }

  const headLength = Math.floor(maxChars * 0.7);
  const tailLength = Math.max(0, maxChars - headLength - 80);

  return `${text.slice(0, headLength)}\n\n[...truncated ${text.length - maxChars} chars...]\n\n${text.slice(
    -tailLength
  )}`;
}

function extractSection(output, label) {
  const match = output.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?:\\n[A-Z_]+:|$)`, "i"));
  return match?.[1]?.trim() || "";
}

function extractListSection(output, label) {
  const section = extractSection(output, label);
  if (!section) {
    return [];
  }

  return section
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function extractPatches(output) {
  const matches = [...output.matchAll(/FILE:\s*([^\n]+)\n```[\w+-]*\n([\s\S]*?)```/gi)];
  return matches.map((match) => ({
    path: match[1].trim(),
    content: cleanCode(match[2])
  }));
}

function toPublicRationale(value) {
  return trimForPrompt(String(value || "").trim(), 2800);
}

function toShortRecommendation(value) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return trimForPrompt(lines.slice(0, 6).join("\n"), 900);
}
