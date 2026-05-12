import { Component, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  FlaskConical,
  FileCode2,
  FilePlus2,
  FolderClosed,
  FolderOpen,
  Eye,
  History,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Play,
  Bug,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  ArrowUpDown,
  XCircle
} from "lucide-react";
import { INITIAL_AGENTS } from "./agentViewModels.js";

const LANGUAGES = [
  "auto",
  "JavaScript",
  "TypeScript",
  "React",
  "Python",
  "C++",
  "SQL",
  "CSS",
  "HTML",
  "Markdown"
];

const TYPE_SPEED = 130;
const PUNCTUATION_PAUSE = 550;
const MESSAGE_GAP = 800;
const STAGE_DELAY = MESSAGE_GAP;
const SCENE_DELAY = 850;
const OUTPUT_TABS = ["architect", "supervisor", "junior", "prd", "tasks", "logs", "decision"];
const AGENT_STATUS_KEYS = [
  "idle",
  "thinking",
  "speaking",
  "coding",
  "installing",
  "unpacking",
  "testing",
  "waiting",
  "done",
  "error",
  "received"
];
const JUNIOR_REACTION_MESSAGES = [
  "Got it. I'll adjust the implementation.",
  "I see the QA issue now.",
  "Updating based on the review."
];
const DENY_SCENE_MESSAGES = [
  { from: "junior", to: "team", role: "recovery", message: "I missed something. I'll re-check the implementation." },
  {
    from: "supervisor",
    to: "team",
    role: "recovery",
    message: "Let's review the mistake and tighten the fix."
  },
  {
    from: "architect",
    to: "team",
    role: "recovery",
    message: "I'll adjust scope and rerun the phase."
  }
];
const SUCCESS_SCENE_MESSAGE = "Good job team!";
const AGENT_NAME_STORAGE_KEY = "trifix-agent-names";
const MESSAGE_HOLD = 1600;
const THINKING_CHATTER_MIN = 4000;
const THINKING_CHATTER_MAX = 8000;
const IDLE_CHATTER_MIN = 12000;
const IDLE_CHATTER_MAX = 20000;
const CHATTER_HOLD = 1000;
const CHATTER_MAX_LIFETIME = 8000;
const CHATTER_REPLY_CHANCE = 0.28;
const THINKING_HELP_CHANCE = 0.3;
const ARCHITECT_ENCOURAGEMENT_CHANCE = 0.2;
const MAX_FEASIBILITY_RETRIES = 4;
const phraseBank = {
  general: {
    idle: [
      "No new result yet.",
      "Still monitoring the run.",
      "Waiting for the next step.",
      "Review data is updating."
    ],
    waiting: [
      "Still waiting on input.",
      "Waiting for the next step.",
      "No new result yet."
    ],
    error: [
      "Pipeline halted. Let me check the logs.",
      "We hit a blocker. Review needed.",
      "Process stopped. Waiting for the fix."
    ]
  },
  junior: {
    idle: ["Ready to implement.", "Waiting for the next step.", "Still monitoring the run."],
    thinkingSolo: [
      "Checking the task scope.",
      "Still monitoring the run.",
      "No new result yet."
    ],
    askingHelp: [
      "QA, can you check this later?",
      "I think the implementation path is clear.",
      "PM scope noted."
    ],
    coding: ["Working on the current patch.", "Applying the current change set."],
    waiting: ["Holding here...", "Waiting on the next clue."]
  },
  supervisor: {
    idle: ["Review queue is open.", "Still monitoring the run.", "Waiting for the next step."],
    thinkingSolo: ["Checking review evidence.", "Reviewing DEV output.", "No new result yet."],
    replyToJunior: ["Yeah, I'll check it later.", "Send it over.", "Not bad. Needs review.", "Hold on, I'm looking."],
    coding: ["Cleaning this up.", "Making it less fragile."],
    waiting: ["Waiting, but critically.", "Still reviewing from afar."]
  },
  architect: {
    idle: ["Scope is ready.", "Waiting for the next step.", "Still monitoring the run."],
    thinkingSolo: ["Checking final status.", "Aligning the current work.", "No new result yet."],
    encouragement: ["You guys can do it.", "Good teamwork so far.", "Keep going. Almost there.", "Let's make this production-ready."],
    coding: ["Shaping the final form.", "Trying not to overengineer this."],
    waiting: ["Waiting for the right moment.", "Holding the final call."]
  }
};

export function App() {
  const [activeView, setActiveView] = useState("landing");
  const [activeTab, setActiveTab] = useState("architect");
  const [agentCatalog, setAgentCatalog] = useState(INITIAL_AGENTS);
  const [agents, setAgents] = useState(INITIAL_AGENTS);
  const [agentNames, setAgentNames] = useState(() => loadAgentNames());
  const [project, setProject] = useState(null);
  const [resultProject, setResultProject] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [contextDocuments, setContextDocuments] = useState([]);
  const [codeInput, setCodeInput] = useState("");
  const [language, setLanguage] = useState("auto");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [autonomyRun, setAutonomyRun] = useState(null);
  const [isAutonomyRunning, setIsAutonomyRunning] = useState(false);
  const [settings, setSettings] = useState(null);
  const [trackedProjects, setTrackedProjects] = useState([]);
  const [workflow, setWorkflow] = useState({
    folderLoaded: false,
    contextReady: false,
    currentStage: "idle",
    loopCount: 0,
    decisionStatus: "pending",
    currentPhase: "",
    currentTask: "",
    iterationCount: 0,
    projectStatus: "Not started",
    commandStatus: "idle"
  });
  const [commandLog, setCommandLog] = useState([]);
  const [projectProcesses, setProjectProcesses] = useState([]);
  const [processLogView, setProcessLogView] = useState(null);
  const [isCommandRunning, setIsCommandRunning] = useState(false);
  const [isGraphRunning, setIsGraphRunning] = useState(false);
  const [testerResult, setTesterResult] = useState(null);
  const [isTesterRunning, setIsTesterRunning] = useState(false);
  const [draftProjectName, setDraftProjectName] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [scene, setScene] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [messageQueue, setMessageQueue] = useState([]);
  const [activeMessage, setActiveMessage] = useState(null);
  const [visibleBubble, setVisibleBubble] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionPreview, setDecisionPreview] = useState([]);
  const [decisionMessage, setDecisionMessage] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const [modelAvailability, setModelAvailability] = useState(null);
  const [runPreflight, setRunPreflight] = useState(null);
  const [isDecisionBusy, setIsDecisionBusy] = useState(false);
  const [reviewFinishedState, setReviewFinishedState] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [isRunStarting, setIsRunStarting] = useState(false);
  const currentRunRef = useRef(null);
  const ignoredRunIdsRef = useRef(new Set());
  const runStartPendingRef = useRef(false);
  const userSelectedReviewTabRef = useRef(false);
  const suppressAutoTabSwitchRef = useRef(false);
  const modelAvailabilityRef = useRef(null);
  const stageMessageKeysRef = useRef(new Set());
  const messageSequenceRef = useRef(0);
  const reactionCursorRef = useRef(0);
  const agentStatusRef = useRef({});
  const typewriterDoneResolverRef = useRef(null);
  const messageProcessorTokenRef = useRef(0);
  const chatterTimeoutRef = useRef(null);
  const chatterReplyTimeoutRef = useRef(null);
  const chatterHardTimeoutRef = useRef(null);
  const notificationTimersRef = useRef(new Map());
  const chatScrollRef = useRef(null);
  const autoRequiredStepsKeyRef = useRef("");
  const selectedFileSet = useMemo(() => new Set(selectedFiles), [selectedFiles]);
  const canRun =
    !isRunning &&
    !isRunStarting &&
    (codeInput.trim().length > 0 || selectedFiles.length > 0 || contextDocuments.length > 0);
  const messageByAgent = getAgentMessageMap(activeMessage, visibleBubble);
  const agentNameMap = useMemo(() => buildAgentNameMap(agents, agentNames), [agents, agentNames]);

  useEffect(() => {
    agentStatusRef.current = Object.fromEntries((agents || []).map((agent) => [agent.id, agent.status]));
  }, [agents]);

  useEffect(() => {
    modelAvailabilityRef.current = modelAvailability;
  }, [modelAvailability]);

  function updateActiveTab(nextTab, { userInitiated = false, force = false } = {}) {
    if (userInitiated) {
      userSelectedReviewTabRef.current = true;
      suppressAutoTabSwitchRef.current = true;
      setActiveTab(nextTab);
      return;
    }

    if (force || (!userSelectedReviewTabRef.current && !suppressAutoTabSwitchRef.current)) {
      setActiveTab(nextTab);
    }
  }

  useEffect(() => {
    const bridge = window.trifix;
    if (!bridge) {
      setError("TriFix desktop bridge is unavailable. Restart the Electron app.");
      return () => { };
    }

    bridge
      .getSettings()
      .then((nextSettings) => {
        setSettings(nextSettings);
        const nextAgents = toAgentList(nextSettings?.agents, agentNames);
        setAgentCatalog(nextAgents);
        setAgents(nextAgents);
      })
      .catch(() => { });

    bridge
      .getLastResult()
      .then((cached) => cached && setResult(cached))
      .catch(() => { });

    bridge
      .listProjects()
      .then((items) => setTrackedProjects(items || []))
      .catch(() => { });

    const unsubscribePipeline = bridge.onPipelineProgress((progress) => {
    if (ignoredRunIdsRef.current.has(progress.runId) || progress.runId !== currentRunRef.current) {
        console.warn("ignored late result for stale runId", {
          runId: progress.runId,
          activeRunId: currentRunRef.current
        });
        return;
      }

      setWorkflow((current) => ({
        ...current,
        ...(progress.partialResult?.workflow || {}),
        currentStage: progress.agent,
        contextReady: true
      }));

      if (progress.requestStatus?.displayText) {
        setDecisionMessage(progress.requestStatus.displayText);
      }

      if (progress.partialResult) {
        setResult((current) => mergePipelineResult(current, progress.partialResult));
        queueStageMessages(progress);
      }

      const qaUnavailable = isSupervisorUnavailable(modelAvailabilityRef.current);
      setAgents((currentAgents) =>
        currentAgents.map((agent) =>
          agent.id === progress.agent
            ? { ...agent, status: mapProgressStatus(progress.agent, progress.status, { qaUnavailable }) }
            : agent
        )
      );
    });
    const unsubscribeAutonomy = bridge.onAutonomyProgress((progress) => {
      if (ignoredRunIdsRef.current.has(progress.runId) || progress.runId !== currentRunRef.current) {
        console.warn("ignored late result for stale runId", {
          runId: progress.runId,
          activeRunId: currentRunRef.current
        });
        return;
      }

      setAutonomyRun((current) => ({
        ...(current || {}),
        runId: progress.runId,
        status: progress.queueStatus || progress.status || current?.status || "running",
        deadlineAt: progress.deadlineAt || current?.deadlineAt || "",
        maxRuntimeMs: progress.maxRuntimeMs || current?.maxRuntimeMs || 0,
        lastStage: progress.stage || current?.lastStage || "",
        lastStatus: progress.status || current?.lastStatus || "",
        message: progress.message || progress.requestStatus?.displayText || current?.message || "",
        updatedAt: new Date().toISOString()
      }));

      if (progress.requestStatus?.displayText || progress.message) {
        setDecisionMessage(progress.requestStatus?.displayText || progress.message);
      }

      if (progress.partialResult) {
        setResult((current) => mergePipelineResult(current, progress.partialResult));
        queueStageMessages(progress);
      }

      setWorkflow((current) => ({
        ...current,
        ...(progress.partialResult?.workflow || {}),
        currentStage: progress.stage || progress.agent || current.currentStage,
        contextReady: true
      }));

      if (progress.agent) {
        const qaUnavailable = isSupervisorUnavailable(modelAvailabilityRef.current);
        setAgents((currentAgents) =>
          currentAgents.map((agent) =>
            agent.id === progress.agent
              ? { ...agent, status: mapProgressStatus(progress.agent, progress.status, { qaUnavailable }) }
              : agent
          )
        );
      }

      if (["autonomy-complete", "autonomy-error"].includes(progress.stage)) {
        setIsRunning(false);
        setIsAutonomyRunning(false);
        setIsRunStarting(false);
        runStartPendingRef.current = false;
        const qaUnavailable = isSupervisorUnavailable(modelAvailabilityRef.current);
        const nonFatal = hasUsefulOutput(progress.partialResult) || String(progress.status || "").toLowerCase() === "needs_review";
        setAgents((currentAgents) =>
          currentAgents.map((agent) => ({
            ...agent,
            status:
              progress.stage === "autonomy-error" && !nonFatal
                ? agent.id === "supervisor" && qaUnavailable
                  ? "idle"
                  : "error"
                : mapTerminalAgentStatus(agent.id, progress.partialResult, {
                  qaUnavailable,
                  runStatus: progress.status || autonomyRun?.status || "needs_review"
                })
          }))
        );
        const outputFiles = getResultOutputFiles(progress.partialResult);
        if (progress.partialResult) {
          const generatedProject = normalizeGeneratedProject(progress.partialResult, project);
          if (generatedProject?.rootPath) {
            setProject(generatedProject);
            setResultProject(generatedProject);
            setSelectedFiles(outputFiles.length > 0 ? outputFiles : (generatedProject.defaultSelectedFiles || []));
            setCommandLog(generatedProject.commandHistory || []);
            setProjectProcesses(generatedProject.processes || []);
          }
          updateActiveTab("decision");
          setActiveView("office");
        }
        pushNotification({
          type: progress.stage === "autonomy-error" && !nonFatal ? "error" : "success",
          title: progress.stage === "autonomy-error" && !nonFatal ? "Autonomy stopped" : "Task finished",
          message: progress.stage === "autonomy-error" && !nonFatal
            ? (progress.message || "The autonomous run needs review.")
            : `${outputFiles.length} file(s) changed. Output is ready for review.`
        });
        void refreshTrackedProjects();
      }
    });

    return () => {
      unsubscribePipeline();
      unsubscribeAutonomy();
    };
  }, []);

  useEffect(() => {
    if (!settings?.agents) {
      return;
    }

    const nextAgents = toAgentList(settings.agents, agentNames);
    setAgentCatalog(nextAgents);
    setAgents((currentAgents) =>
      currentAgents.length > 0
        ? currentAgents.map((agent) => {
          const updated = nextAgents.find((item) => item.id === agent.id) || agent;
          return { ...updated, status: agent.status };
        })
        : nextAgents
    );
  }, [agentNames, settings]);

  useEffect(() => {
    const runId = String(autonomyRun?.runId || currentRunRef.current || "").trim();
    if (!runId || !isAutonomyRunning) {
      return;
    }

    let cancelled = false;
    let timer = null;

    const poll = async () => {
      try {
        const snapshot = await syncAutonomyRunStatus(runId, { silent: true });
        if (cancelled || isTerminalAutonomyStatus(snapshot?.status)) {
          return;
        }
      } catch {}

      if (cancelled) {
        return;
      }

      timer = setTimeout(poll, 3000);
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [autonomyRun?.runId, isAutonomyRunning]);

  useEffect(() => {
    const targetProject = resultProject || project || normalizeGeneratedProject(result, null);
    const shouldRun =
      shouldShowCycleReview({ result, workflow, isRunning }) &&
      !isCommandRunning &&
      !result?.validation &&
      !result?.autoRepair &&
      Boolean(targetProject?.rootPath);

    if (!shouldRun || workflow.commandStatus === "running") {
      return;
    }

    const commandKey = uniqueStrings([
      ...(result?.pm?.commandRequests || []),
      ...(result?.dev?.commandRequests || [])
    ]).join("|");
    const runKey = [
      targetProject.rootPath,
      workflow.loopCount || 0,
      result?.decision?.summary || "",
      result?.executor?.applied?.length || 0,
      commandKey
    ].join("::");

    if (!runKey.trim() || autoRequiredStepsKeyRef.current === runKey) {
      return;
    }

    autoRequiredStepsKeyRef.current = runKey;
    void runRequiredSteps();
  }, [result, resultProject, project, workflow, isRunning, isCommandRunning]);

  useEffect(() => {
    const targetRoot = (resultProject || project)?.rootPath;
    const hasActiveProcess = projectProcesses.some((process) => ["running", "starting"].includes(process.status));
    if (!targetRoot || !hasActiveProcess) {
      return;
    }

    const timer = setInterval(() => {
      void syncProjectProcesses(targetRoot);
    }, 5000);

    return () => clearInterval(timer);
  }, [
    project?.rootPath,
    resultProject?.rootPath,
    projectProcesses.map((process) => `${process.id}:${process.status}`).join("|")
  ]);

  useEffect(() => {
    if (isTyping || activeMessage || messageQueue.length === 0) {
      return;
    }

    const [nextMessage, ...rest] = messageQueue;
    setMessageQueue(rest);
    void playAgentMessage(nextMessage);
  }, [messageQueue, isTyping, activeMessage]);

  useEffect(() => {
    if (!chatScrollRef.current) {
      return;
    }

    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages, visibleBubble, activeMessage]);

  useEffect(
    () => () => {
      if (chatterTimeoutRef.current) {
        clearTimeout(chatterTimeoutRef.current);
      }
      if (chatterReplyTimeoutRef.current) {
        clearTimeout(chatterReplyTimeoutRef.current);
      }
      if (chatterHardTimeoutRef.current) {
        clearTimeout(chatterHardTimeoutRef.current);
      }
      if (typewriterDoneResolverRef.current) {
        typewriterDoneResolverRef.current();
      }
      notificationTimersRef.current.forEach((timer) => clearTimeout(timer));
      notificationTimersRef.current.clear();
    },
    []
  );

  useEffect(() => {
    const canChatter = shouldRunChatter({
      isRunning,
      agents,
      activeMessage,
      isTyping,
      scene,
      messageQueue,
      workflow
    });

    if (!canChatter) {
      if (chatterTimeoutRef.current) {
        clearTimeout(chatterTimeoutRef.current);
        chatterTimeoutRef.current = null;
      }
      if (chatterReplyTimeoutRef.current) {
        clearTimeout(chatterReplyTimeoutRef.current);
        chatterReplyTimeoutRef.current = null;
      }
      return;
    }

    if (chatterTimeoutRef.current) {
      return;
    }

    const stageActive = hasThinkingStage(agents);
    chatterTimeoutRef.current = setTimeout(() => {
      chatterTimeoutRef.current = null;
      if (!shouldAppendChatter(messageQueue)) {
        return;
      }

      const nextChatter = buildChatterMessage({
        agents,
        project,
        selectedFiles,
        timestamp: getChatTimestamp()
      });

      if (!nextChatter) {
        return;
      }

      enqueueAgentMessage(nextChatter);
      maybeQueueChatterReply({
        message: nextChatter,
        agents,
        project,
        selectedFiles,
        activeMessage,
        isTyping,
        scene,
        isRunning,
        queuedMessages: [...messageQueue, nextChatter],
        replyTimeoutRef: chatterReplyTimeoutRef,
        enqueueAgentMessage
      });
    }, randomBetween(stageActive ? THINKING_CHATTER_MIN : IDLE_CHATTER_MIN, stageActive ? THINKING_CHATTER_MAX : IDLE_CHATTER_MAX));

    return () => {
      if (chatterTimeoutRef.current) {
        clearTimeout(chatterTimeoutRef.current);
        chatterTimeoutRef.current = null;
      }
    };
  }, [isRunning, agents, activeMessage, isTyping, scene, messageQueue, project, selectedFiles]);

  function queueStageMessages(progress) {
    if (progress.status !== "speaking") {
      return;
    }

    const stageKey = `${progress.runId}:${progress.agent}:${progress.stage || progress.status}`;
    if (stageMessageKeysRef.current.has(stageKey)) {
      return;
    }

    stageMessageKeysRef.current.add(stageKey);

    const nextMessages = buildStageMessages(progress, reactionCursorRef.current);
    if (nextMessages.some((message) => message.role === "reaction")) {
      reactionCursorRef.current += 1;
    }

    nextMessages.forEach((message) =>
      enqueueAgentMessage({
        ...message,
        text: message.bubbleText || message.message,
        type: message.role === "reaction" ? "reaction" : "pipeline",
        priority: "high",
        restoreState: message.restoreState || inferRestoreState(message)
      })
    );
  }

  function enqueueAgentMessage(message) {
    const normalizedMessage = {
      id:
        message.id ||
        (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `msg-${Date.now()}`),
      priority: "normal",
      type: "chatter",
      order: messageSequenceRef.current++,
      ...message
    };

    setMessageQueue((current) => {
      if (normalizedMessage.priority === "high") {
        const splitIndex = current.findIndex((item) => item.priority !== "high");
        if (splitIndex < 0) {
          return [...current, normalizedMessage];
        }

        return [
          ...current.slice(0, splitIndex),
          normalizedMessage,
          ...current.slice(splitIndex)
        ];
      }

      return [...current, normalizedMessage];
    });
  }

  async function playAgentMessage(message) {
    const token = ++messageProcessorTokenRef.current;
    const previousState = agentStatusRef.current[message.from] || message.restoreState || "idle";
    const isImportantVisual = message.type === "pipeline" || message.type === "reaction" || message.type === "status";
    const holdDuration = message.type === "chatter" ? CHATTER_HOLD : MESSAGE_HOLD;

    if (message.startDelayMs) {
      await wait(message.startDelayMs);
      if (messageProcessorTokenRef.current !== token) {
        return;
      }
    }

    if (message.introState) {
      setAgents((currentAgents) =>
        currentAgents.map((agent) =>
          agent.id === message.from ? { ...agent, status: message.introState } : agent
        )
      );
      await wait(message.introDelayMs || STAGE_DELAY);
      if (messageProcessorTokenRef.current !== token) {
        return;
      }
    }

    setActiveMessage(message);
    setIsTyping(true);
    setAgents((currentAgents) =>
      currentAgents.map((agent) =>
        agent.id === message.from ? { ...agent, status: "speaking" } : agent
      )
    );
    setVisibleBubble({
      agent: message.from,
      text: message.text,
      type: message.type,
      visible: true,
      importantVisual: isImportantVisual,
      isTyping: true
    });
    if (message.type === "chatter") {
      chatterHardTimeoutRef.current = setTimeout(() => {
        chatterHardTimeoutRef.current = null;
        if (messageProcessorTokenRef.current !== token) {
          return;
        }
        if (typewriterDoneResolverRef.current) {
          const resolve = typewriterDoneResolverRef.current;
          typewriterDoneResolverRef.current = null;
          resolve();
        }
      }, CHATTER_MAX_LIFETIME);
    }

    await waitForTypewriterDone(token);
    if (chatterHardTimeoutRef.current) {
      clearTimeout(chatterHardTimeoutRef.current);
      chatterHardTimeoutRef.current = null;
    }
    setVisibleBubble((current) =>
      current?.agent === message.from ? { ...current, isTyping: false } : current
    );

    setChatMessages((current) => [
      ...current,
      {
        ...message,
        timestamp: message.timestamp || getChatTimestamp(),
        message: message.detailsText || message.message || message.text,
        bubbleText: message.text,
        renderedText: message.text,
        visible: false,
        status: "done"
      }
    ]);

    await wait(holdDuration);
    if (messageProcessorTokenRef.current !== token) {
      return;
    }

    setVisibleBubble((current) =>
      current?.agent === message.from ? { ...current, visible: false } : current
    );

    await wait(220);
    if (messageProcessorTokenRef.current !== token) {
      return;
    }

    setVisibleBubble(null);
    await wait(message.type === "chatter" ? 0 : MESSAGE_GAP);
    if (messageProcessorTokenRef.current !== token) {
      return;
    }

    setAgents((currentAgents) =>
      currentAgents.map((agent) =>
        agent.id === message.from
          ? { ...agent, status: message.restoreState || previousState || "idle" }
          : agent
      )
    );
    setIsTyping(false);
    setActiveMessage(null);
  }

  function waitForTypewriterDone(token) {
    return new Promise((resolve) => {
      typewriterDoneResolverRef.current = () => {
        if (messageProcessorTokenRef.current === token) {
          resolve();
        }
      };
    });
  }

  async function refreshTrackedProjects() {
    try {
      const items = await window.trifix.listProjects();
      setTrackedProjects(items || []);
    } catch { }
  }

  function handleTypewriterComplete() {
    if (typewriterDoneResolverRef.current) {
      const resolve = typewriterDoneResolverRef.current;
      typewriterDoneResolverRef.current = null;
      resolve();
    }
  }

  async function openProject() {
    setError("");
    const openedProject = await window.trifix.openProject();

    if (!openedProject) {
      return;
    }

    const defaults = openedProject.defaultSelectedFiles || [];
    setProject(openedProject);
    setResultProject(null);
    setSelectedFiles(defaults);
    setContextDocuments(openedProject.fsd?.documents || []);
    setCommandLog(openedProject.commandHistory || []);
    setProjectProcesses(openedProject.processes || []);
    setProcessLogView(null);
    setDecisionPreview([]);
    setDecisionMessage("");
    setWorkflow((current) => ({
      ...current,
      folderLoaded: true,
      contextReady: defaults.length > 0,
      currentStage: "context-ready"
    }));
    setTaskTitle("");
    setActiveView("office");
    await refreshTrackedProjects();
  }

  async function refreshProject() {
    if (!project?.rootPath) {
      return;
    }

    setError("");
    const refreshed = await window.trifix.refreshProject(project.rootPath);
    const defaults = refreshed.defaultSelectedFiles || [];
    setProject(refreshed);
    setContextDocuments(refreshed.fsd?.documents || contextDocuments);
    setCommandLog(refreshed.commandHistory || commandLog);
    setProjectProcesses(refreshed.processes || []);
    setSelectedFiles((paths) => {
      const next = paths.filter((path) => hasPath(refreshed.tree, path));
      return next.length > 0 ? next : defaults;
    });
    setWorkflow((current) => ({
      ...current,
      folderLoaded: true,
      contextReady: true,
      currentStage:
        current.decisionStatus === "applied" || current.decisionStatus === "accepted"
          ? current.currentStage
          : "context-ready"
    }));
    await refreshTrackedProjects();
  }

  async function syncProjectProcesses(rootPath = (resultProject || project)?.rootPath) {
    if (!rootPath) {
      setProjectProcesses([]);
      return [];
    }

    try {
      const processes = await window.trifix.listProjectProcesses({ projectRoot: rootPath });
      setProjectProcesses(processes || []);
      setProject((current) => current?.rootPath === rootPath ? { ...current, processes: processes || [] } : current);
      setResultProject((current) => current?.rootPath === rootPath ? { ...current, processes: processes || [] } : current);
      return processes || [];
    } catch {
      return projectProcesses;
    }
  }

  function toggleFile(path, checked) {
    setSelectedFiles((currentFiles) => {
      if (checked) {
        const maxFiles = project?.limits?.maxSelectedFiles || 10;
        return [...new Set([...currentFiles, path])].slice(0, maxFiles);
      }

      return currentFiles.filter((item) => item !== path);
    });
  }

  async function uploadContextDocuments() {
    setError("");
    try {
      let targetProject = project;

      const documents = await window.trifix.uploadProjectContext({
        projectRoot: targetProject?.rootPath || "",
        projectId: targetProject?.projectId || ""
      });
      if (!documents?.length) {
        return;
      }

      setContextDocuments((current) => [...current, ...documents].slice(-16));
      setWorkflow((current) => ({
        ...current,
        folderLoaded: Boolean(targetProject?.rootPath),
        contextReady: true,
        currentStage: "context-ready",
        currentPhase: current.currentPhase || "Planning",
        currentTask: "PM context review",
        projectStatus: "Context loaded"
      }));
      await refreshTrackedProjects();
    } catch (uploadError) {
      setError(uploadError?.message || "Could not upload project context.");
    }
  }

  async function runProjectControl(mode) {
    const targetProject = resultProject || project;
    if (!targetProject?.rootPath) {
      setDecisionMessage("Open or create a project before running commands.");
      return;
    }

    setIsCommandRunning(true);
    setWorkflow((current) => ({
      ...current,
      commandStatus: mode === "debug" ? "debugging" : "running",
      projectStatus: mode === "debug" ? "Debugging" : "Running"
    }));
    setDecisionMessage(
      mode === "debug"
        ? "Debug request started. The app is collecting command output from this sandbox."
        : "Run request started. The app is running the project from its sandbox."
    );
    enqueueAgentMessage({
      from: mode === "debug" ? "supervisor" : "junior",
      to: "team",
      text: mode === "debug" ? "Running checks and collecting errors." : "Starting the project command.",
      message: mode === "debug" ? "Running checks and collecting errors." : "Starting the project command.",
      type: "status",
      priority: "high",
      restoreState: mode === "debug" ? "testing" : "waiting"
    });

    try {
      const entry = await window.trifix.runProjectCommand({
        projectRoot: targetProject.rootPath,
        projectId: targetProject.projectId,
        mode
      });
      setCommandLog((current) => [...current, entry].slice(-30));
      setWorkflow((current) => ({
        ...current,
        commandStatus: entry.status,
        projectStatus: entry.status === "running"
          ? "Process running"
          : entry.status === "passed"
            ? "Command passed"
            : "Command failed"
      }));
      setDecisionMessage(entry.healthUrl ? `${entry.command} running at ${entry.healthUrl}.` : `${entry.command} ${entry.status}.`);
      if (entry.healthUrl) {
        pushNotification({
          type: "success",
          title: "Project running",
          message: entry.healthUrl
        });
      }
      if (entry.processId) {
        await syncProjectProcesses(targetProject.rootPath);
      }
      if (mode === "debug" && entry.status !== "passed") {
        setCodeInput((current) =>
          [
            current,
            "",
            "DEBUG_OUTPUT:",
            entry.output
          ].filter(Boolean).join("\n")
        );
      }
      await refreshTrackedProjects();
    } catch (commandError) {
      setDecisionMessage(commandError?.message || "Command failed.");
      setWorkflow((current) => ({
        ...current,
        commandStatus: "error",
        projectStatus: "Command failed"
      }));
    } finally {
      setIsCommandRunning(false);
    }
  }

  async function openProcessUrl(url) {
    try {
      await window.trifix.openExternalUrl(url);
    } catch (openError) {
      setDecisionMessage(openError?.message || "Could not open project URL.");
    }
  }

  async function stopProjectProcess(processId) {
    const targetProject = resultProject || project;
    if (!targetProject?.rootPath || !processId) {
      setDecisionMessage("No running project process is selected.");
      return;
    }

    try {
      const stopped = await window.trifix.stopProjectProcess({
        projectRoot: targetProject.rootPath,
        processId
      });
      setCommandLog((current) =>
        current.map((entry) =>
          entry.processId === processId
            ? {
                ...entry,
                status: stopped.status || "stopped",
                finishedAt: stopped.finishedAt || new Date().toISOString(),
                output: `${entry.output || ""}\nProcess stopped.`
              }
            : entry
        )
      );
      setWorkflow((current) => ({
        ...current,
        commandStatus: "stopped",
        projectStatus: "Process stopped"
      }));
      setDecisionMessage(`${stopped.command || "Process"} stopped.`);
      await syncProjectProcesses(targetProject.rootPath);
      pushNotification({
        type: "info",
        title: "Process stopped",
        message: stopped.command || processId
      });
      await refreshTrackedProjects();
    } catch (stopError) {
      setDecisionMessage(stopError?.message || "Could not stop project process.");
    }
  }

  async function syncAutonomyRunStatus(runId, options = {}) {
    const targetRunId = String(runId || currentRunRef.current || "").trim();
    if (!targetRunId || !window.trifix?.getAutonomyStatus) {
      return null;
    }

    const snapshot = await window.trifix.getAutonomyStatus(targetRunId);
    if (ignoredRunIdsRef.current.has(targetRunId) || targetRunId !== currentRunRef.current) {
      console.warn("ignored late result for stale runId", {
        runId: targetRunId,
        activeRunId: currentRunRef.current
      });
      return snapshot;
    }
    if (!snapshot || snapshot.runId !== targetRunId) {
      return snapshot;
    }

    const latestProgress = Array.isArray(snapshot.progress) && snapshot.progress.length > 0
      ? snapshot.progress[snapshot.progress.length - 1]
      : null;
    const terminal = isTerminalAutonomyStatus(snapshot.status);

    setAutonomyRun((current) => ({
      ...(current || {}),
      runId: snapshot.runId,
      status: snapshot.status || current?.status || "queued",
      deadlineAt: snapshot.deadlineAt || current?.deadlineAt || "",
      maxRuntimeMs: snapshot.maxRuntimeMs || current?.maxRuntimeMs || 0,
      lastStage: latestProgress?.stage || current?.lastStage || "",
      lastStatus: latestProgress?.status || current?.lastStatus || "",
      message: snapshot.error || current?.message || latestProgress?.stage || "",
      updatedAt: snapshot.finishedAt || snapshot.startedAt || snapshot.queuedAt || new Date().toISOString(),
      error: snapshot.error || current?.error || ""
    }));

    if (snapshot.result) {
      setResult(snapshot.result);
      setWorkflow((current) => ({
        ...current,
        ...(snapshot.result.workflow || {}),
        currentStage: snapshot.result.workflow?.currentStage || latestProgress?.stage || current.currentStage,
        contextReady: true
      }));
      const generatedProject = normalizeGeneratedProject(snapshot.result, project);
      if (generatedProject?.rootPath) {
        const outputFiles = getResultOutputFiles(snapshot.result);
        setProject(generatedProject);
        setResultProject(generatedProject);
        setSelectedFiles(outputFiles.length > 0 ? outputFiles : (generatedProject.defaultSelectedFiles || []));
        setCommandLog(generatedProject.commandHistory || []);
        setProjectProcesses(generatedProject.processes || []);
      }
    }

    if (terminal) {
      setIsRunning(false);
      setIsAutonomyRunning(false);
      setIsRunStarting(false);
      runStartPendingRef.current = false;
      const qaUnavailable = isSupervisorUnavailable(modelAvailabilityRef.current);
      setAgents((currentAgents) =>
        currentAgents.map((agent) => ({
          ...agent,
          status: mapTerminalAgentStatus(agent.id, snapshot.result, {
            qaUnavailable,
            runStatus: snapshot.status
          })
        }))
      );
      if (!options.silent) {
        updateActiveTab("decision");
        setActiveView("office");
      }
    }

    return snapshot;
  }

  async function restartProjectProcess(processId) {
    const targetProject = resultProject || project;
    if (!targetProject?.rootPath || !processId) {
      setDecisionMessage("No project process is selected.");
      return;
    }

    setIsCommandRunning(true);
    try {
      const restarted = await window.trifix.restartProjectProcess({
        projectRoot: targetProject.rootPath,
        projectId: targetProject.projectId,
        processId
      });
      if (restarted?.entry) {
        setCommandLog((current) => [...current, restarted.entry].slice(-30));
      }
      setProjectProcesses(restarted?.processes || []);
      setProject((current) => current?.rootPath === targetProject.rootPath ? { ...current, processes: restarted?.processes || [] } : current);
      setResultProject((current) => current?.rootPath === targetProject.rootPath ? { ...current, processes: restarted?.processes || [] } : current);
      setWorkflow((current) => ({
        ...current,
        commandStatus: restarted?.process?.status || "running",
        projectStatus: restarted?.process?.healthUrl ? "Process running" : "Process restarted"
      }));
      setDecisionMessage(
        restarted?.process?.healthUrl
          ? `${restarted.process.command} running at ${restarted.process.healthUrl}.`
          : `${restarted?.process?.command || "Process"} restarted.`
      );
      pushNotification({
        type: "success",
        title: "Process restarted",
        message: restarted?.process?.healthUrl || restarted?.process?.command || processId
      });
      await refreshTrackedProjects();
    } catch (restartError) {
      setDecisionMessage(restartError?.message || "Could not restart project process.");
    } finally {
      setIsCommandRunning(false);
    }
  }

  async function viewProjectProcessLog(processId) {
    const targetProject = resultProject || project;
    if (!targetProject?.rootPath || !processId) {
      setDecisionMessage("No project process is selected.");
      return;
    }

    try {
      const log = await window.trifix.readProjectProcessLog({
        projectRoot: targetProject.rootPath,
        processId,
        stream: "all",
        maxChars: 20000
      });
      setProcessLogView(log);
    } catch (logError) {
      setDecisionMessage(logError?.message || "Could not read process logs.");
    }
  }

  async function runSuggestedCommand(command) {
    const targetProject = resultProject || project;
    if (!targetProject?.rootPath) {
      setDecisionMessage("Open or create a project before running commands.");
      return;
    }

    const normalized = String(command || "").trim();
    if (!normalized) {
      return;
    }

    setIsCommandRunning(true);
    setWorkflow((current) => ({
      ...current,
      commandStatus: "running",
      projectStatus: "Running setup command"
    }));
    setDecisionMessage(`Setup command started: ${normalized}`);
    enqueueAgentMessage({
      from: "architect",
      to: "junior",
      text: `Running PM setup command: ${normalized}`,
      message: `Running PM setup command: ${normalized}`,
      type: "status",
      priority: "high",
      restoreState: "installing"
    });

    try {
      const entry = await window.trifix.runProjectCommand({
        projectRoot: targetProject.rootPath,
        projectId: targetProject.projectId,
        mode: "custom",
        command: normalized
      });
      setCommandLog((current) => [...current, entry].slice(-30));
      setWorkflow((current) => ({
        ...current,
        commandStatus: entry.status,
        projectStatus: entry.status === "passed" ? "Setup command passed" : "Setup command failed"
      }));
      setDecisionMessage(`${entry.command} ${entry.status}.`);
      await refreshTrackedProjects();
    } catch (commandError) {
      setDecisionMessage(commandError?.message || "Command failed.");
      setWorkflow((current) => ({
        ...current,
        commandStatus: "error",
        projectStatus: "Setup command failed"
      }));
    } finally {
      setIsCommandRunning(false);
    }
  }

  async function runRequiredSteps() {
    const targetProject = resultProject || project || normalizeGeneratedProject(result, null);
    if (!targetProject?.rootPath) {
      setDecisionMessage("Open or create a project before running automatic checks.");
      return;
    }

    const commands = uniqueStrings([
      ...(result?.pm?.commandRequests || []),
      ...(result?.dev?.commandRequests || [])
    ]).filter((command) => isUsableCommandRequest(command));

    setIsCommandRunning(true);
    setWorkflow((current) => ({
      ...current,
      commandStatus: "running",
      projectStatus: commands.length > 0 ? "Running automatic checks" : "Running validation"
    }));
    setDecisionMessage(
      commands.length > 0
        ? "Automatic checks started. The app is running setup and validation inside the sandbox."
        : "No automatic setup commands were requested. Running validation inside the sandbox."
    );
    enqueueAgentMessage({
      from: "architect",
      to: "team",
      text: "Running setup and validation automatically.",
      message: "Running setup and validation automatically.",
      type: "status",
      priority: "high",
      restoreState: "installing"
    });

    try {
      const entries = [];
      for (const command of commands) {
        const entry = await window.trifix.runProjectCommand({
          projectRoot: targetProject.rootPath,
          projectId: targetProject.projectId,
          mode: "custom",
          command
        });
        entries.push(entry);
        setCommandLog((current) => [...current, entry].slice(-30));
        if (entry.status !== "passed") {
          throw new Error(`${entry.command} failed.`);
        }
      }

      const validationEntry = await window.trifix.runProjectCommand({
        projectRoot: targetProject.rootPath,
        projectId: targetProject.projectId,
        mode: "validate"
      });
      entries.push(validationEntry);
      setCommandLog((current) => [...current, validationEntry].slice(-30));

      setWorkflow((current) => ({
        ...current,
        commandStatus: validationEntry.status,
        projectStatus: validationEntry.status === "passed" ? "Automatic checks passed" : "Validation failed"
      }));
      setDecisionMessage(
        validationEntry.status === "passed"
          ? `Automatic checks passed (${entries.length} step(s)).`
          : `${validationEntry.command} failed.`
      );
      await refreshTrackedProjects();
    } catch (commandError) {
      setDecisionMessage(commandError?.message || "Automatic checks failed.");
      setWorkflow((current) => ({
        ...current,
        commandStatus: "error",
        projectStatus: "Automatic checks failed"
      }));
    } finally {
      setIsCommandRunning(false);
    }
  }

  function parseInlineWorkspaceCommand(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "/debug-project" || normalized === "debug project") {
      return "debug-project";
    }

    return "";
  }

  function addInstruction() {
    const instruction = window.prompt("Add instruction for the Project Manager");
    if (!instruction?.trim()) {
      return;
    }

    setCodeInput((current) =>
      [
        current,
        "",
        "PM_ADDED_INSTRUCTION:",
        instruction.trim()
      ].filter(Boolean).join("\n")
    );
    enqueueAgentMessage({
      from: "architect",
      to: "supervisor",
      text: "New instruction received. I'll adjust the scope.",
      message: "New instruction received. I'll adjust the scope.",
      type: "status",
      priority: "high",
      restoreState: "thinking"
    });
  }

  async function runAgentCapabilityTest() {
    const scenario = window.prompt("Test scenario: fsd, command, or review", "fsd");
    if (!scenario?.trim()) {
      return;
    }

    const agentId = window.prompt("Agent to test: architect, supervisor, or junior", "architect");
    if (!agentId?.trim()) {
      return;
    }

    const instruction = window.prompt("Optional test instruction", codeInput.trim() || "Read the FSD and report what you can do.");
    setIsTesterRunning(true);
    setDecisionMessage("");
    try {
      const result = await window.trifix.testAgent({
        agentId: agentId.trim(),
        scenario: scenario.trim(),
        instruction: instruction || "",
        contextDocuments,
        projectRoot: project?.rootPath || ""
      });
      setTesterResult(result);
      setActiveView("reports");
      setDecisionMessage(`${formatAgentName(result.agentId)} test completed.`);
    } catch (testError) {
      setDecisionMessage(testError?.message || "Capability test failed.");
    } finally {
      setIsTesterRunning(false);
    }
  }

  function beginNewProjectFlow() {
    resetTaskState({ clearProjectSelection: true });
    setProject(null);
    setResultProject(null);
    setSelectedFiles([]);
    setContextDocuments([]);
    setCommandLog([]);
    setProjectProcesses([]);
    setProcessLogView(null);
    setTaskTitle(draftProjectName.trim());
    setCodeInput("");
    setActiveView("office");
    setWorkflow((current) => ({
      ...current,
      folderLoaded: false,
      contextReady: false,
      currentStage: "task-ready"
    }));
  }

  async function runOffice(nextLoopCount = workflow.loopCount, feedback = "") {
    if (!canRun && !feedback) {
      return;
    }

    setError("");
    setIsRunning(true);
    stageMessageKeysRef.current = new Set();
    reactionCursorRef.current = 0;
    resetSpeechRuntime();

    const explicitNewProject = isExplicitNewProjectRequest(codeInput);
    let runProject = explicitNewProject ? null : project;
    let runSelectedFiles = explicitNewProject ? [] : selectedFiles;
    const inlineCommand = parseInlineWorkspaceCommand(codeInput);

    try {
      if (!feedback && inlineCommand === "debug-project") {
        await runProjectControl("debug");
        return;
      }

      if (!runProject?.rootPath) {
        runSelectedFiles = [];
        setActiveView("office");
        setWorkflow((current) => ({
          ...current,
          folderLoaded: false,
          contextReady: true,
          currentStage: "supervisor-spec"
        }));
      }

      const runId =
        typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
      currentRunRef.current = runId;
      setResultProject(runProject?.rootPath ? runProject : null);
      setContextDocuments((current) => current.length > 0 ? current : runProject?.fsd?.documents || []);
      const effectiveInput = !runProject?.rootPath && taskTitle.trim()
        ? [`PROJECT_TITLE: ${taskTitle.trim()}`, codeInput].filter(Boolean).join("\n\n")
        : codeInput;
      const runStartMessage = feedback
        ? "Patch run started. The team will edit the current sandbox output in place."
        : runProject?.rootPath
          ? "Run request started. The team is working inside the selected sandbox."
          : "Run request started. The team will create output files inside a new sandbox.";

      setDecisionMessage(runStartMessage);
      setDecisionError("");
      setDecisionPreview([]);
      userSelectedReviewTabRef.current = false;
      suppressAutoTabSwitchRef.current = false;
      setReviewFinishedState(null);
      updateActiveTab("architect", { force: true });
      setResult(null);
      setChatMessages([]);
      setMessageQueue([]);
      setActiveMessage(null);
      setVisibleBubble(null);
      setIsTyping(false);
      setAgents(agentCatalog.map((agent) => ({ ...agent, status: "idle" })));
      setWorkflow((current) => ({
        ...current,
        contextReady: true,
        currentStage: "supervisor-spec",
        loopCount: nextLoopCount,
        decisionStatus: "pending",
        currentPhase: "Planning",
        currentTask: "Supervisor scoping",
        iterationCount: nextLoopCount,
        projectStatus: "In progress",
        commandStatus: "idle"
      }));
      enqueueAgentMessage({
        from: "architect",
        to: "team",
        text: runStartMessage,
        message: runStartMessage,
        type: "status",
        priority: "high",
        restoreState: "thinking"
      });

      const nextResult = await window.trifix.runPipeline({
        runId,
        input: effectiveInput,
        language,
        projectRoot: runProject?.rootPath,
        projectId: runProject?.projectId,
        projectName: runProject?.name || taskTitle.trim() || runProject?.rootPath?.split(/[\\/]/).pop(),
        projectType: runProject?.projectType,
        selectedFiles: runSelectedFiles,
        contextDocuments,
        fsd: {
          documents: contextDocuments,
          summary: contextDocuments.map((doc) => `${doc.name}: ${doc.summary}`).join("\n")
        },
        feedback,
        loopCount: nextLoopCount
      });
      const feasibility = assessProjectFeasibility({
        input: codeInput,
        result: nextResult,
        selectedFiles: runSelectedFiles,
        hasContextDocuments: contextDocuments.length > 0
      });
      const filesWereApplied = (nextResult?.executor?.applied || []).length > 0;
      if (!feasibility.ok && !filesWereApplied && nextLoopCount < MAX_FEASIBILITY_RETRIES) {
        setDecisionMessage(`Auto-retrying: ${feasibility.reason}`);
        enqueueAgentMessage({
          from: "architect",
          to: "team",
          text: "This is not feasible yet. I'm tightening the next pass.",
          message: "This is not feasible yet. I'm tightening the next pass.",
          type: "status",
          priority: "high",
          restoreState: "thinking"
        });
        return await runOffice(
          nextLoopCount + 1,
          `The previous iteration is not yet feasible. ${feasibility.reason} Return a runnable, coherent project with valid fileOperations and necessary commands.`
        );
      }
      if (!feasibility.ok) {
        setDecisionMessage(
          filesWereApplied
            ? `Files were written, but the feasibility check flagged: ${feasibility.reason}`
            : `Feasibility check failed after ${MAX_FEASIBILITY_RETRIES} attempts: ${feasibility.reason}`
        );
      }
      const generatedProject = normalizeGeneratedProject(nextResult, runProject);
      if (generatedProject?.rootPath) {
        const outputFiles = getResultOutputFiles(nextResult);
        setProject(generatedProject);
        setResultProject(generatedProject);
        setSelectedFiles(outputFiles.length > 0 ? outputFiles : (generatedProject.defaultSelectedFiles || []));
        setContextDocuments((current) => current.length > 0 ? current : generatedProject.fsd?.documents || []);
        setCommandLog(generatedProject.commandHistory || []);
        setProjectProcesses(generatedProject.processes || []);
        setTaskTitle(generatedProject.projectName || taskTitle);
      } else {
        setResultProject(runProject?.rootPath ? runProject : null);
        setProjectProcesses(runProject?.processes || []);
      }
      setResult(nextResult);
      setWorkflow({
        ...(nextResult.workflow || workflow),
        folderLoaded: Boolean(generatedProject?.rootPath || runProject?.rootPath),
        contextReady: true
      });
      updateActiveTab("decision");
      setActiveView("office");
      pushNotification({
        type: "success",
        title: "Task finished",
        message: `${getResultOutputFiles(nextResult).length} file(s) changed. Output is ready for review.`
      });
      await refreshTrackedProjects();
    } catch (runError) {
      setError(runError?.message || "Pipeline failed.");
      setDecisionMessage(runError?.message || "Pipeline failed.");
      pushNotification({
        type: "error",
        title: "Task failed",
        message: runError?.message || "Pipeline failed."
      });
      setWorkflow((current) => ({
        ...current,
        currentStage: "error"
      }));
      setAgents((currentAgents) =>
        currentAgents.map((agent) =>
          ["thinking", "coding", "testing", "waiting", "installing", "unpacking"].includes(agent.status)
            ? { ...agent, status: "error" }
            : agent
        )
      );
    } finally {
      setIsRunning(false);
    }
  }

  async function runModelPreflight() {
    console.info("preflight start");
    setError("");
    setDecisionMessage("Initializing TriFix...");
    setRunPreflight({
      state: "checking",
      activeModels: [],
      unavailableModels: [],
      warnings: [],
      message: "Initializing TriFix..."
    });

    const nextHealth = await window.trifix.getModelHealth();
    const availability = classifyModelAvailability(nextHealth);
    const nextPreflight = buildRunPreflight(availability);
    console.info("preflight result", {
      state: nextPreflight.state,
      activeModels: nextPreflight.activeModels.map((entry) => entry.id),
      unavailableModels: nextPreflight.unavailableModels.map((entry) => entry.id),
      selectedRunMode: nextPreflight.selectedRunMode
    });
    setModelAvailability(availability);
    setRunPreflight(nextPreflight);
    setDecisionMessage(nextPreflight.message);
    return nextPreflight;
  }

  function clearRunPreflight() {
    setRunPreflight(null);
  }

  async function queueAutonomousRun(selectedRunMode, preflight = runPreflight) {
    setError("");
    setDecisionMessage(buildAvailabilityMessage(preflight));
    setIsRunning(true);
    setIsAutonomyRunning(true);
    stageMessageKeysRef.current = new Set();
    reactionCursorRef.current = 0;
    resetSpeechRuntime();

    const explicitNewProject = isExplicitNewProjectRequest(codeInput);
    const runProject = explicitNewProject ? null : project;
    const runSelectedFiles = runProject?.rootPath ? selectedFiles : [];
    const runId =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `auto-${Date.now()}`;
    currentRunRef.current = runId;
    ignoredRunIdsRef.current.delete(runId);
    const effectiveInput = !runProject?.rootPath && taskTitle.trim()
      ? [`PROJECT_TITLE: ${taskTitle.trim()}`, codeInput].filter(Boolean).join("\n\n")
      : codeInput;
    const developerOnly = selectedRunMode === "degraded_developer_only";
    const runStartMessage = developerOnly
      ? "Developer-only autonomous run queued. The backend runner will generate output without PM planning."
      : runProject?.rootPath
        ? "Autonomous run queued. The backend runner will work inside this sandbox."
        : "Autonomous run queued. The backend runner will create output files inside a new sandbox.";

    console.info("selected run mode", selectedRunMode);
    setAutonomyRun({
      runId,
      status: "queued",
      maxRuntimeMs: 8 * 60 * 60 * 1000,
      lastStage: "queued",
      message: runStartMessage,
      updatedAt: new Date().toISOString(),
      preflight
    });
    setDecisionMessage(runStartMessage);
    setDecisionError("");
    setDecisionPreview([]);
    userSelectedReviewTabRef.current = false;
    suppressAutoTabSwitchRef.current = false;
    setReviewFinishedState(null);
    updateActiveTab("architect", { force: true });
    setResult(null);
    setChatMessages([]);
    setMessageQueue([]);
    setActiveMessage(null);
    setVisibleBubble(null);
    setIsTyping(false);
    setAgents(
      agentCatalog.map((agent) => ({
        ...agent,
        status: "idle"
      }))
    );
    setWorkflow((current) => ({
      ...current,
      contextReady: true,
      currentStage: developerOnly ? "junior-initial" : "autonomy-queued",
      decisionStatus: "pending",
      currentPhase: "Workflow",
      currentTask: developerOnly ? "Developer-only generation" : "Backend autonomy queue",
      projectStatus: developerOnly ? "Developer-only mode" : "Queued",
      commandStatus: "idle",
      runMode: selectedRunMode
    }));
    clearRunPreflight();
    enqueueAgentMessage({
      from: developerOnly ? "junior" : "architect",
      to: "team",
      text: runStartMessage,
      message: runStartMessage,
      type: "status",
      priority: "high",
      restoreState: developerOnly ? "coding" : "thinking"
    });

    try {
      const queuedRun = await window.trifix.startAutonomyRun({
        runId,
        input: effectiveInput,
        language,
        projectRoot: runProject?.rootPath,
        projectId: runProject?.projectId,
        projectName: runProject?.name || taskTitle.trim() || runProject?.rootPath?.split(/[\\/]/).pop(),
        projectType: runProject?.projectType,
        selectedFiles: runSelectedFiles,
        contextDocuments,
        fsd: {
          documents: contextDocuments,
          summary: contextDocuments.map((doc) => `${doc.name}: ${doc.summary}`).join("\n")
        },
        loopCount: workflow.loopCount || 0,
        maxRuntimeMinutes: 480,
        executionMode: selectedRunMode,
        preflight
      });
      setAutonomyRun((current) => ({
        ...(current || {}),
        ...(queuedRun || {}),
        message: runStartMessage,
        preflight
      }));
      setIsRunStarting(false);
      runStartPendingRef.current = false;
      void syncAutonomyRunStatus(runId, { silent: true });
    } catch (runError) {
      setIsRunning(false);
      setIsAutonomyRunning(false);
      setIsRunStarting(false);
      runStartPendingRef.current = false;
      setAutonomyRun((current) => ({
        ...(current || {}),
        status: "failed",
        error: runError?.message || "Autonomous run failed to start."
      }));
      setError(runError?.message || "Autonomous run failed to start.");
      setDecisionMessage(runError?.message || "Autonomous run failed to start.");
    }
  }

  async function startAutonomousRun() {
    if (isRunning || isAutonomyRunning || isRunStarting || runStartPendingRef.current) {
      console.warn("renderer run click ignored because active");
      setDecisionMessage("A run is already in progress.");
      return;
    }

    if (!canRun) {
      return;
    }

    runStartPendingRef.current = true;
    setIsRunStarting(true);
    try {
      if (window.trifix?.getAutonomyStatus) {
        const statusSnapshot = await window.trifix.getAutonomyStatus();
        if (statusSnapshot?.active) {
          console.warn("renderer run click ignored because active");
          setDecisionMessage("A run is already in progress.");
          return;
        }
      }
      await runModelPreflight();
    } catch (healthError) {
      const message = healthError?.message || "Could not check model availability.";
      setError(message);
      setDecisionMessage(message);
      setRunPreflight({
        state: "blocked",
        activeModels: [],
        unavailableModels: [],
        warnings: [],
        message
      });
    } finally {
      setIsRunStarting(false);
      runStartPendingRef.current = false;
    }
  }

  async function confirmPreflightStart(selectedRunMode = runPreflight?.selectedRunMode || "normal") {
    if (isRunning || isAutonomyRunning || isRunStarting || runStartPendingRef.current) {
      console.warn("renderer run click ignored because active");
      setDecisionMessage("A run is already in progress.");
      return;
    }

    if (!runPreflight) {
      return;
    }

    if (selectedRunMode === "degraded_developer_only") {
      console.info("proceed anyway clicked", { runMode: selectedRunMode });
    }

    runStartPendingRef.current = true;
    setIsRunStarting(true);
    try {
      await queueAutonomousRun(selectedRunMode, {
        ...runPreflight,
        selectedRunMode
      });
    } finally {
      setIsRunStarting(false);
      runStartPendingRef.current = false;
    }
  }

  async function stopAutonomousRun() {
    const runId = autonomyRun?.runId || currentRunRef.current;
    if (!runId) {
      return;
    }

    try {
      ignoredRunIdsRef.current.add(runId);
      const stopped = await window.trifix.stopAutonomyRun(runId);
      setAutonomyRun((current) => ({
        ...(current || {}),
        ...(stopped || {}),
        status: stopped?.status || "stopping",
        message: "Stop requested for autonomous run."
      }));
      setDecisionMessage("Stop requested for autonomous run.");
      if (stopped?.status === "stopped") {
        setIsRunning(false);
        setIsAutonomyRunning(false);
        setIsRunStarting(false);
        runStartPendingRef.current = false;
      }
    } catch (stopError) {
      ignoredRunIdsRef.current.delete(runId);
      setDecisionMessage(stopError?.message || "Could not stop autonomous run.");
    }
  }

  async function acceptDecision({ advancePhase = false } = {}) {
    if (!result?.decision) {
      return;
    }

    setIsDecisionBusy(true);
    setDecisionMessage("");
    try {
      const planState = transitionProjectPlan(
        result?.project?.phases || project?.phases || [],
        result?.project?.tasks || project?.tasks || [],
        advancePhase ? "advance" : "finish"
      );
      clearSpeechQueue();
      setAgents((currentAgents) => currentAgents.map((agent) => ({ ...agent, status: "idle" })));
      setScene({ type: "success", message: SUCCESS_SCENE_MESSAGE });
      await wait(520);
      setAgents((currentAgents) => currentAgents.map((agent) => ({ ...agent, status: "done" })));
      await window.trifix.acceptDecision({
        ...result.decision,
        projectId: resultProject?.projectId || project?.projectId,
        projectRoot: resultProject?.rootPath || project?.rootPath || result?.project?.rootPath,
        affectedFiles: result?.decision?.affectedFiles || []
      });
      await window.trifix.updateProject({
        id: resultProject?.projectId || project?.projectId,
        status: advancePhase ? "In progress" : "Accepted",
        decisionStatus: "accepted",
        loopCount: workflow.loopCount,
        lastAgent: "architect",
        affectedFiles: result?.decision?.affectedFiles || [],
        phases: planState.phases,
        tasks: planState.tasks
      });
      const outputFiles = getResultOutputFiles(result);
      const activeProject = resultProject || project || normalizeGeneratedProject(result, null);
      if (activeProject?.rootPath) {
        const refreshed = await window.trifix.refreshProject(activeProject.rootPath);
        const nextSelectedFiles = outputFiles.filter((filePath) => hasPath(refreshed.tree, filePath));
        const nextProject = {
          ...refreshed,
          ...(activeProject || {}),
          tree: refreshed.tree,
          defaultSelectedFiles: refreshed.defaultSelectedFiles || activeProject.defaultSelectedFiles || [],
          phases: planState.phases,
          tasks: planState.tasks
        };
        setProject(nextProject);
        setResultProject(nextProject);
        setSelectedFiles(nextSelectedFiles.length > 0 ? nextSelectedFiles : (refreshed.defaultSelectedFiles || []));
        setCommandLog(refreshed.commandHistory || activeProject.commandHistory || []);
        setProjectProcesses(refreshed.processes || activeProject.processes || []);
      }
      setWorkflow((current) => ({
        ...current,
        decisionStatus: "accepted",
        currentStage: advancePhase ? "phase-ready" : "accepted",
        currentPhase: planState.currentPhase,
        currentTask: planState.currentTask,
        projectStatus: advancePhase ? `Ready for ${planState.currentPhase}` : "Cycle finished"
      }));
      setResult((current) => current ? ({
        ...current,
        project: {
          ...(current.project || {}),
          phases: planState.phases,
          tasks: planState.tasks
        },
        workflow: {
          ...(current.workflow || {}),
          decisionStatus: "accepted",
          currentStage: advancePhase ? "phase-ready" : "accepted",
          currentPhase: planState.currentPhase,
          currentTask: planState.currentTask,
          projectStatus: advancePhase ? `Ready for ${planState.currentPhase}` : "Cycle finished"
        }
      }) : current);
      setProject((current) => current ? ({
        ...current,
        phases: planState.phases,
        tasks: planState.tasks
      }) : current);
      enqueueAgentMessage({
        from: "architect",
        to: "team",
        text: "Good job team!",
        message: "Good job team!",
        type: "status",
        priority: "high",
        restoreState: "done"
      });
      setDecisionMessage(
        advancePhase
          ? "Cycle accepted. Continue to the next work unit."
          : (result?.executor?.applied?.length
              ? "Cycle finished. Junior Dev file operations were already applied."
              : "Cycle finished. No files were changed.")
      );
      pushNotification({
        type: "success",
        title: advancePhase ? "Workflow ready" : "Cycle finished",
        message: advancePhase
          ? "Ready for the next work unit."
          : `${getResultOutputFiles(result).length} file(s) are finalized.`
      });
      await wait(1100);
      setScene(null);
      await refreshTrackedProjects();
    } catch (acceptError) {
      setDecisionMessage(acceptError?.message || "Could not accept the decision.");
    } finally {
      setIsDecisionBusy(false);
    }
  }

  async function previewAndApply() {
    const applyProject = resultProject || project;

    if (!applyProject?.rootPath || !result?.architect?.patches?.length) {
      setDecisionMessage("No file patches are available to apply.");
      return;
    }

    setIsDecisionBusy(true);
    setDecisionMessage("");

    try {
      clearSpeechQueue();
      setAgents((currentAgents) => currentAgents.map((agent) => ({ ...agent, status: "waiting" })));
      const previews = await window.trifix.previewApply({
        projectRoot: applyProject.rootPath,
        patches: result.architect.patches,
        affectedFiles: result.architect.affectedFiles
      });
      setDecisionPreview(previews);

      const createCount = previews.filter((preview) => preview.created).length;
      const updateCount = previews.length - createCount;
      const confirmed = window.confirm(
        `Apply ${previews.length} file change(s)? ${createCount} new, ${updateCount} update(s). Backups are created for overwritten files.`
      );

      if (!confirmed) {
        setDecisionMessage("Apply cancelled.");
        return;
      }

      const applied = await window.trifix.applyDecision({
        projectRoot: applyProject.rootPath,
        projectId: applyProject?.projectId,
        patches: result.architect.patches,
        affectedFiles: result.architect.affectedFiles
      });

      setWorkflow((current) => ({
        ...current,
        decisionStatus: "applied",
        currentStage: "applied"
      }));
      const createdCount = applied.applied.filter((item) => item.created).length;
      const updatedCount = applied.applied.length - createdCount;
      setDecisionMessage(
        `Applied ${applied.applied.length} file(s): ${createdCount} new, ${updatedCount} updated.${applied.backupRoot ? ` Backup: ${applied.backupRoot}` : ""
        }`
      );
      clearSpeechQueue();
      setScene({ type: "success", message: SUCCESS_SCENE_MESSAGE });
      setAgents((currentAgents) => currentAgents.map((agent) => ({ ...agent, status: "done" })));
      enqueueAgentMessage({
        from: "architect",
        to: "team",
        text: "Good job team!",
        message: "Good job team!",
        type: "status",
        priority: "high",
        restoreState: "done"
      });
      await wait(1100);
      setScene(null);
      if (applyProject.rootPath === project?.rootPath) {
        await refreshProject();
      }
      await refreshTrackedProjects();
    } catch (applyError) {
      setDecisionMessage(applyError?.message || "Could not apply the decision.");
    } finally {
      setIsDecisionBusy(false);
    }
  }

  async function denyDecision() {
    const reason = decisionReason.trim();
    if (!reason) {
      setDecisionMessage("Provide a deny reason before starting a correction loop.");
      return;
    }

    if (workflow.loopCount >= 2) {
      setWorkflow((current) => ({
        ...current,
        decisionStatus: "manual_review_required",
        currentStage: "manual-review"
      }));
      setDecisionMessage("Manual review required.");
      await window.trifix.updateProject({
        id: resultProject?.projectId || project?.projectId,
        status: "Manual review required",
        decisionStatus: "manual_review_required",
        loopCount: workflow.loopCount,
        lastAgent: "architect",
        affectedFiles: result?.decision?.affectedFiles || []
      });
      await refreshTrackedProjects();
      return;
    }

    setWorkflow((current) => ({
      ...current,
      decisionStatus: "denied",
      currentStage: "correction-loop"
    }));
    await window.trifix.updateProject({
      id: resultProject?.projectId || project?.projectId,
      status: "Denied",
      decisionStatus: "denied",
      loopCount: workflow.loopCount,
      lastAgent: "architect",
      affectedFiles: result?.decision?.affectedFiles || []
    });
    clearSpeechQueue();
    setScene({ type: "denied", message: "We're sorry! Let's get back to work." });
    setAgents((currentAgents) => currentAgents.map((agent) => ({ ...agent, status: "error" })));
    queueSceneMessages("deny", DENY_SCENE_MESSAGES);
    await wait(estimateSceneDuration(DENY_SCENE_MESSAGES) + SCENE_DELAY);
    setAgents((currentAgents) => currentAgents.map((agent) => ({ ...agent, status: "thinking" })));
    setScene(null);
    await refreshTrackedProjects();

    await runOffice(workflow.loopCount + 1, reason);
  }

  async function discardOutputDecision() {
    const outputProject = resultProject || project || normalizeGeneratedProject(result, null);
    if (!canDiscardGeneratedOutput(outputProject, result)) {
      setDecisionMessage("Only generated sandbox output can be discarded automatically.");
      return;
    }

    const confirmed = window.confirm(`Discard generated output "${outputProject.name || outputProject.projectName || "this sandbox"}"? This deletes the files from disk.`);
    if (!confirmed) {
      setDecisionMessage("Discard cancelled.");
      return;
    }

    setIsDecisionBusy(true);
    try {
      await window.trifix.discardOutput({
        projectRoot: outputProject.rootPath,
        projectId: outputProject.projectId
      });
      setDecisionMessage("Generated output discarded.");
      setResult(null);
      setProject(null);
      setResultProject(null);
      setSelectedFiles([]);
      setCommandLog([]);
      setProjectProcesses([]);
      setProcessLogView(null);
      setDecisionPreview([]);
      setWorkflow((current) => ({
        ...current,
        folderLoaded: false,
        contextReady: contextDocuments.length > 0 || codeInput.trim().length > 0,
        currentStage: "discarded",
        decisionStatus: "denied",
        projectStatus: "Output discarded",
        commandStatus: "idle"
      }));
      await refreshTrackedProjects();
    } catch (discardError) {
      setDecisionMessage(discardError?.message || "Could not discard generated output.");
    } finally {
      setIsDecisionBusy(false);
    }
  }

  async function downloadAllReviewData() {
    const outputProject = resultProject || project || normalizeGeneratedProject(result, null);
    console.log("download-review-data clicked");

    setIsDecisionBusy(true);
    setDecisionError("");
    try {
      if (!window.trifix?.exportReviewData) {
        throw new Error("Review export API is unavailable.");
      }
      const exported = await window.trifix.exportReviewData({
        runId: autonomyRun?.runId || currentRunRef.current,
        projectId: outputProject?.projectId || result?.project?.projectId || "",
        projectName: outputProject?.projectName || outputProject?.name || result?.project?.projectName || result?.project?.name || "",
        projectRoot: outputProject?.rootPath || result?.project?.rootPath || "",
        input: codeInput,
        result,
        workflow,
        preflight: runPreflight || result?.preflight || autonomyRun?.preflight || null,
        autonomyRun
      });
      if (exported?.cancelled || exported?.canceled) {
        setDecisionMessage("Review data export cancelled.");
        return;
      }
      setDecisionError("");
      setDecisionMessage(`Review data exported to ${exported.path}.`);
      pushNotification({
        type: "success",
        title: "Review data exported",
        message: exported.path
      });
    } catch (exportError) {
      const message = exportError?.message || "Could not export review data.";
      setDecisionMessage(message);
      setDecisionError(message);
      pushNotification({
        type: "error",
        title: "Review export failed",
        message
      });
    } finally {
      setIsDecisionBusy(false);
    }
  }

  async function finishReviewState() {
    const outputProject = resultProject || project || normalizeGeneratedProject(result, null);

    setIsDecisionBusy(true);
    setDecisionError("");
    try {
      const finished = await window.trifix.finishReview({
        projectId: outputProject?.projectId || result?.project?.projectId || "",
        projectRoot: outputProject?.rootPath || result?.project?.rootPath || "",
        result
      });
      const nextTask =
        finished?.decisionStatus === "acknowledged" && getResultValidationStatus(result) === "failed"
          ? "Patch recommended"
          : finished?.decisionStatus === "acknowledged" && getResultValidationStatus(result) === "needs_review"
            ? "Manual review follow-up recommended"
            : "Ready for next prompt";
      setReviewFinishedState(finished);
      setWorkflow((current) => ({
        ...current,
        decisionStatus: finished?.decisionStatus || "acknowledged",
        currentStage: "phase-ready",
        projectStatus: finished?.status || current.projectStatus,
        currentTask: nextTask
      }));
      setResult((current) => current ? ({
        ...current,
        workflow: {
          ...(current.workflow || {}),
          decisionStatus: finished?.decisionStatus || "acknowledged",
          currentStage: "phase-ready",
          projectStatus: finished?.status || current.workflow?.projectStatus || "Ready for next prompt",
          currentTask: nextTask
        }
      }) : current);
      setAutonomyRun((current) => current ? ({
        ...current,
        status: "review_finished",
        message: finished?.status || current.message || "Review finished.",
        updatedAt: new Date().toISOString()
      }) : current);
      setDecisionError("");
      setDecisionMessage(finished?.status || "Review finished.");
      pushNotification({
        type: "success",
        title: "Review finished",
        message: finished?.status || "Ready for next prompt."
      });
      await refreshTrackedProjects();
    } catch (finishError) {
      const message = finishError?.message || "Could not finish review.";
      setDecisionMessage(message);
      setDecisionError(message);
      pushNotification({
        type: "error",
        title: "Finish review failed",
        message
      });
    } finally {
      setIsDecisionBusy(false);
    }
  }

  async function startNewTask() {
    resetTaskState({ clearProjectSelection: true });
    setActiveView("landing");
    setProject(null);
    setResultProject(null);
    setContextDocuments([]);
    setCommandLog([]);
    setProjectProcesses([]);
    setProcessLogView(null);
    setTaskTitle("");
    setWorkflow((current) => ({
      ...current,
      folderLoaded: false,
      contextReady: false,
      currentStage: "task-ready"
    }));
  }

  async function continueTrackedProject(entry) {
    try {
      const reopened = entry.type === "sandbox-task"
        ? await window.trifix.openSandboxProject(entry)
        : await window.trifix.openTrackedProject(entry);
      const reviewData = await window.trifix.getProjectReviewData({
        projectRoot: reopened?.rootPath || entry?.path || ""
      });
      setProject(reopened);
      setResultProject(null);
      setSelectedFiles(reopened.defaultSelectedFiles || []);
      setContextDocuments(reopened.fsd?.documents || []);
      setCommandLog(reopened.commandHistory || []);
      setProjectProcesses(reopened.processes || []);
      setProcessLogView(null);
      setReviewFinishedState(
        String(entry?.decisionStatus || "").toLowerCase() === "acknowledged"
          ? { decisionStatus: "acknowledged", status: entry?.status || "Ready for next prompt" }
          : null
      );
      const persistedAutonomy = reopened.autonomyState || entry.autonomyState || null;
      currentRunRef.current = persistedAutonomy?.runId || "";
      if (persistedAutonomy?.runId) {
        ignoredRunIdsRef.current.delete(persistedAutonomy.runId);
      }
      setAutonomyRun(persistedAutonomy ? {
        runId: persistedAutonomy.runId,
        status: persistedAutonomy.status,
        deadlineAt: persistedAutonomy.deadlineAt,
        maxRuntimeMs: persistedAutonomy.maxRuntimeMs,
        lastStage: persistedAutonomy.currentStage,
        message: persistedAutonomy.currentTask || persistedAutonomy.nextAction || "Persisted autonomy state loaded.",
        updatedAt: persistedAutonomy.finishedAt || persistedAutonomy.startedAt || persistedAutonomy.queuedAt
      } : null);
      setIsAutonomyRunning(Boolean(persistedAutonomy?.runId) && !isTerminalAutonomyStatus(persistedAutonomy?.status));
      setIsRunning(Boolean(persistedAutonomy?.runId) && !isTerminalAutonomyStatus(persistedAutonomy?.status));
      setWorkflow((current) => ({
        ...current,
        folderLoaded: true,
        contextReady: (reopened.defaultSelectedFiles || []).length > 0,
        currentStage: mapTrackedStatusToStage(entry?.status, entry?.decisionStatus),
        loopCount: Number(entry?.loopCount || 0),
        decisionStatus: entry?.decisionStatus || "pending"
      }));
      setResult(buildTrackedProjectResult({
        project: reopened,
        entry,
        autonomyState: persistedAutonomy,
        reviewData
      }));
      setTaskTitle(reopened.projectSlug || reopened.name || "");
      setActiveView("office");
      await refreshTrackedProjects();
    } catch (nextError) {
      setError(nextError?.message || "Could not reopen this project.");
    }
  }

  async function removeTrackedProject(id) {
    await window.trifix.removeProject(id);
    await refreshTrackedProjects();
  }

  async function checkGraphifyStatus() {
    const targetProject = resultProject || project;
    if (!targetProject?.rootPath) {
      setDecisionMessage("Open a project before checking graph context.");
      return;
    }

    setDecisionMessage("Checking Graphify availability...");
    try {
      const graphStatus = await window.trifix.getGraphStatus({
        projectRoot: targetProject.rootPath,
        detect: true
      });
      setProject((current) => current?.rootPath === targetProject.rootPath ? { ...current, graphStatus } : current);
      setResultProject((current) => current?.rootPath === targetProject.rootPath ? { ...current, graphStatus } : current);
      setDecisionMessage(graphStatus.message || "Graph status updated.");
    } catch (graphError) {
      setDecisionMessage(graphError?.message || "Could not check graph context.");
    }
  }

  async function buildGraphifyIndex() {
    const targetProject = resultProject || project;
    if (!targetProject?.rootPath) {
      setDecisionMessage("Open a project before building graph context.");
      return;
    }

    setIsGraphRunning(true);
    setDecisionMessage("Building Graphify index. This may take a while on larger projects.");
    try {
      const graphStatus = await window.trifix.buildGraphIndex({
        projectRoot: targetProject.rootPath
      });
      setProject((current) => current?.rootPath === targetProject.rootPath ? { ...current, graphStatus } : current);
      setResultProject((current) => current?.rootPath === targetProject.rootPath ? { ...current, graphStatus } : current);
      setDecisionMessage(graphStatus.message || "Graph index updated.");
    } catch (graphError) {
      setDecisionMessage(graphError?.message || "Could not build graph context.");
    } finally {
      setIsGraphRunning(false);
    }
  }

  async function openGraphifyView() {
    const targetProject = resultProject || project;
    if (!targetProject?.rootPath) {
      setDecisionMessage("Open a project before viewing graph context.");
      return;
    }

    try {
      await window.trifix.openGraphView({
        projectRoot: targetProject.rootPath
      });
      setDecisionMessage("Opened current Graphify view.");
    } catch (graphError) {
      setDecisionMessage(graphError?.message || "Could not open Graphify view.");
    }
  }

  async function proceedToNextPhase() {
    await acceptDecision({ advancePhase: true });
  }

  async function finishCycle() {
    await acceptDecision({ advancePhase: false });
  }

  async function renameTrackedProject(entry) {
    const currentName = String(entry?.name || "").trim();
    const nextName = window.prompt("Rename sandbox", currentName);
    if (!nextName) {
      return;
    }

    const trimmedName = nextName.trim();
    if (!trimmedName || trimmedName === currentName) {
      return;
    }

    await window.trifix.updateProject({
      id: entry.id,
      name: trimmedName
    });
    await refreshTrackedProjects();
  }

  async function deleteTrackedProject(entry) {
    const confirmed = window.confirm(`Delete "${entry?.name || "this sandbox"}" from recents?`);
    if (!confirmed) {
      return;
    }

    await removeTrackedProject(entry.id);
  }

  function resetTaskState({ clearProjectSelection = false } = {}) {
    setError("");
    setResult(null);
    clearSpeechQueue();
    setChatMessages([]);
    setDecisionReason("");
    setDecisionPreview([]);
    setDecisionMessage("");
    setContextDocuments([]);
    setCommandLog([]);
    setScene(null);
    resetSpeechRuntime();
    setCodeInput("");
    setReviewFinishedState(null);
    userSelectedReviewTabRef.current = false;
    suppressAutoTabSwitchRef.current = false;
    setAgents(agentCatalog.map((agent) => ({ ...agent, status: "idle" })));
    setWorkflow({
      folderLoaded: Boolean(project?.rootPath),
      contextReady: false,
      currentStage: "idle",
      loopCount: 0,
      decisionStatus: "pending",
      currentPhase: "",
      currentTask: "",
      iterationCount: 0,
      projectStatus: "Not started",
      commandStatus: "idle"
    });
    if (clearProjectSelection) {
      setSelectedFiles([]);
    }
    setResultProject(null);
  }

  function queueSceneMessages(prefix, items) {
    const timestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    clearSpeechQueue();
    items.forEach((item, index) =>
      enqueueAgentMessage({
        id: `${prefix}:${item.from}:${index}`,
        from: item.from,
        to: item.to,
        role: item.role,
        stage: prefix,
        timestamp,
        text: summarizeBubbleText(item.message, { maxSentences: 2, maxWords: 18 }),
        message: item.message,
        detailsText: item.message,
        type: item.role === "recovery" ? "reaction" : "status",
        priority: "high",
        restoreState: "thinking"
      })
    );
  }

  function resetSpeechRuntime() {
    messageProcessorTokenRef.current += 1;
    if (chatterTimeoutRef.current) {
      clearTimeout(chatterTimeoutRef.current);
      chatterTimeoutRef.current = null;
    }
    if (chatterReplyTimeoutRef.current) {
      clearTimeout(chatterReplyTimeoutRef.current);
      chatterReplyTimeoutRef.current = null;
    }
    if (chatterHardTimeoutRef.current) {
      clearTimeout(chatterHardTimeoutRef.current);
      chatterHardTimeoutRef.current = null;
    }
    if (typewriterDoneResolverRef.current) {
      const resolve = typewriterDoneResolverRef.current;
      typewriterDoneResolverRef.current = null;
      resolve();
    }
  }

  function clearSpeechQueue() {
    resetSpeechRuntime();
    setMessageQueue([]);
    setActiveMessage(null);
    setVisibleBubble(null);
    setIsTyping(false);
  }

  function pushNotification(notification) {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `notice-${Date.now()}`;
    const nextNotification = {
      id,
      type: notification?.type || "info",
      title: notification?.title || "TriFix",
      message: notification?.message || "",
      createdAt: new Date().toISOString()
    };

    setNotifications((current) => [nextNotification, ...current].slice(0, 4));
    const timer = setTimeout(() => removeNotification(id), 6500);
    notificationTimersRef.current.set(id, timer);
  }

  function removeNotification(id) {
    const timer = notificationTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      notificationTimersRef.current.delete(id);
    }
    setNotifications((current) => current.filter((notification) => notification.id !== id));
  }

  return (
    <div className={`app-shell ${activeView === "landing" ? "landing-shell" : ""}`}>
      {activeView === "landing" ? null : (
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">
              <Sparkles size={19} />
            </div>
            <div>
              <strong>TriFix AI</strong>
              <span>Software Team V2</span>
            </div>
          </div>

          <nav className="nav-list" aria-label="Primary">
            <SidebarButton
              active={activeView === "landing"}
              icon={<Plus size={18} />}
              label="Home"
              onClick={() => setActiveView("landing")}
            />
            <SidebarButton
              active={activeView === "office"}
              icon={<BriefcaseBusiness size={18} />}
              label="Workspace"
              onClick={() => setActiveView("office")}
            />
            <SidebarButton
              active={activeView === "reports"}
              icon={<History size={18} />}
              label="Reports"
              onClick={() => setActiveView("reports")}
            />
            <SidebarButton
              active={activeView === "settings"}
              icon={<Settings size={18} />}
              label="Settings"
              onClick={() => setActiveView("settings")}
            />
          </nav>

          <div className="sidebar-footer">
            <span className="signal-dot" />
            <span>Agent endpoints</span>
          </div>
        </aside>
      )}

      <main className="main-view">
        {activeView === "landing" ? (
          <LandingView
            entries={trackedProjects}
            draftProjectName={draftProjectName}
            onDraftProjectName={setDraftProjectName}
            onCreateNewProject={beginNewProjectFlow}
            onOpenProject={openProject}
            onContinue={continueTrackedProject}
            onOpenFolder={(folderPath) => window.trifix.openFolderPath(folderPath)}
            onRefresh={refreshTrackedProjects}
            onRename={renameTrackedProject}
            onDelete={deleteTrackedProject}
          />
        ) : null}

        {activeView === "office" ? (
          <WorkspaceErrorBoundary resetKey={`${activeView}:${project?.rootPath || "none"}:${autonomyRun?.runId || "idle"}:${workflow?.decisionStatus || "pending"}`}>
            <OfficeView
              agents={agents}
              agentNameMap={agentNameMap}
              project={project}
              taskTitle={taskTitle}
              contextDocuments={contextDocuments}
              commandLog={commandLog}
              processes={projectProcesses}
              processLogView={processLogView}
              selectedFiles={selectedFiles}
              selectedFileSet={selectedFileSet}
              codeInput={codeInput}
              language={language}
              result={result}
              error={error}
              isRunning={isRunning}
              isAutonomyRunning={isAutonomyRunning}
              autonomyRun={autonomyRun}
              canRun={canRun}
              workflow={workflow}
              chatMessages={chatMessages}
              activeMessage={activeMessage}
              chatScrollRef={chatScrollRef}
              onTypewriterComplete={handleTypewriterComplete}
              activeTab={activeTab}
              decisionPreview={decisionPreview}
              decisionReason={decisionReason}
              decisionMessage={decisionMessage}
              runPreflight={runPreflight}
              isDecisionBusy={isDecisionBusy}
              messageByAgent={messageByAgent}
              onOpenProject={openProject}
              onRefreshProject={refreshProject}
              onCheckGraphify={checkGraphifyStatus}
              onBuildGraphify={buildGraphifyIndex}
              onOpenGraphify={openGraphifyView}
              isGraphRunning={isGraphRunning}
              onUploadContext={uploadContextDocuments}
              onToggleFile={toggleFile}
              onCodeInput={setCodeInput}
              onLanguage={setLanguage}
              onRun={startAutonomousRun}
              onConfirmPreflightStart={confirmPreflightStart}
              onRecheckPreflight={runModelPreflight}
              onBackFromPreflight={() => {
                clearRunPreflight();
                setActiveView("landing");
              }}
              onStopAutonomy={stopAutonomousRun}
              onRunProject={() => runProjectControl("run")}
              onOpenProcessUrl={openProcessUrl}
              onStopProcess={stopProjectProcess}
              onRestartProcess={restartProjectProcess}
              onViewProcessLog={viewProjectProcessLog}
              onCloseProcessLog={() => setProcessLogView(null)}
              isCommandRunning={isCommandRunning}
              isChatOpen={isChatOpen}
              onToggleChat={() => setIsChatOpen((current) => !current)}
              onTabChange={(tab) => updateActiveTab(tab, { userInitiated: true })}
              onDecisionReason={setDecisionReason}
              onAccept={finishCycle}
              onAcceptAndApply={previewAndApply}
              onAdvanceCycle={proceedToNextPhase}
              onNeedsPatch={denyDecision}
              onDiscardOutput={discardOutputDecision}
              onExportReviewData={downloadAllReviewData}
              onFinishReview={finishReviewState}
              reviewFinishedState={reviewFinishedState}
            />
          </WorkspaceErrorBoundary>
        ) : null}

        {activeView === "reports" ? (
          <WorkspaceErrorBoundary resetKey={`${activeView}:${project?.rootPath || "none"}:${autonomyRun?.runId || "idle"}:${workflow?.decisionStatus || "pending"}`}>
            <ReportsView
              result={result}
              project={project}
              workflow={workflow}
              autonomyRun={autonomyRun}
              testerResult={testerResult}
              onExportReviewData={downloadAllReviewData}
            />
          </WorkspaceErrorBoundary>
        ) : null}
        {activeView === "settings" ? (
          <SettingsView
            settings={settings}
            project={project}
            testerResult={testerResult}
            isTesterRunning={isTesterRunning}
            agentNames={agentNames}
            onRunTester={runAgentCapabilityTest}
            onSettingsChange={(nextSettings) => {
              setSettings(nextSettings);
              const nextAgents = toAgentList(nextSettings?.agents, agentNames);
              setAgentCatalog(nextAgents);
              setAgents((currentAgents) =>
                currentAgents.map((agent) => {
                  const updated = nextAgents.find((item) => item.id === agent.id) || agent;
                  return { ...updated, status: agent.status };
                })
              );
            }}
            onAgentNamesChange={(nextNames) => {
              setAgentNames(nextNames);
              saveAgentNames(nextNames);
            }}
          />
        ) : null}
        {scene ? <SceneOverlay scene={scene} /> : null}
      </main>
      <NotificationStack notifications={notifications} onDismiss={removeNotification} />
    </div>
  );
}

function NotificationStack({ notifications = [], onDismiss }) {
  if (!notifications.length) {
    return null;
  }

  return (
    <div className="notification-stack" aria-live="polite" aria-label="Notifications">
      {notifications.map((notification) => (
        <div className={`notification-card ${notification.type || "info"}`} key={notification.id}>
          <div>
            <strong>{notification.title}</strong>
            {notification.message ? <span>{notification.message}</span> : null}
          </div>
          <button
            className="notification-dismiss"
            type="button"
            onClick={() => onDismiss(notification.id)}
            aria-label="Dismiss notification"
          >
            <XCircle size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

class WorkspaceErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <section className="output-panel tone-red workspace-error-boundary" role="alert">
          <div className="output-panel-header">
            <span className="output-tab">Workspace Error</span>
            <h2>TriFix UI crashed while rendering this view.</h2>
          </div>
          <div className="decision-summary">
            <p>{this.state.error?.message || "Unknown renderer error."}</p>
            <p>Try switching tabs or export raw review data instead.</p>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}

class ReviewPaneErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <section className="output-panel tone-red workspace-error-boundary" role="alert">
          <div className="output-panel-header">
            <span className="output-tab">Review Error</span>
            <h2>{this.props.title || "This review panel could not be rendered."}</h2>
          </div>
          <div className="decision-summary">
            <p>{this.state.error?.message || "Unknown renderer error."}</p>
            <p>{this.props.message || "Switch to another tab or export raw review data instead."}</p>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}

function OfficeView({
  agents,
  agentNameMap,
  project,
  taskTitle,
  contextDocuments,
  commandLog = [],
  processes = [],
  processLogView,
  selectedFiles,
  selectedFileSet,
  codeInput,
  language,
  result,
  error,
  isRunning,
  isAutonomyRunning,
  autonomyRun,
  canRun,
  workflow,
  chatMessages,
  activeMessage,
  chatScrollRef,
  onTypewriterComplete,
  activeTab,
  decisionPreview,
  decisionReason,
  decisionMessage,
  runPreflight,
  isDecisionBusy,
  messageByAgent,
  onOpenProject,
  onRefreshProject,
  onCheckGraphify,
  onBuildGraphify,
  onOpenGraphify,
  isGraphRunning,
  onUploadContext,
  onToggleFile,
  onCodeInput,
  onLanguage,
  onRun,
  onConfirmPreflightStart,
  onRecheckPreflight,
  onBackFromPreflight,
  onStopAutonomy,
  onRunProject,
  onOpenProcessUrl,
  onStopProcess,
  onRestartProcess,
  onViewProcessLog,
  onCloseProcessLog,
  isCommandRunning,
  isChatOpen,
  onToggleChat,
  onTabChange,
  onDecisionReason,
  onAccept,
  onAcceptAndApply,
  onAdvanceCycle,
  onNeedsPatch,
  onDiscardOutput,
  onExportReviewData,
  onFinishReview,
  reviewFinishedState
}) {
  const activeAgentId = getVisibleActiveAgentId(agents, activeMessage, isRunning);
  const displayAgents = agents.map((agent) => ({
    ...agent,
    status: getDisplayAgentStatus(agent, activeMessage)
  }));
  const workflowProgress = buildWorkflowProgress({ workflow, result, preflight: runPreflight, autonomyRun });
  const focusedSpeakerId = activeMessage && isImportantVisualMessage(activeMessage) ? activeAgentId : "";
  const showCycleReview = shouldShowCycleReview({ result, workflow, isRunning });
  const [isCycleReviewOpen, setIsCycleReviewOpen] = useState(false);
  const lastOpenedReviewKey = useRef("");
  const reviewKey = `${workflow?.loopCount || 0}:${workflow?.decisionStatus || ""}:${result?.decision?.summary || ""}`;
  const needsPatch = String(workflow?.decisionStatus || result?.decision?.decisionStatus || "").toLowerCase() === "needs_patch";

  useEffect(() => {
    if (!showCycleReview) {
      setIsCycleReviewOpen(false);
      return;
    }

    if (lastOpenedReviewKey.current !== reviewKey) {
      lastOpenedReviewKey.current = reviewKey;
      setIsCycleReviewOpen(false);
    }
  }, [reviewKey, showCycleReview]);

  function runCycleAction(action) {
    setIsCycleReviewOpen(false);
    action?.();
  }

  function openChangesReview() {
    if (showCycleReview) {
      setIsCycleReviewOpen(true);
      return;
    }

    onTabChange?.("decision");
  }

  return (
    <>
      {showCycleReview ? (
        <CycleReviewLauncher result={result} workflow={workflow} onOpen={() => setIsCycleReviewOpen(true)} />
      ) : null}

      {showCycleReview && isCycleReviewOpen ? (
        <div className="cycle-review-overlay" role="presentation" onMouseDown={() => setIsCycleReviewOpen(false)}>
          <div
            className="cycle-review-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Cycle review"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <CycleReviewCard
              result={result}
              workflow={workflow}
              isBusy={isDecisionBusy}
              onAdvanceCycle={() => runCycleAction(onAdvanceCycle)}
              onFinishCycle={() => runCycleAction(onAccept)}
              onNeedsPatch={() => runCycleAction(onNeedsPatch)}
              onDiscardOutput={() => runCycleAction(onDiscardOutput)}
              onClose={() => setIsCycleReviewOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <header className="workspace-header">
        <div>
          <p className="eyebrow">TriFix AI Workspace</p>
          <h1>{project?.name || taskTitle || "Start the next build"}</h1>
          <p className="workspace-subtitle">
            {project?.rootPath
              ? "Autonomous run: stops when human review is needed."
              : "Runs until output is produced or review is required."}
          </p>
        </div>
        <div className="button-row">
          <button className="secondary-button" type="button" onClick={onRunProject} disabled={isCommandRunning || !project?.rootPath}>
            {isCommandRunning ? <Loader2 size={18} className="spin" /> : <Play size={18} />}
            Run Project
          </button>
          {isAutonomyRunning ? (
            <button className="secondary-button danger" type="button" onClick={onStopAutonomy}>
              <XCircle size={18} />
              Stop Auto
            </button>
          ) : null}
          <button className="primary-button" type="button" onClick={onRun} disabled={!canRun || isAutonomyRunning || Boolean(runPreflight)}>
            {isRunning || runPreflight?.state === "checking" ? <Loader2 size={18} className="spin" /> : <Play size={18} />}
            Run
          </button>
        </div>
      </header>

      <CompactWorkflowStepper workflow={workflow} result={result} progress={workflowProgress} preflight={runPreflight} autonomyRun={autonomyRun} />

      {shouldShowCompactPreflightSummary(runPreflight, result, autonomyRun) ? (
        <CompactPreflightSummary
          preflight={runPreflight || result?.preflight || autonomyRun?.preflight || null}
          onRecheck={onRecheckPreflight}
          isBusy={isRunning}
        />
      ) : null}

      {shouldShowExpandedPreflightPanel(runPreflight) ? (
        <PreflightPanel
          preflight={runPreflight}
          isBusy={isRunning}
          onStartRun={() => onConfirmPreflightStart?.(runPreflight.selectedRunMode || "normal")}
          onProceedAnyway={() => onConfirmPreflightStart?.("degraded_developer_only")}
          onRecheck={onRecheckPreflight}
          onBack={onBackFromPreflight}
        />
      ) : null}

      {autonomyRun?.runId ? (
        <AutonomyStatusCard
          autonomyRun={autonomyRun}
          isRunning={isAutonomyRunning}
          workflow={workflow}
          result={result}
          isDecisionBusy={isDecisionBusy}
          onOpenChanges={openChangesReview}
          onNeedsPatch={onNeedsPatch}
          onDiscardOutput={onDiscardOutput}
        />
      ) : null}
      <ProcessManagerCard
        processes={processes}
        onOpenProcessUrl={onOpenProcessUrl}
        onStopProcess={onStopProcess}
        onRestartProcess={onRestartProcess}
        onViewProcessLog={onViewProcessLog}
      />

      <section className="office-stage" aria-label="Developer agents">
        <div className="stage-backdrop" />
        {displayAgents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            chatMessage={messageByAgent[agent.id] || null}
            onTypewriterComplete={onTypewriterComplete}
            isActive={focusedSpeakerId === agent.id}
            isDimmed={Boolean(focusedSpeakerId) && focusedSpeakerId !== agent.id && agent.status !== "done"}
          />
        ))}
      </section>

      <FloatingChatDock
        isOpen={isChatOpen}
        onToggle={onToggleChat}
        chatMessages={chatMessages}
        agentNameMap={agentNameMap}
        chatScrollRef={chatScrollRef}
        onTypewriterComplete={onTypewriterComplete}
      />

      <div className="context-banner">
        {decisionMessage || (selectedFiles.length > 0
          ? "Supervisor, Senior Dev, and Junior Dev are using only queued files plus summarized uploaded context."
          : project?.projectType === "project"
            ? "No project files are queued. Prompt-only work runs inside the current task sandbox."
            : workflow.folderLoaded && workflow.contextReady
              ? "The software team is working inside the current task sandbox."
              : "Open a project folder or start a new task to prepare context.")}
      </div>

      {error ? (
        <div className="error-banner" role="alert">
          <TriangleAlert size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="work-grid">
        <div className="input-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Input</p>
              <h2>FSD, instruction, or request</h2>
            </div>
            <div className="button-row">
              <button className="secondary-button" type="button" onClick={onUploadContext}>
                <FilePlus2 size={16} />
                Upload Context
              </button>
              <select value={language} onChange={(event) => onLanguage(event.target.value)}>
                {LANGUAGES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <textarea
            value={codeInput}
            onChange={(event) => onCodeInput(event.target.value)}
            spellCheck="false"
            placeholder={`Paste an FSD, product request, bug report, or instruction for the Project Manager...${project?.rootPath ? "\n\nType /debug-project to run project checks from text." : ""}`}
          />
          {contextDocuments.length > 0 ? (
            <div className="context-doc-list">
              <strong>Project context</strong>
              {contextDocuments.map((doc) => (
                <span key={doc.id || doc.name}>{doc.name} - {doc.type}</span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="files-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Project</p>
              <h2>Relevant files</h2>
            </div>
            <div className="button-row">
              {project ? (
                <button className="icon-button" type="button" onClick={onRefreshProject} title="Refresh tree">
                  <RefreshCw size={17} />
                </button>
              ) : null}
              <button className="secondary-button" type="button" onClick={onOpenProject}>
                <FolderOpen size={17} />
                Open
              </button>
            </div>
          </div>

          {project ? (
            <>
              <div className="project-path" title={project.rootPath}>
                {project.rootPath}
              </div>
              {project.sandboxPath ? (
                <div className="project-path" title={project.sandboxPath}>
                  Sandbox: {project.sandboxPath}
                </div>
              ) : null}
              <div className="selected-count">
                {selectedFiles.length} / {project.limits?.maxSelectedFiles || 10} files queued
              </div>
              <GraphStatusCard
                graphStatus={project.graphStatus}
                isGraphRunning={isGraphRunning}
                onCheckGraphify={onCheckGraphify}
                onBuildGraphify={onBuildGraphify}
                onOpenGraphify={onOpenGraphify}
              />
              <div className="file-tree">
                <FileTree nodes={project.tree} selectedFileSet={selectedFileSet} onToggleFile={onToggleFile} />
              </div>
            </>
          ) : (
            <div className="empty-state">
              <FolderOpen size={28} />
              <span>No project folder open. Prompt-only runs use the sandbox automatically.</span>
            </div>
          )}
        </div>
      </section>

            <OutputBin
              result={result}
              activeTab={activeTab}
              workflow={workflow}
        commandLog={commandLog}
        decisionPreview={decisionPreview}
        decisionReason={decisionReason}
        decisionMessage={decisionMessage}
        isDecisionBusy={isDecisionBusy}
        onTabChange={onTabChange}
        onDecisionReason={onDecisionReason}
        onAccept={onAccept}
        onAcceptAndApply={onAcceptAndApply}
        onAdvanceCycle={onAdvanceCycle}
        onNeedsPatch={onNeedsPatch}
        onDiscardOutput={onDiscardOutput}
        onOpenProcessUrl={onOpenProcessUrl}
        onStopProcess={onStopProcess}
        onRestartProcess={onRestartProcess}
        onViewProcessLog={onViewProcessLog}
      />
      {processLogView ? (
        <ProcessLogModal processLog={processLogView} onClose={onCloseProcessLog} />
      ) : null}
    </>
  );
}

function AgentCard({ agent, chatMessage, onTypewriterComplete, isActive, isDimmed }) {
  const StatusIcon = getStatusIcon(agent.status);
  const spriteStatus = mapStatusToSpriteStatus(agent.status);
  const spritePath =
    agent.sprites?.[spriteStatus] ||
    (spriteStatus === "received" ? agent.sprites?.thinking : "") ||
    agent.sprites?.idle;
  const showSpeakingBadge = agent.status === "speaking" && chatMessage?.importantVisual;

  return (
    <article
      className={`agent-card ${agent.color} status-${agent.status} ${isActive ? "is-active" : ""} ${isDimmed ? "is-dimmed" : ""
        }`}
    >
      <div className="agent-card-glow" />
      <div className="agent-topline">
        <div className="agent-identity">
          <div className="agent-meta">{agent.roleLabel}</div>
          <h2>{agent.name}</h2>
        </div>
        <div className="status-group">
          {agent.status === "done" ? (
            <span className="done-badge">
              <CheckCircle2 size={14} />
              complete
            </span>
          ) : null}
          {!(chatMessage?.type === "chatter" && agent.status === "speaking") ? (
            <span className={`status-pill ${showSpeakingBadge ? "speaking" : agent.status}`}>
              <StatusIcon size={15} className={isSpinnerStatus(agent.status) ? "spin" : ""} />
              {showSpeakingBadge ? "speaking" : agent.status}
            </span>
          ) : null}
        </div>
      </div>

      <div className="agent-stage">
        <div className={`agent-avatar sprite-frame ${chatMessage?.type === "chatter" && chatMessage?.isTyping ? "soft-speaking" : ""}`}>
          {spritePath ? (
            <img src={spritePath} alt={`${agent.name} ${agent.status}`} className="agent-sprite" />
          ) : (
            <Bot size={22} />
          )}
        </div>
        <AgentSpeechBubble
          agent={agent.id}
          bubble={chatMessage}
          onComplete={chatMessage?.isTyping ? onTypewriterComplete : undefined}
        />
      </div>

      <div className="agent-footer">
        <p>{agent.summary}</p>
        <code>{agent.model}</code>
      </div>
    </article>
  );
}

function AgentSpeechBubble({ agent, bubble, onComplete }) {
  if (!bubble || bubble.agent !== agent || !bubble.visible) {
    return null;
  }

  return (
    <div className={`agent-dialogue is-visible ${bubble.type === "chatter" ? "is-chatter chatter-bubble" : ""}`}>
      <TypewriterText text={bubble.text} active={bubble.isTyping} onComplete={onComplete} />
    </div>
  );
}

function FloatingChatDock({ isOpen, onToggle, chatMessages, agentNameMap, chatScrollRef, onTypewriterComplete }) {
  return (
    <div className={`floating-chat ${isOpen ? "open" : ""}`}>
      {isOpen ? (
        <div className="floating-chat-card">
          <div className="floating-chat-header">
            <div>
              <p className="eyebrow">Agent Chat</p>
              <h2>Team conversation</h2>
            </div>
            <button className="icon-button" type="button" onClick={onToggle} title="Close chat">
              <XCircle size={18} />
            </button>
          </div>
          <ChatPanel
            chatMessages={chatMessages}
            agentNameMap={agentNameMap}
            chatScrollRef={chatScrollRef}
            onTypewriterComplete={onTypewriterComplete}
            compact
          />
        </div>
      ) : null}
      <button className="floating-chat-toggle" type="button" onClick={onToggle} aria-label="Toggle agent chat">
        <MessageSquare size={18} />
      </button>
    </div>
  );
}

function ChatPanel({
  chatMessages,
  agentNameMap,
  chatScrollRef,
  onTypewriterComplete,
  compact = false
}) {
  return (
    <section className={`chat-panel ${compact ? "compact" : ""}`} aria-label="Agent chat">
      <div className="output-section-header">
        <div>
          <p className="eyebrow">Agent Chat</p>
          <h2>Live collaboration</h2>
        </div>
      </div>

      <div className="chat-log" ref={chatScrollRef}>
        {chatMessages.length === 0 ? (
          <div className="chat-empty">Messages will appear here as the agents work through the task.</div>
        ) : (
          chatMessages.map((message) => (
            <article
              key={message.id}
              className={`chat-message ${message.from} ${message.type === "chatter" ? "is-chatter" : ""} ${message.status === "typing" ? "is-active" : ""
                }`}
            >
              <div className="chat-head">
                <strong>{formatAgentName(message.from, agentNameMap)}</strong>
                {message.type === "chatter" ? <span className="chat-kind">... idle chatter</span> : null}
                <span>{`${message.role} -> ${message.to}`}</span>
                <time>{message.timestamp}</time>
              </div>
              <div className="chat-body">
                {message.renderedText || message.bubbleText || message.message}
              </div>
              {message.detailsText && message.detailsText !== (message.bubbleText || message.message) ? (
                <details className="chat-details">
                  <summary>{message.detailLabel || "View details"}</summary>
                  <div className="chat-detail-body">{message.detailsText}</div>
                </details>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function TypewriterText({ text, active, speed = TYPE_SPEED, onComplete }) {
  const words = splitIntoWords(text);
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (!active) {
      setVisibleCount(words.length);
      return () => { };
    }

    let cancelled = false;
    let timeoutId = null;

    setVisibleCount(0);

    function tick(index) {
      if (cancelled) {
        return;
      }

      const nextCount = index + 1;
      setVisibleCount(nextCount);

      if (nextCount >= words.length) {
        onComplete?.();
        return;
      }

      timeoutId = setTimeout(
        () => tick(nextCount),
        getWordDelay(words[index], speed)
      );
    }

    if (words.length === 0) {
      onComplete?.();
      return () => { };
    }

    timeoutId = setTimeout(() => tick(0), speed);

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [text, speed, active]);

  return joinVisibleWords(words, visibleCount);
}

function TypingIndicator({ label = "typing" }) {
  return (
    <span className="typing-indicator" aria-label={label}>
      <span />
      <span />
      <span />
    </span>
  );
}

function OutputBin({
  result,
  activeTab,
  workflow,
  commandLog,
  decisionPreview,
  decisionReason,
  decisionMessage,
  decisionError,
  isDecisionBusy,
  onTabChange,
  onDecisionReason,
  onAccept,
  onAcceptAndApply,
  onAdvanceCycle,
  onNeedsPatch,
  onDiscardOutput,
  onExportReviewData,
  onFinishReview,
  reviewFinishedState,
  onOpenProcessUrl,
  onStopProcess,
  onRestartProcess,
  onViewProcessLog
}) {
  const safeWorkflow = workflow || { currentStage: "idle", loopCount: 0, decisionStatus: "pending" };
  const workflowProgress = buildWorkflowProgress({ workflow: safeWorkflow, result });
  return (
    <section className="output-section" aria-label="Output Bin">
      <div className="output-section-header">
        <div>
          <p className="eyebrow">Output Bin</p>
          <h2>Review cycle</h2>
        </div>
        <div className="workflow-meta">
          <span>Stage: {safeWorkflow.currentStage}</span>
          <span>Loop: {safeWorkflow.loopCount}</span>
          <span>Run: {workflowProgress.summary}</span>
          {safeWorkflow.currentTask ? <span>Task: {safeWorkflow.currentTask}</span> : null}
          {safeWorkflow.commandStatus ? <span>Command: {safeWorkflow.commandStatus}</span> : null}
          <span>Decision: {safeWorkflow.decisionStatus}</span>
        </div>
      </div>

      <div className="output-tabs" role="tablist" aria-label="Output tabs">
        {OUTPUT_TABS.map((tab) => (
          <button
            key={tab}
            className={`output-tab-button ${activeTab === tab ? "active" : ""}`}
            type="button"
            onClick={() => onTabChange(tab)}
          >
            {formatOutputTab(tab)}
          </button>
        ))}
      </div>

      <ReviewPaneErrorBoundary resetKey={`${activeTab}:${safeWorkflow.currentStage || "idle"}:${safeWorkflow.decisionStatus || "pending"}:${result?.project?.rootPath || "none"}`}>
        <div className="output-grid single">
        {activeTab === "junior" ? (
          <OutputPanel
            title="Junior Dev"
            content={joinSections([
              ["Implementation Notes", result?.junior?.rationale],
              ["File Operations", formatFileOperations(result?.dev?.fileOperations)],
              ["Executor", formatExecutorSummary(result?.executor)],
              ["Recommendation", result?.junior?.recommendation]
            ])}
            tone="blue"
          />
        ) : null}
        {activeTab === "supervisor" ? (
          <OutputPanel
            title="Senior Dev / QA"
            content={joinSections([
              ["Review", result?.supervisor?.critique],
              ["Suggested Changes", result?.supervisor?.suggestedChanges],
              ["Review Notes", result?.qa?.instructions]
            ])}
            tone="red"
          />
        ) : null}
        {activeTab === "architect" ? (
          <OutputPanel
            title="Supervisor / PM"
            content={joinSections([
              ["Summary", result?.architect?.summary],
              ["PRD / Direction", result?.pm?.plan],
              ["Decision", result?.architect?.recommendation]
            ])}
            tone="green"
          />
        ) : null}
        {activeTab === "prd" ? (
          <PrdPanel prd={result?.project?.prd} />
        ) : null}
        {activeTab === "tasks" ? (
          <WorkflowProgressPanel workflow={workflow} result={result} progress={workflowProgress} />
        ) : null}
        {activeTab === "logs" ? (
          <CommandLogPanel
            commandLog={commandLog}
            result={result}
            onOpenProcessUrl={onOpenProcessUrl}
            onStopProcess={onStopProcess}
            onRestartProcess={onRestartProcess}
            onViewProcessLog={onViewProcessLog}
          />
        ) : null}
        {activeTab === "decision" ? (
          <DecisionPanel
            result={result}
            workflow={safeWorkflow}
            decisionPreview={decisionPreview}
            decisionReason={decisionReason}
            decisionMessage={decisionMessage}
            decisionError={decisionError}
            isDecisionBusy={isDecisionBusy}
            onDecisionReason={onDecisionReason}
            onAccept={onAccept}
            onAcceptAndApply={onAcceptAndApply}
            onAdvanceCycle={onAdvanceCycle}
            onNeedsPatch={onNeedsPatch}
            onDiscardOutput={onDiscardOutput}
            onExportReviewData={onExportReviewData}
            onFinishReview={onFinishReview}
            reviewFinishedState={reviewFinishedState}
          />
        ) : null}
        </div>
      </ReviewPaneErrorBoundary>
    </section>
  );
}

function DecisionPanel({
  result,
  workflow,
  decisionPreview,
  decisionReason,
  decisionMessage,
  decisionError,
  isDecisionBusy,
  onDecisionReason,
  onAccept,
  onAcceptAndApply,
  onAdvanceCycle,
  onNeedsPatch,
  onDiscardOutput,
  onExportReviewData,
  onFinishReview,
  reviewFinishedState
}) {
  const decision = result?.decision && typeof result.decision === "object" ? result.decision : {};
  const affectedFiles = Array.isArray(decision?.affectedFiles) ? decision.affectedFiles : [];
  const proposedChanges = Array.isArray(decision?.proposedChanges) ? decision.proposedChanges : [];
  const needsPatch = String(workflow?.decisionStatus || decision?.decisionStatus || "").toLowerCase() === "needs_patch";
  const requiresManualReview = String(workflow?.decisionStatus || "").toLowerCase() === "manual_review_required";
  const reviewAcknowledged = String(workflow?.decisionStatus || "").toLowerCase() === "acknowledged";
  const canDiscard = canDiscardGeneratedOutput(result?.project, result);
  const reviewLifecycleState = getReviewLifecycleState(workflow, result);
  const terminalReviewState =
    reviewAcknowledged
    || ["output_ready", "ready_for_review", "needs_review", "build_unverified", "validation_failed", "needs_patch", "completed"].includes(reviewLifecycleState)
    || requiresManualReview
    || needsPatch;
  const canFinishReview = terminalReviewState && hasUsefulOutput(result) && !reviewAcknowledged;
  const override = result?.finalization?.deterministicOverride;

  return (
    <div className="output-panel output-decision tone-green">
      <div className="output-panel-header">
        <span className="output-tab">Decision</span>
        <h2>Final review</h2>
      </div>

      <div className="decision-summary">
        <h3>Summary</h3>
        <p>{formatDecisionSummaryForResult(decision?.summary, result) || "No decision summary yet."}</p>
        {decision?.verdict ? (
          <>
            <h3>{override?.applied ? "PM verdict (model)" : "PM verdict"}</h3>
            <p>{formatDecisionSummaryForResult(decision.verdict, result)}</p>
          </>
        ) : null}
        {override?.applied ? (
          <>
            <h3>Effective result</h3>
            <p>
              {override.reason === "validation_failed"
                ? "Deterministic validation failed. Final status was overridden to needs patch."
                : "Deterministic evidence is incomplete. Final status was overridden to needs review."}
            </p>
          </>
        ) : null}
        {result?.project?.rootPath ? (
          <p className="project-path" title={result.project.rootPath}>
            {result.project.projectName || result.project.name || "Project"}: {result.project.rootPath}
          </p>
        ) : null}
        {getProjectValidationMessage(result) ? <p>{getProjectValidationMessage(result)}</p> : null}
      </div>

      <div className="decision-columns">
        <div>
          <h3>Affected Files</h3>
          <ul className="affected-files">
            {affectedFiles.map((file) => (
              <li key={file}>
                <FileCode2 size={16} />
                <span>{file}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Proposed Changes</h3>
          <ul className="decision-list">
            {proposedChanges.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
          {result?.executor ? (
            <>
              <h3>File Executor</h3>
              <ul className="decision-list">
                <li>Created: {result.executor.filesCreated || 0}</li>
                <li>Modified: {result.executor.filesModified || 0}</li>
                <li>Failed: {(result.executor.failedOperations || []).length}</li>
              </ul>
            </>
          ) : null}
        </div>
      </div>

      {needsPatch || requiresManualReview ? (
        <div className="decision-actions">
          <button className="secondary-button" type="button" onClick={onNeedsPatch} disabled={isDecisionBusy}>
            <XCircle size={16} />
            Needs Patch
          </button>
          {canDiscard ? (
            <button className="secondary-button danger" type="button" onClick={onDiscardOutput} disabled={isDecisionBusy}>
              <XCircle size={16} />
              Discard Output
            </button>
          ) : null}
        </div>
      ) : (
        <div className="context-banner">
          {reviewAcknowledged
            ? (reviewFinishedState?.status || "Review finished. Ready for the next prompt.")
            : "Output generated. Review it or send another prompt to patch or extend this project."}
        </div>
      )}

      <label className="deny-reason">
        <span>Patch request / correction feedback</span>
        <textarea
          value={decisionReason}
          onChange={(event) => onDecisionReason(event.target.value)}
          placeholder="Explain what is wrong or what should change before re-running the correction loop..."
        />
      </label>

      {decisionPreview.length > 0 ? (
        <div className="diff-preview">
          <h3>Diff Preview</h3>
          {decisionPreview.map((preview) => (
            <div className="diff-card" key={preview.path}>
              <strong>
                {preview.created ? `${preview.path} (new)` : preview.path}
                {preview.redirected ? ` from ${preview.requestedPath}` : ""}
              </strong>
              <pre>{preview.diff}</pre>
            </div>
          ))}
        </div>
      ) : null}

      {decisionMessage ? <div className="context-banner">{decisionMessage}</div> : null}
      {needsPatch ? (
        <div className="error-banner" role="alert">
          <TriangleAlert size={18} />
          <span>Supervisor / PM requested another patch before this cycle can be accepted.</span>
        </div>
      ) : null}
      {workflow.decisionStatus === "manual_review_required" ? (
        <div className="error-banner" role="alert">
          <TriangleAlert size={18} />
          <span>Manual review required.</span>
        </div>
      ) : null}
      {decisionError ? (
        <div className="error-banner" role="alert">
          <TriangleAlert size={18} />
          <span>{decisionError}</span>
        </div>
      ) : null}
      <div className="decision-actions">
        <button
          className="secondary-button"
          type="button"
          onClick={onExportReviewData}
          disabled={isDecisionBusy}
          data-testid="download-review-data-button"
        >
          <FilePlus2 size={16} />
          Download All Review Data
        </button>
        {canFinishReview ? (
          <button className="primary-button" type="button" onClick={onFinishReview} disabled={isDecisionBusy}>
            <CheckCircle2 size={16} />
            Finish Review
          </button>
        ) : null}
      </div>
      <p className="decision-footnote">
        Finish Review closes this run state. It does not change files or mark failed validation as passed.
      </p>
    </div>
  );
}

function CycleReviewLauncher({ result, workflow, onOpen }) {
  const affectedFiles = result?.decision?.affectedFiles || [];
  const needsPatch = String(workflow?.decisionStatus || result?.decision?.decisionStatus || "").toLowerCase() === "needs_patch";

  return (
    <button className="cycle-review-launcher" type="button" onClick={onOpen} aria-label="Open cycle review">
      <span>
        <strong>{needsPatch ? "Patch required" : "Cycle ready"}</strong>
        <small>{affectedFiles.length} file(s) affected - Ready for review</small>
      </span>
      <CheckCircle2 size={18} />
    </button>
  );
}

function CompactWorkflowStepper({ workflow, result, progress, preflight, autonomyRun }) {
  const summary = preflight?.state === "checking"
    ? "Initializing TriFix..."
    : preflight?.message || progress.summary;

  return (
    <section className="output-panel tone-blue workflow-hero-panel" aria-label="Run progress">
      <div className="output-panel-header">
        <span className="output-tab">Run Progress</span>
        <h2>Workflow</h2>
      </div>
      <div className="workflow-hero-summary">
        <p>{summary}</p>
        {autonomyRun?.runId ? <p className="project-path">{autonomyRun.runId}</p> : null}
      </div>
      <div className="workflow-stepper-shell">
        <ul className="workflow-stepper-list" role="list" aria-label="Workflow steps">
          {progress.steps.map((step) => (
            <li key={step.key} className={`workflow-step ${step.state}`}>
              <div className="workflow-step-node">
                <span className="workflow-step-state-icon">{renderWorkflowStepIcon(step.state)}</span>
              </div>
              <div className="workflow-step-copy">
                <strong>{step.label}</strong>
                <span className="workflow-step-badge">{formatWorkflowStepState(step.state)}</span>
                {step.note ? <small>{step.note}</small> : null}
              </div>
              <div className="workflow-step-connector" aria-hidden="true" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function CompactPreflightSummary({ preflight, onRecheck, isBusy = false }) {
  if (!preflight) {
    return null;
  }

  const activeNames = (preflight.activeModels || []).map((entry) => entry.name);
  const compactMessage = preflight.state === "checking"
    ? "Initializing TriFix..."
    : activeNames.length > 0
      ? `Preflight passed: ${activeNames.join(", ")} available`
      : preflight.message;

  return (
    <section className="output-panel tone-green preflight-compact-panel" aria-label="Preflight summary">
      <div className="output-panel-header">
        <span className="output-tab">Preflight</span>
        <h2>Initialization summary</h2>
      </div>
      <div className="preflight-compact-copy">
        <p>{compactMessage}</p>
        <small>{preflight.message}</small>
      </div>
      <div className="decision-actions">
        <button className="secondary-button" type="button" onClick={onRecheck} disabled={isBusy}>
          <RefreshCw size={16} />
          Recheck Models
        </button>
      </div>
    </section>
  );
}

function PreflightPanel({ preflight, isBusy, onStartRun, onProceedAnyway, onRecheck, onBack }) {
  if (!preflight) {
    return null;
  }

  const showStart = ["ready", "ready_with_warnings", "normal_qa_unavailable"].includes(preflight.state);
  const showProceedAnyway = preflight.state === "degraded_available";
  const showRecheck = preflight.state !== "checking";
  const showBack = preflight.state !== "checking";
  const showOfflineHelp = ["blocked", "degraded_available", "ready_with_warnings"].includes(preflight.state);

  return (
    <section className="output-panel tone-green preflight-panel" aria-label="TriFix initialization">
      <div className="output-panel-header">
        <span className="output-tab">Initialization</span>
        <h2>Initializing TriFix...</h2>
      </div>
      <div className="decision-summary preflight-summary">
        <p>{preflight.message}</p>
      </div>
      <div className="preflight-grid">
        <div>
          <h3>Active models</h3>
          <div className="preflight-model-list">
            {(preflight.activeModels || []).length > 0
              ? preflight.activeModels.map((entry) => (
                <article key={entry.id} className="preflight-model-card active">
                  <div className="preflight-model-card-head">
                    <strong>{entry.name}</strong>
                    <span className="preflight-status-badge active">{formatAvailabilityBadge(entry)}</span>
                  </div>
                  <span>{entry.model}</span>
                  <code>{entry.endpoint}</code>
                  <small>{formatHealthAttempts(entry)}</small>
                </article>
              ))
              : <p className="preflight-empty">None yet.</p>}
          </div>
        </div>
        <div>
          <h3>Unavailable models</h3>
          <div className="preflight-model-list">
            {(preflight.unavailableModels || []).length > 0
              ? preflight.unavailableModels.map((entry) => (
                <article key={entry.id} className="preflight-model-card unavailable">
                  <div className="preflight-model-card-head">
                    <strong>{entry.name}</strong>
                    <span className={`preflight-status-badge ${String(entry.classification || "").toLowerCase()}`}>{formatAvailabilityBadge(entry)}</span>
                  </div>
                  <span>{entry.model}</span>
                  <code>{entry.endpoint}</code>
                  <small>{formatHealthAttempts(entry)}</small>
                  <p>{buildUnavailableModelMessage(entry, { allowDeveloperOnly: true })}</p>
                  <small>{getSuggestedFix(entry)}</small>
                </article>
              ))
              : <p className="preflight-empty">None.</p>}
          </div>
        </div>
      </div>
      {(preflight.warnings || []).length > 0 ? (
        <div className="context-banner preflight-warning-banner">
          {preflight.warnings.join(" ")}
        </div>
      ) : null}
      <div className="preflight-recommended-mode">
        <strong>Recommended mode</strong>
        <span>{formatRunModeLabel(preflight.selectedRunMode)}</span>
      </div>
      {showOfflineHelp ? (
        <div className="context-banner preflight-help-banner">
          <strong>Available while some agents are unavailable:</strong>
          <span> Inspect old projects, view reports if available, export review data, and check settings. Developer-only degraded mode is allowed only when Developer is online.</span>
        </div>
      ) : null}
      <div className="decision-actions">
        {showStart ? (
          <button className="primary-button" type="button" onClick={onStartRun} disabled={isBusy}>
            <Play size={16} />
            Start Run
          </button>
        ) : null}
        {showProceedAnyway ? (
          <button className="primary-button" type="button" onClick={onProceedAnyway} disabled={isBusy}>
            <Play size={16} />
            Proceed Anyway
          </button>
        ) : null}
        {showRecheck ? (
          <button className="secondary-button" type="button" onClick={onRecheck} disabled={isBusy}>
            <RefreshCw size={16} />
            Recheck Models
          </button>
        ) : null}
        {showBack ? (
          <button className="secondary-button" type="button" onClick={onBack} disabled={isBusy}>
            <ChevronRight size={16} />
            Back to Landing
          </button>
        ) : null}
      </div>
    </section>
  );
}

function CycleReviewCard({ result, workflow, isBusy, onAdvanceCycle, onFinishCycle, onNeedsPatch, onDiscardOutput, onClose }) {
  const affectedFiles = result?.decision?.affectedFiles || [];
  const needsPatch = String(workflow?.decisionStatus || result?.decision?.decisionStatus || "").toLowerCase() === "needs_patch";
  const workflowProgress = buildWorkflowProgress({ workflow, result });

  return (
    <section className="cycle-review-card" aria-label="Cycle review">
      <div className="cycle-review-header">
        <div>
          <p className="eyebrow">Cycle Review</p>
          <h2>{formatDecisionHeadline(result?.decision?.summary) || "Cycle finished and is ready for review."}</h2>
        </div>
        <div className="cycle-review-header-actions">
          <span className="cycle-review-badge">{workflowProgress.summary}</span>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close cycle review">
            <XCircle size={18} />
          </button>
        </div>
      </div>

      <div className="cycle-review-grid">
        <div>
          <h3>What changed</h3>
          <ul className="decision-list">
            {(result?.decision?.proposedChanges || []).slice(0, 5).map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Files</h3>
          <ul className="affected-files">
            {affectedFiles.slice(0, 6).map((file) => (
              <li key={file}>
                <FileCode2 size={16} />
                <span>{file}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="cycle-review-footer">
        <div className="cycle-review-meta">
          <span>{affectedFiles.length} file(s) affected</span>
          <span>{workflowProgress.summary}</span>
        </div>
        <div className="decision-actions">
          <button className="primary-button" type="button" onClick={onAdvanceCycle} disabled={isBusy || needsPatch}>
            <Play size={16} />
            Continue Workflow
          </button>
          <button className="secondary-button" type="button" onClick={onFinishCycle} disabled={isBusy || needsPatch}>
            <CheckCircle2 size={16} />
            Finish Cycle
          </button>
          <button className="secondary-button" type="button" onClick={onNeedsPatch} disabled={isBusy}>
            <XCircle size={16} />
            Needs Patch
          </button>
          <button className="secondary-button danger" type="button" onClick={onDiscardOutput} disabled={isBusy}>
            <XCircle size={16} />
            Discard Output
          </button>
        </div>
      </div>
    </section>
  );
}

function PrdPanel({ prd }) {
  return (
    <div className="output-panel tone-green">
      <div className="output-panel-header">
        <span className="output-tab">PRD</span>
        <h2>Product requirements</h2>
      </div>
      {prd ? (
        <>
          <p>{prd.summary}</p>
          <SectionList title="Goals" items={prd.goals} />
          <SectionList title="Features" items={prd.features} />
          <SectionList title="Constraints" items={prd.constraints} />
        </>
      ) : (
        <p>No PRD generated yet.</p>
      )}
    </div>
  );
}

function WorkflowProgressPanel({ workflow, result, progress }) {
  return (
    <div className="output-panel tone-blue">
      <div className="output-panel-header">
        <span className="output-tab">Progress</span>
        <h2>Workflow Progress</h2>
      </div>
      <div className="section-list">
        <h3>Current Status</h3>
        <ul>
          <li>{formatWorkflowStepper(progress.steps)}</li>
          <li>{progress.summary}</li>
          {workflow.currentTask ? <li>Current task: {workflow.currentTask}</li> : null}
          {workflow.projectStatus ? <li>Run status: {workflow.projectStatus}</li> : null}
          {progress.verificationNote ? <li>{progress.verificationNote}</li> : null}
          {progress.finalizationNote ? <li>{progress.finalizationNote}</li> : null}
        </ul>
      </div>
      <div className="section-list">
        <h3>Workflow Steps</h3>
        <ul>
          {progress.steps.map((step) => (
            <li key={step.key}>
              {step.label} - {formatWorkflowStepState(step.state)}
              {step.note ? ` (${step.note})` : ""}
            </li>
          ))}
        </ul>
      </div>
      {Array.isArray(result?.project?.tasks) && result.project.tasks.length > 0 ? (
        <SectionList
          title="Planned Work Items"
          items={result.project.tasks.map((task) => `${task.phase || "Workflow"}: ${task.title} - ${task.status}`)}
        />
      ) : null}
    </div>
  );
}

function CommandLogPanel({ commandLog = [], result, onOpenProcessUrl, onStopProcess, onRestartProcess, onViewProcessLog }) {
  const logs = commandLog.length > 0 ? commandLog : result?.project?.commandHistory || [];
  const pipelineLogs = Array.isArray(result?.parallel?.logs) ? result.parallel.logs : [];
  return (
    <div className="output-panel tone-red">
      <div className="output-panel-header">
        <span className="output-tab">Logs</span>
        <h2>Pipeline and command history</h2>
      </div>
      {pipelineLogs.length > 0 ? (
        <div className="command-log-list">
          {pipelineLogs.map((entry, index) => (
            <div className="command-log-card" key={`${entry.at || "pipeline"}-${index}`}>
              <strong>{entry.message}</strong>
              <span>{entry.at || "pipeline"}</span>
            </div>
          ))}
        </div>
      ) : null}
      {logs.length > 0 ? (
        <div className="command-log-list">
          {logs.map((entry) => (
            <div className="command-log-card" key={entry.id || `${entry.command}-${entry.startedAt}`}>
              <strong>{entry.command}</strong>
              <span>{entry.status} {Number.isInteger(entry.exitCode) ? `(exit ${entry.exitCode})` : ""}</span>
              {entry.healthUrl || entry.processId ? (
                <div className="command-log-actions">
                  {entry.healthUrl ? (
                    <button className="secondary-button" type="button" onClick={() => onOpenProcessUrl?.(entry.healthUrl)}>
                      <Eye size={15} />
                      Open URL
                    </button>
                  ) : null}
                  {entry.processId && entry.status === "running" ? (
                    <button className="secondary-button danger" type="button" onClick={() => onStopProcess?.(entry.processId)}>
                      <XCircle size={15} />
                      Stop Process
                    </button>
                  ) : null}
                  {entry.processId ? (
                    <>
                      <button className="secondary-button" type="button" onClick={() => onRestartProcess?.(entry.processId)}>
                        <RefreshCw size={15} />
                        Restart
                      </button>
                      <button className="secondary-button" type="button" onClick={() => onViewProcessLog?.(entry.processId)}>
                        <FileCode2 size={15} />
                        View Logs
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
              <pre>{entry.output || "No output captured."}</pre>
            </div>
          ))}
        </div>
      ) : pipelineLogs.length === 0 ? (
        <p>No commands have been run yet.</p>
      ) : null}
    </div>
  );
}

function SectionList({ title, items = [] }) {
  const cleanItems = (items || []).filter(Boolean);
  return (
    <div className="section-list">
      <h3>{title}</h3>
      {cleanItems.length > 0 ? (
        <ul>
          {cleanItems.map((item, index) => (
            <li key={`${title}-${index}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>None yet.</p>
      )}
    </div>
  );
}

function OutputPanel({ title, content, code = false, codeContent = "", tone = "blue" }) {
  return (
    <div className={`output-panel ${code ? "code-panel" : ""} tone-${tone}`}>
      <div className="output-panel-header">
        <span className="output-tab">{title}</span>
        <h2>{title}</h2>
      </div>
      <p>{content || "No content returned."}</p>
      {codeContent ? (
        <pre>
          <code>{codeContent}</code>
        </pre>
      ) : null}
    </div>
  );
}

function ProcessManagerCard({ processes = [], onOpenProcessUrl, onStopProcess, onRestartProcess, onViewProcessLog }) {
  if (!processes.length) {
    return null;
  }

  const activeProcess = processes.find((process) => ["running", "starting"].includes(process.status)) || processes[0];

  return (
    <section className={`process-manager-card ${activeProcess.status || "idle"}`} aria-label="Project process">
      <div className="process-manager-main">
        <span className={`process-status-dot ${activeProcess.status || "idle"}`} />
        <div>
          <span className="process-label">Project Process</span>
          <strong>{activeProcess.command || "Process"}</strong>
          <p>
            {activeProcess.healthUrl
              || (["running", "starting"].includes(activeProcess.status) ? "Process running, waiting for URL..." : "")
              || activeProcess.outputPreview
              || activeProcess.stdoutLog
              || "No app URL detected yet."}
          </p>
        </div>
      </div>
      <div className="process-manager-actions">
        {activeProcess.healthUrl ? (
          <button className="secondary-button" type="button" onClick={() => onOpenProcessUrl?.(activeProcess.healthUrl)}>
            <Eye size={16} />
            Open URL
          </button>
        ) : null}
        <button className="secondary-button" type="button" onClick={() => onViewProcessLog?.(activeProcess.id)}>
          <FileCode2 size={16} />
          Logs
        </button>
        <button className="secondary-button" type="button" onClick={() => onRestartProcess?.(activeProcess.id)}>
          <RefreshCw size={16} />
          Restart
        </button>
        {["running", "starting"].includes(activeProcess.status) ? (
          <button className="secondary-button danger" type="button" onClick={() => onStopProcess?.(activeProcess.id)}>
            <XCircle size={16} />
            Stop
          </button>
        ) : null}
      </div>
    </section>
  );
}

function ProcessLogModal({ processLog, onClose }) {
  const process = processLog?.process || {};
  return (
    <div className="process-log-overlay" role="presentation" onMouseDown={onClose}>
      <section className="process-log-modal" role="dialog" aria-modal="true" aria-label="Process logs" onMouseDown={(event) => event.stopPropagation()}>
        <div className="process-log-header">
          <div>
            <p className="eyebrow">Process Logs</p>
            <h2>{process.command || "Project process"}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close process logs">
            <XCircle size={18} />
          </button>
        </div>
        <div className="process-log-meta">
          <span>{process.status || "unknown"}</span>
          {process.healthUrl ? <span>{process.healthUrl}</span> : null}
          {process.pid ? <span>PID {process.pid}</span> : null}
        </div>
        <pre className="process-log-output">{processLog?.output || "No log output captured yet."}</pre>
      </section>
    </div>
  );
}

function AutonomyStatusCard({
  autonomyRun,
  isRunning,
  workflow,
  result,
  isDecisionBusy,
  onOpenChanges,
  onNeedsPatch,
  onDiscardOutput
}) {
  const status = autonomyRun?.status || "idle";
  const detail = autonomyRun?.message || autonomyRun?.error || autonomyRun?.lastStage || "Backend autonomy runner is idle.";
  const deadline = autonomyRun?.deadlineAt ? `Deadline: ${formatTimestamp(autonomyRun.deadlineAt)}` : "";
  const runtime = autonomyRun?.maxRuntimeMs ? `Limit: ${Math.round(autonomyRun.maxRuntimeMs / 60000)} min` : "";
  const decisionState = String(workflow?.decisionStatus || result?.decision?.decisionStatus || "").toLowerCase();
  const showReviewActions = !isRunning && (status === "blocked" || ["needs_patch", "manual_review_required"].includes(decisionState));
  const canDiscard = canDiscardGeneratedOutput(result?.project, result);

  return (
    <section className={`autonomy-status-card ${isRunning ? "running" : ""}`} aria-label="Autonomy status">
      <div>
        <span className="output-tab">Autonomy</span>
        <strong>{formatAutonomyStatus(status)}</strong>
        <p>{detail}</p>
        {showReviewActions ? (
          <div className="button-row">
            <button className="secondary-button" type="button" onClick={onOpenChanges} disabled={isDecisionBusy}>
              <Eye size={16} />
              Open Changes
            </button>
            <button className="secondary-button" type="button" onClick={onNeedsPatch} disabled={isDecisionBusy}>
              <XCircle size={16} />
              Needs Patch
            </button>
            {canDiscard ? (
              <button className="secondary-button danger" type="button" onClick={onDiscardOutput} disabled={isDecisionBusy}>
                <XCircle size={16} />
                Discard Output
              </button>
            ) : null}
          </div>
        ) : null}
        {deadline || runtime ? <p>{[runtime, deadline].filter(Boolean).join(" · ")}</p> : null}
      </div>
      <div className="autonomy-status-meta">
        {isRunning ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
        <span>{autonomyRun?.lastStage || autonomyRun?.runId}</span>
      </div>
    </section>
  );
}

function GraphStatusCard({ graphStatus, isGraphRunning, onCheckGraphify, onBuildGraphify, onOpenGraphify }) {
  const status = graphStatus?.status || "not_checked";
  const available = Boolean(graphStatus?.toolAvailable);
  const canView = status === "indexed" || Boolean(graphStatus?.htmlPath || graphStatus?.reportPath);
  const label = available
    ? status === "indexed"
      ? "Graph context indexed"
      : `${graphStatus.toolName || "Graphify"} available`
    : status === "tool_missing"
      ? "Graphify missing"
      : "Graph context not checked";

  return (
    <div className={`graph-status-card ${available ? "available" : ""}`}>
      <div>
        <strong>{label}</strong>
        <span>{graphStatus?.message || "Use Graphify to index project structure for smaller agent context."}</span>
      </div>
      <div className="graph-status-actions">
        <button
          className="icon-button graph-view-button"
          type="button"
          onClick={onOpenGraphify}
          disabled={isGraphRunning || !canView}
          title="View Graphify graph"
          aria-label="View Graphify graph"
        >
          <Eye size={15} />
        </button>
        <button className="secondary-button" type="button" onClick={onCheckGraphify} disabled={isGraphRunning}>
          Check
        </button>
        <button className="secondary-button" type="button" onClick={onBuildGraphify} disabled={isGraphRunning}>
          {isGraphRunning ? <Loader2 size={14} className="spin" /> : null}
          Build
        </button>
      </div>
    </div>
  );
}

function FileTree({ nodes, selectedFileSet, onToggleFile }) {
  if (!nodes?.length) {
    return <div className="tree-empty">No supported files found.</div>;
  }

  return nodes.map((node) => (
    <TreeNode key={node.path} node={node} selectedFileSet={selectedFileSet} onToggleFile={onToggleFile} />
  ));
}

function TreeNode({ node, selectedFileSet, onToggleFile }) {
  const [open, setOpen] = useState(true);

  if (node.type === "directory") {
    return (
      <div className="tree-group">
        <button className="tree-directory" type="button" onClick={() => setOpen((value) => !value)}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <span>{node.name}</span>
        </button>
        {open ? (
          <div className="tree-children">
            <FileTree nodes={node.children} selectedFileSet={selectedFileSet} onToggleFile={onToggleFile} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <label className={`tree-file ${node.selectable ? "" : "disabled"}`} title={node.reason || node.path}>
      <input
        type="checkbox"
        checked={selectedFileSet.has(node.path)}
        disabled={!node.selectable}
        onChange={(event) => onToggleFile(node.path, event.target.checked)}
      />
      <FileCode2 size={15} />
      <span>{node.name}</span>
    </label>
  );
}

function ReportsView({ result, project, workflow, autonomyRun, testerResult, onExportReviewData }) {
  const reviewData = result?.reviewData || {};
  const finalReport = String(reviewData?.finalReport || "").trim();
  const runState = reviewData?.runState && typeof reviewData.runState === "object" ? reviewData.runState : null;
  const artifacts = reviewData?.artifacts && typeof reviewData.artifacts === "object" ? reviewData.artifacts : null;
  const runLogExcerpts = Array.isArray(reviewData?.runLogExcerpts) ? reviewData.runLogExcerpts : [];
  const safeWorkflow = workflow || result?.workflow || { currentStage: "idle", loopCount: 0, decisionStatus: "pending" };
  const effectiveProject = project || normalizeGeneratedProject(result, null);
  const reportStatus = finalReport
    ? "Final report available"
    : "No final report is available for this run yet.";
  return (
    <section className="simple-view">
      <p className="eyebrow">Reports</p>
      <h1>Run report</h1>
      {testerResult ? (
        <div className="output-panel tone-blue">
          <div className="output-panel-header">
            <span className="output-tab">Tester</span>
            <h2>{formatAgentName(testerResult.agentId)} {testerResult.scenario}</h2>
          </div>
          <pre>{testerResult.output}</pre>
        </div>
      ) : null}
      <div className="output-panel tone-blue">
        <div className="output-panel-header">
          <span className="output-tab">Status</span>
          <h2>{reportStatus}</h2>
        </div>
        <div className="decision-columns">
          <div>
            <h3>Project</h3>
            <ul className="decision-list">
              <li>{effectiveProject?.projectName || effectiveProject?.name || result?.project?.projectName || "Unknown project"}</li>
              <li>{effectiveProject?.rootPath || reviewData?.projectRoot || "Project path unavailable"}</li>
            </ul>
          </div>
          <div>
            <h3>Run state</h3>
            <ul className="decision-list">
              <li>Status: {runState?.status || autonomyRun?.status || "unknown"}</li>
              <li>Stage: {runState?.stage || runState?.currentStage || safeWorkflow.currentStage || "unknown"}</li>
              <li>Decision: {safeWorkflow.decisionStatus || result?.decision?.decisionStatus || "pending"}</li>
            </ul>
          </div>
        </div>
        <div className="decision-actions">
          <button className="secondary-button" type="button" onClick={onExportReviewData}>
            <FilePlus2 size={16} />
            Download All Review Data
          </button>
        </div>
      </div>
      <ReviewPaneErrorBoundary
        resetKey={`${effectiveProject?.rootPath || "none"}:${runState?.runId || autonomyRun?.runId || "idle"}:${Boolean(finalReport)}`}
        title="Report data could not be rendered."
        message="Report data could not be rendered. Export raw review data instead."
      >
        <div className="output-panel tone-green">
          <div className="output-panel-header">
            <span className="output-tab">Final Report</span>
            <h2>Review summary</h2>
          </div>
          {finalReport ? (
            <pre className="report-output">{finalReport}</pre>
          ) : (
            <p>No final report is available for this run yet.</p>
          )}
        </div>
      </ReviewPaneErrorBoundary>
      <div className="output-panel tone-blue">
        <div className="output-panel-header">
          <span className="output-tab">Artifacts</span>
          <h2>Captured review data</h2>
        </div>
        <div className="decision-columns">
          <div>
            <h3>Artifacts</h3>
            <p>{artifacts ? `${Array.isArray(artifacts?.records) ? artifacts.records.length : 0} record(s) tracked.` : "No artifacts ledger was found for this run."}</p>
          </div>
          <div>
            <h3>Run logs</h3>
            <p>{runLogExcerpts.length > 0 ? `${runLogExcerpts.length} review log entr${runLogExcerpts.length === 1 ? "y" : "ies"} available.` : "No run logs were found for this run."}</p>
          </div>
        </div>
        {!finalReport && !artifacts && !runState ? (
          <p>Report data could not be rendered. Export raw review data instead.</p>
        ) : null}
      </div>
    </section>
  );
}

function LandingView({
  entries,
  draftProjectName,
  onDraftProjectName,
  onCreateNewProject,
  onOpenProject,
  onContinue,
  onOpenFolder,
  onRefresh,
  onRename,
  onDelete
}) {
  const [searchValue, setSearchValue] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState("updated-desc");
  const [openMenuId, setOpenMenuId] = useState("");
  const statusOptions = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "waiting", label: "Waiting" },
    { key: "not-started", label: "Not started" },
    { key: "completed", label: "Completed" }
  ];

  const statusCounts = useMemo(() => {
    const counts = {
      all: (entries || []).length,
      active: 0,
      waiting: 0,
      "not-started": 0,
      completed: 0
    };

    for (const entry of entries || []) {
      const key = toLandingStatusKey(entry?.status, entry?.decisionStatus);
      if (counts[key] !== undefined) {
        counts[key] += 1;
      }
    }

    return counts;
  }, [entries]);

  const recentEntries = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    const filtered = [...(entries || [])].filter((entry) => {
      const key = toLandingStatusKey(entry?.status, entry?.decisionStatus);
      const searchable = [entry?.name, entry?.path, entry?.projectSlug, entry?.status].join(" ").toLowerCase();
      const matchesSearch = !query || searchable.includes(query);
      const matchesFilter = statusFilter === "all" || statusFilter === key;
      return matchesSearch && matchesFilter;
    });

    filtered.sort((left, right) => {
      if (sortMode === "name") {
        return String(left?.name || "").localeCompare(String(right?.name || ""));
      }

      const leftTime = new Date(left?.lastUpdated || 0).getTime();
      const rightTime = new Date(right?.lastUpdated || 0).getTime();
      return sortMode === "updated-asc" ? leftTime - rightTime : rightTime - leftTime;
    });

    return filtered.slice(0, 8);
  }, [entries, searchValue, sortMode, statusFilter]);

  return (
    <section className="landing-view">
      <div className="landing-toolbar">
        <div className="landing-branding">
          <div className="landing-brand-mark">
            <Box size={28} />
          </div>
          <div className="landing-brand-copy">
            <h1>TriFix AI</h1>
            <p>Tiny Office Mode</p>
          </div>
        </div>

        <div className="landing-toolbar-row">
          <label className="landing-search">
            <Search size={18} />
            <input
              type="text"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search sandboxes..."
            />
            <span className="landing-shortcut">Ctrl + K</span>
          </label>

          <div className="landing-toolbar-actions">
            <label className="landing-select">
              <SlidersHorizontal size={16} />
              <span>Filter</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                {statusOptions.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
              <ChevronDown size={16} />
            </label>

            <label className="landing-select wide">
              <ArrowUpDown size={16} />
              <span>Sort</span>
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value)}>
                <option value="updated-desc">Updated (Newest)</option>
                <option value="updated-asc">Updated (Oldest)</option>
                <option value="name">Name</option>
              </select>
              <ChevronDown size={16} />
            </label>

            <button className="icon-button landing-refresh" type="button" onClick={onRefresh} aria-label="Refresh sandboxes">
              <RefreshCw size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="landing-grid">
        <aside className="landing-rail">
          <div className="landing-panel landing-panel-intro">
            <div className="landing-panel-icon">
              <Box size={32} />
            </div>
            <div className="landing-panel-copy">
              <p className="eyebrow">New Sandbox</p>
              <h2>Create a new sandbox project to experiment, build, and iterate safely.</h2>
            </div>
          </div>

          <label className="landing-field">
            <span>Sandbox Name</span>
            <input
              type="text"
              value={draftProjectName}
              onChange={(event) => onDraftProjectName(event.target.value)}
              placeholder="SimpleDash"
            />
          </label>

          <div className="landing-rail-actions">
            <button className="primary-button landing-primary-button" type="button" onClick={onCreateNewProject}>
              <Plus size={16} />
              Create New Project
            </button>
            <button className="secondary-button landing-open-folder-button" type="button" onClick={onOpenProject}>
              <FolderOpen size={16} />
              Open Folder
            </button>
          </div>

          <div className="landing-note-card">
            <div className="landing-note-icon">
              <CheckCircle2 size={18} />
            </div>
            <div>
              <h3>Isolated &amp; Safe</h3>
              <p>All sandboxes run in isolated environments so your workspace stays clean and secure.</p>
            </div>
          </div>
        </aside>

        <div className="landing-panel landing-panel-recents">
          <div className="landing-panel-header">
            <div>
              <h2>Recent Sandboxes</h2>
              <p>Manage and resume your sandbox projects.</p>
            </div>
            <span className="landing-project-count">{statusCounts.all} Projects</span>
          </div>

          <div className="landing-status-row">
            {statusOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`landing-filter-pill ${statusFilter === option.key ? "active" : ""}`}
                onClick={() => setStatusFilter(option.key)}
              >
                {option.key === "all" ? null : <span className={`status-dot ${option.key}`} />}
                <span>{option.label}</span>
              </button>
            ))}
          </div>

          {recentEntries.length === 0 ? (
            <div className="landing-empty">No matching sandboxes found.</div>
          ) : (
            <div className="landing-recents">
              {recentEntries.map((entry) => {
                const statusKey = toLandingStatusKey(entry?.status, entry?.decisionStatus);
                const autonomyState = entry?.autonomyState;
                return (
                  <article key={entry.id} className="landing-recent-card">
                    <div className="landing-recent-main">
                      <div className={`landing-folder-icon ${statusKey}`}>
                        <FolderClosed size={22} />
                      </div>
                      <div className="landing-recent-copy">
                        <h3>{entry.name}</h3>
                        <div className="project-path" title={entry.path}>{entry.path}</div>
                        <div className="landing-recent-meta">
                          <span className="landing-meta-item">
                            <Clock3 size={14} />
                            Updated: {formatTimestamp(entry.lastUpdated)}
                          </span>
                          {autonomyState?.status ? (
                            <span className="landing-meta-item autonomy-meta">
                              <Sparkles size={14} />
                              Auto: {formatAutonomyStatus(autonomyState.status)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="landing-recent-actions">
                      <span className={`landing-status-chip ${statusKey}`}>{toLandingStatusLabel(entry?.status, entry?.decisionStatus)}</span>
                      <button className="primary-button landing-continue-button" type="button" onClick={() => onContinue(entry)}>
                        <Play size={15} />
                        Continue
                      </button>
                      <button className="secondary-button landing-open-button" type="button" onClick={() => onOpenFolder(entry.path)}>
                        <FolderOpen size={15} />
                        Open Folder
                      </button>
                      <div className="landing-more-wrap">
                        <button
                          className="icon-button landing-more-button"
                          type="button"
                          aria-label={`More actions for ${entry.name}`}
                          aria-expanded={openMenuId === entry.id}
                          onClick={() => setOpenMenuId((current) => current === entry.id ? "" : entry.id)}
                        >
                          <MoreHorizontal size={18} />
                        </button>
                        {openMenuId === entry.id ? (
                          <div className="landing-more-menu">
                            <button
                              type="button"
                              className="landing-menu-item"
                              onClick={() => {
                                setOpenMenuId("");
                                void onRename(entry);
                              }}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              className="landing-menu-item danger"
                              onClick={() => {
                                setOpenMenuId("");
                                void onDelete(entry);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ProjectsView({ entries, agentNameMap, onContinue, onOpenFolder, onRemove }) {
  const recentProjects = entries.filter((entry) => entry.type === "project");
  const sandboxTasks = entries.filter((entry) => entry.type === "sandbox-task");

  return (
    <section className="simple-view">
      <p className="eyebrow">Projects</p>
      <h1>Recent workspaces</h1>
      <ProjectListSection
        title="Recent Projects"
        entries={recentProjects}
        agentNameMap={agentNameMap}
        onContinue={onContinue}
        onOpenFolder={onOpenFolder}
        onRemove={onRemove}
      />
      <ProjectListSection
        title="Sandbox Tasks"
        entries={sandboxTasks}
        agentNameMap={agentNameMap}
        onContinue={onContinue}
        onOpenFolder={onOpenFolder}
        onRemove={onRemove}
      />
    </section>
  );
}

function ProjectListSection({ title, entries, agentNameMap, onContinue, onOpenFolder, onRemove }) {
  return (
    <div className="project-list-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{title}</p>
          <h2>{entries.length} tracked</h2>
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="empty-output">Nothing tracked yet.</div>
      ) : (
        <div className="project-list">
          {entries.map((entry) => (
            <article key={entry.id} className="project-card">
              <div className="project-card-top">
                <div>
                  <h2>{entry.name}</h2>
                  <div className="project-path" title={entry.path}>
                    {entry.path}
                  </div>
                </div>
                <span className={`status-badge ${toStatusBadgeClass(entry.status)}`}>{entry.status}</span>
              </div>
              <div className="project-stats">
                {entry.projectSlug ? <span>Slug: {entry.projectSlug}</span> : null}
                {typeof entry.filesCreated !== "undefined" ? <span>Created: {entry.filesCreated || 0}</span> : null}
                {typeof entry.filesModified !== "undefined" ? <span>Modified: {entry.filesModified || 0}</span> : null}
                {entry.failedOperations?.length ? <span>Failed: {entry.failedOperations.length}</span> : null}
                <span>Loop: {entry.loopCount || 0}</span>
                <span>Agent: {formatAgentName(entry.lastAgent || "team", agentNameMap)}</span>
                <span>Decision: {entry.decisionStatus || "pending"}</span>
                <span>PRD: {entry.prd ? "ready" : "none"}</span>
                <span>Tasks: {(entry.tasks || []).length}</span>
                <span>Commands: {(entry.commandHistory || []).length}</span>
                <span>Updated: {formatTimestamp(entry.lastUpdated)}</span>
              </div>
              <div className="project-files">
                {(entry.affectedFiles || []).slice(0, 4).map((file) => (
                  <span key={file}>{file}</span>
                ))}
              </div>
              <div className="decision-actions">
                <button className="primary-button" type="button" onClick={() => onContinue(entry)}>
                  Continue
                </button>
                <button className="secondary-button" type="button" onClick={() => onOpenFolder(entry.path)}>
                  Open Folder
                </button>
                <button className="secondary-button danger" type="button" onClick={() => onRemove(entry.id)}>
                  Remove from List
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function SceneOverlay({ scene }) {
  return (
    <div className={`scene-overlay ${scene.type}`}>
      <div className={`scene-panel ${scene.type}`}>
        <Sparkles size={18} />
        <strong>{scene.message}</strong>
      </div>
      {scene.type === "success" ? <div className="scene-confetti" aria-hidden="true" /> : null}
    </div>
  );
}

function createDefaultGuiQaSettings() {
  return {
    enabled: false,
    mode: "headless",
    browser: "chromium",
    slowMoMs: 0,
    autoRunAfterBuild: false,
    stopDevServerAfterQa: true,
    maxAttempts: 1
  };
}

function normalizeGuiQaDraft(value) {
  const next = { ...createDefaultGuiQaSettings(), ...(value || {}) };
  next.mode = next.mode === "live" ? "live" : "headless";
  next.browser = "chromium";
  next.slowMoMs = Math.max(0, Number(next.slowMoMs) || 0);
  next.maxAttempts = Math.max(1, Number(next.maxAttempts) || 1);
  next.enabled = Boolean(next.enabled);
  next.autoRunAfterBuild = Boolean(next.autoRunAfterBuild);
  next.stopDevServerAfterQa = next.stopDevServerAfterQa !== false;
  return next;
}

function formatPlaywrightCapabilityStatus(capability) {
  const status = String(capability?.status || "not_checked").trim().toLowerCase();
  if (status === "available") return "available";
  if (status === "package_missing") return "package missing";
  if (status === "browsers_missing") return "browsers missing";
  return "not checked";
}

function SettingsView({ settings, project, testerResult, isTesterRunning, agentNames, onRunTester, onSettingsChange, onAgentNamesChange }) {
  const [dialogueDraft, setDialogueDraft] = useState(() => buildDialogueDraft(settings?.agents));
  const [guiQaDraft, setGuiQaDraft] = useState(() => normalizeGuiQaDraft(settings?.guiQa));
  const [nameDraft, setNameDraft] = useState(() => ({
    juniorName: agentNames.junior || "",
    supervisorName: agentNames.supervisor || "",
    architectName: agentNames.architect || ""
  }));
  const [playwrightCapability, setPlaywrightCapability] = useState(() => ({
    status: "not_checked",
    packageStatus: "not_checked",
    browsersStatus: "not_checked",
    details: "Capability not checked yet."
  }));
  const [saveState, setSaveState] = useState("idle");
  const [saveError, setSaveError] = useState("");
  const [guiQaSaveState, setGuiQaSaveState] = useState("idle");
  const [guiQaError, setGuiQaError] = useState("");
  const [isCapabilityChecking, setIsCapabilityChecking] = useState(false);

  useEffect(() => {
    setDialogueDraft(buildDialogueDraft(settings?.agents));
    setGuiQaDraft(normalizeGuiQaDraft(settings?.guiQa));
  }, [settings]);

  useEffect(() => {
    setNameDraft({
      juniorName: agentNames.junior || "",
      supervisorName: agentNames.supervisor || "",
      architectName: agentNames.architect || ""
    });
  }, [agentNames]);

  async function saveDialogue() {
    setSaveState("saving");
    setSaveError("");

    try {
      const nextSettings = await window.trifix.saveDialogue(dialogueDraft);
      onSettingsChange(nextSettings);
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setSaveError(error?.message || "Failed to save dialogue.");
    }
  }

  function saveNames() {
    onAgentNamesChange({
      junior: nameDraft.juniorName.trim(),
      supervisor: nameDraft.supervisorName.trim(),
      architect: nameDraft.architectName.trim()
    });
    setSaveState("saved");
  }

  async function saveGuiQaSettings() {
    setGuiQaSaveState("saving");
    setGuiQaError("");
    try {
      const nextSettings = await window.trifix.saveGuiQaSettings(normalizeGuiQaDraft(guiQaDraft));
      onSettingsChange(nextSettings);
      setGuiQaSaveState("saved");
    } catch (error) {
      setGuiQaSaveState("error");
      setGuiQaError(error?.message || "Failed to save GUI QA settings.");
    }
  }

  async function checkPlaywrightCapability() {
    setIsCapabilityChecking(true);
    setGuiQaError("");
    try {
      const capability = await window.trifix.checkPlaywrightCapability({
        projectRoot: project?.rootPath || ""
      });
      setPlaywrightCapability(capability || {
        status: "not_checked",
        packageStatus: "not_checked",
        browsersStatus: "not_checked",
        details: "Capability not checked yet."
      });
    } catch (error) {
      setGuiQaError(error?.message || "Could not check Playwright capability.");
      setPlaywrightCapability({
        status: "not_checked",
        packageStatus: "not_checked",
        browsersStatus: "not_checked",
        details: "Capability check failed."
      });
    } finally {
      setIsCapabilityChecking(false);
    }
  }

  return (
    <section className="simple-view">
      <p className="eyebrow">Settings</p>
      <h1>Runtime configuration</h1>
      <div className="settings-grid">
        <div className="settings-row">
          <span>Senior Dev endpoint</span>
          <code>{settings?.endpoints?.qa || settings?.endpoint || "Loading..."}</code>
        </div>
        <div className="settings-row">
          <span>Junior Dev endpoint</span>
          <code>{settings?.endpoints?.dev || "Loading..."}</code>
        </div>
        <div className="settings-row">
          <span>Supervisor endpoint</span>
          <code>{settings?.endpoints?.pm || "Loading..."}</code>
        </div>
        <div className="settings-row">
          <span>Project</span>
          <code>{project?.rootPath || "No folder open"}</code>
        </div>
        {settings?.agents
          ? Object.values(settings.agents).map((agent) => (
            <div className="settings-row" key={agent.id}>
              <span>{formatAgentName(agent.id, {
                junior: agentNames.junior || "Junior Dev",
                supervisor: agentNames.supervisor || "Senior Dev / QA",
                architect: agentNames.architect || "Supervisor / PM"
              })}</span>
              <code>{`${agent.model} | ${agent.endpoint} | ${agent.summary}${agent.speech?.prefix ? ` | says "${agent.speech.prefix}"` : ""}`}</code>
            </div>
          ))
          : null}
      </div>
      <div className="dialogue-editor">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Model Test</p>
            <h2>Check agent responses</h2>
          </div>
          <button className="secondary-button" type="button" onClick={onRunTester} disabled={isTesterRunning}>
            {isTesterRunning ? <Loader2 size={18} className="spin" /> : <FlaskConical size={18} />}
            Test Models
          </button>
        </div>
        {testerResult ? <pre className="tester-output">{testerResult.output}</pre> : <p className="muted">Run a quick capability test from here.</p>}
      </div>
      <div className="dialogue-editor">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">GUI QA</p>
            <h2>Playwright foundation</h2>
          </div>
          <button className="primary-button" type="button" onClick={saveGuiQaSettings} disabled={guiQaSaveState === "saving"}>
            {guiQaSaveState === "saving" ? <Loader2 size={18} className="spin" /> : null}
            Save GUI QA Settings
          </button>
        </div>
        <div className="settings-grid">
          <label className="settings-row checkbox-row">
            <span>Enable GUI QA</span>
            <input
              type="checkbox"
              checked={guiQaDraft.enabled}
              onChange={(event) => setGuiQaDraft((current) => ({ ...current, enabled: event.target.checked }))}
            />
          </label>
          <label className="settings-row">
            <span>Mode</span>
            <select
              value={guiQaDraft.mode}
              onChange={(event) => setGuiQaDraft((current) => ({ ...current, mode: event.target.value }))}
            >
              <option value="headless">Headless</option>
              <option value="live">Live</option>
            </select>
          </label>
          <label className="settings-row">
            <span>Browser</span>
            <select value="chromium" disabled>
              <option value="chromium">Chromium</option>
            </select>
          </label>
          <label className="settings-row">
            <span>Slow motion / demo delay (ms)</span>
            <input
              type="number"
              min="0"
              step="50"
              value={guiQaDraft.slowMoMs}
              onChange={(event) => setGuiQaDraft((current) => ({ ...current, slowMoMs: Math.max(0, Number(event.target.value) || 0) }))}
            />
          </label>
          <label className="settings-row checkbox-row">
            <span>Auto-run GUI QA after build</span>
            <input
              type="checkbox"
              checked={guiQaDraft.autoRunAfterBuild}
              onChange={(event) => setGuiQaDraft((current) => ({ ...current, autoRunAfterBuild: event.target.checked }))}
            />
          </label>
          <label className="settings-row checkbox-row">
            <span>Stop dev server after GUI QA</span>
            <input
              type="checkbox"
              checked={guiQaDraft.stopDevServerAfterQa}
              onChange={(event) => setGuiQaDraft((current) => ({ ...current, stopDevServerAfterQa: event.target.checked }))}
            />
          </label>
          <label className="settings-row">
            <span>Max GUI QA attempts</span>
            <input
              type="number"
              min="1"
              step="1"
              value={guiQaDraft.maxAttempts}
              onChange={(event) => setGuiQaDraft((current) => ({ ...current, maxAttempts: Math.max(1, Number(event.target.value) || 1) }))}
            />
          </label>
        </div>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Capability</p>
            <h2>Playwright availability</h2>
          </div>
          <button className="secondary-button" type="button" onClick={checkPlaywrightCapability} disabled={isCapabilityChecking}>
            {isCapabilityChecking ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
            Check Playwright
          </button>
        </div>
        <div className="settings-grid">
          <div className="settings-row">
            <span>Status</span>
            <code>{formatPlaywrightCapabilityStatus(playwrightCapability)}</code>
          </div>
          <div className="settings-row">
            <span>Package</span>
            <code>{String(playwrightCapability?.packageStatus || "not_checked").replace(/_/g, " ")}</code>
          </div>
          <div className="settings-row">
            <span>Browsers</span>
            <code>{String(playwrightCapability?.browsersStatus || "not_checked").replace(/_/g, " ")}</code>
          </div>
          <div className="settings-row">
            <span>Target root</span>
            <code>{playwrightCapability?.targetRoot || project?.rootPath || "Not checked"}</code>
          </div>
        </div>
        <p className="muted">{playwrightCapability?.details || "Capability not checked yet."}</p>
        {guiQaSaveState === "saved" ? <div className="save-note">GUI QA settings saved.</div> : null}
        {guiQaError ? (
          <div className="error-banner" role="alert">
            <TriangleAlert size={18} />
            <span>{guiQaError}</span>
          </div>
        ) : null}
      </div>
      <div className="dialogue-editor">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Display Names</p>
            <h2>Rename the agents locally</h2>
          </div>
          <button className="primary-button" type="button" onClick={saveNames}>
            Save Names
          </button>
        </div>
        {[
          ["juniorName", "Junior Dev"],
          ["supervisorName", "Senior Dev / QA"],
          ["architectName", "Supervisor / PM"]
        ].map(([key, label]) => (
          <label className="dialogue-field" key={key}>
            <span>{label}</span>
            <input
              type="text"
              value={nameDraft[key]}
              onChange={(event) => setNameDraft((current) => ({ ...current, [key]: event.target.value }))}
            />
          </label>
        ))}
      </div>
      <div className="dialogue-editor">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Dialogue</p>
            <h2>Editable agent lines</h2>
          </div>
          <button className="primary-button" type="button" onClick={saveDialogue} disabled={saveState === "saving"}>
            {saveState === "saving" ? <Loader2 size={18} className="spin" /> : null}
            Save Dialogue
          </button>
        </div>
        {Object.values(settings?.agents || {}).map((agent) => (
          <div className="dialogue-block" key={agent.id}>
            <h2>{formatAgentName(agent.id, {
              junior: agentNames.junior || "Junior Dev",
              supervisor: agentNames.supervisor || "Senior Dev / QA",
              architect: agentNames.architect || "Supervisor / PM"
            })}</h2>
            {AGENT_STATUS_KEYS.map((status) => (
              <label className="dialogue-field" key={`${agent.id}-${status}`}>
                <span>{status}</span>
                <input
                  type="text"
                  value={dialogueDraft?.[agent.id]?.[status] || ""}
                  onChange={(event) =>
                    setDialogueDraft((current) => ({
                      ...current,
                      [agent.id]: {
                        ...(current[agent.id] || {}),
                        [status]: event.target.value
                      }
                    }))
                  }
                />
              </label>
            ))}
          </div>
        ))}
        {saveState === "saved" ? <div className="save-note">Dialogue saved.</div> : null}
        {saveError ? (
          <div className="error-banner" role="alert">
            <TriangleAlert size={18} />
            <span>{saveError}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SidebarButton({ active, icon, label, onClick }) {
  return (
    <button className={`sidebar-button ${active ? "active" : ""}`} type="button" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function getStatusIcon(status) {
  if (["thinking", "coding", "installing", "unpacking", "testing", "waiting"].includes(status)) {
    return Loader2;
  }

  if (status === "received") {
    return RefreshCw;
  }

  if (status === "done") {
    return CheckCircle2;
  }

  if (status === "error") {
    return TriangleAlert;
  }

  return Bot;
}

function hasPath(nodes, value) {
  for (const node of nodes || []) {
    if (node.path === value) {
      return true;
    }

    if (node.children && hasPath(node.children, value)) {
      return true;
    }
  }

  return false;
}

function toAgentList(agentsMap, nameOverrides = {}) {
  if (!agentsMap) {
    return applyAgentNames(INITIAL_AGENTS, nameOverrides);
  }

  return applyAgentNames(
    Object.values(agentsMap).map((agent) => ({
      ...agent,
      status: "idle"
    })),
    nameOverrides
  );
}

function buildStageMessages(progress, reactionIndex) {
  const { runId, agent, partialResult } = progress;
  const timestamp = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  if (agent === "junior") {
    const juniorMessage = buildJuniorChatMessage(partialResult);
    return [
      {
        id: `${runId}:${progress.stage || "junior-initial"}:junior:message`,
        from: "junior",
        to: "supervisor",
        role: "implementation",
        stage: progress.stage || "junior-initial",
        timestamp,
        message: juniorMessage.detailsText,
        bubbleText: juniorMessage.bubbleText,
        detailsText: juniorMessage.detailsText,
        detailLabel: "Show Junior Dev notes",
        status: "queued",
        renderedText: ""
      }
    ];
  }

  if (agent === "supervisor") {
    const supervisorMessage = buildSupervisorChatMessage(partialResult);
    return [
      {
        id: `${runId}:${progress.stage || "senior-final-review"}:supervisor:message`,
        from: "supervisor",
        to: progress.stage === "senior-parallel-review" ? "junior" : "architect",
        role: progress.stage === "senior-parallel-review" ? "parallel review" : "final review",
        stage: progress.stage || "senior-final-review",
        timestamp,
        message: supervisorMessage.detailsText,
        bubbleText: supervisorMessage.bubbleText,
        detailsText: supervisorMessage.detailsText,
        detailLabel: "Show Senior Dev notes",
        startDelayMs: STAGE_DELAY,
        status: "queued",
        renderedText: ""
      },
      {
        id: `${runId}:${progress.stage || "senior-final-review"}:junior:reaction`,
        from: "junior",
        to: "supervisor",
        role: "reaction",
        stage: "reaction",
        timestamp,
        message: JUNIOR_REACTION_MESSAGES[reactionIndex % JUNIOR_REACTION_MESSAGES.length],
        bubbleText: JUNIOR_REACTION_MESSAGES[reactionIndex % JUNIOR_REACTION_MESSAGES.length],
        status: "queued",
        renderedText: "",
        introState: "received",
        introDelayMs: STAGE_DELAY
      }
    ];
  }

  if (agent === "architect") {
    const architectMessage = buildArchitectChatMessage(partialResult);
    return [
      {
        id: `${runId}:${progress.stage || "supervisor-final"}:architect:message`,
        from: "architect",
        to: "team",
        role: progress.stage === "supervisor-spec" ? "planning" : "decision",
        stage: progress.stage || "supervisor-final",
        timestamp,
        message: architectMessage.detailsText,
        bubbleText: architectMessage.bubbleText,
        detailsText: architectMessage.detailsText,
        detailLabel: "Show Supervisor notes",
        startDelayMs: STAGE_DELAY,
        status: "queued",
        renderedText: ""
      }
    ];
  }

  return [];
}

function buildJuniorChatMessage(partialResult) {
  const detailsText = firstNonEmpty([
    formatExecutorSummary(partialResult?.executor),
    partialResult?.junior?.recommendation,
    partialResult?.junior?.rationale,
    partialResult?.explanation
  ]);
  return {
    bubbleText: summarizeBubbleText(detailsText || "I'm implementing the current task.", { maxSentences: 2, maxWords: 22 }),
    detailsText
  };
}

function buildSupervisorChatMessage(partialResult) {
  const detailsText = firstNonEmpty([
    partialResult?.supervisor?.suggestedChanges,
    partialResult?.supervisor?.critique,
    partialResult?.critique
  ]);
  return {
    bubbleText: toBulletSummary(detailsText || "Senior Dev is checking this against the PRD.", 4),
    detailsText
  };
}

function buildArchitectChatMessage(partialResult) {
  const detailsText = firstNonEmpty([
    joinSections([
      ["Summary", partialResult?.architect?.summary],
      ["PM Plan", partialResult?.pm?.plan],
      ["Decision", partialResult?.architect?.recommendation]
    ]),
    partialResult?.architect?.recommendation,
    partialResult?.recommendation
  ]);
  return {
    bubbleText: toBulletSummary(detailsText || "PM is aligning scope and next steps.", 4),
    detailsText
  };
}

function firstNonEmpty(values) {
  return values.find((value) => String(value || "").trim()) || "";
}

function summarizeBubbleText(text, { maxSentences = 2, maxWords = 24 } = {}) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return "";
  }

  const sentences = normalized.match(/[^.!?]+[.!?]?/g)?.map((item) => item.trim()).filter(Boolean) || [];
  const picked = sentences.slice(0, maxSentences).join(" ");
  return clampWords(picked || normalized, maxWords);
}

function toBulletSummary(text, limit = 4) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return "";
  }

  const bullets = extractBullets(normalized).slice(0, limit);
  if (bullets.length > 0) {
    return bullets.map((item) => `- ${clampWords(item, 14)}`).join("\n");
  }

  const sentences = normalized.match(/[^.!?]+[.!?]?/g)?.map((item) => item.trim()).filter(Boolean) || [];
  return sentences
    .slice(0, limit)
    .map((item) => `- ${clampWords(item, 14)}`)
    .join("\n");
}

function extractBullets(text) {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[\s*-]+/, "").trim())
    .filter(Boolean);
}

function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function clampWords(text, maxWords) {
  const words = splitIntoWords(text);
  if (words.length <= maxWords) {
    return text.trim();
  }

  return `${joinVisibleWords(words, maxWords).trim()}...`;
}

function getVisibleActiveAgentId(agents, activeMessage, isRunning) {
  if (activeMessage?.from) {
    return activeMessage.from;
  }

  if (!isRunning) {
    return "";
  }

  const activeAgent = agents.find((agent) => agent.status === "thinking" || agent.status === "speaking");
  return activeAgent?.id || "";
}

function getDisplayAgentStatus(agent, activeMessage) {
  if (activeMessage?.from === agent.id) {
    return "speaking";
  }

  return agent.status;
}

function getAgentMessageMap(activeMessage, visibleBubble) {
  if (!activeMessage || !visibleBubble) {
    return {};
  }

  return {
    [visibleBubble.agent]: {
      agent: visibleBubble.agent,
      text: visibleBubble.text,
      type: visibleBubble.type,
      visible: visibleBubble.visible !== false,
      isTyping: Boolean(activeMessage),
      importantVisual: isImportantVisualMessage(activeMessage)
    }
  };
}

function mergePipelineResult(current, partial) {
  if (!partial) {
    return current;
  }

  const next = {
    ...(current || {}),
    ...partial
  };

  for (const key of ["junior", "supervisor", "architect", "decision", "workflow", "project", "pm", "qa", "dev"]) {
    if (partial[key]) {
      next[key] = {
        ...(current?.[key] || {}),
        ...partial[key]
      };
    }
  }

  return next;
}

function buildTrackedProjectResult({ project, entry, autonomyState, reviewData }) {
  const safeProject = project || {};
  const safeEntry = entry || {};
  const safeAutonomyState = autonomyState || {};
  const safeReviewData = reviewData && typeof reviewData === "object" ? reviewData : {};
  const runState = safeReviewData.runState && typeof safeReviewData.runState === "object" ? safeReviewData.runState : {};
  const finalReport = String(safeReviewData.finalReport || "").trim();
  const validationStatus = normalizeTrackedValidationStatus(runState.lastValidationStatus);
  const projectStatus = String(
    safeEntry.status
    || runState.status
    || (finalReport ? "Review available" : "Project loaded")
  ).trim();
  const decisionStatus = String(safeEntry.decisionStatus || "").trim().toLowerCase() || "pending";

  return {
    project: {
      ...safeProject,
      rootPath: safeProject.rootPath || safeEntry.path || safeReviewData.projectRoot || "",
      projectId: safeProject.projectId || safeEntry.id || "",
      projectName: safeProject.projectName || safeProject.name || safeEntry.name || "",
      commandHistory: safeProject.commandHistory || [],
      processes: safeProject.processes || []
    },
    workflow: {
      currentStage: mapTrackedStatusToStage(projectStatus, decisionStatus),
      loopCount: Number(safeEntry.loopCount || 0),
      decisionStatus,
      currentTask: String(runState.currentTask || safeAutonomyState.currentTask || "").trim(),
      projectStatus,
      commandStatus: validationStatus || "idle"
    },
    decision: {
      decisionStatus,
      summary: finalReport ? extractTrackedReportSummary(finalReport) : "",
      verdict: ""
    },
    validation: validationStatus ? { status: validationStatus } : null,
    finalization: {},
    reviewData: {
      projectRoot: safeReviewData.projectRoot || safeProject.rootPath || safeEntry.path || "",
      finalReport,
      artifacts: safeReviewData.artifacts || null,
      runState: Object.keys(runState).length > 0 ? runState : null,
      runLogExcerpts: Array.isArray(safeReviewData.runLogExcerpts) ? safeReviewData.runLogExcerpts : []
    }
  };
}

function normalizeGeneratedProject(result, fallbackProject) {
  const resultProject = result?.project || {};
  if (!resultProject.rootPath) {
    return fallbackProject?.rootPath ? fallbackProject : null;
  }

  return {
    ...(fallbackProject || {}),
    ...resultProject,
    rootPath: resultProject.rootPath,
    projectId: resultProject.projectId || resultProject.id || fallbackProject?.projectId || "",
    projectType: resultProject.projectType || "sandbox-task",
    name: resultProject.projectName || resultProject.name || resultProject.projectSlug || "Task",
    projectSlug: resultProject.projectSlug || "",
    projectStatus: resultProject.status || result?.workflow?.projectStatus || "Files written",
    defaultSelectedFiles: resultProject.defaultSelectedFiles || [],
    commandHistory: resultProject.commandHistory || fallbackProject?.commandHistory || [],
    processes: resultProject.processes || fallbackProject?.processes || [],
    fsd: resultProject.fsd || fallbackProject?.fsd || null
  };
}

function getResultOutputFiles(result) {
  return uniqueStrings([
    ...(result?.executor?.applied || []).map((operation) => operation?.path),
    ...(result?.dev?.fileOperations || []).map((operation) => operation?.path),
    ...(result?.decision?.affectedFiles || [])
  ]).filter(Boolean);
}

function hasUsefulOutput(result) {
  return getResultOutputFiles(result).length > 0;
}

function normalizeTrackedValidationStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["passed", "failed", "needs_review"].includes(normalized)) {
    return normalized;
  }
  if (normalized === "build_unverified") {
    return "needs_review";
  }
  if (normalized === "validation_failed" || normalized === "needs_patch") {
    return "failed";
  }
  return "";
}

function extractTrackedReportSummary(finalReport) {
  const lines = String(finalReport || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^#/.test(line));
  return lines[0] || "Tracked review data loaded.";
}

const WORKFLOW_STEP_LABELS = {
  planning: "Planning",
  qa: "QA Check",
  development: "Development",
  verification: "Verification",
  finalReview: "Final Review",
  decision: "Decision"
};

function buildWorkflowProgress({ workflow, result, preflight = null, autonomyRun = null }) {
  const currentStage = String(workflow?.currentStage || "").trim().toLowerCase();
  const decisionStatus = String(workflow?.decisionStatus || result?.decision?.decisionStatus || "").trim().toLowerCase();
  const validationStatus = getResultValidationStatus(result);
  const qaStatus = getResultQaStatus(result);
  const finalPmStatus = String(result?.finalization?.pmStatus || "").trim().toLowerCase();
  const runMode = String(result?.preflight?.runMode || workflow?.runMode || preflight?.selectedRunMode || preflight?.runMode || "").trim().toLowerCase();
  const hasOutput = hasUsefulOutput(result);
  const reviewLifecycleState = getReviewLifecycleState(workflow, result, autonomyRun);
  const activeKey = mapStageToWorkflowStep(currentStage, workflow, result);
  const order = ["planning", "qa", "development", "verification", "finalReview", "decision"];
  const activeIndex = currentStage === "autonomy-queued" || preflight?.state === "checking"
    ? -1
    : Math.max(order.indexOf(activeKey), 0);
  const steps = order.map((key, index) => ({
    key,
    label: WORKFLOW_STEP_LABELS[key],
    state: activeIndex < 0 ? "pending" : index < activeIndex ? "complete" : index === activeIndex ? "active" : "pending",
    note: ""
  }));

  if (preflight?.state === "checking") {
    setWorkflowStepState(steps, "planning", "pending", "initialization in progress");
  }

  if (qaStatus === "skipped") {
    setWorkflowStepState(steps, "qa", "skipped", "optional QA unavailable");
  } else if (qaStatus === "complete") {
    setWorkflowStepState(steps, "qa", "complete");
  }

  if (hasOutput) {
    setWorkflowStepState(steps, "development", "complete");
  }

  if (runMode === "degraded_developer_only") {
    setWorkflowStepState(steps, "planning", "skipped", "PM unavailable");
    setWorkflowStepState(steps, "qa", "skipped", "developer-only mode");
    if (!hasOutput) {
      setWorkflowStepState(steps, "development", activeKey === "development" ? "active" : "pending", "developer-only mode");
    }
  }

  if (validationStatus === "passed") {
    setWorkflowStepState(steps, "verification", "complete", "verifier passed");
  } else if (validationStatus === "needs_review") {
    setWorkflowStepState(steps, "verification", "needs_review", "build unverified");
  } else if (validationStatus === "failed") {
    setWorkflowStepState(steps, "verification", "failed", "verifier or build failed");
  }

  if (decisionStatus === "acknowledged") {
    setWorkflowStepState(steps, "decision", "complete");
  } else if (finalPmStatus === "timed_out") {
    setWorkflowStepState(steps, "finalReview", "needs_review", "final PM timeout");
    setWorkflowStepState(steps, "decision", "needs_review", "manual review required");
  } else if (["accepted", "acknowledged"].includes(decisionStatus) || ["completed", "output_ready", "ready_for_review"].includes(reviewLifecycleState) || String(workflow?.projectStatus || "").toLowerCase().includes("cycle finished")) {
    setWorkflowStepState(steps, "decision", "complete");
  } else if (decisionStatus === "needs_patch" || reviewLifecycleState === "validation_failed") {
    setWorkflowStepState(steps, "decision", "failed", "patch required");
  } else if (decisionStatus === "manual_review_required" || ["needs_review", "build_unverified"].includes(reviewLifecycleState)) {
    setWorkflowStepState(steps, "decision", "needs_review", reviewLifecycleState === "build_unverified" ? "build unverified" : "manual review required");
  } else if (validationStatus === "failed" && !hasOutput) {
    setWorkflowStepState(steps, "decision", "failed");
  } else if (hasOutput && (validationStatus === "needs_review" || qaStatus === "skipped" || finalPmStatus === "timed_out")) {
    setWorkflowStepState(steps, "decision", "needs_review");
  }

  return {
    steps,
    summary: buildWorkflowSummary({
      steps,
      validationStatus,
      qaStatus,
      finalPmStatus,
      hasOutput,
      preflight,
      runMode,
      autonomyRun,
      decisionStatus,
      reviewLifecycleState
    }),
    verificationNote: validationStatus === "needs_review" ? "Verification pending manual build confirmation." : "",
    finalizationNote: finalPmStatus === "timed_out" ? "Final PM decision timed out after output was generated." : ""
  };
}

function setWorkflowStepState(steps, key, state, note = "") {
  const step = steps.find((item) => item.key === key);
  if (!step) {
    return;
  }
  step.state = state;
  step.note = note;
}

function buildWorkflowSummary({ steps, validationStatus, qaStatus, finalPmStatus, hasOutput, preflight, runMode, autonomyRun, decisionStatus = "", reviewLifecycleState = "" }) {
  if (preflight?.state === "checking") {
    return "Initializing TriFix";
  }
  if (preflight?.state === "blocked") {
    return "Blocked - required model unavailable";
  }
  if (preflight?.state === "degraded_available") {
    return "Ready - developer-only mode available";
  }
  if (!hasOutput && autonomyRun?.status === "queued") {
    return "Run queued";
  }
  if (!hasOutput && steps.some((step) => step.state === "failed")) {
    return "Failed before useful output";
  }
  if (validationStatus === "failed" && hasOutput) {
    return "Validation failed - patch required";
  }
  if (finalPmStatus === "timed_out") {
    return "Needs review - final decision unavailable";
  }
  if (reviewLifecycleState === "needs_patch" || reviewLifecycleState === "validation_failed") {
    return "Validation failed - patch required";
  }
  if (reviewLifecycleState === "build_unverified") {
    return "Needs review - build unverified";
  }
  if (reviewLifecycleState === "needs_review") {
    return "Needs review - follow-up prompt recommended";
  }
  if (decisionStatus === "acknowledged" && validationStatus === "failed") {
    return "Review finished - patch recommended";
  }
  if (decisionStatus === "acknowledged" && validationStatus === "needs_review") {
    return reviewLifecycleState === "build_unverified"
      ? "Review finished - build still unverified"
      : "Review finished - follow-up prompt recommended";
  }
  if (steps.find((step) => step.key === "decision")?.state === "complete" && hasOutput) {
    return "Ready for next prompt";
  }
  if (runMode === "degraded_developer_only" && hasOutput) {
    return "Needs review - developer-only output";
  }
  if (validationStatus === "needs_review") {
    return "Needs review - build unverified";
  }
  if (qaStatus === "skipped") {
    return "Needs review - QA skipped";
  }
  if (steps.every((step) => step.state === "complete")) {
    return "Workflow complete";
  }
  const active = steps.find((step) => step.state === "active");
  return active ? `${active.label} in progress` : "Run progress available";
}

function mapStageToWorkflowStep(stage, workflow, result) {
  if (["supervisor-spec", "pm_plan", "planning", "pipeline-start", "autonomy-runner", "context-ready"].includes(stage)) {
    return "planning";
  }
  if (["senior-parallel-review", "qa"].includes(stage)) {
    return "qa";
  }
  if (["junior-initial", "junior-patch", "dev", "patch", "auto-repair"].includes(stage)) {
    return "development";
  }
  if (["file-executor", "apply_files", "auto-validation", "verify", "validation"].includes(stage)) {
    return "verification";
  }
  if (["senior-final-review"].includes(stage)) {
    return "finalReview";
  }
  if (["supervisor-final", "final", "decision", "accepted", "phase-ready", "autonomy-complete", "autonomy-error"].includes(stage)) {
    return "decision";
  }
  if (String(workflow?.projectStatus || "").toLowerCase().includes("validation")) {
    return "verification";
  }
  if (result?.qa?.finalReview || result?.qa?.parallelReview) {
    return "finalReview";
  }
  return "planning";
}

function getReviewLifecycleState(workflow, result, autonomyRun = null) {
  const decisionStatus = String(workflow?.decisionStatus || result?.decision?.decisionStatus || "").trim().toLowerCase();
  const validationStatus = getResultValidationStatus(result);
  const finalPmStatus = String(result?.finalization?.pmStatus || "").trim().toLowerCase();
  const projectType = String(result?.autoRepair?.finalValidation?.projectType || result?.validation?.projectType || "").trim().toLowerCase();
  const currentStage = String(workflow?.currentStage || result?.workflow?.currentStage || "").trim().toLowerCase();
  const runStatus = String(autonomyRun?.status || "").trim().toLowerCase();
  const hasOutput = hasUsefulOutput(result);

  if (decisionStatus === "acknowledged") {
    return "acknowledged";
  }
  if (decisionStatus === "needs_patch") {
    return "needs_patch";
  }
  if (validationStatus === "failed") {
    return "validation_failed";
  }
  if (finalPmStatus === "timed_out") {
    return "needs_review";
  }
  if (validationStatus === "needs_review") {
    return projectType === "vite-react" ? "build_unverified" : "needs_review";
  }
  if (decisionStatus === "manual_review_required") {
    return "needs_review";
  }
  if (hasOutput && (decisionStatus === "acknowledged" || runStatus === "completed" || ["supervisor-final", "final", "decision", "accepted", "phase-ready", "autonomy-complete"].includes(currentStage))) {
    return "completed";
  }
  if (hasOutput && validationStatus === "passed") {
    return "output_ready";
  }
  return "";
}

function getResultValidationStatus(result) {
  const value = String(result?.autoRepair?.status || result?.validation?.status || "").trim().toLowerCase();
  if (value === "passed") return "passed";
  if (value === "needs_review") return "needs_review";
  if (value === "failed") return "failed";
  return "";
}

function getProjectValidationMessage(result) {
  const projectType = String(result?.autoRepair?.finalValidation?.projectType || result?.validation?.projectType || "").trim().toLowerCase();
  const validationStatus = getResultValidationStatus(result);

  if (projectType === "vite-react") {
    if (validationStatus === "failed") {
      return "Vite validation failed. Review package.json dependencies, install step, and build output.";
    }
    if (validationStatus === "needs_review") {
      return "Build unverified. Vite source files were generated but build was not run.";
    }
    return "Vite project source generated. Use npm install and npm run dev/build to preview or validate.";
  }

  if (projectType === "static-html" && validationStatus === "passed") {
    return "open index.html passed";
  }

  return "";
}

function getResultQaStatus(result) {
  if (String(result?.preflight?.runMode || "").trim().toLowerCase() === "degraded_developer_only") {
    return "skipped";
  }
  const qaStatus = String(result?.finalization?.qaStatus || "").trim().toLowerCase();
  if (["skipped", "unavailable"].includes(qaStatus)) {
    return "skipped";
  }
  if (result?.qa?.finalReview || result?.qa?.parallelReview) {
    if (/qa unavailable|review unavailable|unavailable/i.test(String(result?.qa?.finalReview || result?.qa?.parallelReview || ""))) {
      return "skipped";
    }
    return "complete";
  }
  return "";
}

function formatWorkflowStepState(state) {
  const normalized = String(state || "pending").trim().toLowerCase();
  const labels = {
    pending: "pending",
    active: "active",
    complete: "complete",
    skipped: "skipped",
    needs_review: "needs review",
    failed: "failed"
  };
  return labels[normalized] || normalized;
}

function formatWorkflowStepper(steps = []) {
  return (steps || [])
    .map((step) => `${step.label} ${formatWorkflowStepState(step.state)}`)
    .join(" -> ");
}

function renderWorkflowStepIcon(state) {
  const normalized = String(state || "pending").trim().toLowerCase();
  if (normalized === "complete") {
    return <CheckCircle2 size={16} />;
  }
  if (normalized === "active") {
    return <Loader2 size={16} className="spin" />;
  }
  if (normalized === "failed") {
    return <XCircle size={16} />;
  }
  if (normalized === "needs_review") {
    return <TriangleAlert size={16} />;
  }
  if (normalized === "skipped") {
    return <ArrowUpDown size={16} />;
  }
  return <Clock3 size={16} />;
}

function shouldShowCycleReview({ result, workflow, isRunning }) {
  if (isRunning || !result?.decision?.summary) {
    return false;
  }

  return ["needs_patch", "manual_review_required", "denied"].includes(
    String(workflow?.decisionStatus || "").toLowerCase()
  );
}

function canDiscardGeneratedOutput(project, result) {
  return Boolean(
    project?.rootPath &&
    (project?.projectType === "sandbox-task" || result?.project?.projectType === "sandbox-task") &&
    (result?.executor?.applied || []).length > 0
  );
}

function getUpcomingPhaseName(phases = []) {
  const currentIndex = phases.findIndex((phase) => phase.status === "in_progress");
  if (currentIndex >= 0 && phases[currentIndex + 1]) {
    return phases[currentIndex + 1].name;
  }

  return phases.find((phase) => phase.status === "not_started")?.name || "";
}

function uniqueStrings(items = []) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
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

function isUsableCommandRequest(command) {
  const normalized = String(command || "").trim();
  return normalized.length > 0 && !/^(none|n\/a|na|no command|no commands|nothing)$/i.test(normalized);
}

function formatDecisionSummary(value) {
  return sanitizeDecisionText(value).replace(/\s+/g, " ").trim();
}

function formatDecisionHeadline(value) {
  const normalized = formatDecisionSummary(value);
  if (!normalized) {
    return "";
  }

  const firstSentence = normalized.match(/^(.{1,220}?[.!?])(\s|$)/)?.[1] || normalized.slice(0, 220);
  return firstSentence.trim();
}

function formatDecisionSummaryForResult(value, result) {
  return sanitizeProjectValidationWording(formatDecisionSummary(value), result);
}

function sanitizeDecisionText(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gis, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[#>\-\s]+/gm, "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sanitizeProjectValidationWording(value, result) {
  const projectType = String(result?.autoRepair?.finalValidation?.projectType || result?.validation?.projectType || "").trim().toLowerCase();
  const normalized = String(value || "");
  if (projectType !== "vite-react") {
    return normalized;
  }

  return normalized
    .replace(/open\s+index\.html\s+passed\.?/gi, "Vite source generated. Direct file preview is not a validation check.")
    .replace(/file:\/\/\s*index\.html\s+passed\.?/gi, "Vite source generated. Direct file preview is not a validation check.")
    .replace(/html\s+preview\s+passed\.?/gi, "Vite source generated. Direct file preview is not a validation check.");
}

function transitionProjectPlan(phases = [], tasks = [], mode = "finish") {
  const nextPhases = (phases || []).map((phase) => ({ ...phase }));
  const nextTasks = (tasks || []).map((task) => ({ ...task }));
  const currentPhaseIndex = nextPhases.findIndex((phase) => phase.status === "in_progress");
  const resolvedPhaseIndex = currentPhaseIndex >= 0 ? currentPhaseIndex : (nextPhases.length > 0 ? 0 : -1);
  const currentPhaseName = resolvedPhaseIndex >= 0 ? nextPhases[resolvedPhaseIndex]?.name || "" : "";

  if (resolvedPhaseIndex >= 0) {
    nextPhases.forEach((phase, index) => {
      if (index === resolvedPhaseIndex) {
        phase.status = "done";
      } else if (phase.status === "in_progress") {
        phase.status = "not_started";
      }
    });

    nextTasks.forEach((task) => {
      if (task.phase === currentPhaseName && task.status !== "done") {
        task.status = "done";
      }
    });
  }

  let nextPhaseName = "";
  let nextTaskTitle = "";
  if (mode === "advance" && resolvedPhaseIndex >= 0 && nextPhases[resolvedPhaseIndex + 1]) {
    const nextPhase = nextPhases[resolvedPhaseIndex + 1];
    nextPhase.status = "in_progress";
    nextPhaseName = nextPhase.name || "";
    const nextTask = nextTasks.find((task) => task.phase === nextPhaseName && task.status !== "done");
    if (nextTask) {
      nextTask.status = "in_progress";
      nextTaskTitle = nextTask.title || "";
    }
  }

  return {
    phases: nextPhases,
    tasks: nextTasks,
    currentPhase: mode === "advance" ? (nextPhaseName || currentPhaseName || "") : currentPhaseName,
    currentTask: mode === "advance" ? (nextTaskTitle || "Start next phase") : "Cycle finished"
  };
}

function buildDialogueDraft(agentsMap) {
  const draft = {};

  for (const [agentId, agent] of Object.entries(agentsMap || {})) {
    draft[agentId] = {
      idle: agent.dialogue?.idle || "",
      thinking: agent.dialogue?.thinking || "",
      speaking: agent.dialogue?.speaking || "",
      coding: agent.dialogue?.coding || "",
      installing: agent.dialogue?.installing || "",
      unpacking: agent.dialogue?.unpacking || "",
      testing: agent.dialogue?.testing || "",
      waiting: agent.dialogue?.waiting || "",
      done: agent.dialogue?.done || "",
      error: agent.dialogue?.error || "",
      received: agent.dialogue?.received || ""
    };
  }

  return draft;
}

function getActiveAgentId(agents, isRunning) {
  if (!isRunning) {
    return "";
  }

  const activeAgent = agents.find((agent) => agent.status === "thinking" || agent.status === "speaking");
  return activeAgent?.id || "";
}

function capitalize(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function formatOutputTab(value) {
  const labels = {
    architect: "Supervisor",
    supervisor: "Senior Dev",
    junior: "Junior Dev",
    prd: "PRD",
    tasks: "Progress",
    logs: "Logs",
    decision: "Decision"
  };
  return labels[value] || capitalize(value);
}

function joinSections(sections) {
  return sections
    .filter(([, content]) => content)
    .map(([label, content]) => `${label}\n${content}`)
    .join("\n\n");
}

function formatFileOperations(fileOperations = []) {
  if (!fileOperations.length) {
    return "";
  }

  return fileOperations
    .slice(0, 8)
    .map((operation) => `${operation.action || "write"} ${operation.path}`)
    .join("\n");
}

function formatExecutorSummary(executor) {
  if (!executor) {
    return "";
  }

  return [
    executor.rootPath ? `Path: ${executor.rootPath}` : "",
    `Created: ${executor.filesCreated || 0}`,
    `Modified: ${executor.filesModified || 0}`,
    `Failed: ${(executor.failedOperations || []).length}`
  ].filter(Boolean).join("\n");
}

function formatAgentName(value, agentNameMap = {}) {
  if (agentNameMap?.[value]) {
    return agentNameMap[value];
  }

  if (value === "junior") {
    return "Junior Dev";
  }

  if (value === "supervisor") {
    return "Senior Dev / QA";
  }

  if (value === "architect") {
    return "Supervisor / PM";
  }

  return capitalize(String(value || "team"));
}

function splitIntoWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function joinVisibleWords(words, count) {
  return words.slice(0, count).join(" ");
}

function getWordDelay(word, speed) {
  if (/[.!?]["')\]]*$/.test(word)) {
    return speed + PUNCTUATION_PAUSE;
  }

  if (/[,:;]["')\]]*$/.test(word)) {
    return speed + Math.round(PUNCTUATION_PAUSE * 0.5);
  }

  return speed;
}

function isSpinnerStatus(status) {
  return ["thinking", "coding", "installing", "unpacking", "testing", "waiting"].includes(status);
}

function mapStatusToSpriteStatus(status) {
  if (["thinking", "coding", "installing", "unpacking", "testing", "waiting", "received"].includes(status)) {
    return status === "received" ? "thinking" : "thinking";
  }

  return status;
}

function mapProgressStatus(agentId, status, options = {}) {
  if (agentId === "supervisor" && options.qaUnavailable) {
    return "idle";
  }

  if (status === "coding" && agentId === "architect") {
    return "thinking";
  }

  if (AGENT_STATUS_KEYS.includes(status)) {
    return status;
  }

  if (["waiting_for_decision", "blocked"].includes(status)) {
    return "waiting";
  }

  if (["failed", "stopped"].includes(status)) {
    return "error";
  }

  return "thinking";
}

function mapTerminalAgentStatus(agentId, result, options = {}) {
  const runStatus = String(options.runStatus || "").trim().toLowerCase();
  const qaUnavailable = Boolean(options.qaUnavailable);
  const hasOutput = hasUsefulOutput(result);
  const finalPmTimedOut = String(result?.finalization?.pmStatus || "").trim().toLowerCase() === "timed_out";
  const developerOnlyMode = String(result?.preflight?.runMode || "").trim().toLowerCase() === "degraded_developer_only";

  if (agentId === "junior") {
    return hasOutput ? "done" : (runStatus === "failed" ? "error" : "idle");
  }

  if (agentId === "supervisor") {
    if (developerOnlyMode || qaUnavailable || String(result?.finalization?.qaStatus || "").trim().toLowerCase() === "skipped") {
      return "idle";
    }
    if (runStatus === "failed" && !hasOutput) {
      return "error";
    }
    return result?.qa?.finalReview || result?.qa?.parallelReview ? "done" : "idle";
  }

  if (agentId === "architect") {
    if (developerOnlyMode) {
      return "idle";
    }
    if (finalPmTimedOut) {
      return "waiting";
    }
    if (runStatus === "failed" && !hasOutput) {
      return "error";
    }
    return "done";
  }

  return runStatus === "failed" && !hasOutput ? "error" : "idle";
}

function classifyModelAvailability(health) {
  const roles = [
    { id: "architect", name: "Project Manager", required: true },
    { id: "junior", name: "Junior Dev", required: true },
    { id: "supervisor", name: "Senior Dev / QA", required: false }
  ];
  const required = [];
  const optional = [];

  roles.forEach((role) => {
    const match = health?.[role.id] || {};
    const availability = classifyAvailabilityState(role, match);
    const entry = {
      id: role.id,
      name: role.name,
      model: match.model || "",
      online: availability === "online",
      availability,
      endpoint: match.endpoint || "",
      required: role.required,
      reason: match.error || "",
      endpointReachable: Boolean(match.endpointReachable || match.online),
      modelResponded: Boolean(match.modelResponded || match.online),
      elapsedMs: Number(match.elapsedMs || 0),
      classification: match.classification || availability
    };

    if (role.required) {
      required.push(entry);
      return;
    }

    optional.push(entry);
  });

  const requiredOffline = required.filter((entry) => entry.availability === "offline");
  const optionalOffline = optional.filter((entry) => entry.availability !== "online");
  const architect = required.find((entry) => entry.id === "architect");
  const junior = required.find((entry) => entry.id === "junior");
  const warnings = [];
  if (optionalOffline.length > 0) {
    warnings.push("Senior Dev / QA is unavailable. The run will continue with deterministic verification and may end as needs_review.");
  }
  const canRunNormal = architect?.availability === "online" && junior?.availability === "online";
  const canRunDeveloperOnly = architect?.availability !== "online" && junior?.availability === "online";
  const cannotRun = junior?.availability !== "online";

  return {
    canRun: canRunNormal,
    canRunNormal,
    canRunDeveloperOnly,
    canRunWithWarnings: canRunNormal && optionalOffline.length > 0,
    cannotRun,
    required,
    optional,
    warnings
  };
}

function classifyAvailabilityState(role, match) {
  if (match?.online) {
    return "online";
  }
  return String(match?.classification || "").trim().toLowerCase() || "unknown_error";
}

function findAvailabilityEntry(availability, agentId) {
  return [...(availability?.required || []), ...(availability?.optional || [])].find((entry) => entry.id === agentId) || null;
}

function isSupervisorUnavailable(availability) {
  const supervisor = findAvailabilityEntry(availability, "supervisor");
  return Boolean(supervisor) && supervisor.required === false && supervisor.availability !== "online";
}

function buildAvailabilityMessage(availability) {
  const source = availability?.availability || availability;
  const activeModels = preflightEntries(source)
    .activeModels
    .map((entry) => `${entry.name}: ${entry.model}`);
  const unavailableModels = preflightEntries(source)
    .unavailableModels
    .map((entry) => `${entry.name}: ${entry.model}`);

  const parts = [];
  if (activeModels.length > 0) {
    parts.push(`Active models: ${activeModels.join("; ")}.`);
  }
  if (unavailableModels.length > 0) {
    parts.push(`Unavailable models: ${unavailableModels.join("; ")}.`);
  }
  if ((source?.warnings || []).length > 0) {
    parts.push(source.warnings.join(" "));
  }

  return parts.join(" ");
}

function preflightEntries(availability) {
  const all = [...(availability?.required || []), ...(availability?.optional || [])];
  return {
    activeModels: all.filter((entry) => entry.availability === "online"),
    unavailableModels: all.filter((entry) => entry.availability !== "online")
  };
}

function buildRunPreflight(availability) {
  const { activeModels, unavailableModels } = preflightEntries(availability);
  const architect = findAvailabilityEntry(availability, "architect");
  const junior = findAvailabilityEntry(availability, "junior");
  const qa = findAvailabilityEntry(availability, "supervisor");

  let state = "blocked";
  let selectedRunMode = "blocked";
  let message = "Required model unavailable. Please start the model server and try again.";
  const warnings = [...(availability?.warnings || [])];

  if (junior?.availability !== "online") {
    state = "blocked";
    selectedRunMode = "blocked";
    message = buildUnavailableModelMessage(junior, { allowDeveloperOnly: false });
  } else if (architect?.availability !== "online") {
    state = "degraded_available";
    selectedRunMode = "degraded_developer_only";
    message = `${buildUnavailableModelMessage(architect, { allowDeveloperOnly: true })} You may proceed in Developer-only mode, but your prompt must be detailed. No PM planning or QA approval will be available.`;
  } else if (qa?.availability !== "online") {
    state = "ready_with_warnings";
    selectedRunMode = "normal_qa_unavailable";
    message = `${buildUnavailableModelMessage(qa, { allowDeveloperOnly: false })} TriFix will continue with deterministic verification. Final status may require manual review.`;
  } else {
    state = "ready";
    selectedRunMode = "normal";
    message = "All required models are available. TriFix is ready to run.";
  }

  return {
    state,
    selectedRunMode,
    activeModels,
    unavailableModels,
    warnings,
    availability,
    message
  };
}

function buildUnavailableModelMessage(entry, options = {}) {
  if (!entry) {
    return "Model unavailable.";
  }

  const roleName = entry.name;
  const modelName = entry.model || "unknown model";
  const endpoint = entry.endpoint || "unknown endpoint";
  const reason = String(entry.reason || "").trim();
  const classification = String(entry.classification || entry.availability || "").trim().toLowerCase();
  const suffix = reason ? ` ${reason}` : "";

  if (entry.endpointReachable && !entry.modelResponded) {
    if (entry.id === "architect") {
      return `Endpoint reachable, but PM model ${modelName} did not respond. Check that this model is loaded or served in LM Studio.${suffix}`;
    }
    return `${roleName} endpoint is reachable, but model ${modelName} did not respond. Check that this model is loaded or served in LM Studio.${suffix}`;
  }

  if (classification === "endpoint_offline") {
    return `${roleName} endpoint is offline at ${endpoint}. Start the model server and try again.${suffix}`;
  }

  if (classification === "model_timeout") {
    return `${roleName} model ${modelName} timed out during the quick health check. Endpoint is reachable, but this model did not respond within the health timeout. Confirm the model is loaded or set TRIFIX_HEALTH_TIMEOUT_MS=10000 for slow VPN servers.${suffix}`;
  }

  if (classification === "model_unavailable") {
    return `${roleName} model ${modelName} is not available on ${endpoint}. Confirm the exact model name is loaded or served in LM Studio.${suffix}`;
  }

  if (classification === "invalid_response") {
    return `${roleName} endpoint responded, but the model health response was invalid. Check the served API response in LM Studio.${suffix}`;
  }

  return `${roleName} is unavailable. ${reason || "Check the model server and LM Studio configuration."}`;
}

function getSuggestedFix(entry) {
  const classification = String(entry?.classification || entry?.availability || "").trim().toLowerCase();
  if (entry?.endpointReachable && !entry?.modelResponded) {
    return `Open LM Studio on the remote laptop. Confirm ${entry.model || "the model"} is loaded or served.`;
  }
  if (classification === "endpoint_offline") {
    return "Start the endpoint host and confirm the server is reachable on the configured address.";
  }
  if (classification === "model_timeout") {
    return `Confirm ${entry.model || "the model"} is loaded and responsive in LM Studio.`;
  }
  if (classification === "model_unavailable") {
    return `Confirm the exact model name ${entry.model || ""} is available and served in LM Studio.`;
  }
  if (classification === "invalid_response") {
    return "Inspect the server response format and confirm the chat endpoint is returning a valid success response.";
  }
  return "Recheck the model server, endpoint, and loaded model name.";
}

function formatAvailabilityBadge(entry) {
  const classification = String(entry?.classification || entry?.availability || "").trim().toLowerCase();
  if (classification === "online") return "Active";
  if (classification === "endpoint_offline") return "Endpoint offline";
  if (classification === "model_timeout") return "Model timeout";
  if (classification === "model_unavailable") return "Model unavailable";
  if (classification === "invalid_response") return "Invalid response";
  if (entry?.endpointReachable && !entry?.modelResponded) return "Model unavailable";
  return "Unavailable";
}

function isTerminalAutonomyStatus(status) {
  return ["completed", "needs_review", "failed", "stopped", "timed_out"].includes(String(status || "").trim().toLowerCase());
}

function formatAutonomyStatus(status) {
  const normalized = String(status || "idle").trim().toLowerCase();
  if (normalized === "waiting_for_decision") {
    return "Ready for review";
  }
  if (normalized === "needs_review") {
    return "Needs review";
  }
  if (normalized === "completed") {
    return "Output ready";
  }
  if (normalized === "timed_out") {
    return "Final decision unavailable";
  }
  return String(status || "idle")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatRunModeLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "normal") return "Normal";
  if (normalized === "normal_qa_unavailable") return "Normal with QA skipped";
  if (normalized === "degraded_developer_only") return "Developer-only degraded mode";
  if (normalized === "blocked") return "Blocked";
  return normalized || "Unknown";
}

function shouldShowExpandedPreflightPanel(preflight) {
  const state = String(preflight?.state || "").trim().toLowerCase();
  return ["checking", "blocked", "degraded_available", "ready", "ready_with_warnings"].includes(state);
}

function shouldShowCompactPreflightSummary(runPreflight, result, autonomyRun) {
  if (shouldShowExpandedPreflightPanel(runPreflight)) {
    return false;
  }
  const preflight = runPreflight || result?.preflight || autonomyRun?.preflight;
  return Boolean(preflight);
}

function formatHealthAttempts(entry) {
  const attempts = Number(entry?.attempts || 0);
  const elapsedMs = Number(entry?.elapsedMs || 0);
  const perAttempt = Array.isArray(entry?.perAttemptElapsedMs) ? entry.perAttemptElapsedMs : [];
  if (attempts <= 0 && elapsedMs <= 0) {
    return "";
  }

  const parts = [];
  if (attempts > 0) {
    parts.push(`${attempts} attempt${attempts === 1 ? "" : "s"}`);
  }
  if (elapsedMs > 0) {
    parts.push(`${elapsedMs}ms total`);
  }
  if (perAttempt.length > 1) {
    parts.push(`per attempt: ${perAttempt.map((value) => `${value}ms`).join(", ")}`);
  }
  return parts.join(" - ");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function estimateSceneDuration(messages) {
  return messages.reduce((total, item, index) => {
    const words = splitIntoWords(item.message).length;
    const punctuationCount = (item.message.match(/[.!?]/g) || []).length;
    const base = words * TYPE_SPEED + punctuationCount * PUNCTUATION_PAUSE;
    return total + base + (index > 0 ? STAGE_DELAY : 0);
  }, 0);
}

function toStatusBadgeClass(status) {
  const value = String(status || "").toLowerCase().replace(/\s+/g, "-");
  return value || "not-started";
}

function formatTimestamp(value) {
  if (!value) {
    return "n/a";
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function toLandingStatusKey(status, decisionStatus) {
  const decision = String(decisionStatus || "").toLowerCase();
  const value = String(status || "").toLowerCase();

  if (
    decision === "applied" ||
    decision === "accepted" ||
    decision === "acknowledged" ||
    ["completed", "output ready", "ready for review"].includes(value)
  ) {
    return "completed";
  }

  if (["needs review", "build unverified"].includes(value)) {
    return "active";
  }

  if (value === "in progress" || value === "validation failed" || value === "blocked" || value === "timed_out" || decision === "denied" || decision === "manual_review_required") {
    return "active";
  }

  if (decision === "needs_patch") {
    return "active";
  }

  return "not-started";
}

function toLandingStatusLabel(status, decisionStatus) {
  const normalized = String(status || "").trim().toLowerCase();
  if (["output ready", "ready for review", "needs review", "build unverified"].includes(normalized)) {
    return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  const key = toLandingStatusKey(status, decisionStatus);
  if (key === "active") {
    return "In progress";
  }

  if (key === "completed") {
    return "Completed";
  }

  return "Not started";
}

function mapTrackedStatusToStage(status, decisionStatus) {
  if (decisionStatus === "applied") {
    return "applied";
  }

  if (decisionStatus === "accepted") {
    return "accepted";
  }

  if (decisionStatus === "acknowledged") {
    return "accepted";
  }

  if (decisionStatus === "manual_review_required") {
    return "manual-review";
  }

  if (decisionStatus === "needs_patch") {
    return "correction-loop";
  }

  if (decisionStatus === "denied") {
    return "correction-loop";
  }

  if (["ready for review", "output ready", "needs review", "build unverified"].includes(String(status || "").toLowerCase())) {
    return "decision";
  }

  if (String(status || "").toLowerCase() === "in progress") {
    return "junior";
  }

  return "idle";
}

function isExplicitNewProjectRequest(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return /\b(create|start|make)\s+(a\s+)?new project\b/.test(normalized) || /^new project\b/.test(normalized);
}

function assessProjectFeasibility({ input, result, selectedFiles, hasContextDocuments }) {
  const patches = result?.architect?.patches || [];
  const fileOperations = result?.dev?.fileOperations || [];
  const appliedOperations = result?.executor?.applied || [];
  const affectedFiles = result?.decision?.affectedFiles || result?.architect?.affectedFiles || [];
  const lowerInput = String(input || "").toLowerCase();
  const wantsProject =
    /\b(project|website|web app|app|site|landing page|dashboard|tool|game)\b/.test(lowerInput) ||
    hasContextDocuments;
  const paths = new Set([
    ...affectedFiles,
    ...patches.map((patch) => patch.path),
    ...fileOperations.map((operation) => operation.path),
    ...appliedOperations.map((operation) => operation.path)
  ]);

  if (patches.length === 0 && fileOperations.length === 0 && appliedOperations.length === 0) {
    return { ok: false, reason: "No valid file operations were produced." };
  }

  if (wantsProject && paths.size < 2 && selectedFiles.length === 0 && ![...paths].some((path) => /index\.html$/i.test(path))) {
    return { ok: false, reason: "The result only produced a single file for a project-style request." };
  }

  if (wantsProject && [...paths].some((path) => /package\.json$/i.test(path)) && ![...paths].some((path) => /(src\/|index\.|main\.)/i.test(path))) {
    return { ok: false, reason: "The result created package metadata without any runnable app files." };
  }

  const htmlOperation = fileOperations.find((operation) => /\.html$/i.test(operation.path));
  const htmlContent = String(htmlOperation?.content || "");
  const hasEmbeddedCssAndJs = /<style[\s>]/i.test(htmlContent) && /<script[\s>]/i.test(htmlContent);
  if (wantsProject && [...paths].some((path) => /\.html$/i.test(path)) && !hasEmbeddedCssAndJs && ![...paths].some((path) => /\.(css|js)$/i.test(path))) {
    return { ok: false, reason: "The result produced HTML without supporting CSS or JS assets." };
  }

  return { ok: true, reason: "" };
}

function inferRestoreState(message) {
  if (message.type === "reaction") {
    return "thinking";
  }

  if (message.from === "architect") {
    return "done";
  }

  if (message.from === "supervisor") {
    return "done";
  }

  if (message.from === "junior") {
    return "done";
  }

  return "idle";
}

function isImportantVisualMessage(message) {
  return ["pipeline", "reaction", "status"].includes(String(message?.type || ""));
}

function applyAgentNames(agentList, nameOverrides = {}) {
  return (agentList || []).map((agent) => ({
    ...agent,
    name: nameOverrides[agent.id] || agent.name
  }));
}

function buildAgentNameMap(agentList, nameOverrides = {}) {
  const map = {};
  for (const agent of agentList || []) {
    map[agent.id] = nameOverrides[agent.id] || agent.name;
  }
  return map;
}

function loadAgentNames() {
  try {
    const raw = window.localStorage.getItem(AGENT_NAME_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      junior: parsed?.junior || "",
      supervisor: parsed?.supervisor || "",
      architect: parsed?.architect || ""
    };
  } catch {
    return {
      junior: "",
      supervisor: "",
      architect: ""
    };
  }
}

function saveAgentNames(names) {
  window.localStorage.setItem(AGENT_NAME_STORAGE_KEY, JSON.stringify(names));
}

function shouldRunChatter({ isRunning, agents, activeMessage, isTyping, scene, messageQueue, workflow }) {
  if (scene) {
    return false;
  }

  if (activeMessage || isTyping) {
    return false;
  }

  if ((messageQueue || []).some((message) => message.priority === "high")) {
    return false;
  }

  const currentStage = String(workflow?.currentStage || "").trim().toLowerCase();
  const decisionStatus = String(workflow?.decisionStatus || "").trim().toLowerCase();
  if (["decision", "supervisor-final", "manual-review", "manual_review_required", "accepted", "applied"].includes(currentStage)) {
    return false;
  }
  if (["manual_review_required", "acknowledged", "accepted", "applied"].includes(decisionStatus)) {
    return false;
  }

  return !isRunning || hasThinkingStage(agents);
}

function hasThinkingStage(agents) {
  return (agents || []).some((agent) =>
    ["thinking", "coding", "waiting", "installing", "testing", "unpacking"].includes(agent.status)
  );
}

function shouldAppendChatter(chatMessages) {
  const streak = countTrailingChatter(chatMessages);
  return streak < 2;
}

function countTrailingChatter(messages) {
  let count = 0;
  for (let index = (messages || []).length - 1; index >= 0; index -= 1) {
    if (messages[index]?.type !== "chatter") {
      break;
    }
    count += 1;
  }
  return count;
}

function buildChatterMessage({ agents, project, selectedFiles, timestamp }) {
  const eligibleAgents = (agents || []).filter((agent) =>
    ["idle", "waiting", "thinking", "coding", "installing", "testing", "unpacking", "error"].includes(agent.status)
  );
  const speaker = pickRandom(eligibleAgents);
  if (!speaker) {
    return null;
  }

  const contextPhrase = getContextPhrase(project, selectedFiles);
  const category = getChatterCategory(speaker);
  const lines = [
    ...(phraseBank[speaker.id]?.[category] || []),
    ...(phraseBank[speaker.id]?.[speaker.status] || []),
    ...(phraseBank.general?.[speaker.status] || []),
    ...(category === "idle" ? phraseBank.general.idle : []),
    getStatusFallbackPhrase(speaker.status),
    ...(contextPhrase ? [contextPhrase] : [])
  ].filter(Boolean);
  const message = clampWords(pickRandom(lines) || "", 12);
  if (!message) {
    return null;
  }

  return {
    from: speaker.id,
    to: "team",
    role: speaker.status === "idle" ? "idle chatter" : "thinking chatter",
    stage: "chatter",
    timestamp,
    text: message,
    message,
    type: "chatter",
    priority: "low",
    restoreState: speaker.status
  };
}

function maybeQueueChatterReply({
  message,
  agents,
  project,
  selectedFiles,
  activeMessage,
  isTyping,
  scene,
  isRunning,
  queuedMessages,
  replyTimeoutRef,
  enqueueAgentMessage
}) {
  if (message.type !== "chatter") {
    return;
  }

  if (replyTimeoutRef.current || activeMessage || isTyping || scene) {
    return;
  }

  const speaker = message.from;
  const shouldReply =
    (speaker === "junior" && Math.random() < THINKING_HELP_CHANCE) ||
    Math.random() < CHATTER_REPLY_CHANCE ||
    (isRunning && Math.random() < ARCHITECT_ENCOURAGEMENT_CHANCE);

  if (!shouldReply || countTrailingChatter(queuedMessages) >= 2) {
    return;
  }

  const replyAgent = selectReplyAgent(speaker, agents, isRunning);
  const replyMessage = buildReplyChatter(replyAgent, speaker, project, selectedFiles);
  if (!replyAgent || !replyMessage) {
    return;
  }

  replyTimeoutRef.current = setTimeout(() => {
    replyTimeoutRef.current = null;
    enqueueAgentMessage({
      from: replyAgent.id,
      to: speaker,
      role: "thinking chatter",
      stage: "chatter",
      timestamp: getChatTimestamp(),
      text: replyMessage,
      message: replyMessage,
      type: "chatter",
      priority: "low",
      restoreState: replyAgent.status
    });
  }, randomBetween(1000, 2000));
}

function selectReplyAgent(from, agents, isRunning) {
  if (from === "junior") {
    return (agents || []).find((agent) => agent.id === "supervisor") || null;
  }

  if (isRunning && Math.random() < ARCHITECT_ENCOURAGEMENT_CHANCE) {
    return (agents || []).find((agent) => agent.id === "architect") || null;
  }

  return pickRandom((agents || []).filter((agent) => agent.id !== from));
}

function buildReplyChatter(agent, replyingTo, project, selectedFiles) {
  if (!agent) {
    return "";
  }

  const contextPhrase = getContextPhrase(project, selectedFiles);
  let lines = [];

  if (agent.id === "supervisor" && replyingTo === "junior") {
    lines = phraseBank.supervisor.replyToJunior || [];
  } else if (agent.id === "architect") {
    lines = phraseBank.architect.encouragement || [];
  } else {
    lines = phraseBank[agent.id]?.thinkingSolo || phraseBank.general.waiting || [];
  }

  return clampWords(pickRandom([...lines, ...(contextPhrase ? [contextPhrase] : [])]) || "", 12);
}

function getContextPhrase(project, selectedFiles) {
  const projectName = project?.name || project?.rootPath?.split(/[\\/]/).pop() || "";
  const firstFile = selectedFiles?.[0]?.split(/[\\/]/).pop() || "";

  if (firstFile && Math.random() < 0.5) {
    return clampWords(`That ${firstFile} looks suspicious.`, 8);
  }

  if (projectName) {
    return clampWords(`This ${projectName} thing is interesting.`, 8);
  }

  return "";
}

function getStatusFallbackPhrase(status) {
  if (status === "installing") {
    return pickRandom(["Installing dependencies...", "Waiting for npm..."]);
  }

  if (status === "coding") {
    return "Writing the fix...";
  }

  if (status === "thinking") {
    return pickRandom(["Hmm...", "This might work..."]);
  }

  if (status === "testing") {
    return pickRandom(["Running tests...", "Waiting on the checks..."]);
  }

  if (status === "waiting") {
    return "Still waiting...";
  }

  if (status === "error") {
    return "Pipeline encountered an error. Waiting for review.";
  }

  return "";
}

function getChatterCategory(agent) {
  if (!agent) {
    return "idle";
  }

  if (agent.status === "idle") {
    return "idle";
  }

  if (agent.status === "waiting") {
    return "waiting";
  }

  if (agent.status === "error") {
    return "error";
  }

  if (["coding"].includes(agent.status)) {
    return "coding";
  }

  if (["installing"].includes(agent.status)) {
    return "installing";
  }

  if (["testing"].includes(agent.status)) {
    return "testing";
  }

  if (agent.id === "architect" && Math.random() < ARCHITECT_ENCOURAGEMENT_CHANCE) {
    return "encouragement";
  }

  if (agent.id === "junior" && Math.random() < THINKING_HELP_CHANCE) {
    return "askingHelp";
  }

  return "thinkingSolo";
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(items) {
  if (!items?.length) {
    return null;
  }

  return items[Math.floor(Math.random() * items.length)];
}

function getChatTimestamp() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}
