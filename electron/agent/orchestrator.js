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
  const feedback = String(payload?.feedback || "").trim();
  const loopCount = Number(payload?.loopCount || 0);
  const runId = payload?.runId || randomUUID();

  if (!input && files.length === 0) {
    throw new Error("Add a code/error snippet or select at least one project file.");
  }

  const filesAnalyzed = files.map((file) => ({
    path: file.path,
    size: file.size,
    extension: file.extension
  }));
  const compactContext = buildCompactContext({ input, files, language, feedback });
  const revisionBrief = feedback
    ? await createRevisionBrief({
        compactContext,
        feedback,
        loopCount
      })
    : "";

  emitProgress({ runId, agent: "junior", status: "thinking" });
  const explanation = await callAgent({
    agent: AGENTS.junior,
    systemPrompt: buildSystemPrompt(AGENTS.junior),
    input: buildJuniorContext({ compactContext, feedback, revisionBrief, loopCount })
  });
  const juniorResult = buildJuniorResult(explanation);
  emitProgress({
    runId,
    agent: "junior",
    status: "speaking",
    partialResult: {
      junior: juniorResult,
      explanation: explanation.trim()
    }
  });
  await delay(SPEAKING_DELAY_MS);
  emitProgress({
    runId,
    agent: "junior",
    status: "done",
    partialResult: {
      junior: juniorResult,
      explanation: explanation.trim()
    }
  });

  emitProgress({ runId, agent: "supervisor", status: "thinking" });
  const critique = await callAgent({
    agent: AGENTS.supervisor,
    systemPrompt: buildSystemPrompt(AGENTS.supervisor),
    input: buildSupervisorContext({ compactContext, explanation, feedback, revisionBrief, loopCount })
  });
  const supervisorResult = buildSupervisorResult(critique);
  emitProgress({
    runId,
    agent: "supervisor",
    status: "speaking",
    partialResult: {
      supervisor: supervisorResult,
      critique: critique.trim()
    }
  });
  await delay(SPEAKING_DELAY_MS);
  emitProgress({
    runId,
    agent: "supervisor",
    status: "done",
    partialResult: {
      supervisor: supervisorResult,
      critique: critique.trim()
    }
  });

  emitProgress({ runId, agent: "architect", status: "thinking" });
  const leadOutput = await callAgent({
    agent: AGENTS.architect,
    systemPrompt: buildSystemPrompt(AGENTS.architect),
    input: buildArchitectContext({ compactContext, explanation, critique, language, feedback, revisionBrief, loopCount })
  });
  const leadResult = parseLeadOutput(leadOutput, filesAnalyzed);
  const pipelineResult = buildPipelineResult({
    explanation,
    critique,
    files,
    filesAnalyzed,
    leadResult,
    loopCount
  });
  emitProgress({ runId, agent: "architect", status: "speaking", partialResult: pipelineResult });
  await delay(SPEAKING_DELAY_MS);
  emitProgress({ runId, agent: "architect", status: "done", partialResult: pipelineResult });

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

function buildCompactContext({ input, files, language, feedback }) {
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
    summary: summary || "Architect completed a final recommendation pass.",
    rationale: rationale || "Reviewed the project context, likely failure points, and the recommended fix.",
    proposedChanges:
      proposedChanges.length > 0
        ? proposedChanges
        : normalizedPatches.map((patch) => `Update ${patch.path} with the architect's revised code.`),
    affectedFiles: normalizedAffectedFiles,
    patches: normalizedPatches,
    fixedCode: normalizedPatches[0]?.content || cleanCode(fallbackCodeFence?.[1] || output),
    recommendation: recommendation || output.trim()
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

function buildPipelineResult({ explanation, critique, files, filesAnalyzed, leadResult, loopCount }) {
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
      contextReady: files.length > 0,
      currentStage: "decision",
      loopCount,
      decisionStatus: "pending"
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
      "Rewrite the user's denial feedback into a concise revised instruction for the junior developer. Public instruction only. Maximum four lines.",
    input: [
      trimForPrompt(compactContext, 4000),
      `DENIAL_FEEDBACK_LOOP_${loopCount}:\n${trimForPrompt(feedback, 1200)}`
    ].join("\n\n")
  });

  return trimForPrompt(output, 800);
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
