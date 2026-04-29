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
  TriangleAlert
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

export function App() {
  const [activeView, setActiveView] = useState("office");
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
  const currentRunRef = useRef(null);

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
    window.trifix.getLastResult().then((cached) => cached && setResult(cached)).catch(() => {});

    return window.trifix.onPipelineProgress((progress) => {
      if (progress.runId !== currentRunRef.current) {
        return;
      }

      setAgents((currentAgents) =>
        currentAgents.map((agent) =>
          agent.id === progress.agent ? { ...agent, status: progress.status } : agent
        )
      );
    });
  }, []);

  const selectedFileSet = useMemo(() => new Set(selectedFiles), [selectedFiles]);
  const canRun = !isRunning && (codeInput.trim().length > 0 || selectedFiles.length > 0);

  async function openProject() {
    setError("");
    const openedProject = await window.trifix.openProject();

    if (!openedProject) {
      return;
    }

    setProject(openedProject);
    setSelectedFiles([]);
  }

  async function refreshProject() {
    if (!project?.rootPath) {
      return;
    }

    setError("");
    const refreshed = await window.trifix.refreshProject(project.rootPath);
    setProject(refreshed);
    setSelectedFiles((paths) => paths.filter((path) => hasPath(refreshed.tree, path)));
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

  async function runOffice() {
    if (!canRun) {
      return;
    }

    const runId =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    currentRunRef.current = runId;
    setIsRunning(true);
    setError("");
    setResult(null);
    setAgents(agentCatalog.map((agent) => ({ ...agent, status: "idle" })));

    try {
      const nextResult = await window.trifix.runPipeline({
        runId,
        input: codeInput,
        language,
        projectRoot: project?.rootPath,
        selectedFiles
      });
      setResult(nextResult);
      setActiveView("office");
    } catch (runError) {
      setError(runError?.message || "Pipeline failed.");
      setAgents((currentAgents) =>
        currentAgents.map((agent) =>
          agent.status === "thinking" ? { ...agent, status: "error" } : agent
        )
      );
    } finally {
      setIsRunning(false);
    }
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
            onOpenProject={openProject}
            onRefreshProject={refreshProject}
            onToggleFile={toggleFile}
            onCodeInput={setCodeInput}
            onLanguage={setLanguage}
            onRun={runOffice}
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
  onOpenProject,
  onRefreshProject,
  onToggleFile,
  onCodeInput,
  onLanguage,
  onRun
}) {
  const activeAgentId = getActiveAgentId(agents, isRunning);

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
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            isActive={activeAgentId === agent.id}
            isDimmed={Boolean(activeAgentId) && activeAgentId !== agent.id && agent.status !== "done"}
          />
        ))}
      </section>

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
              <h2>Code or error</h2>
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
            placeholder="Paste a stack trace, function, component, SQL query, or failing test output..."
          />
        </div>

        <div className="files-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Project</p>
              <h2>Selected files</h2>
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
              <span>No project folder open</span>
            </div>
          )}
        </div>
      </section>

      <OutputPanels result={result} />
    </>
  );
}

function AgentCard({ agent, isActive, isDimmed }) {
  const StatusIcon = getStatusIcon(agent.status);
  const spritePath = agent.sprites?.[agent.status] || agent.sprites?.idle;
  const dialogue = agent.dialogue?.[agent.status] || agent.dialogue?.idle || "";

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
        {dialogue ? <div className="agent-dialogue">"{dialogue}"</div> : null}
      </div>

      <div className="agent-footer">
        <p>{agent.summary}</p>
        <code>{agent.model}</code>
      </div>
    </article>
  );
}

function OutputPanels({ result }) {
  if (!result) {
    return (
      <section className="output-section">
        <div className="output-section-header">
          <p className="eyebrow">Reports</p>
          <h2>Office output</h2>
        </div>
        <div className="empty-output">
          <Code2 size={28} />
          <span>Results will appear here after the pipeline finishes.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="output-section" aria-label="Pipeline output">
      <div className="output-section-header">
        <p className="eyebrow">Reports</p>
        <h2>Office output</h2>
      </div>
      <div className="output-grid">
        <OutputPanel title="Explanation" content={result.explanation} tone="blue" />
        <OutputPanel title="Critique" content={result.critique} tone="red" />
        <OutputPanel title="Fixed Code" content={result.fixedCode} code tone="green" />
        <OutputPanel title="Final Recommendation" content={result.recommendation} tone="green" />
        <div className="output-panel output-files">
          <div className="output-panel-header">
            <span className="output-tab">Files</span>
            <h2>Files Affected</h2>
          </div>
          {result.filesAnalyzed?.length ? (
            <ul className="affected-files">
              {result.filesAnalyzed.map((file) => (
                <li key={file.path}>
                  <FileCode2 size={16} />
                  <span>{file.path}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Snippet-only run</p>
          )}
        </div>
      </div>
    </section>
  );
}

function OutputPanel({ title, content, code = false, tone = "blue" }) {
  return (
    <div className={`output-panel ${code ? "code-panel" : ""} tone-${tone}`}>
      <div className="output-panel-header">
        <span className="output-tab">{title}</span>
        <h2>{title}</h2>
      </div>
      {code ? (
        <pre>
          <code>{content || "No fixed code returned."}</code>
        </pre>
      ) : (
        <p>{content || "No content returned."}</p>
      )}
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
      <OutputPanels result={result} />
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
            {["idle", "thinking", "speaking", "done", "error"].map((status) => (
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
        {saveError ? <div className="error-banner" role="alert"><TriangleAlert size={18} /><span>{saveError}</span></div> : null}
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

  if (status === "done") {
    return CheckCircle2;
  }

  if (status === "error") {
    return TriangleAlert;
  }

  return Bot;
}

function hasPath(nodes, path) {
  for (const node of nodes || []) {
    if (node.path === path) {
      return true;
    }

    if (node.children && hasPath(node.children, path)) {
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

function buildDialogueDraft(agentsMap) {
  const draft = {};

  for (const [agentId, agent] of Object.entries(agentsMap || {})) {
    draft[agentId] = {
      idle: agent.dialogue?.idle || "",
      thinking: agent.dialogue?.thinking || "",
      speaking: agent.dialogue?.speaking || "",
      done: agent.dialogue?.done || "",
      error: agent.dialogue?.error || ""
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
