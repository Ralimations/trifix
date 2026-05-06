import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import {
  AGENTS,
  AI_ENDPOINT,
  DEFAULT_SANDBOX_PROJECT_NAME,
  MAX_CONTEXT_CHARS_PER_FILE,
  MAX_CONTEXT_CHARS_TOTAL,
  SANDBOX_FOLDER_NAME
} from "../constants.js";
import {
  appendRunLog,
  createRunState,
  markStage,
  saveRunState
} from "./runState.js";
import {
  trackCommandRequests,
  trackPlannedFiles,
  trackProposedFiles,
  trackQaResult
} from "./artifactLedger.js";

const REQUEST_TIMEOUT_MS = 1800000;
const SPEAKING_DELAY_MS = 800;
const MAX_DEV_HANDOFF_CHARS = 2200;
const REQUEST_STATUS_INTERVAL_MS = 15000;
let lastResult = null;

export function getLastResult() {
  return lastResult;
}

export async function runAgentTest(payload) {
  const agentId = String(payload?.agentId || "architect");
  const agent = AGENTS[agentId];
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  const scenario = String(payload?.scenario || "fsd");
  const input = buildAgentTestInput({
    scenario,
    instruction: String(payload?.instruction || "").trim(),
    contextDocuments: Array.isArray(payload?.contextDocuments) ? payload.contextDocuments : [],
    files: Array.isArray(payload?.files) ? payload.files : [],
    projectRoot: payload?.projectRoot || ""
  });

  const output = await callAgent({
    agent,
    systemPrompt: buildAgentTestPrompt(agent, scenario),
    input
  });

  return {
    agentId,
    scenario,
    output: trimForPrompt(output, 8000)
  };
}

export async function runPipeline(payload, emitProgress = () => {}) {
  const input = String(payload?.input || "").trim();
  const language = String(payload?.language || "auto");
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const contextDocuments = Array.isArray(payload?.contextDocuments) ? payload.contextDocuments : [];
  const graphContext = payload?.graphContext || null;
  const projectFsd = payload?.fsd || null;
  const projectRoot = String(payload?.projectRoot || "").trim();
  const isExistingProjectRequest = Boolean(projectRoot);
  const feedback = String(payload?.feedback || "").trim();
  const loopCount = Number(payload?.loopCount || 0);
  const runId = payload?.runId || randomUUID();
  const runMode = payload?.mode === "autonomous" || payload?.autonomy ? "autonomous" : "manual";
  let pipelineRunPath = String(payload?.runPath || payload?.projectRoot || "").trim();

  if (!input && files.length === 0 && contextDocuments.length === 0) {
    throw new Error("Add an instruction, upload context, or select at least one project file.");
  }

  if (pipelineRunPath) {
    await initializePipelineRunState({
      runPath: pipelineRunPath,
      runId,
      taskInput: input,
      mode: runMode
    });
    await markPipelineStage(pipelineRunPath, "pm_plan", "running", {
      status: "running",
      attempt: loopCount,
      maxAttempts: 3
    }, {
      type: "stage-detail",
      event: "supervisor-spec started"
    });
  }

  const filesAnalyzed = files.map((file) => ({
    path: file.path,
    size: file.size,
    extension: file.extension
  }));
  const compactContext = buildCompactContext({
    input,
    files,
    language,
    feedback,
    contextDocuments,
    graphContext,
    projectFsd,
    mode: isExistingProjectRequest ? "existing-project" : "new-project"
  });
  const revisionBrief = feedback
    ? await createRevisionBrief({
        compactContext,
        feedback,
        loopCount
      })
    : "";

  const parallelLogs = [];
  const addParallelLog = (message) => {
    parallelLogs.push({ at: new Date().toISOString(), message });
  };
  const emitStage = ({ agent, stage, status, projectPlan: activeProjectPlan = null, partialResult = {}, requestStatus = null }) =>
    emitProgress({
      runId,
      agent,
      stage,
      status,
      requestStatus,
      partialResult: {
        ...partialResult,
        parallel: {
          ...(partialResult.parallel || {}),
          logs: parallelLogs
        },
        workflow: partialResult.workflow || buildV2Workflow({ loopCount, currentStage: stage, projectPlan: activeProjectPlan })
      }
    });

  emitStage({ agent: "architect", stage: "supervisor-spec", status: "thinking" });
  const pmPlan = await callAgent({
    agent: AGENTS.architect,
    systemPrompt: buildSupervisorSpecSystemPrompt(),
    input: buildSupervisorSpecContext({ compactContext, feedback, revisionBrief, loopCount, isExistingProjectRequest }),
    onRequestStatus: (requestStatus) =>
      emitAgentRequestProgress({ emitProgress, runId, agentId: "architect", stage: "supervisor-spec", status: "thinking", requestStatus, loopCount })
  });
  addParallelLog("Supervisor spec created");

  const pmArchitecture = normalizePmArchitecture(extractJsonObject(pmPlan), input, null, pmPlan);
  if (!pipelineRunPath) {
    pipelineRunPath = buildPlannedRunPath(payload?.sandboxParentPath, pmArchitecture?.projectSlug);
    if (pipelineRunPath) {
      await initializePipelineRunState({
        runPath: pipelineRunPath,
        runId,
        taskInput: input,
        mode: runMode
      });
    }
  }
  const prd = buildPrd(pmPlan, contextDocuments, input, pmArchitecture);
  const projectPlan = buildProjectPlan(prd);
  const qaStructureReview = isExistingProjectRequest
    ? buildExistingProjectQaReview({ prd, files, input })
    : normalizeQaStructureReview(null, pmArchitecture);
  const qaInstructions = formatQaStructureReview(qaStructureReview);
  const qaDevHandoff = buildDevHandoffFromQa(qaInstructions, qaStructureReview);

  emitStage({
    agent: "architect",
    stage: "supervisor-spec",
    status: "speaking",
    projectPlan,
    partialResult: {
      architect: buildPmResult(pmPlan, "PM created the PRD and phase direction."),
      project: {
        projectName: pmArchitecture.projectName,
        projectSlug: pmArchitecture.projectSlug,
        fileArchitecture: pmArchitecture.fileArchitecture,
        implementationPlan: pmArchitecture.implementationPlan,
        requiredFiles: pmArchitecture.requiredFiles,
        fsd: buildFsdState(projectFsd, contextDocuments),
        prd,
        phases: projectPlan.phases,
        tasks: projectPlan.tasks
      }
    }
  });
  await delay(SPEAKING_DELAY_MS);
  if (pipelineRunPath) {
    await trackPlannedFiles(pipelineRunPath, pmArchitecture?.requiredFiles || pmArchitecture?.fileArchitecture || []);
    await markPipelineStage(pipelineRunPath, "pm_plan", "running", {
      changedFiles: uniqueStrings(pmArchitecture?.requiredFiles || []),
      status: "running"
    }, {
      type: "stage-detail",
      event: "supervisor-spec done"
    });
  }
  emitStage({
    agent: "architect",
    stage: "supervisor-spec",
    status: "done",
    projectPlan,
    partialResult: {
      architect: buildPmResult(pmPlan, "PM created the PRD and phase direction."),
      project: {
        projectName: pmArchitecture.projectName,
        projectSlug: pmArchitecture.projectSlug,
        fileArchitecture: pmArchitecture.fileArchitecture,
        implementationPlan: pmArchitecture.implementationPlan,
        requiredFiles: pmArchitecture.requiredFiles,
        fsd: buildFsdState(projectFsd, contextDocuments),
        prd,
        phases: projectPlan.phases,
        tasks: projectPlan.tasks
      }
    }
  });

  const qaInstructionResult = buildSupervisorResult(qaDevHandoff);
  emitStage({
    agent: "supervisor",
    stage: "senior-parallel-review",
    status: "thinking",
    projectPlan,
    partialResult: {
      supervisor: qaInstructionResult,
      critique: qaDevHandoff.trim(),
      qa: {
        structureReview: qaStructureReview,
        instructions: qaDevHandoff.trim()
      }
    }
  });

  addParallelLog("Junior Dev started");
  if (pipelineRunPath) {
    await markPipelineStage(pipelineRunPath, "dev", "running", {
      status: "running"
    }, {
      type: "stage-detail",
      event: "junior-initial started"
    });
  }
  emitStage({ agent: "junior", stage: "junior-initial", status: "coding", projectPlan });
  const juniorInitialTask = trackAgentCall(callAgent({
    agent: AGENTS.junior,
    systemPrompt: buildJuniorInitialSystemPrompt(),
    input: buildJuniorInitialContext({
      compactContext,
      prd,
      pmPlan,
      pmArchitecture,
      qaInstructions: qaDevHandoff,
      qaStructureReview,
      language,
      feedback,
      revisionBrief,
      loopCount,
      isExistingProjectRequest
    }),
    onRequestStatus: (requestStatus) =>
      emitAgentRequestProgress({ emitProgress, runId, agentId: "junior", stage: "junior-initial", status: "coding", requestStatus, loopCount, projectPlan })
  }));

  addParallelLog("Senior Dev started");
  emitStage({ agent: "supervisor", stage: "senior-parallel-review", status: "testing", projectPlan });
  const seniorParallelTask = trackAgentCall(callAgent({
    agent: AGENTS.supervisor,
    systemPrompt: buildSeniorParallelSystemPrompt(),
    input: buildSeniorParallelContext({ compactContext, prd, pmPlan, pmArchitecture, qaDevHandoff, feedback, revisionBrief, loopCount }),
    onRequestStatus: (requestStatus) =>
      emitAgentRequestProgress({ emitProgress, runId, agentId: "supervisor", stage: "senior-parallel-review", status: "testing", requestStatus, loopCount, projectPlan })
  }));

  const juniorInitialSettled = await juniorInitialTask.promise;
  addParallelLog("Junior Dev finished");
  if (juniorInitialSettled.status === "rejected") {
    throw new Error(`Junior Dev failed before producing file changes: ${formatAgentFailure(juniorInitialSettled.reason)}`);
  }

  const juniorInitialOutput = juniorInitialSettled.value;
  const juniorInitialLeadResult = parseLeadOutput(juniorInitialOutput, filesAnalyzed, pmArchitecture);
  const juniorInitialResult = buildJuniorResult(juniorInitialOutput);
  if (pipelineRunPath) {
    await trackProposedFiles(pipelineRunPath, juniorInitialLeadResult.fileOperations || []);
    await trackCommandRequests(pipelineRunPath, juniorInitialLeadResult.commandRequests || []);
    await appendRunLog(pipelineRunPath, {
      type: "stage-detail",
      event: "fileOperations parsed",
      fileOperations: (juniorInitialLeadResult.fileOperations || []).map((operation) => operation.path),
      commandRequests: juniorInitialLeadResult.commandRequests || []
    });
    await markPipelineStage(pipelineRunPath, "dev", "running", {
      changedFiles: juniorInitialLeadResult.affectedFiles || [],
      status: "running"
    }, {
      type: "stage-detail",
      event: "junior-initial done"
    });
  }
  emitStage({
    agent: "junior",
    stage: "junior-initial",
    status: "speaking",
    projectPlan,
    partialResult: {
      junior: juniorInitialResult,
      explanation: juniorInitialOutput.trim(),
      architect: {
        affectedFiles: juniorInitialLeadResult.affectedFiles,
        patches: juniorInitialLeadResult.patches,
        fixedCode: juniorInitialLeadResult.fixedCode,
        proposedChanges: juniorInitialLeadResult.proposedChanges
      },
      dev: {
        fileOperations: juniorInitialLeadResult.fileOperations,
        commandRequests: juniorInitialLeadResult.commandRequests
      }
    }
  });
  await delay(SPEAKING_DELAY_MS);
  emitStage({
    agent: "junior",
    stage: "junior-initial",
    status: "done",
    projectPlan,
    partialResult: {
      junior: juniorInitialResult,
      explanation: juniorInitialOutput.trim(),
      architect: {
        affectedFiles: juniorInitialLeadResult.affectedFiles,
        patches: juniorInitialLeadResult.patches,
        fixedCode: juniorInitialLeadResult.fixedCode,
        proposedChanges: juniorInitialLeadResult.proposedChanges
      },
      dev: {
        fileOperations: juniorInitialLeadResult.fileOperations,
        commandRequests: juniorInitialLeadResult.commandRequests
      }
    }
  });

  let seniorParallelSettled = await waitForTrackedAgent(seniorParallelTask, 15000);
  if (!seniorParallelSettled) {
    addParallelLog("Senior Dev still running; continuing without blocking patch pass");
  }

  let seniorParallelReview = "";
  let seniorParallelAvailable = false;
  if (seniorParallelSettled?.status === "fulfilled") {
    seniorParallelReview = seniorParallelSettled.value;
    seniorParallelAvailable = true;
    addParallelLog("Senior Dev finished");
  } else if (seniorParallelSettled?.status === "rejected") {
    seniorParallelReview = `Senior Dev parallel review unavailable: ${formatAgentFailure(seniorParallelSettled.reason)}`;
    addParallelLog("Senior Dev failed; continuing with Junior Dev output");
  } else {
    seniorParallelReview = "Senior Dev parallel review was not ready before the patch pass.";
  }

  const seniorParallelResult = buildSupervisorResult(seniorParallelReview);
  if (pipelineRunPath) {
    await markPipelineStage(pipelineRunPath, "qa", "running", {
      status: "running"
    }, {
      type: "stage-detail",
      event: "senior review started"
    });
    await trackQaResult(pipelineRunPath, seniorParallelReview.trim());
  }
  emitStage({
    agent: "supervisor",
    stage: "senior-parallel-review",
    status: "speaking",
    projectPlan,
    partialResult: {
      supervisor: seniorParallelResult,
      critique: seniorParallelReview.trim(),
      qa: {
        structureReview: qaStructureReview,
        instructions: qaDevHandoff.trim(),
        parallelReview: seniorParallelReview.trim()
      }
    }
  });
  await delay(SPEAKING_DELAY_MS);
  if (pipelineRunPath) {
    await markPipelineStage(pipelineRunPath, "qa", "running", {
      status: "running"
    }, {
      type: "stage-detail",
      event: "senior review done"
    });
  }
  emitStage({
    agent: "supervisor",
    stage: "senior-parallel-review",
    status: "done",
    projectPlan,
    partialResult: {
      supervisor: seniorParallelResult,
      critique: seniorParallelReview.trim(),
      qa: {
        structureReview: qaStructureReview,
        instructions: qaDevHandoff.trim(),
        parallelReview: seniorParallelReview.trim()
      }
    }
  });

  let juniorPatchOutput = "";
  let finalLeadResult = juniorInitialLeadResult;
  if (seniorParallelAvailable) {
    addParallelLog("Patch pass started");
    if (pipelineRunPath) {
      await markPipelineStage(pipelineRunPath, "patch", "running", {
        status: "running"
      }, {
        type: "stage-detail",
        event: "patch pass started"
      });
    }
    emitStage({ agent: "junior", stage: "junior-patch", status: "coding", projectPlan });
    try {
      juniorPatchOutput = await callAgent({
        agent: AGENTS.junior,
        systemPrompt: buildJuniorPatchSystemPrompt(),
        input: buildJuniorPatchContext({
          compactContext,
          prd,
          pmPlan,
          pmArchitecture,
          juniorInitialOutput,
          juniorInitialLeadResult,
          seniorParallelReview,
          feedback,
          revisionBrief,
          loopCount,
          isExistingProjectRequest
        }),
        onRequestStatus: (requestStatus) =>
          emitAgentRequestProgress({ emitProgress, runId, agentId: "junior", stage: "junior-patch", status: "coding", requestStatus, loopCount, projectPlan })
      });
      finalLeadResult = mergeLeadResults(juniorInitialLeadResult, parseLeadOutput(juniorPatchOutput, filesAnalyzed, pmArchitecture));
      addParallelLog("Patch pass finished");
    } catch (error) {
      juniorPatchOutput = `Junior patch pass skipped after error: ${formatAgentFailure(error)}`;
      addParallelLog("Patch pass failed; using Junior initial output");
    }
  } else {
    juniorPatchOutput = "Junior patch pass skipped because Senior Dev notes were unavailable.";
  }

  const finalDevOutput = [juniorInitialOutput, juniorPatchOutput].filter(Boolean).join("\n\nPATCH PASS:\n");
  if (pipelineRunPath) {
    await trackProposedFiles(pipelineRunPath, finalLeadResult.fileOperations || []);
    await trackCommandRequests(pipelineRunPath, finalLeadResult.commandRequests || []);
    await markPipelineStage(pipelineRunPath, "patch", "running", {
      changedFiles: finalLeadResult.affectedFiles || [],
      status: "running"
    }, {
      type: "stage-detail",
      event: "patch pass done"
    });
  }
  emitStage({
    agent: "junior",
    stage: "junior-patch",
    status: "done",
    projectPlan,
    partialResult: {
      junior: buildJuniorResult(finalDevOutput),
      explanation: finalDevOutput.trim(),
      architect: {
        affectedFiles: finalLeadResult.affectedFiles,
        patches: finalLeadResult.patches,
        fixedCode: finalLeadResult.fixedCode,
        proposedChanges: finalLeadResult.proposedChanges
      },
      dev: {
        fileOperations: finalLeadResult.fileOperations,
        commandRequests: finalLeadResult.commandRequests
      }
    }
  });

  addParallelLog("Final review started");
  emitStage({ agent: "supervisor", stage: "senior-final-review", status: "testing", projectPlan });
  let seniorFinalReview = "";
  let seniorFinalReviewAvailable = false;
  if (seniorParallelAvailable) {
    try {
      seniorFinalReview = await callAgent({
        agent: AGENTS.supervisor,
        systemPrompt: buildSeniorFinalReviewSystemPrompt(),
        input: buildSeniorFinalReviewContext({ compactContext, prd, pmPlan, seniorParallelReview, finalDevOutput, finalLeadResult, feedback, revisionBrief, loopCount }),
        onRequestStatus: (requestStatus) =>
          emitAgentRequestProgress({ emitProgress, runId, agentId: "supervisor", stage: "senior-final-review", status: "testing", requestStatus, loopCount, projectPlan })
      });
      seniorFinalReviewAvailable = true;
      addParallelLog("Senior Dev final review finished");
    } catch (error) {
      seniorFinalReview = `FINAL REVIEW:\nUNAVAILABLE\n\nISSUES:\n- Senior Dev final review failed: ${formatAgentFailure(error)}\n\nREQUIRED FIXES:\n- none\n\nNOTE:\nSupervisor must decide from Junior output and the checklist.`;
      addParallelLog("Senior Dev final review failed");
    }
  } else {
    seniorFinalReview = "FINAL REVIEW:\nUNAVAILABLE\n\nISSUES:\n- Senior Dev review unavailable.\n\nREQUIRED FIXES:\n- none\n\nNOTE:\nSupervisor must decide from Junior output and the checklist.";
  }

  emitStage({
    agent: "supervisor",
    stage: "senior-final-review",
    status: "done",
    projectPlan,
    partialResult: {
      supervisor: buildSupervisorResult(seniorFinalReview),
      critique: seniorFinalReview.trim()
    }
  });

  addParallelLog("Final status started");
  if (pipelineRunPath) {
    await markPipelineStage(pipelineRunPath, "final", "running", {
      status: "running"
    }, {
      type: "stage-detail",
      event: "final decision started"
    });
  }
  emitStage({ agent: "architect", stage: "supervisor-final", status: "thinking", projectPlan });
  let pmDecision = "";
  try {
    pmDecision = await callAgent({
      agent: AGENTS.architect,
      systemPrompt: buildSupervisorFinalSystemPrompt(),
      input: buildSupervisorFinalContext({
        compactContext,
        prd,
        pmPlan,
        qaInstructions: qaDevHandoff,
        devOutput: finalDevOutput,
        qaReview: seniorFinalReview,
        qaReviewAvailable: seniorFinalReviewAvailable,
        devLeadResult: finalLeadResult,
        language,
        feedback,
        revisionBrief,
        loopCount,
        isExistingProjectRequest
      }),
      onRequestStatus: (requestStatus) =>
        emitAgentRequestProgress({ emitProgress, runId, agentId: "architect", stage: "supervisor-final", status: "thinking", requestStatus, loopCount, projectPlan })
    });
    addParallelLog("Final status finished");
  } catch (error) {
    pmDecision = `FINAL STATUS:\nNEEDS PATCH\n\nREASON:\nSupervisor final status failed: ${formatAgentFailure(error)}`;
    addParallelLog("Final status failed");
  }

  const pmDecisionResult = buildPmResult(pmDecision, finalLeadResult.summary);
  const pipelineResult = buildPipelineResult({
    explanation: finalDevOutput,
    critique: seniorFinalReview,
    files,
    filesAnalyzed,
    leadResult: {
      ...finalLeadResult,
      summary: pmDecisionResult.summary || finalLeadResult.summary,
      rationale: pmDecisionResult.rationale || seniorFinalReview,
      recommendation: pmDecisionResult.recommendation || pmDecision
    },
    loopCount,
    project: {
      projectName: pmArchitecture.projectName,
      projectSlug: pmArchitecture.projectSlug,
      fileArchitecture: pmArchitecture.fileArchitecture,
      implementationPlan: pmArchitecture.implementationPlan,
      requiredFiles: pmArchitecture.requiredFiles,
      architecture: pmArchitecture,
      fsd: buildFsdState(projectFsd, contextDocuments),
      prd,
      phases: projectPlan.phases,
      tasks: projectPlan.tasks
    },
    qaInstructions,
    qaStructureReview,
    pmPlan,
    pmDecision
  });
  pipelineResult.parallel = {
    supervisor_spec: pmPlan,
    junior_initial_output: juniorInitialOutput,
    senior_parallel_review: seniorParallelReview,
    junior_patch_output: juniorPatchOutput,
    senior_final_review: seniorFinalReview,
    supervisor_final_status: pmDecision,
    logs: parallelLogs
  };
  pipelineResult.qa = {
    ...pipelineResult.qa,
    parallelReview: seniorParallelReview,
    finalReview: seniorFinalReview
  };
  pipelineResult.dev = {
    ...pipelineResult.dev,
    initialImplementation: juniorInitialOutput,
    patchOutput: juniorPatchOutput
  };

  emitProgress({ runId, agent: "architect", stage: "supervisor-final", status: "speaking", partialResult: pipelineResult });
  await delay(SPEAKING_DELAY_MS);
  emitProgress({ runId, agent: "architect", stage: "supervisor-final", status: "done", partialResult: pipelineResult });

  if (pipelineRunPath) {
    await markPipelineStage(pipelineRunPath, "final", runMode === "autonomous" ? "running" : "needs_review", {
      changedFiles: finalLeadResult.affectedFiles || [],
      status: runMode === "autonomous" ? "running" : "needs_review"
    }, {
      type: "stage-detail",
      event: "final decision done"
    });
  }

  lastResult = pipelineResult;

  return lastResult;
}

async function initializePipelineRunState({ runPath, runId, taskInput, mode }) {
  try {
    await fs.mkdir(runPath, { recursive: true });
    await createRunState({
      runId,
      taskInput,
      projectRoot: runPath,
      mode
    });
    await saveRunState(runPath, {
      runId,
      taskInput,
      mode,
      status: "running"
    });
  } catch {}
}

async function markPipelineStage(runPath, stage, status, statePatch = {}, logEvent = null) {
  try {
    await markStage(runPath, stage, status, statePatch);
    if (logEvent) {
      await appendRunLog(runPath, logEvent);
    }
  } catch {}
}

function buildPlannedRunPath(parentPath, projectSlug) {
  const baseParent = String(parentPath || "").trim();
  const slug = sanitizePipelineProjectSlug(projectSlug);
  if (!baseParent || !slug) {
    return "";
  }
  return path.join(baseParent, DEFAULT_SANDBOX_PROJECT_NAME, "sandbox", "tasks", slug);
}

function sanitizePipelineProjectSlug(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

function emitAgentRequestProgress({ emitProgress, runId, agentId, stage, status, requestStatus, loopCount, projectPlan }) {
  const agent = AGENTS[agentId];
  const elapsed = formatDuration(requestStatus.elapsedMs || 0);
  const label =
    requestStatus.phase === "still-generating"
      ? `${agent?.name || agentId} is still generating... ${elapsed} elapsed`
      : `${agent?.name || agentId}: ${requestStatus.label} (${elapsed})`;

  emitProgress({
    runId,
    agent: agentId,
    stage,
    status,
    requestStatus: {
      ...requestStatus,
      agentName: agent?.name || agentId,
      displayText: label
    },
    partialResult: {
      workflow: {
        ...buildV2Workflow({ loopCount, currentStage: stage, projectPlan }),
        currentTask: requestStatus.label,
        projectStatus: label
      }
    }
  });
}

async function callAgent({ agent, systemPrompt, input, onRequestStatus }) {
  const requestTimeoutMs = agent.timeoutMs || REQUEST_TIMEOUT_MS;
  const endpoint = agent.endpoint || AI_ENDPOINT;
  const startedAt = Date.now();
  const statusTimers = [];
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json"
  };

  if (endpoint.includes("ngrok-free.dev")) {
    headers["ngrok-skip-browser-warning"] = "true";
  }

  const emitRequestStatus = (phase, label) => {
    onRequestStatus?.({
      phase,
      label,
      elapsedMs: Date.now() - startedAt,
      timeoutMs: requestTimeoutMs
    });
  };

  const startStatusTimer = (callback, ms, repeat = false) => {
    const timer = repeat ? setInterval(callback, ms) : setTimeout(callback, ms);
    timer.unref?.();
    statusTimers.push({ timer, repeat });
  };

  try {
    const body = {
      model: agent.model,
      system_prompt: systemPrompt,
      input
    };

    emitRequestStatus("prompt-sent", "Prompt sent");
    startStatusTimer(() => emitRequestStatus("model-processing", "Model processing"), 1000);
    startStatusTimer(() => emitRequestStatus("waiting-first-token", "Waiting for first token"), 12000);
    startStatusTimer(() => emitRequestStatus("still-generating", `${agent.name} is still generating...`), REQUEST_STATUS_INTERVAL_MS, true);

    const response = await postJson({
      endpoint,
      headers,
      body,
      timeoutMs: requestTimeoutMs
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(formatAgentHttpError({ agent, endpoint, status: response.status, body }));
    }

    emitRequestStatus("receiving-output", "Receiving output");
    const text = await response.text();
    const parsed = parseChatResponse(text);

    if (!parsed.trim()) {
      throw new Error(`${agent.name} returned an empty response.`);
    }

    emitRequestStatus("completed", "Completed");
    return parsed;
  } catch (error) {
    const networkCode = getNetworkErrorCode(error);
    if (networkCode === "ECONNREFUSED") {
      throw new Error(`${agent.name} connection refused at ${endpoint}. Confirm the endpoint is online.`);
    }

    if (networkCode === "ENOTFOUND" || networkCode === "EAI_AGAIN") {
      throw new Error(`${agent.name} endpoint host could not be resolved for ${endpoint}.`);
    }

    if (networkCode === "ETIMEDOUT") {
      throw new Error(
        `${agent.name} request timed out after ${formatDuration(requestTimeoutMs)}. The model may still be generating. Try shorter context or increase timeout.`
      );
    }

    if (/UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT/i.test(networkCode)) {
      throw new Error(
        `${agent.name} request timed out after ${formatDuration(requestTimeoutMs)}. The model may still be generating. Try shorter context or increase timeout.`
      );
    }

    if (networkCode === "ECONNRESET") {
      throw new Error(`${agent.name} connection closed before a response was received from ${endpoint}.`);
    }

    if (/fetch failed|network/i.test(error?.message || "")) {
      throw new Error(`${agent.name} network request failed for ${endpoint}: ${formatNetworkError(error)}`);
    }

    throw error;
  } finally {
    for (const { timer, repeat } of statusTimers) {
      if (repeat) {
        clearInterval(timer);
      } else {
        clearTimeout(timer);
      }
    }
  }
}

function postJson({ endpoint, headers, body, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const client = url.protocol === "https:" ? https : http;
    const payload = JSON.stringify(body);
    const request = client.request(
      url,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(payload)
        },
        timeout: timeoutMs
      },
      (response) => {
        const chunks = [];

        response.setEncoding("utf8");
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode || 0,
            text: () => Promise.resolve(chunks.join(""))
          })
        );
      }
    );

    request.on("timeout", () => {
      const error = new Error(`Request timed out after ${formatDuration(timeoutMs)}.`);
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

function buildCompactContext({ input, files, language, feedback, contextDocuments = [], graphContext = null, projectFsd = null, mode = "new-project" }) {
  const isExistingProject = mode === "existing-project";
  const maxInputChars = isExistingProject ? 4000 : 9000;
  const maxDocumentSummaryChars = isExistingProject ? 3000 : 7000;
  const maxContextCharsTotal = isExistingProject ? 14000 : MAX_CONTEXT_CHARS_TOTAL;
  const maxContextCharsPerFile = isExistingProject ? 2800 : MAX_CONTEXT_CHARS_PER_FILE;
  const filesForContext = isExistingProject ? files.slice(0, 4) : files;
  const chunks = [
    `LANGUAGE: ${language}`,
    [
      "SANDBOX_WORKSPACE:",
      "For FSD-only project creation, PM chooses one projectSlug and DEV returns project-relative fileOperations.",
      "The app writes those fileOperations under sandbox/tasks/{projectSlug}/ after QA approval.",
      `For existing project edits, patches may still use "${SANDBOX_FOLDER_NAME}/" for new scratch files.`,
      "Do not scan node_modules, .git, dist, or build."
    ].join("\n")
  ];

  if (input) {
    chunks.push(`USER_INPUT:\n${trimForPrompt(input, maxInputChars)}`);
  }

  if (filesForContext.length > 0) {
    chunks.push(
      `FILES_SELECTED:\n${files
        .slice(0, filesForContext.length)
        .map((file) => `- ${file.path} (${Math.round(file.size / 1024)} KB)`)
        .join("\n")}`
    );
  }

  if (feedback) {
    chunks.push(`DECISION_FEEDBACK:\n${trimForPrompt(feedback, 1500)}`);
  }

  const documentSummary = buildDocumentContextSummary(contextDocuments, projectFsd, {
    maxSummaryChars: maxDocumentSummaryChars,
    maxExcerptChars: isExistingProject ? 900 : 1600,
    maxDocSummaryChars: isExistingProject ? 700 : 1200
  });
  if (documentSummary) {
    chunks.push(`PROJECT_CONTEXT_SUMMARY:\n${documentSummary}`);
  }

  const graphSummary = formatGraphContextForPrompt(graphContext);
  if (graphSummary) {
    chunks.push(`GRAPH_CONTEXT:\n${graphSummary}`);
  }

  let remaining = maxContextCharsTotal - chunks.join("\n\n").length;

  for (const file of filesForContext) {
    if (remaining <= 500) {
      break;
    }

    const summary = summarizeFile(file);
    const budget = Math.min(maxContextCharsPerFile, remaining);
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
  const options = arguments[2] || {};
  const docs = Array.isArray(contextDocuments) ? contextDocuments : [];
  const chunks = [];
  const maxSummaryChars = options.maxSummaryChars || 7000;
  const maxExcerptChars = options.maxExcerptChars || 1600;
  const maxDocSummaryChars = options.maxDocSummaryChars || 1200;

  if (projectFsd?.summary) {
    chunks.push(`Existing FSD summary:\n${trimForPrompt(projectFsd.summary, 2600)}`);
  }

  for (const doc of docs.slice(0, 8)) {
    chunks.push(
      [
        `Document: ${doc.name || "context"} (${doc.type || doc.extension || "unknown"})`,
        `Summary: ${trimForPrompt(doc.summary || "", maxDocSummaryChars)}`,
        doc.excerpt ? `Excerpt: ${trimForPrompt(doc.excerpt, maxExcerptChars)}` : ""
      ].filter(Boolean).join("\n")
    );
  }

  return trimForPrompt(chunks.join("\n\n"), maxSummaryChars);
}

function formatGraphContextForPrompt(graphContext) {
  if (!graphContext || typeof graphContext !== "object") {
    return "";
  }

  const chunks = [
    `Status: ${graphContext.status || "unknown"}`,
    graphContext.message ? `Message: ${trimForPrompt(graphContext.message, 300)}` : "",
    graphContext.reportSummary ? `Report summary:\n${trimForPrompt(graphContext.reportSummary, 2200)}` : "",
    Array.isArray(graphContext.relatedFiles) && graphContext.relatedFiles.length
      ? `Related files:\n${graphContext.relatedFiles.map((filePath) => `- ${filePath}`).join("\n")}`
      : "",
    graphContext.query ? `Query: ${trimForPrompt(graphContext.query, 260)}` : "",
    graphContext.queryOutput ? `Query output:\n${trimForPrompt(graphContext.queryOutput, 1800)}` : ""
  ].filter(Boolean);

  return trimForPrompt(chunks.join("\n\n"), 4500);
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
    const structuredPayload = readStructuredPayload(json);
    const text = readChatText(json);

    if (structuredPayload && shouldPreferStructuredPayload(structuredPayload, text)) {
      return structuredPayload;
    }

    if (text) {
      return text;
    }

    if (structuredPayload) {
      return structuredPayload;
    }

    return responseText;
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
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
    const messageItems = value.filter((item) => isMessageItem(item));
    const publicItems = value.filter((item) => !isReasoningItem(item));
    const items = messageItems.length > 0 ? messageItems : publicItems.length > 0 ? publicItems : value;

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

function readStructuredPayload(value) {
  const candidate = findStructuredPayload(value);
  if (!candidate) {
    return "";
  }

  return typeof candidate === "string" ? candidate : JSON.stringify(candidate, null, 2);
}

function looksLikeAgentPayload(value) {
  const keys = new Set(Object.keys(value || {}));
  const markerGroups = [
    ["summary", "fileOperations"],
    ["summary", "recommendation"],
    ["projectName", "projectSlug"],
    ["fileArchitecture", "implementationPlan"],
    ["approved", "devChecklist"],
    ["approved", "issues"]
  ];

  return markerGroups.some((group) => group.every((key) => keys.has(key)));
}

function findStructuredPayload(value, visited = new Set()) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed);
      return findStructuredPayload(parsed, visited) || trimmed;
    } catch {
      return null;
    }
  }

  if (typeof value !== "object") {
    return null;
  }

  if (visited.has(value)) {
    return null;
  }
  visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStructuredPayload(item, visited);
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (isReasoningItem(value)) {
    const found = findStructuredPayload(value.content, visited);
    if (found) {
      return found;
    }

    const contentText = typeof value.content === "string" ? value.content.trim() : "";
    return contentText || null;
  }

  if (looksLikeAgentPayload(value)) {
    return value;
  }

  for (const key of ["output", "result", "response", "data", "message", "content", "choices"]) {
    const found = findStructuredPayload(value[key], visited);
    if (found) {
      return found;
    }
  }

  for (const nestedValue of Object.values(value)) {
    const found = findStructuredPayload(nestedValue, visited);
    if (found) {
      return found;
    }
  }

  return null;
}

function shouldPreferStructuredPayload(structuredPayload, text) {
  const structured = String(structuredPayload || "").trim();
  const plainText = String(text || "").trim();
  if (!structured) {
    return false;
  }

  if (!plainText) {
    return true;
  }

  const structuredSignals = [
    "\"fileOperations\"",
    "\"commandRequests\"",
    "\"fileArchitecture\"",
    "\"implementationPlan\"",
    "FILE:",
    "AFFECTED_FILES",
    "COMMAND_REQUESTS"
  ];

  return structuredSignals.some((signal) => structured.includes(signal)) && !structuredSignals.some((signal) => plainText.includes(signal));
}

function isReasoningItem(value) {
  return typeof value === "object" && value !== null && /^(reasoning|analysis)$/i.test(String(value.type || ""));
}

function isMessageItem(value) {
  return typeof value === "object" && value !== null && /^message$/i.test(String(value.type || ""));
}

function getNetworkErrorCode(error) {
  return error?.cause?.code || error?.code || "";
}

function formatNetworkError(error) {
  const code = getNetworkErrorCode(error);
  const causeMessage = error?.cause?.message || "";
  return [code, causeMessage || error?.message].filter(Boolean).join(" ");
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatAgentHttpError({ agent, endpoint, status, body }) {
  const trimmedBody = String(body || "").trim();
  const serverError = parseServerError(trimmedBody);
  const serverMessage = serverError?.message || "";
  const serverCode = serverError?.code || "";
  const agentEnvPrefix =
    agent.id === "junior" ? "TRIFIX_DEV" : `TRIFIX_${String(agent.id || agent.name || "AGENT").toUpperCase()}`;

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

function parseLeadOutput(output, filesAnalyzed = [], expectedArchitecture = null) {
  const parsedJson = extractJsonObject(output);
  const nestedJson = findNestedOperationContainer(parsedJson);
  const summary = extractSection(output, "SUMMARY");
  const rationale = extractSection(output, "RATIONALE");
  const proposedChanges = extractListSection(output, "PROPOSED_CHANGES");
  const recommendation = extractSection(output, "RECOMMENDATION");
  const affectedFiles = extractListSection(output, "AFFECTED_FILES");
  const commandRequests = extractListSection(output, "COMMAND_REQUESTS");
  const expectedPaths = normalizeExpectedFilePaths(filesAnalyzed, expectedArchitecture);
  const patches = [
    ...extractPatches(output),
    ...extractPathLabeledCodeBlocks(output),
    ...extractInlineFileBlocks(output)
  ];
  const fallbackCodeFence = output.match(/```[\w+-]*\n([\s\S]*?)```/);
  const jsonFileOperations = mergeByPath(
    normalizeFileOperations(parsedJson?.fileOperations),
    normalizeFileOperations(parsedJson?.operations),
    normalizeFileOperations(parsedJson?.patches),
    normalizeFileOperations(parsedJson?.files),
    normalizeFileOperations(nestedJson?.fileOperations),
    normalizeFileOperations(nestedJson?.operations),
    normalizeFileOperations(nestedJson?.patches),
    normalizeFileOperations(nestedJson?.files),
    fileOperationsFromObjectMap(parsedJson?.files),
    fileOperationsFromObjectMap(parsedJson?.changedFiles),
    fileOperationsFromObjectMap(parsedJson?.filesChanged),
    fileOperationsFromObjectMap(nestedJson?.files),
    fileOperationsFromObjectMap(nestedJson?.changedFiles),
    fileOperationsFromObjectMap(nestedJson?.filesChanged)
  );
  const jsonCommands = uniqueStrings([
    ...normalizeStringArray(parsedJson?.commands),
    ...normalizeStringArray(nestedJson?.commands)
  ]);

  let normalizedPatches = patches;
  if (normalizedPatches.length === 0 && expectedPaths.length === 1 && fallbackCodeFence?.[1]) {
    normalizedPatches = [
      {
        path: expectedPaths[0],
        content: cleanCode(fallbackCodeFence[1])
      }
    ];
  }

  const fileOperations = jsonFileOperations.length > 0
    ? jsonFileOperations
    : fileOperationsFromPatches(normalizedPatches);
  const normalizedPatchesForApply = normalizedPatches.length > 0
    ? normalizedPatches
    : fileOperations.map((operation) => ({
        path: operation.path,
        content: operation.content
      }));

  const normalizedAffectedFiles =
    affectedFiles.length > 0
      ? affectedFiles
      : fileOperations.length > 0
        ? fileOperations.map((operation) => operation.path).filter(Boolean)
        : normalizedPatches.map((patch) => patch.path).filter(Boolean);

  return {
    summary: parsedJson?.summary || summary || "DEV completed an implementation pass.",
    rationale: rationale || "Reviewed the project context, likely failure points, and the recommended fix.",
    proposedChanges:
      proposedChanges.length > 0
        ? proposedChanges
        : fileOperations.map((operation) => `Write ${operation.path} from the DEV implementation.`),
    affectedFiles: normalizedAffectedFiles,
    commandRequests: jsonCommands.length > 0 ? jsonCommands : commandRequests,
    patches: normalizedPatchesForApply,
    fileOperations,
    fixedCode: fileOperations[0]?.content || normalizedPatchesForApply[0]?.content || cleanCode(fallbackCodeFence?.[1] || output),
    recommendation: parsedJson?.recommendation || recommendation || output.trim()
  };
}

function findNestedOperationContainer(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidates = [
    value?.result,
    value?.dev,
    value?.output,
    value?.response,
    value?.data,
    value?.payload,
    value?.changes
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    if (
      Array.isArray(candidate?.fileOperations) ||
      Array.isArray(candidate?.operations) ||
      Array.isArray(candidate?.patches) ||
      Array.isArray(candidate?.files) ||
      (candidate?.files && typeof candidate.files === "object") ||
      (candidate?.changedFiles && typeof candidate.changedFiles === "object")
    ) {
      return candidate;
    }
  }

  return null;
}

function extractJsonObject(output) {
  const text = String(output || "").trim();
  if (!text) {
    return null;
  }

  const candidates = [];
  const fencedJson = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]);
  candidates.push(...fencedJson);
  candidates.push(text);

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {}
  }

  return null;
}

function normalizePmArchitecture(parsed, input, previous = null, rawOutput = "") {
  const intent = analyzeProjectIntent(input);
  const fallbackName = deriveProjectName(input);
  const taskName = extractSection(rawOutput, "TASK").split(/\r?\n/)[0];
  const projectName = normalizeTitle(parsed?.projectName || previous?.projectName || taskName || fallbackName);
  const projectSlug = sanitizeProjectSlug(parsed?.projectSlug || projectName) || sanitizeProjectSlug(previous?.projectSlug) || createFallbackTaskSlug();
  const sectionFiles = parseFileArchitectureFromSection(rawOutput);
  const fileArchitecture = normalizeFileArchitecture(
    parsed?.fileArchitecture || (sectionFiles.length > 0 ? sectionFiles : null),
    parsed?.requiredFiles
    ,
    intent
  );
  const sectionCommandRequests = uniqueStrings([
    ...extractListSection(rawOutput, "COMMAND_REQUESTS"),
    ...extractListSection(rawOutput, "SETUP_COMMANDS")
  ]);
  const sectionPlan = [
    ...extractListSection(rawOutput, "ACCEPTANCE"),
    ...extractListSection(rawOutput, "NOTES")
  ];
  const implementationPlan = normalizeStringArray(parsed?.implementationPlan).length > 0
    ? normalizeStringArray(parsed?.implementationPlan)
    : sectionPlan;
  const requiredFiles = normalizeStringArray(parsed?.requiredFiles).length > 0
    ? normalizeStringArray(parsed?.requiredFiles)
    : fileArchitecture.map((file) => file.path);
  const setupCommands = uniqueStrings([
    ...normalizeStringArray(parsed?.setupCommands),
    ...sectionCommandRequests,
    ...defaultSetupCommandsForIntent(intent, fileArchitecture)
  ]);

  return {
    projectName,
    projectSlug,
    fileArchitecture,
    implementationPlan: implementationPlan.length > 0
      ? implementationPlan
      : defaultImplementationPlanForIntent(intent, fileArchitecture),
    requiredFiles,
    setupCommands,
    qaInstruction:
      String(parsed?.qaInstruction || previous?.qaInstruction || defaultQaInstructionForIntent(intent)).trim()
  };
}

function parseFileArchitectureFromSection(output) {
  return extractListSection(output, "FILES")
    .map((item) => {
      const text = String(item || "").trim();
      const pathMatch = text.match(/`?([A-Za-z0-9._/-]+\.[A-Za-z0-9]+)`?/);
      const path = toProjectPath(pathMatch?.[1] || text.split(/\s+-\s+|\s+--\s+|\s+purpose\s*:/i)[0]);

      return {
        path,
        purpose: text.replace(pathMatch?.[0] || path, "").replace(/^[-:\s]+/, "").trim() || "Required project file"
      };
    })
    .filter((item) => item.path);
}

function normalizeQaStructureReview(parsed, pmArchitecture) {
  const issues = normalizeStringArray(parsed?.issues);
  const devChecklist = normalizeStringArray(parsed?.devChecklist);
  const slug = pmArchitecture?.projectSlug || "";
  const architecture = Array.isArray(pmArchitecture?.fileArchitecture) ? pmArchitecture.fileArchitecture : [];
  const hardValidationIssues = [];

  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) {
    hardValidationIssues.push("projectSlug must be lowercase kebab-case and max 40 characters.");
  }

  if (architecture.length === 0) {
    hardValidationIssues.push("fileArchitecture must include at least one file.");
  }

  const guidanceIssues = issues.filter((issue) => !hardValidationIssues.includes(issue));
  const approved = hardValidationIssues.length === 0;

  return {
    approved,
    issues: [...hardValidationIssues, ...guidanceIssues],
    hardValidationIssues,
    devChecklist: devChecklist.length > 0
      ? devChecklist
      : (pmArchitecture?.implementationPlan || architecture.map((file) => `Create ${file.path}`))
  };
}

function buildExistingProjectQaReview({ prd, files, input }) {
  const requestedFiles = (files || []).map((file) => file.path).filter(Boolean);
  const devChecklist = [
    requestedFiles.length > 0
      ? `Edit only the queued project files unless a small supporting file is clearly required.`
      : "Edit the smallest existing project surface that satisfies the request.",
    "Keep the implementation aligned with the current project structure and requested scope.",
    "Do not create a new project folder or regenerate the project architecture.",
    "Return concise fileOperations for the files being changed."
  ];

  const requestedFeature = String(input || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (requestedFeature) {
    devChecklist.unshift(`Implement this request: ${trimForPrompt(requestedFeature, 160)}`);
  }

  return {
    approved: true,
    issues: [],
    hardValidationIssues: [],
    devChecklist,
    mode: "existing-project",
    summary: `QA skipped project-creation structure review because the project already exists.${prd?.summary ? ` ${trimForPrompt(prd.summary, 180)}` : ""}`
  };
}

function formatQaStructureReview(review) {
  return JSON.stringify(
    {
      approved: Boolean(review?.approved),
      issues: Array.isArray(review?.issues) ? review.issues : [],
      devChecklist: Array.isArray(review?.devChecklist) ? review.devChecklist : []
    },
    null,
    2
  );
}

function normalizeFileArchitecture(fileArchitecture, requiredFiles, intent = null) {
  const fromArchitecture = Array.isArray(fileArchitecture)
    ? fileArchitecture.map((item) => ({
        path: toProjectPath(item?.path || item),
        purpose: String(item?.purpose || "Required project file").trim()
      }))
    : [];
  const fromRequired = normalizeStringArray(requiredFiles).map((filePath) => ({
    path: toProjectPath(filePath),
    purpose: "Required project file"
  }));
  const merged = [...fromArchitecture, ...fromRequired].filter((item) => item.path);
  const unique = [];
  const seen = new Set();

  for (const item of merged) {
    if (seen.has(item.path)) {
      continue;
    }

    seen.add(item.path);
    unique.push(item);
  }

  return unique.length > 0
    ? unique
    : defaultFileArchitectureForIntent(intent);
}

function analyzeProjectIntent(input) {
  const text = String(input || "").toLowerCase();
  return {
    wantsVite: /\bvite\b/.test(text),
    wantsReact: /\breact\b/.test(text),
    wantsShadcn: /\bshadcn\b|\bshadcn\/ui\b/.test(text),
    wantsTailwind: /\btailwind\b/.test(text),
    wantsDashboard: /\bdashboard\b/.test(text),
    wantsCrud: /\bcrud\b/.test(text),
    wantsTodo: /\bto-?do\b/.test(text)
  };
}

function isModernReactAppIntent(intent) {
  return Boolean(intent?.wantsVite || intent?.wantsReact || intent?.wantsShadcn);
}

function defaultFileArchitectureForIntent(intent) {
  if (isModernReactAppIntent(intent)) {
    return [
      { path: "package.json", purpose: "Vite React app dependencies and scripts" },
      { path: "index.html", purpose: "Vite HTML shell" },
      { path: "vite.config.js", purpose: "Vite config" },
      { path: "jsconfig.json", purpose: "Path alias support for src imports" },
      { path: "src/main.jsx", purpose: "React entry point" },
      { path: "src/App.jsx", purpose: "Dashboard shell and CRUD flow" },
      { path: "src/index.css", purpose: "Global styles and tokens" },
      { path: "src/lib/utils.js", purpose: "shadcn utility helpers" },
      { path: "components.json", purpose: "shadcn/ui component registry config" },
      { path: "src/components/ui/button.jsx", purpose: "shadcn button component" },
      { path: "src/components/ui/card.jsx", purpose: "shadcn card component" },
      { path: "src/components/ui/input.jsx", purpose: "shadcn input component" },
      { path: "src/components/ui/dialog.jsx", purpose: "shadcn dialog component for CRUD editing" }
    ];
  }

  return [{ path: "index.html", purpose: "Single-file app entry point" }];
}

function defaultImplementationPlanForIntent(intent, fileArchitecture) {
  if (isModernReactAppIntent(intent)) {
    const plan = [
      "Create a real Vite + React project structure with package.json and src entry files.",
      intent?.wantsShadcn
        ? "Implement reusable shadcn/ui-style components and utilities instead of raw HTML controls."
        : "Implement reusable React UI components for the requested feature set.",
      intent?.wantsCrud || intent?.wantsTodo
        ? "Build client-side CRUD flows for todo items with create, update, delete, and status changes."
        : "Build the requested interactive application flows.",
      intent?.wantsDashboard
        ? "Compose the UI as a dashboard layout with data panels and action surfaces."
        : "Compose the UI as a structured app layout.",
      "Run install and build checks so the output is runnable."
    ];
    return uniqueStrings(plan);
  }

  return fileArchitecture.map((file) => `Create ${file.path}`);
}

function defaultSetupCommandsForIntent(intent, fileArchitecture) {
  const filePaths = new Set((fileArchitecture || []).map((file) => file?.path).filter(Boolean));
  if (isModernReactAppIntent(intent) || filePaths.has("package.json")) {
    return ["npm install", "npm run build"];
  }

  return [];
}

function defaultQaInstructionForIntent(intent) {
  if (isModernReactAppIntent(intent)) {
    return "Verify the Vite React app installs, builds, and uses reusable component structure instead of a single-file fallback.";
  }

  return "Verify required files and FSD alignment.";
}

function normalizeFileOperations(fileOperations) {
  if (!Array.isArray(fileOperations)) {
    return [];
  }

  return fileOperations
    .map((operation) => {
      const content =
        operation?.content ??
        operation?.fullContent ??
        operation?.fileContent ??
        operation?.code ??
        operation?.source ??
        operation?.text ??
        operation?.body ??
        "";

      return {
        action: normalizeFileOperationAction(operation?.action),
        path: toProjectPath(
          operation?.path ||
          operation?.file ||
          operation?.filePath ||
          operation?.filepath ||
          operation?.filename ||
          operation?.target ||
          operation?.name ||
          ""
        ),
        content: typeof content === "string" ? content : String(content || "")
      };
    })
    .filter((operation) => operation.action === "write" && operation.path);
}

function normalizeFileOperationAction(value) {
  const action = String(value || "write").trim().toLowerCase();
  if (!action || ["write", "create", "update", "modify", "edit", "replace", "overwrite", "upsert"].includes(action)) {
    return "write";
  }

  return action;
}

function fileOperationsFromPatches(patches) {
  return (patches || [])
    .map((patch) => ({
      action: "write",
      path: toProjectPath(patch.path),
      content: String(patch.content || "")
    }))
    .filter((operation) => operation.path);
}

function fileOperationsFromObjectMap(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return [];
  }

  return Object.entries(value)
    .map(([filePath, content]) => ({
      action: "write",
      path: toProjectPath(filePath),
      content: typeof content === "string"
        ? content
        : String(content?.content || content?.fullContent || content?.fileContent || content?.code || content?.source || "")
    }))
    .filter((operation) => operation.path);
}

function normalizeExpectedFilePaths(filesAnalyzed = [], expectedArchitecture = null) {
  return uniqueStrings([
    ...(filesAnalyzed || []).map((file) => file?.path),
    ...(expectedArchitecture?.fileArchitecture || []).map((file) => file?.path || file),
    ...(expectedArchitecture?.requiredFiles || [])
  ])
    .map(toProjectPath)
    .filter(Boolean);
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
  }

  return [];
}

function deriveProjectName(input) {
  const text = String(input || "").trim();
  const titleMatch = text.match(/(?:fsd\s*)?(?:title|project\s*name|project)\s*[:#-]\s*["']?([^\n."]+)/i);
  if (titleMatch?.[1]) {
    return normalizeTitle(titleMatch[1]);
  }

  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
  const firstNamedToken = firstLine.match(/^([A-Z][A-Za-z0-9_-]{2,40})(?:\s|:|-|$)/);
  if (firstNamedToken?.[1]) {
    return normalizeTitle(firstNamedToken[1]);
  }

  return normalizeTitle(firstLine.split(/\s+/).slice(0, 5).join(" ")) || "Task";
}

function normalizeTitle(value) {
  return String(value || "")
    .replace(/[`*_#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Task";
}

function sanitizeProjectSlug(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40)
    .replace(/-+$/g, "");
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

function createFallbackTaskSlug() {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `task-${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function buildPrd(pmPlan, contextDocuments = [], input = "", pmArchitecture = null) {
  const goals = extractListSection(pmPlan, "PRD_GOALS");
  const features = extractListSection(pmPlan, "FEATURES");
  const constraints = extractListSection(pmPlan, "CONSTRAINTS");
  const phases = extractListSection(pmPlan, "PHASES");
  const tasks = extractListSection(pmPlan, "TASKS");

  return {
    summary: pmArchitecture?.qaInstruction || extractSection(pmPlan, "QA_INSTRUCTION") || summarizePlan(pmPlan, input),
    goals: goals.length ? goals : ["Deliver the requested software change within the selected project context."],
    features: features.length ? features : (pmArchitecture?.implementationPlan || ["Implement the user-requested functionality."]),
    constraints: constraints.length ? constraints : [`Keep new files under "${SANDBOX_FOLDER_NAME}/" unless updating selected existing files.`],
    phases: phases.length ? phases : ["Phase 1: Setup", "Phase 2: Core Features", "Phase 3: Testing"],
    tasks: tasks.length
      ? tasks
      : (pmArchitecture?.implementationPlan || ["Confirm scope", "Implement feature", "Run checks"]).map((task, index) => `[Phase ${Math.min(index + 1, 3)}] ${task}`),
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
  const finalStatus = extractSection(output, "FINAL_STATUS") || extractSection(output, "FINAL STATUS");
  return {
    summary: extractSection(output, "SUMMARY") || finalStatus || extractSection(output, "QA_INSTRUCTION") || fallbackSummary,
    rationale: extractSection(output, "RATIONALE") || extractSection(output, "REASON") || toPublicRationale(output),
    affectedFiles: extractListSection(output, "AFFECTED_FILES"),
    proposedChanges: extractListSection(output, "PROPOSED_CHANGES"),
    commandRequests: uniqueStrings([
      ...extractListSection(output, "COMMAND_REQUESTS"),
      ...extractListSection(output, "SETUP_COMMANDS")
    ]),
    patches: [],
    recommendation: extractSection(output, "RECOMMENDATION") || output.trim(),
    fixedCode: "",
    decisionStatus: inferPmDecisionStatus(finalStatus || output)
  };
}

function inferPmDecisionStatus(output) {
  const text = String(output || "").trim();
  if (!text) {
    return "pending";
  }

  if (/needs\s+patch/i.test(text) || /fail/i.test(text)) {
    return "needs_patch";
  }

  if (/\bpass\b/i.test(text) || /approved"\s*:\s*true/i.test(text)) {
    return "pending";
  }

  return "pending";
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

function buildPipelineResult({ explanation, critique, files, filesAnalyzed, leadResult, loopCount, project, qaInstructions, qaStructureReview, pmPlan, pmDecision }) {
  const pmPlanResult = buildPmResult(pmPlan, "");
  const pmDecisionResult = buildPmResult(pmDecision, "");
  const pmCommandRequests = uniqueStrings([
    ...(project?.architecture?.setupCommands || []),
    ...(pmPlanResult.commandRequests || []),
    ...(leadResult.commandRequests || [])
  ]);
  const decisionStatus = pmDecisionResult.decisionStatus || "pending";
  const decisionSummary = pmDecisionResult.rationale || leadResult.summary;
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
      summary: decisionSummary,
      affectedFiles: leadResult.affectedFiles,
      proposedChanges: leadResult.proposedChanges,
      canApply: leadResult.patches.length > 0,
      decisionStatus: decisionStatus,
      verdict: pmDecisionResult.summary || ""
    },
    workflow: {
      folderLoaded: true,
      contextReady: files.length > 0 || Boolean(project?.fsd),
      currentStage: "decision",
      loopCount,
      decisionStatus: decisionStatus,
      currentPhase: project?.phases?.[0]?.name || "Phase 1",
      currentTask: project?.tasks?.find((task) => task.status !== "done")?.title || "Review decision",
      iterationCount: loopCount,
      projectStatus: decisionStatus === "needs_patch" ? "Patch required" : "Waiting for decision",
      commandStatus: "idle"
    },
    project,
    pm: {
      plan: pmPlan,
      decision: pmDecision,
      commandRequests: pmCommandRequests
    },
    qa: {
      instructions: qaInstructions,
      structureReview: qaStructureReview,
      review: critique.trim()
    },
    dev: {
      implementation: explanation.trim(),
      summary: leadResult.summary,
      fileOperations: leadResult.fileOperations || [],
      commands: leadResult.commandRequests || [],
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

function buildSupervisorSpecSystemPrompt() {
  return [
    "You are the Supervisor/PM.",
    "Create a concise implementation spec for the dev pipeline.",
    "Do not write code. Do not over-explain.",
    "Name expected files and folders. Define acceptance tests.",
    "If project setup commands are required, include only safe local commands such as npm install or npm run build.",
    "Keep output under 300 tokens.",
    "Output format:",
    "TASK:",
    "FILES:",
    "CONSTRAINTS:",
    "ACCEPTANCE:",
    "COMMAND_REQUESTS:",
    "NOTES:"
  ].join("\n");
}

function buildJuniorInitialSystemPrompt() {
  return [
    "You are Junior Dev and local patch applier.",
    "Implement the Supervisor spec.",
    "Edit only listed/relevant files.",
    "Do not create extra folders. Do not rename files unless required.",
    "Do not redesign the app.",
    "No long explanations.",
    "Return machine-readable fileOperations when creating or editing files.",
    "Max output: 800 tokens."
  ].join("\n");
}

function buildSeniorParallelSystemPrompt() {
  return [
    "You are Senior Dev / QA.",
    "Work in parallel with Junior Dev.",
    "Review the Supervisor spec.",
    "Predict bugs, missing requirements, edge cases, and likely implementation mistakes.",
    "Suggest exact fixes and tests.",
    "Do not edit files directly. Do not rewrite the whole project.",
    "Keep output under 600 tokens.",
    "Output format:",
    "PASS/FAIL RISK:",
    "RISKS:",
    "EDGE CASES:",
    "FILES TO CHECK:",
    "PATCH SUGGESTIONS:",
    "TESTS:"
  ].join("\n");
}

function buildJuniorPatchSystemPrompt() {
  return [
    "You are Junior Dev applying Senior Dev review.",
    "Use the original Supervisor spec and Senior Dev notes.",
    "Apply only necessary fixes.",
    "Do not rewrite completed work.",
    "Do not create new folders unless required.",
    "Return only changed files and concise summary.",
    "Return machine-readable fileOperations for changed files.",
    "Max output: 700 tokens."
  ].join("\n");
}

function buildSeniorFinalReviewSystemPrompt() {
  return [
    "You are Senior Dev / QA performing final verification.",
    "Check the final output against the original task, acceptance checklist, changed files, and known risks.",
    "Do not edit files directly. Do not output code.",
    "Return only:",
    "FINAL REVIEW:",
    "PASS / NEEDS PATCH",
    "ISSUES:",
    "- none / issue list",
    "REQUIRED FIXES:",
    "- none / exact fixes"
  ].join("\n");
}

function buildSupervisorFinalSystemPrompt() {
  return [
    "You are the Supervisor/PM.",
    "Check if the result satisfies acceptance.",
    "If Senior Dev final review is unavailable, decide from the Junior output, changed files, and checklist. Do not fail only because the review is unavailable.",
    "Do not write code. Keep the decision short.",
    "Return only:",
    "FINAL STATUS:",
    "PASS / NEEDS PATCH",
    "REASON:",
    "short reason"
  ].join("\n");
}

function trackAgentCall(promise) {
  const task = {
    settled: false,
    result: null,
    promise: null
  };

  task.promise = promise.then(
    (value) => {
      task.settled = true;
      task.result = { status: "fulfilled", value };
      return task.result;
    },
    (reason) => {
      task.settled = true;
      task.result = { status: "rejected", reason };
      return task.result;
    }
  );

  return task;
}

async function waitForTrackedAgent(task, timeoutMs) {
  if (!task) {
    return null;
  }

  if (task.settled) {
    return task.result;
  }

  if (!timeoutMs || timeoutMs <= 0) {
    return null;
  }

  return Promise.race([task.promise, delay(timeoutMs).then(() => null)]);
}

function formatAgentFailure(error) {
  return String(error?.message || error || "Unknown agent failure").trim();
}

function mergeLeadResults(initialResult, patchResult) {
  const initial = initialResult || {};
  const patch = patchResult || {};
  const fileOperations = mergeByPath(initial.fileOperations || [], patch.fileOperations || []);
  const patches = fileOperations.length > 0
    ? fileOperations.map((operation) => ({ path: operation.path, content: operation.content }))
    : mergeByPath(initial.patches || [], patch.patches || []);
  const affectedFiles = uniqueStrings([
    ...(initial.affectedFiles || []),
    ...(patch.affectedFiles || []),
    ...fileOperations.map((operation) => operation.path)
  ]);

  return {
    ...initial,
    ...patch,
    summary: patch.summary && patch.summary !== "DEV completed an implementation pass." ? patch.summary : initial.summary,
    rationale: patch.rationale || initial.rationale,
    proposedChanges: uniqueStrings([...(initial.proposedChanges || []), ...(patch.proposedChanges || [])]),
    affectedFiles,
    commandRequests: uniqueStrings([...(initial.commandRequests || []), ...(patch.commandRequests || [])]),
    patches,
    fileOperations,
    fixedCode: fileOperations[0]?.content || patches[0]?.content || patch.fixedCode || initial.fixedCode || "",
    recommendation: patch.recommendation || initial.recommendation
  };
}

function mergeByPath(...itemGroups) {
  const merged = new Map();

  for (const item of itemGroups.flatMap((items) => items || [])) {
    const path = toProjectPath(item?.path || "");
    if (!path) {
      continue;
    }

    merged.set(path.toLowerCase(), {
      ...item,
      path
    });
  }

  return [...merged.values()];
}

function uniqueStrings(items) {
  const seen = new Set();
  const unique = [];

  for (const item of items || []) {
    const value = String(item || "").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(value);
  }

  return unique;
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

function buildSupervisorSpecContext({ compactContext, feedback, revisionBrief, loopCount, isExistingProjectRequest = false }) {
  const intent = analyzeProjectIntent(compactContext);
  return [
    trimForPrompt(compactContext, isExistingProjectRequest ? 7000 : 12000),
    feedback ? `DENIAL_FEEDBACK_LOOP_${loopCount}:\n${trimForPrompt(feedback, 900)}` : "",
    revisionBrief ? `REVISION_BRIEF:\n${trimForPrompt(revisionBrief, 500)}` : "",
    [
      isExistingProjectRequest
        ? "This is a follow-up request for an existing project. Do not create a new project folder."
        : "This is a project creation or FSD task. Choose a short contextual project name and expected files.",
      isModernReactAppIntent(intent)
        ? "This request implies a modern React app. Do not collapse it into a single-file index.html solution."
        : "Use the smallest coherent file set for the request.",
      intent.wantsShadcn
        ? "For shadcn/ui requests, plan reusable component files, utility helpers, and package.json dependencies needed to build."
        : "Plan reusable files only when the request needs them.",
      "Name only the smallest expected files/folders.",
      "Keep constraints strict so Junior Dev does not redesign or create random folders.",
      "Add COMMAND_REQUESTS only for necessary project setup steps, such as installing dependencies or running a build check.",
      "For FILES, list project-relative paths only.",
      "No raw code."
    ].join("\n")
  ].filter(Boolean).join("\n\n");
}

function buildJuniorInitialContext({
  compactContext,
  prd,
  pmPlan,
  pmArchitecture,
  qaInstructions,
  qaStructureReview,
  language,
  feedback,
  revisionBrief,
  loopCount,
  isExistingProjectRequest = false
}) {
  const intent = analyzeProjectIntent(compactContext);
  return [
    trimForPrompt(compactContext, isExistingProjectRequest ? 3200 : 5200),
    `SUPERVISOR_SPEC:\n${trimForPrompt(pmPlan, 1200)}`,
    `PRD:\n${formatPrdForPrompt(prd, { compact: true })}`,
    ...(isExistingProjectRequest
      ? []
      : [`EXPECTED_ARCHITECTURE:\n${JSON.stringify(pmArchitecture || {}, null, 2)}`]),
    `DEV_CHECKLIST:\n${trimForPrompt(qaInstructions, 1200)}`,
    ...(isExistingProjectRequest
      ? []
      : [`LOCAL_STRUCTURE_CHECK:\n${JSON.stringify(qaStructureReview || {}, null, 2)}`]),
    `Preferred language: ${language}`,
    feedback ? `DENIAL_FEEDBACK_LOOP_${loopCount}:\n${trimForPrompt(feedback, 700)}` : "",
    revisionBrief ? `REVISION_BRIEF:\n${trimForPrompt(revisionBrief, 700)}` : "",
    [
      "Implement only the current task scope.",
      "Only Junior Dev may create/edit files.",
      "Use project-relative paths only, such as index.html or src/main.js.",
      "Do not include sandbox/tasks or absolute paths.",
      isModernReactAppIntent(intent)
        ? "For Vite/React requests, create a real package.json + src/ React app structure. Do not fall back to a static single-file page."
        : "Use the simplest valid project structure for the request.",
      intent.wantsShadcn
        ? "For shadcn/ui requests, implement reusable shadcn-style component files, utility helpers, and the dependency manifest needed for them."
        : "Create reusable components only if they materially help the request.",
      "Return JSON only:",
      "{",
      '  "summary": "short summary",',
      '  "fileOperations": [{ "action": "write", "path": "index.html", "content": "<!DOCTYPE html>..." }],',
      '  "commands": [],',
      '  "recommendation": "short recommendation"',
      "}"
    ].join("\n")
  ].filter(Boolean).join("\n\n");
}

function buildSeniorParallelContext({ compactContext, prd, pmPlan, pmArchitecture, qaDevHandoff, feedback, revisionBrief, loopCount }) {
  return [
    trimForPrompt(compactContext, 6500),
    `SUPERVISOR_SPEC:\n${trimForPrompt(pmPlan, 1400)}`,
    `PRD:\n${formatPrdForPrompt(prd, { compact: true })}`,
    `EXPECTED_ARCHITECTURE:\n${JSON.stringify(pmArchitecture || {}, null, 2)}`,
    `LOCAL_DEV_CHECKLIST:\n${trimForPrompt(qaDevHandoff, 900)}`,
    feedback ? `DENIAL_FEEDBACK_LOOP_${loopCount}:\n${trimForPrompt(feedback, 800)}` : "",
    revisionBrief ? `REVISION_BRIEF:\n${trimForPrompt(revisionBrief, 700)}` : "",
    [
      "You are read-only. Do not return full files.",
      "Focus on likely Junior Dev mistakes, edge cases, and exact tests.",
      "Patch suggestions must be small and targeted."
    ].join("\n")
  ].filter(Boolean).join("\n\n");
}

function buildJuniorPatchContext({
  compactContext,
  prd,
  pmPlan,
  pmArchitecture,
  juniorInitialOutput,
  juniorInitialLeadResult,
  seniorParallelReview,
  feedback,
  revisionBrief,
  loopCount,
  isExistingProjectRequest = false
}) {
  return [
    trimForPrompt(compactContext, isExistingProjectRequest ? 2400 : 3400),
    `SUPERVISOR_SPEC:\n${trimForPrompt(pmPlan, 1000)}`,
    `PRD:\n${formatPrdForPrompt(prd, { compact: true })}`,
    ...(isExistingProjectRequest
      ? []
      : [`EXPECTED_ARCHITECTURE:\n${JSON.stringify(pmArchitecture || {}, null, 2)}`]),
    `JUNIOR_INITIAL_CHANGED_FILES:\n${(juniorInitialLeadResult.affectedFiles || []).join("\n")}`,
    `JUNIOR_INITIAL_OUTPUT:\n${trimForPrompt(juniorInitialOutput, 5200)}`,
    `SENIOR_DEV_NOTES:\n${trimForPrompt(seniorParallelReview, 2400)}`,
    feedback ? `DENIAL_FEEDBACK_LOOP_${loopCount}:\n${trimForPrompt(feedback, 700)}` : "",
    revisionBrief ? `REVISION_BRIEF:\n${trimForPrompt(revisionBrief, 700)}` : "",
    [
      "Apply only necessary fixes from Senior Dev notes.",
      "If no fixes are needed, return an empty fileOperations array.",
      "When changing a file, return full replacement content for that file.",
      "Return JSON only with summary, fileOperations, commands, recommendation."
    ].join("\n")
  ].filter(Boolean).join("\n\n");
}

function buildSeniorFinalReviewContext({ compactContext, prd, pmPlan, seniorParallelReview, finalDevOutput, finalLeadResult, feedback, revisionBrief, loopCount }) {
  return [
    trimForPrompt(compactContext, 4200),
    `SUPERVISOR_SPEC:\n${trimForPrompt(pmPlan, 1100)}`,
    `PRD:\n${formatPrdForPrompt(prd, { compact: true })}`,
    `SENIOR_PARALLEL_NOTES:\n${trimForPrompt(seniorParallelReview, 1200)}`,
    `FINAL_CHANGED_FILES:\n${(finalLeadResult.affectedFiles || []).join("\n")}`,
    `FINAL_FILE_OPERATIONS:\n${trimForPrompt(JSON.stringify(finalLeadResult.fileOperations || [], null, 2), 3200)}`,
    `FINAL_DEV_OUTPUT:\n${trimForPrompt(finalDevOutput, 2800)}`,
    feedback ? `DENIAL_FEEDBACK_LOOP_${loopCount}:\n${trimForPrompt(feedback, 700)}` : "",
    revisionBrief ? `REVISION_BRIEF:\n${trimForPrompt(revisionBrief, 700)}` : ""
  ].filter(Boolean).join("\n\n");
}

function buildSupervisorFinalContext({
  compactContext,
  prd,
  pmPlan,
  qaInstructions,
  devOutput,
  qaReview,
  qaReviewAvailable,
  devLeadResult,
  language,
  feedback,
  revisionBrief,
  loopCount,
  isExistingProjectRequest = false
}) {
  return [
    trimForPrompt(compactContext, isExistingProjectRequest ? 3000 : 4200),
    `SUPERVISOR_SPEC:\n${trimForPrompt(pmPlan, 1000)}`,
    `PRD:\n${formatPrdForPrompt(prd, { compact: true })}`,
    `DEV_CHECKLIST:\n${trimForPrompt(qaInstructions, 800)}`,
    `JUNIOR_DEV_OUTPUT:\n${trimForPrompt(devOutput, 1800)}`,
    `SENIOR_FINAL_REVIEW_AVAILABLE: ${qaReviewAvailable ? "yes" : "no"}`,
    `SENIOR_FINAL_REVIEW:\n${trimForPrompt(qaReview, 1400)}`,
    `CHANGED_FILES:\n${(devLeadResult.affectedFiles || []).join("\n")}`,
    `Preferred language: ${language}`,
    feedback ? `DENIAL_FEEDBACK_LOOP_${loopCount}:\n${trimForPrompt(feedback, 700)}` : "",
    revisionBrief ? `REVISION_BRIEF:\n${trimForPrompt(revisionBrief, 700)}` : ""
  ].filter(Boolean).join("\n\n");
}

function buildPmPlanningContext({ compactContext, feedback, revisionBrief, loopCount, qaFeedback = [], isExistingProjectRequest = false }) {
  const intent = analyzeProjectIntent(compactContext);
  if (isExistingProjectRequest) {
    return [
      trimForPrompt(compactContext, 7000),
      feedback
        ? `Previous result was denied in loop ${loopCount}. Address this feedback in the plan:\n${trimForPrompt(feedback, 900)}`
        : "",
      revisionBrief ? `REVISION_BRIEF:\n${trimForPrompt(revisionBrief, 500)}` : "",
      [
        "This is a follow-up request for an existing project.",
        "Do not redesign the whole project or restate the full architecture.",
        "Return JSON only with the smallest affected implementation plan:",
        "{",
        '  "projectName": "Current Project",',
        '  "projectSlug": "current-project",',
        '  "fileArchitecture": [{ "path": "existing/file.ext", "purpose": "Touched by this request" }],',
        '  "implementationPlan": ["Update the touched files for this request"],',
        '  "requiredFiles": ["existing/file.ext"],',
        '  "qaInstruction": "Verify only the touched scope and affected files."',
        "}"
      ].join("\n")
    ].filter(Boolean).join("\n\n");
  }

  return [
    trimForPrompt(compactContext, 14000),
    feedback
      ? `Previous result was denied in loop ${loopCount}. Address this feedback in the plan:\n${trimForPrompt(feedback, 1200)}`
      : "",
    normalizeStringArray(qaFeedback).length > 0
      ? `QA_STRUCTURE_FEEDBACK:\n${normalizeStringArray(qaFeedback).map((issue) => `- ${issue}`).join("\n")}`
      : "",
    revisionBrief ? `REVISION_BRIEF:\n${trimForPrompt(revisionBrief, 800)}` : "",
    [
      "Create the project architecture from the provided FSD/docs/request.",
      "Do not output raw code.",
      "Extract a short projectName from the FSD title/project name when present.",
      "projectSlug must be lowercase kebab-case, remove special characters, max 40 chars.",
      "If there is no usable title, use a slug like task-YYYYMMDD-HHMMSS.",
      isModernReactAppIntent(intent)
        ? "If the request implies Vite/React, return a multi-file app architecture with package.json, src entry files, and any component/util files needed."
        : "Use the smallest architecture that can satisfy the request.",
      intent.wantsShadcn
        ? "If the request mentions shadcn/ui, include component files, utility helpers, and setupCommands for installing and building."
        : "Only include setupCommands when project install/build steps are genuinely required.",
      "Return JSON only with this shape:",
      "{",
      '  "projectName": "Simple Admin Dashboard",',
      '  "projectSlug": "simple-admin-dashboard",',
      '  "fileArchitecture": [{ "path": "package.json", "purpose": "Vite React app dependencies and scripts" }, { "path": "src/App.jsx", "purpose": "Main dashboard UI" }],',
      '  "implementationPlan": ["Create the Vite React project structure", "Build the dashboard UI and CRUD flows"],',
      '  "requiredFiles": ["package.json", "src/main.jsx", "src/App.jsx"],',
      '  "setupCommands": ["npm install", "npm run build"],',
      '  "qaInstruction": "Verify required files and FSD alignment."',
      "}"
    ].join("\n")
  ].filter(Boolean).join("\n\n");
}

function buildQaInstructionContext({ compactContext, prd, pmPlan, pmArchitecture, feedback, revisionBrief, loopCount }) {
  const intent = analyzeProjectIntent(compactContext);
  return [
    trimForPrompt(compactContext, 7000),
    `PM_PRD:\n${formatPrdForPrompt(prd, { compact: true })}`,
    `PM_PLAN:\n${trimForPrompt(pmPlan, 1800)}`,
    `PM_FILE_ARCHITECTURE:\n${JSON.stringify(pmArchitecture || {}, null, 2)}`,
    feedback ? `DENIAL_FEEDBACK_LOOP_${loopCount}:\n${trimForPrompt(feedback, 1200)}` : "",
    revisionBrief ? `REVISION_BRIEF:\n${trimForPrompt(revisionBrief, 800)}` : "",
    [
      "Verify the PM file structure before DEV starts.",
      "Check required files match the FSD, no unnecessary folders, valid projectSlug, and realistic scope.",
      isModernReactAppIntent(intent)
        ? "If this is a Vite/React request, reject single-file fallback structures and require installable/buildable app files."
        : "Allow a small file set when the request is simple.",
      "Do not write implementation code.",
      "Return JSON only with this shape:",
      "{",
      '  "approved": true,',
      '  "issues": [],',
      '  "devChecklist": [',
      '    "Create index.html",',
      '    "Include required UI/features from the FSD",',
      '    "Implement expected interactions"',
      "  ]",
      "}"
    ].join("\n")
  ].filter(Boolean).join("\n\n");
}

function buildDevImplementationContext({ compactContext, prd, pmPlan, pmArchitecture, qaInstructions, qaStructureReview, language, feedback, revisionBrief, loopCount, isExistingProjectRequest = false }) {
  const intent = analyzeProjectIntent(compactContext);
  return [
    trimForPrompt(compactContext, isExistingProjectRequest ? 2800 : 4500),
    `PRD:\n${formatPrdForPrompt(prd, { compact: true })}`,
    `PM_DIRECTION:\n${trimForPrompt(pmPlan, isExistingProjectRequest ? 500 : 900)}`,
    ...(isExistingProjectRequest
      ? []
      : [`PM_FILE_ARCHITECTURE:\n${JSON.stringify(pmArchitecture || {}, null, 2)}`]),
    `QA_DEV_STEPS:\n${trimForPrompt(qaInstructions, 1200)}`,
    ...(isExistingProjectRequest
      ? []
      : [`QA_STRUCTURE_REVIEW:\n${JSON.stringify(qaStructureReview || {}, null, 2)}`]),
    `Preferred language: ${language}`,
    feedback ? `DENIAL_FEEDBACK_LOOP_${loopCount}:\n${trimForPrompt(feedback, 800)}` : "",
    revisionBrief ? `REVISION_BRIEF:\n${trimForPrompt(revisionBrief, 800)}` : "",
    [
      "Implement only the current task scope.",
      "Create/edit actual files by returning machine-readable fileOperations.",
      "Use project-relative paths only, such as index.html or src/main.js. Do not include sandbox/tasks or absolute paths.",
      isModernReactAppIntent(intent)
        ? "For Vite/React requests, return a real multi-file app with package.json, src/main.jsx, src/App.jsx, and supporting files."
        : "A single-file app is acceptable only if the request is truly simple.",
      intent.wantsShadcn
        ? "For shadcn/ui requests, create reusable component files under src/components/ui and supporting utils/dependencies required to build them."
        : "Use a component structure only when it helps the request.",
      "Keep output concise. Do not include hidden reasoning.",
      "Return JSON only with this shape:",
      "{",
      '  "summary": "Created the requested app.",',
      '  "fileOperations": [',
      '    { "action": "write", "path": "src/App.jsx", "content": "export default function App() { return null; }" }',
      "  ],",
      '  "commands": ["npm install", "npm run build"],',
      '  "recommendation": "Run install and build checks."',
      "}"
    ].join("\n")
  ].filter(Boolean).join("\n\n");
}

function buildQaReviewContext({ compactContext, prd, pmPlan, qaInstructions, devOutput, devLeadResult, feedback, revisionBrief, loopCount }) {
  return [
    trimForPrompt(compactContext, 4500),
    `PRD:\n${formatPrdForPrompt(prd, { compact: true })}`,
    `PM_DIRECTION:\n${trimForPrompt(pmPlan, 800)}`,
    `QA_ORIGINAL_INSTRUCTIONS:\n${trimForPrompt(qaInstructions, 1000)}`,
    `DEV_OUTPUT:\n${trimForPrompt(devOutput, 2200)}`,
    `DEV_AFFECTED_FILES:\n${(devLeadResult.affectedFiles || []).join("\n")}`,
    `DEV_FILE_OPERATIONS:\n${JSON.stringify(devLeadResult.fileOperations || [], null, 2).slice(0, 1400)}`,
    feedback ? `DENIAL_FEEDBACK_LOOP_${loopCount}:\n${trimForPrompt(feedback, 1200)}` : "",
    revisionBrief ? `REVISION_BRIEF:\n${trimForPrompt(revisionBrief, 800)}` : "",
    [
      "Review DEV fileOperations against the PRD and current phase.",
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

function buildPmDecisionContext({ compactContext, prd, pmPlan, qaInstructions, devOutput, qaReview, devLeadResult, language, feedback, revisionBrief, loopCount, isExistingProjectRequest = false }) {
  return [
    trimForPrompt(compactContext, isExistingProjectRequest ? 3600 : 6500),
    `PRD:\n${formatPrdForPrompt(prd, { compact: true })}`,
    `PM_INITIAL_PLAN:\n${trimForPrompt(pmPlan, isExistingProjectRequest ? 700 : 1400)}`,
    `QA_INSTRUCTIONS:\n${trimForPrompt(qaInstructions, isExistingProjectRequest ? 800 : 1400)}`,
    `DEV_IMPLEMENTATION:\n${trimForPrompt(devOutput, isExistingProjectRequest ? 1200 : 2200)}`,
    `QA_REVIEW:\n${trimForPrompt(qaReview, isExistingProjectRequest ? 1000 : 1800)}`,
    `DEV_FILE_PATHS:\n${(devLeadResult.affectedFiles || []).join("\n")}`,
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

function buildAgentTestPrompt(agent, scenario) {
  const prompts = {
    architect: {
      fsd: "Read the provided FSD or project context and return a compact PRD with phases and tasks. Public output only.",
      command: "Read the provided project context and propose the exact safe shell commands the team should run next. Public output only.",
      review: "Read the project context and summarize whether the project scope is feasible. Public output only."
    },
    supervisor: {
      fsd: "Convert the provided PRD or FSD into a short DEV task list and acceptance checks. Public output only.",
      command: "Review the proposed project command plan and identify risks or missing checks. Public output only.",
      review: "Review the provided implementation context and return bugs, alignment issues, and tests. Public output only."
    },
    junior: {
      fsd: "Read the provided scope and explain what files should likely be created first. Public output only.",
      command: "Read the project context and return the next safe command or commands needed to make progress. Public output only.",
      review: "Read the provided task context and outline the implementation plan. Public output only."
    }
  };

  return prompts[agent.id]?.[scenario] || prompts[agent.id]?.fsd || agent.prompts?.system || "";
}

function buildAgentTestInput({ scenario, instruction, contextDocuments, files, projectRoot }) {
  const docs = buildDocumentContextSummary(contextDocuments, null);
  const selectedFiles = (files || [])
    .slice(0, 5)
    .map((file) => `FILE: ${file.path}\n${trimForPrompt(file.content || "", 1800)}`)
    .join("\n\n");

  return [
    `TEST_SCENARIO: ${scenario}`,
    projectRoot ? `PROJECT_ROOT: ${projectRoot}` : "",
    instruction ? `INSTRUCTION:\n${instruction}` : "",
    docs ? `CONTEXT_DOCUMENTS:\n${docs}` : "",
    selectedFiles ? `SELECTED_FILES:\n${selectedFiles}` : "",
    "Keep the output short and public. Do not expose hidden reasoning."
  ]
    .filter(Boolean)
    .join("\n\n");
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

function buildDevHandoffFromQa(qaInstructions, qaStructureReview = null) {
  const checklist = normalizeStringArray(qaStructureReview?.devChecklist);
  if (checklist.length > 0) {
    return trimForPrompt(
      [
        "DEV_CHECKLIST:",
        ...checklist.slice(0, 8).map((item) => `- ${item}`)
      ].join("\n"),
      MAX_DEV_HANDOFF_CHARS
    );
  }

  const devSteps = extractListSection(qaInstructions, "DEV_STEPS").slice(0, 4);
  const acceptanceChecks = extractListSection(qaInstructions, "ACCEPTANCE_CHECKS").slice(0, 2);
  const risks = extractListSection(qaInstructions, "RISKS").slice(0, 2);
  const messageToDev = extractSection(qaInstructions, "MESSAGE_TO_DEV");

  const compact = [
    devSteps.length > 0 ? `DEV_STEPS:\n${devSteps.map((item) => `- ${item}`).join("\n")}` : "",
    acceptanceChecks.length > 0
      ? `ACCEPTANCE_CHECKS:\n${acceptanceChecks.map((item) => `- ${item}`).join("\n")}`
      : "",
    risks.length > 0 ? `RISKS:\n${risks.map((item) => `- ${item}`).join("\n")}` : "",
    messageToDev ? `MESSAGE_TO_DEV:\n${messageToDev}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");

  return trimForPrompt(compact || qaInstructions, MAX_DEV_HANDOFF_CHARS);
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

function extractInlineFileBlocks(output) {
  const text = String(output || "");
  const matches = [...text.matchAll(/(?:^|\n)FILE:\s*([^\n]+)\n([\s\S]*?)(?=\nFILE:\s*[^\n]+\n|$)/gi)];
  const blocks = [];

  for (const match of matches) {
    const filePath = toProjectPath(match[1]);
    const rawContent = String(match[2] || "").trim();
    if (!filePath || !rawContent) {
      continue;
    }

    const content = rawContent.startsWith("```")
      ? cleanCode(rawContent)
      : rawContent
          .replace(/^(SUMMARY|RATIONALE|RECOMMENDATION|COMMAND_REQUESTS|AFFECTED_FILES|PROPOSED_CHANGES):[\s\S]*$/i, "")
          .trim();

    if (!content || blocks.some((block) => block.path.toLowerCase() === filePath.toLowerCase())) {
      continue;
    }

    blocks.push({
      path: filePath,
      content
    });
  }

  return blocks;
}

function extractPathLabeledCodeBlocks(output) {
  const text = String(output || "");
  const blocks = [];
  const codeBlockPattern = /```(?!json\b)[\w+-]*\n([\s\S]*?)```/gi;
  let match;

  while ((match = codeBlockPattern.exec(text))) {
    const preceding = text.slice(Math.max(0, match.index - 240), match.index);
    const labelLine = preceding
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) || "";
    const pathMatch = labelLine.match(/`?([A-Za-z0-9._/-]+\.[A-Za-z0-9]+)`?\s*:?$/);
    const filePath = toProjectPath(pathMatch?.[1] || "");

    if (!filePath || blocks.some((block) => block.path.toLowerCase() === filePath.toLowerCase())) {
      continue;
    }

    blocks.push({
      path: filePath,
      content: cleanCode(match[1])
    });
  }

  return blocks;
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
