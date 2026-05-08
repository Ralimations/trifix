import { useEffect, useMemo, useRef, useState } from "react";
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
      "How's this project going?",
      "Anyone seen the logs today?",
      "I swear this worked yesterday.",
      "I'm still stuck in this screen.",
      "This bug fears me. I think."
    ],
    waiting: [
      "Still waiting on input...",
      "Coffee break?",
      "I'm just here... thinking.",
      "I deserve a raise for this."
    ],
    error: [
      "Pipeline halted. Let me check the logs.",
      "We hit a blocker. Review needed.",
      "Process stopped. Waiting for the fix."
    ]
  },
  junior: {
    idle: ["Ready to implement.", "I can wire that up.", "Please don't crash..."],
    thinkingSolo: [
      "Hmm...",
      "Checking the task scope.",
      "This looks familiar. Suspiciously familiar.",
      "Maybe the bug is scared of me."
    ],
    askingHelp: [
      "QA, can you check this later?",
      "I think the implementation path is clear.",
      "PM scope noted."
    ],
    coding: ["I'm coding carefully... probably.", "Typing fixes with confidence I borrowed."],
    waiting: ["Holding here...", "Waiting on the next clue."]
  },
  supervisor: {
    idle: ["Review queue is open.", "Let's keep it aligned.", "This needs a test plan."],
    thinkingSolo: ["Let me review that.", "Checking PRD alignment.", "Reviewing DEV output..."],
    replyToJunior: ["Yeah, I'll check it later.", "Send it over.", "Not bad. Needs review.", "Hold on, I'm looking."],
    coding: ["Cleaning this up.", "Making it less fragile."],
    waiting: ["Waiting, but critically.", "Still reviewing from afar."]
  },
  architect: {
    idle: ["Scope is ready.", "We need a clean PRD.", "This needs structure."],
    thinkingSolo: ["Looking at the bigger picture.", "Aligning phases.", "Final decision pending."],
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
  const [modelAvailability, setModelAvailability] = useState(null);
  const [isDecisionBusy, setIsDecisionBusy] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const currentRunRef = useRef(null);
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
    (codeInput.trim().length > 0 || selectedFiles.length > 0 || contextDocuments.length > 0);
  const messageByAgent = getAgentMessageMap(activeMessage, visibleBubble);
  const agentNameMap = useMemo(() => buildAgentNameMap(agents, agentNames), [agents, agentNames]);

  useEffect(() => {
    agentStatusRef.current = Object.fromEntries((agents || []).map((agent) => [agent.id, agent.status]));
  }, [agents]);

  useEffect(() => {
    modelAvailabilityRef.current = modelAvailability;
  }, [modelAvailability]);

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
      if (progress.runId !== currentRunRef.current) {
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
      if (progress.runId !== currentRunRef.current) {
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
        const qaUnavailable = isSupervisorUnavailable(modelAvailabilityRef.current);
        setAgents((currentAgents) =>
          currentAgents.map((agent) => ({
            ...agent,
            status:
              progress.stage === "autonomy-error"
                ? agent.id === "supervisor" && qaUnavailable
                  ? "idle"
                  : "error"
                : "idle"
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
          setActiveTab("decision");
          setActiveView("office");
        }
        pushNotification({
          type: progress.stage === "autonomy-error" ? "error" : "success",
          title: progress.stage === "autonomy-error" ? "Autonomy stopped" : "Task finished",
          message: progress.stage === "autonomy-error"
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

  useEffect(() => {
    if (activeMessage?.from) {
      setActiveTab(activeMessage.from === "architect" ? "architect" : activeMessage.from);
    }
  }, [activeMessage]);

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
      messageQueue
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
      const qaUnavailable = isSupervisorUnavailable(modelAvailabilityRef.current);
      setAgents((currentAgents) =>
        currentAgents.map((agent) => ({
          ...agent,
          status:
            snapshot.status === "failed"
              ? agent.id === "supervisor" && qaUnavailable
                ? "idle"
                : "error"
              : "idle"
        }))
      );
      if (!options.silent) {
        setActiveTab("decision");
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

    let runProject = project;
    let runSelectedFiles = selectedFiles;
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
      setDecisionPreview([]);
      setActiveTab("architect");
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
      setActiveTab("decision");
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

  async function startAutonomousRun() {
    if (!canRun) {
      return;
    }

    setError("");
    let availability = null;
    try {
      const nextHealth = await window.trifix.getModelHealth();
      availability = classifyModelAvailability(nextHealth);
      setModelAvailability(availability);
    } catch (healthError) {
      const message = healthError?.message || "Could not check model availability.";
      setError(message);
      setDecisionMessage(message);
      return;
    }

    if (!availability?.canRun) {
      const requiredOffline = [...(availability?.required || [])].find((entry) => entry.availability === "offline");
      const message = requiredOffline
        ? `Required model unavailable: ${requiredOffline.name} (${requiredOffline.model || "unknown model"}). Please start the model server and try again.`
        : "Required model unavailable. Please start the model server and try again.";
      setError(message);
      setDecisionMessage("");
      return;
    }

    setDecisionMessage(buildAvailabilityMessage(availability));
    setIsRunning(true);
    setIsAutonomyRunning(true);
    stageMessageKeysRef.current = new Set();
    reactionCursorRef.current = 0;
    resetSpeechRuntime();

    const runProject = project;
    const runSelectedFiles = runProject?.rootPath ? selectedFiles : [];
    const runId =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `auto-${Date.now()}`;
    currentRunRef.current = runId;
    const effectiveInput = !runProject?.rootPath && taskTitle.trim()
      ? [`PROJECT_TITLE: ${taskTitle.trim()}`, codeInput].filter(Boolean).join("\n\n")
      : codeInput;
    const runStartMessage = runProject?.rootPath
      ? "Autonomous run queued. The backend runner will work inside this sandbox."
      : "Autonomous run queued. The backend runner will create output files inside a new sandbox.";

    setAutonomyRun({
      runId,
      status: "queued",
      maxRuntimeMs: 8 * 60 * 60 * 1000,
      lastStage: "queued",
      message: runStartMessage,
      updatedAt: new Date().toISOString()
    });
    setDecisionMessage(runStartMessage);
    setDecisionPreview([]);
    setActiveTab("architect");
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
      currentStage: "autonomy-queued",
      decisionStatus: "pending",
      currentPhase: "Planning",
      currentTask: "Backend autonomy queue",
      projectStatus: "Queued",
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
        maxRuntimeMinutes: 480
      });
      setAutonomyRun((current) => ({
        ...(current || {}),
        ...(queuedRun || {}),
        message: runStartMessage
      }));
      void syncAutonomyRunStatus(runId, { silent: true });
    } catch (runError) {
      setIsRunning(false);
      setIsAutonomyRunning(false);
      setAutonomyRun((current) => ({
        ...(current || {}),
        status: "failed",
        error: runError?.message || "Autonomous run failed to start."
      }));
      setError(runError?.message || "Autonomous run failed to start.");
      setDecisionMessage(runError?.message || "Autonomous run failed to start.");
    }
  }

  async function stopAutonomousRun() {
    const runId = autonomyRun?.runId || currentRunRef.current;
    if (!runId) {
      return;
    }

    try {
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
      }
    } catch (stopError) {
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
          ? `Cycle accepted. Proceed to ${planState.currentPhase}.`
          : (result?.executor?.applied?.length
              ? "Cycle finished. Junior Dev file operations were already applied."
              : "Cycle finished. No files were changed.")
      );
      pushNotification({
        type: "success",
        title: advancePhase ? "Phase ready" : "Cycle finished",
        message: advancePhase
          ? `Ready for ${planState.currentPhase || "the next phase"}.`
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
      setProject(reopened);
      setResultProject(null);
      setSelectedFiles(reopened.defaultSelectedFiles || []);
      setContextDocuments(reopened.fsd?.documents || []);
      setCommandLog(reopened.commandHistory || []);
      setProjectProcesses(reopened.processes || []);
      setProcessLogView(null);
      const persistedAutonomy = reopened.autonomyState || entry.autonomyState || null;
      currentRunRef.current = persistedAutonomy?.runId || "";
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
            onTabChange={setActiveTab}
            onDecisionReason={setDecisionReason}
        onAccept={finishCycle}
        onAcceptAndApply={previewAndApply}
        onAdvanceCycle={proceedToNextPhase}
        onNeedsPatch={denyDecision}
        onDiscardOutput={discardOutputDecision}
      />
        ) : null}

        {activeView === "reports" ? <ReportsView result={result} testerResult={testerResult} /> : null}
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
  onDiscardOutput
}) {
  const activeAgentId = getVisibleActiveAgentId(agents, activeMessage, isRunning);
  const displayAgents = agents.map((agent) => ({
    ...agent,
    status: getDisplayAgentStatus(agent, activeMessage)
  }));
  const focusedSpeakerId = activeMessage && isImportantVisualMessage(activeMessage) ? activeAgentId : "";
  const showCycleReview = shouldShowCycleReview({ result, workflow, isRunning });
  const [isCycleReviewOpen, setIsCycleReviewOpen] = useState(false);
  const lastOpenedReviewKey = useRef("");
  const reviewKey = `${workflow?.loopCount || 0}:${workflow?.decisionStatus || ""}:${result?.decision?.summary || ""}`;
  const nextPhase = getUpcomingPhaseName(result?.project?.phases || []);
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
          <button className="primary-button" type="button" onClick={onRun} disabled={!canRun}>
            {isRunning ? <Loader2 size={18} className="spin" /> : <Play size={18} />}
            Run
          </button>
        </div>
      </header>

      {autonomyRun?.runId ? (
        <AutonomyStatusCard
          autonomyRun={autonomyRun}
          isRunning={isAutonomyRunning}
          workflow={workflow}
          result={result}
          isDecisionBusy={isDecisionBusy}
          canContinue={Boolean(nextPhase) && !needsPatch}
          onOpenChanges={openChangesReview}
          onContinue={onAdvanceCycle}
          onDeny={onNeedsPatch}
          onEnd={onAccept}
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
  isDecisionBusy,
  onTabChange,
  onDecisionReason,
  onAccept,
  onAcceptAndApply,
  onAdvanceCycle,
  onNeedsPatch,
  onDiscardOutput,
  onOpenProcessUrl,
  onStopProcess,
  onRestartProcess,
  onViewProcessLog
}) {
  return (
    <section className="output-section" aria-label="Output Bin">
      <div className="output-section-header">
        <div>
          <p className="eyebrow">Output Bin</p>
          <h2>Review cycle</h2>
        </div>
        <div className="workflow-meta">
          <span>Stage: {workflow.currentStage}</span>
          <span>Loop: {workflow.loopCount}</span>
          {workflow.currentPhase ? <span>Phase: {workflow.currentPhase}</span> : null}
          {workflow.currentTask ? <span>Task: {workflow.currentTask}</span> : null}
          {workflow.commandStatus ? <span>Command: {workflow.commandStatus}</span> : null}
          <span>Decision: {workflow.decisionStatus}</span>
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
          <TasksPanel phases={result?.project?.phases} tasks={result?.project?.tasks} />
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
            workflow={workflow}
            decisionPreview={decisionPreview}
            decisionReason={decisionReason}
            decisionMessage={decisionMessage}
            isDecisionBusy={isDecisionBusy}
            onDecisionReason={onDecisionReason}
            onAccept={onAccept}
            onAcceptAndApply={onAcceptAndApply}
            onAdvanceCycle={onAdvanceCycle}
            onNeedsPatch={onNeedsPatch}
            onDiscardOutput={onDiscardOutput}
          />
        ) : null}
      </div>
    </section>
  );
}

function DecisionPanel({
  result,
  workflow,
  decisionPreview,
  decisionReason,
  decisionMessage,
  isDecisionBusy,
  onDecisionReason,
  onAccept,
  onAcceptAndApply,
  onAdvanceCycle,
  onNeedsPatch,
  onDiscardOutput
}) {
  const decision = result?.decision;
  const needsPatch = String(workflow?.decisionStatus || decision?.decisionStatus || "").toLowerCase() === "needs_patch";

  return (
    <div className="output-panel output-decision tone-green">
      <div className="output-panel-header">
        <span className="output-tab">Decision</span>
        <h2>Final review</h2>
      </div>

      <div className="decision-summary">
        <h3>Summary</h3>
        <p>{formatDecisionSummary(decision?.summary) || "No decision summary yet."}</p>
        {decision?.verdict ? (
          <>
            <h3>PM verdict</h3>
            <p>{formatDecisionSummary(decision.verdict)}</p>
          </>
        ) : null}
        {result?.project?.rootPath ? (
          <p className="project-path" title={result.project.rootPath}>
            {result.project.projectName || result.project.name || "Project"}: {result.project.rootPath}
          </p>
        ) : null}
      </div>

      <div className="decision-columns">
        <div>
          <h3>Affected Files</h3>
          <ul className="affected-files">
            {(decision?.affectedFiles || []).map((file) => (
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
            {(decision?.proposedChanges || []).map((item, index) => (
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

      <div className="decision-actions">
        <button className="primary-button" type="button" onClick={onAdvanceCycle} disabled={isDecisionBusy}>
          <Play size={16} />
          Proceed to Next Phase
        </button>
        <button className="secondary-button" type="button" onClick={onAccept} disabled={isDecisionBusy}>
          <CheckCircle2 size={16} />
          Finish Cycle
        </button>
        <button className="secondary-button" type="button" onClick={onNeedsPatch} disabled={isDecisionBusy}>
          <XCircle size={16} />
          Needs Patch
        </button>
        <button className="secondary-button danger" type="button" onClick={onDiscardOutput} disabled={isDecisionBusy}>
          <XCircle size={16} />
          Discard Output
        </button>
      </div>

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
    </div>
  );
}

function CycleReviewLauncher({ result, workflow, onOpen }) {
  const affectedFiles = result?.decision?.affectedFiles || [];
  const nextPhase = getUpcomingPhaseName(result?.project?.phases || []);
  const needsPatch = String(workflow?.decisionStatus || result?.decision?.decisionStatus || "").toLowerCase() === "needs_patch";

  return (
    <button className="cycle-review-launcher" type="button" onClick={onOpen} aria-label="Open cycle review">
      <span>
        <strong>{needsPatch ? "Patch required" : "Cycle ready"}</strong>
        <small>{affectedFiles.length} file(s) affected{nextPhase ? ` - Next: ${nextPhase}` : ""}</small>
      </span>
      <CheckCircle2 size={18} />
    </button>
  );
}

function CycleReviewCard({ result, workflow, isBusy, onAdvanceCycle, onFinishCycle, onNeedsPatch, onDiscardOutput, onClose }) {
  const affectedFiles = result?.decision?.affectedFiles || [];
  const nextPhase = getUpcomingPhaseName(result?.project?.phases || []);
  const needsPatch = String(workflow?.decisionStatus || result?.decision?.decisionStatus || "").toLowerCase() === "needs_patch";

  return (
    <section className="cycle-review-card" aria-label="Cycle review">
      <div className="cycle-review-header">
        <div>
          <p className="eyebrow">Cycle Review</p>
          <h2>{formatDecisionHeadline(result?.decision?.summary) || "Cycle finished and is ready for review."}</h2>
        </div>
        <div className="cycle-review-header-actions">
          <span className="cycle-review-badge">{workflow.currentPhase || result?.project?.phases?.[0]?.name || "Phase 1"}</span>
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
          <span>{nextPhase ? `Next: ${nextPhase}` : "No next phase planned"}</span>
        </div>
        <div className="decision-actions">
          <button className="primary-button" type="button" onClick={onAdvanceCycle} disabled={isBusy || !nextPhase || needsPatch}>
            <Play size={16} />
            Proceed to Next Phase
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

function TasksPanel({ phases = [], tasks = [] }) {
  return (
    <div className="output-panel tone-blue">
      <div className="output-panel-header">
        <span className="output-tab">Plan</span>
        <h2>Phases and tasks</h2>
      </div>
      <SectionList title="Phases" items={phases.map((phase) => `${phase.name} - ${phase.status}`)} />
      <SectionList title="Tasks" items={tasks.map((task) => `${task.phase}: ${task.title} - ${task.status}`)} />
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
            {activeProcess.healthUrl || activeProcess.stdoutLog || "No app URL detected yet."}
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
  canContinue,
  onOpenChanges,
  onContinue,
  onDeny,
  onEnd
}) {
  const status = autonomyRun?.status || "idle";
  const detail = autonomyRun?.message || autonomyRun?.error || autonomyRun?.lastStage || "Backend autonomy runner is idle.";
  const deadline = autonomyRun?.deadlineAt ? `Deadline: ${formatTimestamp(autonomyRun.deadlineAt)}` : "";
  const runtime = autonomyRun?.maxRuntimeMs ? `Limit: ${Math.round(autonomyRun.maxRuntimeMs / 60000)} min` : "";
  const decisionState = String(workflow?.decisionStatus || result?.decision?.decisionStatus || "").toLowerCase();
  const showDecisionActions = !isRunning && ["waiting_for_decision", "blocked"].includes(status);

  return (
    <section className={`autonomy-status-card ${isRunning ? "running" : ""}`} aria-label="Autonomy status">
      <div>
        <span className="output-tab">Autonomy</span>
        <strong>{formatAutonomyStatus(status)}</strong>
        <p>{detail}</p>
        {showDecisionActions ? (
          <div className="button-row">
            <button className="secondary-button" type="button" onClick={onOpenChanges} disabled={isDecisionBusy}>
              <Eye size={16} />
              Open Changes
            </button>
            <button className="primary-button" type="button" onClick={onContinue} disabled={isDecisionBusy || !canContinue}>
              <Play size={16} />
              Continue
            </button>
            <button className="secondary-button" type="button" onClick={onDeny} disabled={isDecisionBusy}>
              <XCircle size={16} />
              Deny
            </button>
            <button className="secondary-button danger" type="button" onClick={onEnd} disabled={isDecisionBusy || decisionState === "needs_patch"}>
              <CheckCircle2 size={16} />
              End
            </button>
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

function ReportsView({ result, testerResult }) {
  return (
    <section className="simple-view">
      <p className="eyebrow">Reports</p>
      <h1>Last pipeline result</h1>
      {testerResult ? (
        <div className="output-panel tone-blue">
          <div className="output-panel-header">
            <span className="output-tab">Tester</span>
            <h2>{formatAgentName(testerResult.agentId)} {testerResult.scenario}</h2>
          </div>
          <pre>{testerResult.output}</pre>
        </div>
      ) : null}
      <OutputBin
        result={result}
        activeTab="decision"
        workflow={result?.workflow || { currentStage: "idle", loopCount: 0, decisionStatus: "pending" }}
        decisionPreview={[]}
        decisionReason=""
        decisionMessage=""
        isDecisionBusy={false}
        onTabChange={() => { }}
        onDecisionReason={() => { }}
        onAccept={() => { }}
        onAcceptAndApply={() => { }}
        onAdvanceCycle={() => { }}
        onNeedsPatch={() => { }}
        onDiscardOutput={() => { }}
      />
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

function SettingsView({ settings, project, testerResult, isTesterRunning, agentNames, onRunTester, onSettingsChange, onAgentNamesChange }) {
  const [dialogueDraft, setDialogueDraft] = useState(() => buildDialogueDraft(settings?.agents));
  const [nameDraft, setNameDraft] = useState(() => ({
    juniorName: agentNames.junior || "",
    supervisorName: agentNames.supervisor || "",
    architectName: agentNames.architect || ""
  }));
  const [saveState, setSaveState] = useState("idle");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    setDialogueDraft(buildDialogueDraft(settings?.agents));
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

function shouldShowCycleReview({ result, workflow, isRunning }) {
  if (isRunning || !result?.decision?.summary) {
    return false;
  }

  return String(workflow?.decisionStatus || "pending").toLowerCase() === "pending";
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
    tasks: "Tasks",
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
      reason: match.error || ""
    };

    if (role.required) {
      required.push(entry);
      return;
    }

    optional.push(entry);
  });

  const requiredOffline = required.filter((entry) => entry.availability === "offline");
  const requiredUnknown = required.filter((entry) => entry.availability === "unknown");
  const optionalOffline = optional.filter((entry) => entry.availability !== "online");
  const warnings = [];
  if (optionalOffline.length > 0) {
    warnings.push("Senior Dev / QA is unavailable. The run will continue with deterministic verification and may end as needs_review.");
  }
  if (requiredUnknown.length > 0) {
    warnings.push(`${requiredUnknown.map((entry) => entry.name).join(" and ")} did not answer the quick availability check. Proceeding with the run attempt.`);
  }

  return {
    canRun: requiredOffline.length === 0,
    canRunWithWarnings: requiredOffline.length === 0 && (optionalOffline.length > 0 || requiredUnknown.length > 0),
    cannotRun: requiredOffline.length > 0,
    required,
    optional,
    warnings
  };
}

function classifyAvailabilityState(role, match) {
  if (match?.online) {
    return "online";
  }

  const reason = String(match?.error || "");
  if (role.required && /timed out after/i.test(reason)) {
    return "unknown";
  }

  return "offline";
}

function findAvailabilityEntry(availability, agentId) {
  return [...(availability?.required || []), ...(availability?.optional || [])].find((entry) => entry.id === agentId) || null;
}

function isSupervisorUnavailable(availability) {
  const supervisor = findAvailabilityEntry(availability, "supervisor");
  return Boolean(supervisor) && supervisor.required === false && supervisor.availability !== "online";
}

function buildAvailabilityMessage(availability) {
  const activeModels = [...availability.required, ...availability.optional]
    .filter((entry) => entry.availability === "online")
    .map((entry) => `${entry.name}: ${entry.model}`);
  const unavailableOptional = availability.optional
    .filter((entry) => entry.availability !== "online")
    .map((entry) => `${entry.name}: ${entry.model}`);
  const uncertainRequired = availability.required
    .filter((entry) => entry.availability === "unknown")
    .map((entry) => `${entry.name}: ${entry.model}`);

  const parts = [];
  if (activeModels.length > 0) {
    parts.push(`Active models: ${activeModels.join("; ")}.`);
  }
  if (unavailableOptional.length > 0) {
    parts.push(`Inactive optional models: ${unavailableOptional.join("; ")}.`);
  }
  if (uncertainRequired.length > 0) {
    parts.push(`Required model availability check timed out: ${uncertainRequired.join("; ")}. Proceeding with the run attempt.`);
  }
  if (availability.warnings.length > 0) {
    parts.push(availability.warnings.join(" "));
  }

  return parts.join(" ");
}

function isTerminalAutonomyStatus(status) {
  return ["completed", "needs_review", "failed", "stopped", "timed_out"].includes(String(status || "").trim().toLowerCase());
}

function formatAutonomyStatus(status) {
  return String(status || "idle")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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

  if (decision === "applied" || decision === "accepted" || value === "completed") {
    return "completed";
  }

  if (value === "waiting for decision" || decision === "pending") {
    return "waiting";
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
  const key = toLandingStatusKey(status, decisionStatus);
  if (key === "active") {
    return "In progress";
  }

  if (key === "waiting") {
    return "Waiting for decision";
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

  if (decisionStatus === "manual_review_required") {
    return "manual-review";
  }

  if (decisionStatus === "needs_patch") {
    return "correction-loop";
  }

  if (decisionStatus === "denied") {
    return "correction-loop";
  }

  if (String(status || "").toLowerCase() === "waiting for decision") {
    return "decision";
  }

  if (String(status || "").toLowerCase() === "in progress") {
    return "junior";
  }

  return "idle";
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

function shouldRunChatter({ isRunning, agents, activeMessage, isTyping, scene, messageQueue }) {
  if (scene) {
    return false;
  }

  if (activeMessage || isTyping) {
    return false;
  }

  if ((messageQueue || []).some((message) => message.priority === "high")) {
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
