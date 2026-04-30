import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  FileCode2,
  FolderOpen,
  History,
  Loader2,
  Play,
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

const OUTPUT_TABS = ["junior", "supervisor", "architect", "decision"];
const TYPEWRITER_WORD_MS = 42;
const TYPEWRITER_PUNCTUATION_PAUSE_MS = 180;
const AGENT_STATUS_KEYS = ["idle", "thinking", "speaking", "done", "error", "received"];
const JUNIOR_REACTION_MESSAGES = [
  "Got it, reviewing your changes...",
  "Ah, I see the issue now.",
  "Updating based on your feedback."
];

export function App() {
  const [activeView, setActiveView] = useState("office");
  const [activeTab, setActiveTab] = useState("junior");
  const [agentCatalog, setAgentCatalog] = useState(INITIAL_AGENTS);
  const [agents, setAgents] = useState(INITIAL_AGENTS);
  const [project, setProject] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [codeInput, setCodeInput] = useState("");
  const [language, setLanguage] = useState("auto");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [settings, setSettings] = useState(null);
  const [workflow, setWorkflow] = useState({
    folderLoaded: false,
    contextReady: false,
    currentStage: "idle",
    loopCount: 0,
    decisionStatus: "pending"
  });
  const [chatMessages, setChatMessages] = useState([]);
  const [activeMessageId, setActiveMessageId] = useState("");
  const [introMessageId, setIntroMessageId] = useState("");
  const [activeTypedText, setActiveTypedText] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionPreview, setDecisionPreview] = useState([]);
  const [decisionMessage, setDecisionMessage] = useState("");
  const [isDecisionBusy, setIsDecisionBusy] = useState(false);
  const currentRunRef = useRef(null);
  const stageMessageKeysRef = useRef(new Set());
  const reactionCursorRef = useRef(0);
  const introTimeoutRef = useRef(null);
  const chatScrollRef = useRef(null);
  const selectedFileSet = useMemo(() => new Set(selectedFiles), [selectedFiles]);
  const canRun =
    !isRunning &&
    (codeInput.trim().length > 0 || selectedFiles.length > 0);
  const activeMessage = chatMessages.find((message) => message.id === activeMessageId) || null;
  const messageByAgent = getAgentMessageMap(chatMessages, activeMessage, activeTypedText);

  useEffect(() => {
    window.trifix
      .getSettings()
      .then((nextSettings) => {
        setSettings(nextSettings);
        const nextAgents = toAgentList(nextSettings?.agents);
        setAgentCatalog(nextAgents);
        setAgents(nextAgents);
      })
      .catch(() => {});

    window.trifix
      .getLastResult()
      .then((cached) => cached && setResult(cached))
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

      if (progress.partialResult) {
        setResult((current) => mergePipelineResult(current, progress.partialResult));
        queueStageMessages(progress);
      }

      setAgents((currentAgents) =>
        currentAgents.map((agent) =>
          agent.id === progress.agent ? { ...agent, status: progress.status } : agent
        )
      );
    });
  }, []);

  useEffect(() => {
    if (activeMessageId || introMessageId) {
      return;
    }

    const nextMessage = chatMessages.find((message) => message.status === "queued");
    if (!nextMessage) {
      return;
    }

    if (nextMessage.introState) {
      setChatMessages((current) =>
        current.map((message) =>
          message.id === nextMessage.id ? { ...message, status: "intro" } : message
        )
      );
      setIntroMessageId(nextMessage.id);
      introTimeoutRef.current = setTimeout(() => {
        introTimeoutRef.current = null;
        setChatMessages((current) =>
          current.map((message) =>
            message.id === nextMessage.id ? { ...message, status: "typing" } : message
          )
        );
        setIntroMessageId("");
        setActiveMessageId(nextMessage.id);
      }, nextMessage.introDelayMs || 420);
      return;
    }

    setChatMessages((current) =>
      current.map((message) =>
        message.id === nextMessage.id ? { ...message, status: "typing" } : message
      )
    );
    setActiveMessageId(nextMessage.id);
  }, [chatMessages, activeMessageId, introMessageId]);

  useEffect(() => {
    if (!chatScrollRef.current) {
      return;
    }

    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages, activeMessageId, activeTypedText, introMessageId]);

  useEffect(() => {
    if (activeMessage?.from) {
      setActiveTab(activeMessage.from === "architect" ? "architect" : activeMessage.from);
      return;
    }

    if (introMessageId.includes("junior")) {
      setActiveTab("junior");
    }
  }, [activeMessage, introMessageId]);

  useEffect(
    () => () => {
      if (introTimeoutRef.current) {
        clearTimeout(introTimeoutRef.current);
      }
    },
    []
  );

  function queueStageMessages(progress) {
    if (progress.status !== "speaking") {
      return;
    }

    const stageKey = `${progress.runId}:${progress.agent}`;
    if (stageMessageKeysRef.current.has(stageKey)) {
      return;
    }

    stageMessageKeysRef.current.add(stageKey);

    const nextMessages = buildStageMessages(progress, reactionCursorRef.current);
    if (nextMessages.some((message) => message.role === "reaction")) {
      reactionCursorRef.current += 1;
    }

    setChatMessages((current) => [...current, ...nextMessages]);
  }

  function handleTypewriterRender(messageId, text) {
    if (messageId === activeMessageId) {
      setActiveTypedText(text);
    }
  }

  function handleTypewriterComplete(messageId) {
    setChatMessages((current) =>
      current.map((message) =>
        message.id === messageId ? { ...message, status: "done", renderedText: message.message } : message
      )
    );
    setActiveTypedText("");
    setActiveMessageId((current) => (current === messageId ? "" : current));
  }

  async function openProject() {
    setError("");
    const openedProject = await window.trifix.openProject();

    if (!openedProject) {
      return;
    }

    const defaults = openedProject.defaultSelectedFiles || [];
    setProject(openedProject);
    setSelectedFiles(defaults);
    setDecisionPreview([]);
    setDecisionMessage("");
    setWorkflow((current) => ({
      ...current,
      folderLoaded: true,
      contextReady: defaults.length > 0,
      currentStage: "context-ready"
    }));
  }

  async function refreshProject() {
    if (!project?.rootPath) {
      return;
    }

    setError("");
    const refreshed = await window.trifix.refreshProject(project.rootPath);
    const defaults = refreshed.defaultSelectedFiles || [];
    setProject(refreshed);
    setSelectedFiles((paths) => {
      const next = paths.filter((path) => hasPath(refreshed.tree, path));
      return next.length > 0 ? next : defaults;
    });
    setWorkflow((current) => ({
      ...current,
      folderLoaded: true,
      contextReady: true,
      currentStage: "context-ready"
    }));
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

  async function runOffice(nextLoopCount = workflow.loopCount, feedback = "") {
    if (!canRun && !feedback) {
      return;
    }

    setError("");
    setIsRunning(true);
    stageMessageKeysRef.current = new Set();
    reactionCursorRef.current = 0;
    if (introTimeoutRef.current) {
      clearTimeout(introTimeoutRef.current);
      introTimeoutRef.current = null;
    }

    let runProject = project;
    let runSelectedFiles = selectedFiles;

    try {
      if (!runProject?.rootPath) {
        runProject = await window.trifix.openSandboxProject();
        runSelectedFiles = [];
        setProject(runProject);
        setSelectedFiles([]);
        setActiveView("office");
        setWorkflow((current) => ({
          ...current,
          folderLoaded: true,
          contextReady: true,
          currentStage: "sandbox-ready"
        }));
      }

      const runId =
        typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
      currentRunRef.current = runId;

      setDecisionMessage("");
      setDecisionPreview([]);
      setActiveTab("junior");
      setResult(null);
      setChatMessages([]);
      setActiveMessageId("");
      setIntroMessageId("");
      setActiveTypedText("");
      setAgents(agentCatalog.map((agent) => ({ ...agent, status: "idle" })));
      setWorkflow((current) => ({
        ...current,
        contextReady: true,
        currentStage: "junior",
        loopCount: nextLoopCount,
        decisionStatus: "pending"
      }));

      const nextResult = await window.trifix.runPipeline({
        runId,
        input: codeInput,
        language,
        projectRoot: runProject?.rootPath,
        selectedFiles: runSelectedFiles,
        feedback,
        loopCount: nextLoopCount
      });
      setResult(nextResult);
      setWorkflow({
        ...(nextResult.workflow || workflow),
        folderLoaded: Boolean(runProject?.rootPath),
        contextReady: true
      });
      setActiveTab("decision");
      setActiveView("office");
    } catch (runError) {
      setError(runError?.message || "Pipeline failed.");
      setWorkflow((current) => ({
        ...current,
        currentStage: "error"
      }));
      setAgents((currentAgents) =>
        currentAgents.map((agent) =>
          agent.status === "thinking" ? { ...agent, status: "error" } : agent
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
      await window.trifix.acceptDecision(result.decision);
      setWorkflow((current) => ({
        ...current,
        decisionStatus: "accepted",
        currentStage: "accepted"
      }));
      setDecisionMessage("Decision accepted. No files were changed.");
    } catch (acceptError) {
      setDecisionMessage(acceptError?.message || "Could not accept the decision.");
    } finally {
      setIsDecisionBusy(false);
    }
  }

  async function previewAndApply() {
    if (!project?.rootPath || !result?.architect?.patches?.length) {
      setDecisionMessage("No file patches are available to apply.");
      return;
    }

    setIsDecisionBusy(true);
    setDecisionMessage("");

    try {
      const previews = await window.trifix.previewApply({
        projectRoot: project.rootPath,
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
        projectRoot: project.rootPath,
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
      await refreshProject();
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
      return;
    }

    setWorkflow((current) => ({
      ...current,
      decisionStatus: "denied",
      currentStage: "correction-loop"
    }));

    await runOffice(workflow.loopCount + 1, reason);
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
            <span>Tiny Office</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          <SidebarButton
            active={activeView === "task"}
            icon={<TerminalSquare size={18} />}
            label="New Task"
            onClick={() => setActiveView("task")}
          />
          <SidebarButton
            active={activeView === "office"}
            icon={<BriefcaseBusiness size={18} />}
            label="Office"
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
          <span>VPN endpoint</span>
        </div>
      </aside>

      <main className="main-view">
        {activeView === "office" || activeView === "task" ? (
          <OfficeView
            agents={agents}
            project={project}
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
            introMessageId={introMessageId}
            activeTypedText={activeTypedText}
            chatScrollRef={chatScrollRef}
            onTypewriterRender={handleTypewriterRender}
            onTypewriterComplete={handleTypewriterComplete}
            activeTab={activeTab}
            decisionPreview={decisionPreview}
            decisionReason={decisionReason}
            decisionMessage={decisionMessage}
            isDecisionBusy={isDecisionBusy}
            messageByAgent={messageByAgent}
            onOpenProject={openProject}
            onRefreshProject={refreshProject}
            onToggleFile={toggleFile}
            onCodeInput={setCodeInput}
            onLanguage={setLanguage}
            onRun={() => runOffice(workflow.loopCount, "")}
            onTabChange={setActiveTab}
            onDecisionReason={setDecisionReason}
            onAccept={acceptDecision}
            onAcceptAndApply={previewAndApply}
            onDeny={denyDecision}
          />
        ) : null}

        {activeView === "reports" ? <ReportsView result={result} /> : null}
        {activeView === "settings" ? (
          <SettingsView
            settings={settings}
            project={project}
            onSettingsChange={(nextSettings) => {
              setSettings(nextSettings);
              const nextAgents = toAgentList(nextSettings?.agents);
              setAgentCatalog(nextAgents);
              setAgents((currentAgents) =>
                currentAgents.map((agent) => {
                  const updated = nextAgents.find((item) => item.id === agent.id) || agent;
                  return { ...updated, status: agent.status };
                })
              );
            }}
          />
        ) : null}
      </main>
    </div>
  );
}

function OfficeView({
  agents,
  project,
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
  introMessageId,
  activeTypedText,
  chatScrollRef,
  onTypewriterRender,
  onTypewriterComplete,
  activeTab,
  decisionPreview,
  decisionReason,
  decisionMessage,
  isDecisionBusy,
  messageByAgent,
  onOpenProject,
  onRefreshProject,
  onToggleFile,
  onCodeInput,
  onLanguage,
  onRun,
  onTabChange,
  onDecisionReason,
  onAccept,
  onAcceptAndApply,
  onDeny
}) {
  const activeAgentId = getVisibleActiveAgentId(agents, activeMessage, introMessageId, isRunning);
  const displayAgents = agents.map((agent) => ({
    ...agent,
    status: getDisplayAgentStatus(agent, activeMessage, introMessageId)
  }));

  return (
    <>
      <header className="workspace-header">
        <div>
          <p className="eyebrow">Tiny Office</p>
          <h1>Three AI developers, one compact review pass.</h1>
        </div>
        <button className="primary-button" type="button" onClick={onRun} disabled={!canRun}>
          {isRunning ? <Loader2 size={18} className="spin" /> : <Play size={18} />}
          Run Pipeline
        </button>
      </header>

      <section className="office-stage" aria-label="Developer agents">
        <div className="stage-backdrop" />
        {displayAgents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            chatMessage={messageByAgent[agent.id] || null}
            isActive={activeAgentId === agent.id}
            isDimmed={Boolean(activeAgentId) && activeAgentId !== agent.id && agent.status !== "done"}
          />
        ))}
      </section>

      <ChatPanel
        chatMessages={chatMessages}
        activeMessage={activeMessage}
        activeTypedText={activeTypedText}
        chatScrollRef={chatScrollRef}
        onTypewriterRender={onTypewriterRender}
        onTypewriterComplete={onTypewriterComplete}
      />

      <div className="context-banner">
        {workflow.folderLoaded && workflow.contextReady
          ? "All 3 AI developers have read the project context."
          : "Open a project folder to prepare shared context."}
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
              <h2>Issue, error, or request</h2>
            </div>
            <select value={language} onChange={(event) => onLanguage(event.target.value)}>
              {LANGUAGES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={codeInput}
            onChange={(event) => onCodeInput(event.target.value)}
            spellCheck="false"
            placeholder="Describe the issue, paste an error, or request a change..."
          />
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

function AgentCard({ agent, chatMessage, isActive, isDimmed }) {
  const StatusIcon = getStatusIcon(agent.status);
  const spritePath =
    agent.sprites?.[agent.status] ||
    (agent.status === "received" ? agent.sprites?.thinking : "") ||
    agent.sprites?.idle;
  const dialogue = chatMessage?.text || agent.dialogue?.[agent.status] || agent.dialogue?.idle || "";

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
          <span className={`status-pill ${agent.status}`}>
            <StatusIcon size={15} className={agent.status === "thinking" ? "spin" : ""} />
            {agent.status}
          </span>
        </div>
      </div>

      <div className="agent-stage">
        <div className="agent-avatar sprite-frame">
          {spritePath ? (
            <img src={spritePath} alt={`${agent.name} ${agent.status}`} className="agent-sprite" />
          ) : (
            <Bot size={22} />
          )}
        </div>
        {dialogue ? (
          <div className={`agent-dialogue ${chatMessage?.isTyping ? "is-typing" : ""}`}>
            "{dialogue}"
          </div>
        ) : null}
      </div>

      <div className="agent-footer">
        <p>{agent.summary}</p>
        <code>{agent.model}</code>
      </div>
    </article>
  );
}

function ChatPanel({
  chatMessages,
  activeMessage,
  activeTypedText,
  chatScrollRef,
  onTypewriterRender,
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
              className={`chat-message ${message.from} ${message.status === "typing" ? "is-active" : ""}`}
            >
              <div className="chat-head">
                <strong>{formatAgentName(message.from)}</strong>
                <span>{`${message.role} -> ${message.to}`}</span>
                <time>{message.timestamp}</time>
              </div>
              <div className="chat-body">
                {message.status === "typing" ? (
                  <>
                    <Typewriter
                      key={message.id}
                      text={message.message}
                      speed={TYPEWRITER_WORD_MS}
                      onRender={(text) => onTypewriterRender(message.id, text)}
                      onComplete={() => onTypewriterComplete(message.id)}
                    />
                    <TypingIndicator />
                  </>
                ) : message.status === "intro" ? (
                  <TypingIndicator label="reacting" />
                ) : (
                  message.renderedText || message.message
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function Typewriter({ text, speed = TYPEWRITER_WORD_MS, onComplete, onRender }) {
  const words = splitIntoWords(text);
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timeoutId = null;

    setVisibleCount(0);
    onRender?.("");

    function tick(index) {
      if (cancelled) {
        return;
      }

      const nextCount = index + 1;
      setVisibleCount(nextCount);
      onRender?.(joinVisibleWords(words, nextCount));

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
  }, [text, speed]);

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
            {capitalize(tab)}
          </button>
        ))}
      </div>

      <div className="output-grid single">
        {activeTab === "junior" ? (
          <OutputPanel
            title="Junior"
            content={joinSections([
              ["Analysis", result?.junior?.rationale],
              ["Recommendation", result?.junior?.recommendation]
            ])}
            tone="blue"
          />
        ) : null}
        {activeTab === "supervisor" ? (
          <OutputPanel
            title="Supervisor"
            content={joinSections([
              ["Critique", result?.supervisor?.critique],
              ["Suggested Changes", result?.supervisor?.suggestedChanges]
            ])}
            tone="red"
          />
        ) : null}
        {activeTab === "architect" ? (
          <OutputPanel
            title="Architect"
            content={joinSections([
              ["Summary", result?.architect?.summary],
              ["Rationale", result?.architect?.rationale],
              ["Recommendation", result?.architect?.recommendation]
            ])}
            codeContent={result?.architect?.fixedCode}
            tone="green"
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

function ReportsView({ result }) {
  return (
    <section className="simple-view">
      <p className="eyebrow">Reports</p>
      <h1>Last pipeline result</h1>
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

function SettingsView({ settings, project, onSettingsChange }) {
  const [dialogueDraft, setDialogueDraft] = useState(() => buildDialogueDraft(settings?.agents));
  const [saveState, setSaveState] = useState("idle");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    setDialogueDraft(buildDialogueDraft(settings?.agents));
  }, [settings]);

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

  return (
    <section className="simple-view">
      <p className="eyebrow">Settings</p>
      <h1>Runtime configuration</h1>
      <div className="settings-grid">
        <div className="settings-row">
          <span>Endpoint</span>
          <code>{settings?.endpoint || "Loading..."}</code>
        </div>
        <div className="settings-row">
          <span>Project</span>
          <code>{project?.rootPath || "No folder open"}</code>
        </div>
        {settings?.agents
          ? Object.values(settings.agents).map((agent) => (
              <div className="settings-row" key={agent.id}>
                <span>{agent.name}</span>
                <code>{`${agent.model} | ${agent.summary}${agent.speech?.prefix ? ` | says "${agent.speech.prefix}"` : ""}`}</code>
              </div>
            ))
          : null}
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
            <h2>{agent.name}</h2>
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
  if (status === "thinking") {
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

function toAgentList(agentsMap) {
  if (!agentsMap) {
    return INITIAL_AGENTS;
  }

  return Object.values(agentsMap).map((agent) => ({
    ...agent,
    status: "idle"
  }));
}

function buildStageMessages(progress, reactionIndex) {
  const { runId, agent, partialResult } = progress;
  const timestamp = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  if (agent === "junior") {
    return [
      {
        id: `${runId}:junior:message`,
        from: "junior",
        to: "supervisor",
        role: "observation",
        stage: "junior",
        timestamp,
        message: buildJuniorChatMessage(partialResult),
        status: "queued",
        renderedText: ""
      }
    ];
  }

  if (agent === "supervisor") {
    return [
      {
        id: `${runId}:supervisor:message`,
        from: "supervisor",
        to: "junior",
        role: "critique",
        stage: "supervisor",
        timestamp,
        message: buildSupervisorChatMessage(partialResult),
        status: "queued",
        renderedText: ""
      },
      {
        id: `${runId}:junior:reaction`,
        from: "junior",
        to: "supervisor",
        role: "reaction",
        stage: "reaction",
        timestamp,
        message: JUNIOR_REACTION_MESSAGES[reactionIndex % JUNIOR_REACTION_MESSAGES.length],
        status: "queued",
        renderedText: "",
        introState: "received",
        introDelayMs: 520
      }
    ];
  }

  if (agent === "architect") {
    return [
      {
        id: `${runId}:architect:message`,
        from: "architect",
        to: "team",
        role: "decision",
        stage: "architect",
        timestamp,
        message: buildArchitectChatMessage(partialResult),
        status: "queued",
        renderedText: ""
      }
    ];
  }

  return [];
}

function buildJuniorChatMessage(partialResult) {
  return firstNonEmpty([
    partialResult?.junior?.recommendation,
    partialResult?.junior?.rationale,
    partialResult?.explanation
  ]);
}

function buildSupervisorChatMessage(partialResult) {
  return firstNonEmpty([
    partialResult?.supervisor?.suggestedChanges,
    partialResult?.supervisor?.critique,
    partialResult?.critique
  ]);
}

function buildArchitectChatMessage(partialResult) {
  return firstNonEmpty([
    joinSections([
      ["Summary", partialResult?.architect?.summary],
      ["Decision", partialResult?.architect?.recommendation]
    ]),
    partialResult?.architect?.recommendation,
    partialResult?.recommendation
  ]);
}

function firstNonEmpty(values) {
  return values.find((value) => String(value || "").trim()) || "";
}

function getVisibleActiveAgentId(agents, activeMessage, introMessageId, isRunning) {
  if (activeMessage?.from) {
    return activeMessage.from;
  }

  if (introMessageId) {
    const introMessage = agents.find((agent) => introMessageId.includes(agent.id));
    return introMessage?.id || "";
  }

  if (!isRunning) {
    return "";
  }

  const activeAgent = agents.find((agent) => agent.status === "thinking" || agent.status === "speaking");
  return activeAgent?.id || "";
}

function getDisplayAgentStatus(agent, activeMessage, introMessageId) {
  if (activeMessage?.from === agent.id) {
    return "speaking";
  }

  if (introMessageId && introMessageId.includes(agent.id)) {
    return "received";
  }

  if (agent.status === "speaking") {
    return "thinking";
  }

  return agent.status;
}

function getAgentMessageMap(chatMessages, activeMessage, activeTypedText) {
  const map = {};

  for (const message of chatMessages) {
    if (message.status === "queued") {
      continue;
    }

    map[message.from] = {
      text:
        activeMessage?.id === message.id
          ? activeTypedText || ""
          : message.renderedText || message.message,
      isTyping: activeMessage?.id === message.id
    };
  }

  return map;
}

function mergePipelineResult(current, partial) {
  if (!partial) {
    return current;
  }

  const next = {
    ...(current || {}),
    ...partial
  };

  for (const key of ["junior", "supervisor", "architect", "decision", "workflow"]) {
    if (partial[key]) {
      next[key] = {
        ...(current?.[key] || {}),
        ...partial[key]
      };
    }
  }

  return next;
}

function buildDialogueDraft(agentsMap) {
  const draft = {};

  for (const [agentId, agent] of Object.entries(agentsMap || {})) {
    draft[agentId] = {
      idle: agent.dialogue?.idle || "",
      thinking: agent.dialogue?.thinking || "",
      speaking: agent.dialogue?.speaking || "",
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

function joinSections(sections) {
  return sections
    .filter(([, content]) => content)
    .map(([label, content]) => `${label}\n${content}`)
    .join("\n\n");
}

function formatAgentName(value) {
  if (value === "junior") {
    return "Junior";
  }

  if (value === "supervisor") {
    return "Supervisor";
  }

  if (value === "architect") {
    return "Architect";
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
    return speed + TYPEWRITER_PUNCTUATION_PAUSE_MS;
  }

  if (/[,:;]["')\]]*$/.test(word)) {
    return speed + Math.round(TYPEWRITER_PUNCTUATION_PAUSE_MS * 0.5);
  }

  return speed;
}
