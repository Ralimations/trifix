import { randomUUID } from "node:crypto";
import { AGENTS, AI_ENDPOINT, MAX_CONTEXT_CHARS_PER_FILE, MAX_CONTEXT_CHARS_TOTAL } from "../constants.js";

const REQUEST_TIMEOUT_MS = 45000;
let lastResult = null;

export function getLastResult() {
  return lastResult;
}

export async function runPipeline(payload, emitProgress = () => {}) {
  const input = String(payload?.input || "").trim();
  const language = String(payload?.language || "auto");
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const runId = payload?.runId || randomUUID();

  if (!input && files.length === 0) {
    throw new Error("Add a code/error snippet or select at least one project file.");
  }

  const filesAnalyzed = files.map((file) => ({
    path: file.path,
    size: file.size,
    extension: file.extension
  }));
  const compactContext = buildCompactContext({ input, files, language });

  emitProgress({ runId, agent: "junior", status: "thinking" });
  const explanation = await callAgent({
    agent: AGENTS.junior,
    systemPrompt:
      "Explain this code or error simply for a developer. Be concise. Mention likely intent and failure point.",
    input: compactContext
  });
  emitProgress({ runId, agent: "junior", status: "done" });

  emitProgress({ runId, agent: "senior", status: "thinking" });
  const critique = await callAgent({
    agent: AGENTS.senior,
    systemPrompt:
      "Find bugs, risks, bad practices, missing edge cases, and test gaps. Be direct, concise, and professional.",
    input: `${compactContext}\n\nJUNIOR_EXPLANATION:\n${trimForPrompt(explanation, 5000)}`
  });
  emitProgress({ runId, agent: "senior", status: "done" });

  emitProgress({ runId, agent: "lead", status: "thinking" });
  const leadOutput = await callAgent({
    agent: AGENTS.lead,
    systemPrompt:
      "Use the context and reviews to produce a fix. Output exactly two sections: FIXED_CODE and RECOMMENDATION. Keep code complete but minimal.",
    input: [
      compactContext,
      `JUNIOR_EXPLANATION:\n${trimForPrompt(explanation, 4000)}`,
      `SENIOR_CRITIQUE:\n${trimForPrompt(critique, 5000)}`,
      `Preferred language: ${language}`
    ].join("\n\n")
  });
  emitProgress({ runId, agent: "lead", status: "done" });

  const leadResult = parseLeadOutput(leadOutput);
  lastResult = {
    explanation: explanation.trim(),
    critique: critique.trim(),
    fixedCode: leadResult.fixedCode,
    recommendation: leadResult.recommendation,
    filesAnalyzed
  };

  return lastResult;
}

async function callAgent({ agent, systemPrompt, input }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: agent.model,
        system_prompt: systemPrompt,
        input
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `${agent.name} request failed with HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`
      );
    }

    const text = await response.text();
    const parsed = parseChatResponse(text);

    if (!parsed.trim()) {
      throw new Error(`${agent.name} returned an empty response.`);
    }

    return parsed;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${agent.name} timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)} seconds.`);
    }

    if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network/i.test(error?.message || "")) {
      throw new Error(
        `${agent.name} could not reach ${AI_ENDPOINT}. Confirm the VPN is connected and the endpoint is online.`
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildCompactContext({ input, files, language }) {
  const chunks = [`LANGUAGE: ${language}`];

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
    return (
      json.output ||
      json.result ||
      json.text ||
      json.response ||
      json.message?.content ||
      json.choices?.[0]?.message?.content ||
      json.choices?.[0]?.text ||
      responseText
    ).toString();
  } catch {
    return responseText;
  }
}

function parseLeadOutput(output) {
  const fixedMatch = output.match(/FIXED_CODE:\s*([\s\S]*?)(?:\n\s*RECOMMENDATION:|$)/i);
  const recommendationMatch = output.match(/RECOMMENDATION:\s*([\s\S]*)$/i);
  const fallbackCodeFence = output.match(/```[\w+-]*\n([\s\S]*?)```/);

  return {
    fixedCode: cleanCode(fixedMatch?.[1] || fallbackCodeFence?.[1] || output),
    recommendation: (recommendationMatch?.[1] || output).trim()
  };
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
