import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  FileCode2,
  FilePlus2,
  FolderOpen,
  History,
  Loader2,
  Play,
  Bug,
  RefreshCw,
  Settings,
  Sparkles,
  TerminalSquare,
  TriangleAlert,
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
  const [activeView, setActiveView] = useState("office");
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
  const [isCommandRunning, setIsCommandRunning] = useState(false);
  const [testerResult, setTesterResult] = useState(null);
  const [isTesterRunning, setIsTesterRunning] = useState(false);
  const [scene, setScene] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [messageQueue, setMessageQueue] = useState([]);
  const [activeMessage, setActiveMessage] = useState(null);
  const [visibleBubble, setVisibleBubble] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionPreview, setDecisionPreview] = useState([]);
  const [decisionMessage, setDecisionMessage] = useState("");
  const [isDecisionBusy, setIsDecisionBusy] = useState(false);
  const currentRunRef = useRef(null);
  const stageMessageKeysRef = useRef(new Set());
  const messageSequenceRef = useRef(0);
  const reactionCursorRef = useRef(0);
  const agentStatusRef = useRef({});
  const typewriterDoneResolverRef = useRef(null);
  const messageProcessorTokenRef = useRef(0);
  const chatterTimeoutRef = useRef(null);
  const chatterReplyTimeoutRef = useRef(null);
  const chatterHardTimeoutRef = useRef(null);
  const chatScrollRef = useRef(null);
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
    window.trifix
      .getSettings()
      .then((nextSettings) => {
        setSettings(nextSettings);
        const nextAgents = toAgentList(nextSettings?.agents, agentNames);
        setAgentCatalog(nextAgents);
        setAgents(nextAgents);
      })
      .catch(() => {});

    window.trifix
      .getLastResult()
      .then((cached) => cached && setResult(cached))
      .catch(() => {});

    window.trifix
      .listProjects()
      .then((items) => setTrackedProjects(items || []))
      .catch(() => {});

    return window.trifix.onPipelineProgress((progress) => {
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

      setAgents((currentAgents) =>
        currentAgents.map((agent) =>
          agent.id === progress.agent
            ? { ...agent, status: mapProgressStatus(progress.agent, progress.status) }
            : agent
        )
      );
    });
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
    } catch {}
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
    setDecisionPreview([]);
    setDecisionMessage("");
    setWorkflow((current) => ({
      ...current,
      folderLoaded: true,
      contextReady: defaults.length > 0,
      currentStage: "context-ready"
    }));
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
        projectStatus: entry.status === "passed" ? "Command passed" : "Command failed"
      }));
      setDecisionMessage(`${entry.command} ${entry.status}.`);
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

    try {
      if (!runProject?.rootPath) {
        runSelectedFiles = [];
        setActiveView("office");
        setWorkflow((current) => ({
          ...current,
          folderLoaded: false,
          contextReady: true,
          currentStage: "pm-plan"
        }));
      }

      const runId =
        typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
      currentRunRef.current = runId;
      setResultProject(runProject?.rootPath ? runProject : null);
      setContextDocuments((current) => current.length > 0 ? current : runProject?.fsd?.documents || []);

      setDecisionMessage("");
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
        currentStage: "pm-plan",
        loopCount: nextLoopCount,
        decisionStatus: "pending",
        currentPhase: "Planning",
        currentTask: "PM scoping",
        iterationCount: nextLoopCount,
        projectStatus: "In progress",
        commandStatus: "idle"
      }));

      const nextResult = await window.trifix.runPipeline({
        runId,
        input: codeInput,
        language,
        projectRoot: runProject?.rootPath,
        projectId: runProject?.projectId,
        projectName: runProject?.name || runProject?.rootPath?.split(/[\\/]/).pop(),
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
        setProject(generatedProject);
        setResultProject(generatedProject);
        setSelectedFiles(generatedProject.defaultSelectedFiles || []);
        setContextDocuments((current) => current.length > 0 ? current : generatedProject.fsd?.documents || []);
        setCommandLog(generatedProject.commandHistory || []);
      } else {
        setResultProject(runProject?.rootPath ? runProject : null);
      }
      setResult(nextResult);
      setWorkflow({
        ...(nextResult.workflow || workflow),
        folderLoaded: Boolean(generatedProject?.rootPath || runProject?.rootPath),
        contextReady: true
      });
      setActiveTab("decision");
      setActiveView("office");
      await refreshTrackedProjects();
    } catch (runError) {
      setError(runError?.message || "Pipeline failed.");
      setDecisionMessage(runError?.message || "Pipeline failed.");
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

  async function acceptDecision() {
    if (!result?.decision) {
      return;
    }

    setIsDecisionBusy(true);
    setDecisionMessage("");
    try {
      clearSpeechQueue();
      setAgents((currentAgents) => currentAgents.map((agent) => ({ ...agent, status: "idle" })));
      setScene({ type: "success", message: SUCCESS_SCENE_MESSAGE });
      await wait(520);
      setAgents((currentAgents) => currentAgents.map((agent) => ({ ...agent, status: "done" })));
      await window.trifix.acceptDecision({
        ...result.decision,
        projectId: resultProject?.projectId || project?.projectId,
        affectedFiles: result?.decision?.affectedFiles || []
      });
      setWorkflow((current) => ({
        ...current,
        decisionStatus: "accepted",
        currentStage: "accepted"
      }));
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
        result?.executor?.applied?.length
          ? "Decision accepted. DEV file operations were already applied."
          : "Decision accepted. No files were changed."
      );
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
        `Applied ${applied.applied.length} file(s): ${createdCount} new, ${updatedCount} updated.${
          applied.backupRoot ? ` Backup: ${applied.backupRoot}` : ""
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

  async function startNewTask() {
    resetTaskState({ clearProjectSelection: true });
    setActiveView("task");
    setProject(null);
    setResultProject(null);
    setContextDocuments([]);
    setCommandLog([]);
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
      setWorkflow((current) => ({
        ...current,
        folderLoaded: true,
        contextReady: (reopened.defaultSelectedFiles || []).length > 0,
        currentStage: mapTrackedStatusToStage(entry?.status, entry?.decisionStatus),
        loopCount: Number(entry?.loopCount || 0),
        decisionStatus: entry?.decisionStatus || "pending"
      }));
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

  return (
    <div className="app-shell">
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
            active={activeView === "task"}
            icon={<TerminalSquare size={18} />}
            label="New Task"
            onClick={startNewTask}
          />
          <SidebarButton
            active={activeView === "office"}
            icon={<BriefcaseBusiness size={18} />}
            label="Office"
            onClick={() => setActiveView("office")}
          />
          <SidebarButton
            active={activeView === "projects"}
            icon={<FolderOpen size={18} />}
            label="Projects"
            onClick={() => setActiveView("projects")}
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

      <main className="main-view">
        {activeView === "office" || activeView === "task" ? (
          <OfficeView
            agents={agents}
            agentNameMap={agentNameMap}
            project={project}
            contextDocuments={contextDocuments}
            commandLog={commandLog}
            selectedFiles={selectedFiles}
            selectedFileSet={selectedFileSet}
            codeInput={codeInput}
            language={language}
            result={result}
            error={error}
            isRunning={isRunning}
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
            onUploadContext={uploadContextDocuments}
            onToggleFile={toggleFile}
            onCodeInput={setCodeInput}
            onLanguage={setLanguage}
            onRun={() => runOffice(workflow.loopCount, "")}
            onRunProject={() => runProjectControl("run")}
            onDebugProject={() => runProjectControl("debug")}
            onAddInstruction={addInstruction}
            onRunTester={runAgentCapabilityTest}
            isCommandRunning={isCommandRunning}
            isTesterRunning={isTesterRunning}
            onTabChange={setActiveTab}
            onDecisionReason={setDecisionReason}
            onAccept={acceptDecision}
            onAcceptAndApply={previewAndApply}
            onDeny={denyDecision}
          />
        ) : null}

        {activeView === "reports" ? <ReportsView result={result} testerResult={testerResult} /> : null}
        {activeView === "projects" ? (
          <ProjectsView
            entries={trackedProjects}
            agentNameMap={agentNameMap}
            onContinue={continueTrackedProject}
            onOpenFolder={(folderPath) => window.trifix.openFolderPath(folderPath)}
            onRemove={removeTrackedProject}
          />
        ) : null}
        {activeView === "settings" ? (
          <SettingsView
            settings={settings}
            project={project}
            agentNames={agentNames}
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
    </div>
  );
}

function OfficeView({
  agents,
  agentNameMap,
  project,
  contextDocuments,
  commandLog = [],
  selectedFiles,
  selectedFileSet,
  codeInput,
  language,
  result,
  error,
  isRunning,
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
  onUploadContext,
  onToggleFile,
  onCodeInput,
  onLanguage,
  onRun,
  onRunProject,
  onDebugProject,
  onAddInstruction,
  onRunTester,
  isCommandRunning,
  isTesterRunning,
  onTabChange,
  onDecisionReason,
  onAccept,
  onAcceptAndApply,
  onDeny
}) {
  const activeAgentId = getVisibleActiveAgentId(agents, activeMessage, isRunning);
  const displayAgents = agents.map((agent) => ({
    ...agent,
    status: getDisplayAgentStatus(agent, activeMessage)
  }));
  const focusedSpeakerId = activeMessage && isImportantVisualMessage(activeMessage) ? activeAgentId : "";

  return (
    <>
      <header className="workspace-header">
        <div>
          <p className="eyebrow">AI Software Team Simulator V2</p>
          <h1>PM, QA, and DEV working through one software workflow.</h1>
        </div>
        <div className="button-row">
          <button className="secondary-button" type="button" onClick={onRunProject} disabled={isCommandRunning || !project?.rootPath}>
            {isCommandRunning ? <Loader2 size={18} className="spin" /> : <Play size={18} />}
            Run Project
          </button>
          <button className="secondary-button" type="button" onClick={onDebugProject} disabled={isCommandRunning || !project?.rootPath}>
            <Bug size={18} />
            Debug Project
          </button>
          <button className="secondary-button" type="button" onClick={onAddInstruction}>
            <FilePlus2 size={18} />
            Add Instruction
          </button>
          <button className="secondary-button" type="button" onClick={onRunTester} disabled={isTesterRunning}>
            {isTesterRunning ? <Loader2 size={18} className="spin" /> : <TerminalSquare size={18} />}
            Test Models
          </button>
          <button className="primary-button" type="button" onClick={onRun} disabled={!canRun}>
            {isRunning ? <Loader2 size={18} className="spin" /> : <Play size={18} />}
            Run Team
          </button>
        </div>
      </header>

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

      <ChatPanel
        chatMessages={chatMessages}
        agentNameMap={agentNameMap}
        chatScrollRef={chatScrollRef}
        onTypewriterComplete={onTypewriterComplete}
      />

      <div className="context-banner">
        {decisionMessage || (selectedFiles.length > 0
          ? "PM, QA, and DEV are using only queued files plus summarized uploaded context."
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
            placeholder="Paste an FSD, product request, bug report, or instruction for the Project Manager..."
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
        onDeny={onDeny}
      />
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
      className={`agent-card ${agent.color} status-${agent.status} ${isActive ? "is-active" : ""} ${
        isDimmed ? "is-dimmed" : ""
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

function ChatPanel({
  chatMessages,
  agentNameMap,
  chatScrollRef,
  onTypewriterComplete
}) {
  return (
    <section className="chat-panel" aria-label="Agent chat">
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
              className={`chat-message ${message.from} ${message.type === "chatter" ? "is-chatter" : ""} ${
                message.status === "typing" ? "is-active" : ""
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
      return () => {};
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
      return () => {};
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
  onDeny
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
            title="DEV"
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
            title="QA"
            content={joinSections([
              ["Review", result?.supervisor?.critique],
              ["Suggested Changes", result?.supervisor?.suggestedChanges],
              ["Instructions", result?.qa?.instructions]
            ])}
            tone="red"
          />
        ) : null}
        {activeTab === "architect" ? (
          <OutputPanel
            title="Project Manager"
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
          <CommandLogPanel commandLog={commandLog} result={result} />
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
            onDeny={onDeny}
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
  onDeny
}) {
  const decision = result?.decision;

  return (
    <div className="output-panel output-decision tone-green">
      <div className="output-panel-header">
        <span className="output-tab">Decision</span>
        <h2>Final review</h2>
      </div>

      <div className="decision-summary">
        <h3>Summary</h3>
        <p>{decision?.summary || "No decision summary yet."}</p>
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
          {result?.dev?.commandRequests?.length ? (
            <>
              <h3>DEV Command Requests</h3>
              <ul className="decision-list">
                {result.dev.commandRequests.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}
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
        <button className="secondary-button" type="button" onClick={onAccept} disabled={isDecisionBusy}>
          <CheckCircle2 size={16} />
          Accept
        </button>
        <button className="primary-button" type="button" onClick={onAcceptAndApply} disabled={isDecisionBusy}>
          {isDecisionBusy ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
          Accept and Apply
        </button>
        <button className="secondary-button danger" type="button" onClick={onDeny} disabled={isDecisionBusy}>
          <XCircle size={16} />
          Deny
        </button>
      </div>

      <label className="deny-reason">
        <span>Deny reason / correction feedback</span>
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
      {workflow.decisionStatus === "manual_review_required" ? (
        <div className="error-banner" role="alert">
          <TriangleAlert size={18} />
          <span>Manual review required.</span>
        </div>
      ) : null}
    </div>
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

function CommandLogPanel({ commandLog = [], result }) {
  const logs = commandLog.length > 0 ? commandLog : result?.project?.commandHistory || [];
  return (
    <div className="output-panel tone-red">
      <div className="output-panel-header">
        <span className="output-tab">Logs</span>
        <h2>Command history</h2>
      </div>
      {logs.length > 0 ? (
        <div className="command-log-list">
          {logs.map((entry) => (
            <div className="command-log-card" key={entry.id || `${entry.command}-${entry.startedAt}`}>
              <strong>{entry.command}</strong>
              <span>{entry.status} {typeof entry.exitCode !== "undefined" ? `(exit ${entry.exitCode})` : ""}</span>
              <pre>{entry.output || "No output captured."}</pre>
            </div>
          ))}
        </div>
      ) : (
        <p>No commands have been run yet.</p>
      )}
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
        onTabChange={() => {}}
        onDecisionReason={() => {}}
        onAccept={() => {}}
        onAcceptAndApply={() => {}}
        onDeny={() => {}}
      />
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

function SettingsView({ settings, project, agentNames, onSettingsChange, onAgentNamesChange }) {
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
          <span>QA endpoint</span>
          <code>{settings?.endpoints?.qa || settings?.endpoint || "Loading..."}</code>
        </div>
        <div className="settings-row">
          <span>DEV endpoint</span>
          <code>{settings?.endpoints?.dev || "Loading..."}</code>
        </div>
        <div className="settings-row">
          <span>PM endpoint</span>
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
                  junior: agentNames.junior || "DEV",
                  supervisor: agentNames.supervisor || "QA",
                  architect: agentNames.architect || "PROJECT MANAGER"
                })}</span>
                <code>{`${agent.model} | ${agent.endpoint} | ${agent.summary}${agent.speech?.prefix ? ` | says "${agent.speech.prefix}"` : ""}`}</code>
              </div>
            ))
          : null}
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
          ["juniorName", "DEV"],
          ["supervisorName", "QA"],
          ["architectName", "PROJECT MANAGER"]
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
              junior: agentNames.junior || "DEV",
              supervisor: agentNames.supervisor || "QA",
              architect: agentNames.architect || "PROJECT MANAGER"
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
        id: `${runId}:${progress.stage || "dev-implementation"}:junior:message`,
        from: "junior",
        to: "supervisor",
        role: "implementation",
        stage: progress.stage || "dev-implementation",
        timestamp,
        message: juniorMessage.detailsText,
        bubbleText: juniorMessage.bubbleText,
        detailsText: juniorMessage.detailsText,
        detailLabel: "Show DEV notes",
        status: "queued",
        renderedText: ""
      }
    ];
  }

  if (agent === "supervisor") {
    const supervisorMessage = buildSupervisorChatMessage(partialResult);
    return [
      {
        id: `${runId}:${progress.stage || "qa-review"}:supervisor:message`,
        from: "supervisor",
        to: progress.stage === "qa-scope" ? "junior" : "architect",
        role: progress.stage === "qa-scope" ? "qa instruction" : "qa review",
        stage: progress.stage || "qa-review",
        timestamp,
        message: supervisorMessage.detailsText,
        bubbleText: supervisorMessage.bubbleText,
        detailsText: supervisorMessage.detailsText,
        detailLabel: "Show QA notes",
        startDelayMs: STAGE_DELAY,
        status: "queued",
        renderedText: ""
      },
      {
        id: `${runId}:${progress.stage || "qa-review"}:junior:reaction`,
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
        id: `${runId}:${progress.stage || "pm-decision"}:architect:message`,
        from: "architect",
        to: "team",
        role: progress.stage === "pm-plan" ? "planning" : "decision",
        stage: progress.stage || "pm-decision",
        timestamp,
        message: architectMessage.detailsText,
        bubbleText: architectMessage.bubbleText,
        detailsText: architectMessage.detailsText,
        detailLabel: "Show PM notes",
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
    bubbleText: toBulletSummary(detailsText || "QA is checking this against the PRD.", 4),
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
    fsd: resultProject.fsd || fallbackProject?.fsd || null
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
    architect: "PM",
    supervisor: "QA",
    junior: "DEV",
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
    return "DEV";
  }

  if (value === "supervisor") {
    return "QA";
  }

  if (value === "architect") {
    return "PROJECT MANAGER";
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

function mapProgressStatus(agentId, status) {
  if (status === "coding" && agentId === "architect") {
    return "thinking";
  }

  return status;
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
    ["idle", "waiting", "thinking", "coding", "installing", "testing", "unpacking"].includes(agent.status)
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
