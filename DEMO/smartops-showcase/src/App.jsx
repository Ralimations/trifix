import { useEffect, useMemo, useState } from "react";

const navItems = ["Overview", "Projects", "Quality", "Agents", "Design Loop", "Reports"];

const kpis = [
  { label: "Active Projects", value: "24", trend: "+6 today", note: "Sandbox and tracked workspaces synchronized.", tone: "positive" },
  { label: "Build Success Rate", value: "92%", trend: "+4.1%", note: "Deterministic verification wins over fragile retries.", tone: "positive" },
  { label: "GUI QA Pass Rate", value: "84%", trend: "+9 sessions", note: "Playwright evidence reviewed before release.", tone: "neutral" },
  { label: "Design Score", value: "8.7", trend: "Improved", note: "Visual hierarchy rose after polish passes.", tone: "accent" }
];

const pipelineSteps = [
  { name: "Plan", status: "done", note: "PM turned goal into scoped architecture." },
  { name: "Build", status: "done", note: "DEV generated root-relative file operations." },
  { name: "Run", status: "done", note: "Preview process and verification commands executed." },
  { name: "GUI QA", status: "active", note: "Live evidence and regression flows under review." },
  { name: "UI Quality", status: "queued", note: "DOM audit, hierarchy and responsiveness check." },
  { name: "Design Review", status: "queued", note: "TriFix design loop collects polish suggestions." },
  { name: "Ready", status: "waiting", note: "Manual review stays available when models wobble." }
];

const agentTimeline = [
  { agent: "PM", summary: "Planned architecture for a local-first ops dashboard.", time: "09:12", status: "done" },
  { agent: "DEV", summary: "Applied six root-relative files and generated a Vite scaffold.", time: "09:18", status: "done" },
  { agent: "QA", summary: "Reviewed command output, build readiness and screenshot evidence.", time: "09:24", status: "active" },
  { agent: "Design Loop", summary: "Prepared a polish pass for contrast, spacing and density.", time: "09:26", status: "queued" },
  { agent: "Terminal", summary: "Manual fallback path remains visible when automation stops safely.", time: "09:29", status: "waiting" }
];

const initialToolRequests = [
  { id: 1, title: "Run GUI QA", requester: "QA", risk: "Low", status: "completed", detail: "Playwright smoke route completed with evidence artifacts captured." },
  { id: 2, title: "Run UI Quality Check", requester: "PM", risk: "Low", status: "pending approval", detail: "Design system heuristics, spacing and DOM structure review are queued." },
  { id: 3, title: "Create Dependency Plan", requester: "DEV", risk: "Medium", status: "completed", detail: "Optional package install path documented without forcing remote fetches." },
  { id: 4, title: "Request Dependency Install", requester: "DEV", risk: "High", status: "denied", detail: "Manual approval required because environment slowness is not a code defect." },
  { id: 5, title: "Run Build", requester: "PM", risk: "Medium", status: "failed", detail: "Previous run timed out; current demo emphasizes manual review-safe behavior." }
];

const fileTree = [
  "package.json",
  "index.html",
  "vite.config.js",
  "src/main.jsx",
  "src/App.jsx",
  "src/styles.css"
];

const activityFeed = [
  { time: "09:04", agent: "Preflight", action: "Verified PM, DEV and QA model health.", status: "passed", artifact: "model-health.json" },
  { time: "09:08", agent: "PM", action: "Generated scoped dashboard plan.", status: "passed", artifact: "runbook.json" },
  { time: "09:13", agent: "DEV", action: "Parsed strict JSON file operations.", status: "passed", artifact: "artifacts.json" },
  { time: "09:16", agent: "Executor", action: "Applied root-relative files.", status: "passed", artifact: "run-state.json" },
  { time: "09:20", agent: "Verifier", action: "Build verification held for dependency approval.", status: "needs review", artifact: "run-log.jsonl" },
  { time: "09:22", agent: "GUI QA", action: "Queued smoke evidence capture.", status: "pending", artifact: "latest-result.json" },
  { time: "09:24", agent: "Design Quality", action: "Flagged hierarchy polish opportunity.", status: "improved", artifact: "design-review.json" },
  { time: "09:28", agent: "Safety", action: "Released lock and preserved manual review path.", status: "passed", artifact: "active-work-pointer.json" }
];

const proofCards = [
  "Generates Vite React projects",
  "Validates file operations",
  "Runs GUI QA",
  "Runs UI Quality Check",
  "Attempts bounded design improvement",
  "Fails safely when models misbehave"
];

const loopStages = [
  "Collecting UI evidence",
  "Running GUI QA",
  "Running UI Quality Check",
  "QA reviewing design",
  "DEV applying polish",
  "Ready for manual review"
];

export default function App() {
  const [theme, setTheme] = useState("dark");
  const [density, setDensity] = useState("comfortable");
  const [activeNav, setActiveNav] = useState("Overview");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedRequest, setExpandedRequest] = useState(2);
  const [toolRequests, setToolRequests] = useState(initialToolRequests);
  const [loopIndex, setLoopIndex] = useState(-1);
  const [loopRunning, setLoopRunning] = useState(false);

  useEffect(() => {
    document.body.dataset.theme = theme;
    document.body.dataset.density = density;
  }, [theme, density]);

  useEffect(() => {
    if (!loopRunning) {
      return undefined;
    }
    if (loopIndex >= loopStages.length - 1) {
      setLoopRunning(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setLoopIndex((current) => current + 1), 900);
    return () => window.clearTimeout(timer);
  }, [loopRunning, loopIndex]);

  const filteredActivity = useMemo(() => {
    return activityFeed.filter((item) => {
      const matchesSearch = `${item.time} ${item.agent} ${item.action} ${item.artifact}`.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || item.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [search, statusFilter]);

  const loopLabel = loopIndex >= 0 ? loopStages[loopIndex] : "Demo simulation ready";

  const handleLoopDemo = () => {
    setLoopRunning(true);
    setLoopIndex(0);
  };

  const toggleRequest = (id) => {
    setExpandedRequest((current) => (current === id ? null : id));
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">TF</div>
          <div>
            <p className="eyebrow">TriFix Showcase</p>
            <h1>SmartOps</h1>
          </div>
        </div>
        <nav className="nav-list">
          {navItems.map((item) => (
            <button
              key={item}
              className={`nav-item ${activeNav === item ? "active" : ""}`}
              onClick={() => setActiveNav(item)}
            >
              <span className="nav-dot" />
              {item}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span>Local-first workspace</span>
          <span>Optional AI agents</span>
        </div>
      </aside>

      <main className="main-layout">
        <header className="topbar panel">
          <div>
            <p className="eyebrow">Generated and improved through TriFix design systems</p>
            <h2>SmartOps Command Center</h2>
          </div>
          <div className="topbar-actions">
            <label className="search-shell">
              <span>Search</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search activity, files, agents..." />
            </label>
            <div className="badge-stack">
              <span className="badge glow">Full AI Mode</span>
              <span className="badge subtle">Manual fallback ready</span>
              <span className="team-pill">Skunk / Demo Ops</span>
            </div>
          </div>
        </header>

        <section className="hero-grid">
          {kpis.map((card) => (
            <article key={card.label} className={`panel metric-card ${card.tone}`}>
              <div className="metric-head">
                <span>{card.label}</span>
                <span className={`status-chip ${card.tone}`}>{card.trend}</span>
              </div>
              <strong>{card.value}</strong>
              <p>{card.note}</p>
            </article>
          ))}
        </section>

        <section className="content-grid">
          <article className="panel span-two">
            <div className="section-head">
              <div>
                <p className="eyebrow">Autonomy Pipeline</p>
                <h3>Plan to ready, with visible gates</h3>
              </div>
              <span className="badge subtle">Demo signal path</span>
            </div>
            <div className="pipeline">
              {pipelineSteps.map((step, index) => (
                <div key={step.name} className={`pipeline-step ${step.status}`}>
                  <div className="pipeline-node">{index + 1}</div>
                  <div>
                    <strong>{step.name}</strong>
                    <p>{step.note}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Design Loop</p>
                <h3>Simulation</h3>
              </div>
              <span className="badge subtle">Demo simulation</span>
            </div>
            <div className="loop-card">
              <strong>{loopLabel}</strong>
              <p>This locally simulates the orchestration path without calling any backend or model.</p>
              <div className="loop-progress">
                {loopStages.map((stage, index) => (
                  <span key={stage} className={index <= loopIndex ? "done" : ""} />
                ))}
              </div>
              <div className="toggle-row">
                <button className="primary-button" onClick={handleLoopDemo} disabled={loopRunning}>
                  {loopRunning ? "Running..." : "Run Design Loop"}
                </button>
                <button className="secondary-button" onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}>
                  Theme: {theme}
                </button>
                <button className="secondary-button" onClick={() => setDensity((current) => (current === "comfortable" ? "compact" : "comfortable"))}>
                  Density: {density}
                </button>
              </div>
            </div>
          </article>

          <article className="panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Agent Activity</p>
                <h3>Cross-agent timeline</h3>
              </div>
            </div>
            <div className="timeline">
              {agentTimeline.map((item) => (
                <div key={`${item.agent}-${item.time}`} className="timeline-row">
                  <span className={`timeline-marker ${item.status}`} />
                  <div>
                    <div className="timeline-meta">
                      <strong>{item.agent}</strong>
                      <small>{item.time}</small>
                    </div>
                    <p>{item.summary}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel span-two">
            <div className="section-head">
              <div>
                <p className="eyebrow">Tool Requests</p>
                <h3>Approval-aware operations</h3>
              </div>
            </div>
            <div className="tool-grid">
              {toolRequests.map((request) => (
                <div key={request.id} className="tool-card">
                  <button className="tool-summary" onClick={() => toggleRequest(request.id)}>
                    <div>
                      <strong>{request.title}</strong>
                      <p>{request.requester} requested this action</p>
                    </div>
                    <div className="tool-meta">
                      <span className="badge subtle">{request.risk} risk</span>
                      <span className={`status-chip ${request.status.replace(/\s+/g, "-")}`}>{request.status}</span>
                    </div>
                  </button>
                  {expandedRequest === request.id ? <p className="tool-detail">{request.detail}</p> : null}
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Design Quality</p>
                <h3>Review snapshot</h3>
              </div>
            </div>
            <ul className="check-list">
              <li><span>Selected skill</span><strong>AI Control Room</strong></li>
              <li><span>Recommended stack</span><strong>React + custom CSS</strong></li>
              <li><span>DOM audit</span><strong>Passed</strong></li>
              <li><span>Responsive check</span><strong>Passed</strong></li>
              <li><span>Visual hierarchy</span><strong>Improved</strong></li>
              <li><span>Next action</span><strong>Run Design Improvement Loop</strong></li>
            </ul>
          </article>

          <article className="panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Generated Files</p>
                <h3>Project preview</h3>
              </div>
            </div>
            <div className="file-tree">
              {fileTree.map((file) => (
                <div key={file} className="file-row">
                  <span>{file}</span>
                  <span className="badge subtle">ready</span>
                </div>
              ))}
            </div>
            <div className="proof-badges">
              <span className="badge glow">Root-relative files</span>
              <span className="badge glow">No nested Sandbox folder</span>
              <span className="badge glow">Build-ready</span>
              <span className="badge glow">Manual review safe</span>
            </div>
          </article>

          <article className="panel span-two">
            <div className="section-head">
              <div>
                <p className="eyebrow">Recent Activity</p>
                <h3>Operational evidence</h3>
              </div>
              <div className="filter-row">
                {["all", "passed", "pending", "needs review", "improved"].map((option) => (
                  <button
                    key={option}
                    className={`filter-button ${statusFilter === option ? "active" : ""}`}
                    onClick={() => setStatusFilter(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <div className="activity-table">
              {filteredActivity.map((entry) => (
                <div key={`${entry.time}-${entry.agent}`} className="activity-row">
                  <span>{entry.time}</span>
                  <span>{entry.agent}</span>
                  <span>{entry.action}</span>
                  <span className={`status-chip ${entry.status.replace(/\s+/g, "-")}`}>{entry.status}</span>
                  <span>{entry.artifact}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel span-two">
            <div className="section-head">
              <div>
                <p className="eyebrow">What This Proves</p>
                <h3>Demo-ready summary</h3>
              </div>
            </div>
            <div className="proof-grid">
              {proofCards.map((item) => (
                <div key={item} className="proof-card">
                  <span className="proof-icon">+</span>
                  <p>{item}</p>
                </div>
              ))}
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
