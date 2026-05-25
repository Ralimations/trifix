# Feature Inventory

| Feature | Description | Status | Requires AI? | Evidence / file references | Suggested next action |
| --- | --- | --- | --- | --- | --- |
| Electron + Vite + React shell | Desktop UI shell with React renderer and Electron main/preload bridge | Implemented | No | `package.json`, `scripts/dev.mjs`, `scripts/start.mjs`, `electron/main.cjs`, `electron/preload.cjs`, `src/App.jsx` | Revalidate launch on current machine |
| Project/workspace tracking | Tracks projects and opens workspace views | Implemented | No | `electron/preload.cjs`, `src/App.jsx` project list/workspace handlers | Confirm clean local flow with current user data |
| Model settings / preflight UI | Shows agent endpoint/model health before runs | Implemented | No for visibility, Yes for useful live results | `shared/agentConfig.js`, `electron/agent/modelHealth.js`, `src/App.jsx` | Reconnect endpoints and re-run preflight |
| PM / DEV / QA workflow structure | Three-role workflow concept and UI | Implemented structurally | Yes | `shared/agentConfig.js`, `docs/03-agent-pipeline.md`, `src/App.jsx` | Revalidate end-to-end with working models |
| Managed project runner | Starts/stops tracked project commands and detects URLs | Implemented | No | `electron/main.cjs`, `electron/preload.cjs`, `src/App.jsx`, `dev.current.stderr.log` | Re-run locally and confirm stability |
| Run Project / Stop Project / Open URL | Deterministic project execution controls | Implemented | No | `electron/preload.cjs`, `electron/main.cjs`, `src/App.jsx` | Verify against a local sample project |
| Commands panel | Manual terminal command history and execution surface | Implemented | No | `electron/preload.cjs`, `src/App.jsx` | Confirm current UX and safety messages |
| Command safety / approval policy | Approval-gated dependency/terminal policy and agent tool settings | Implemented | No | `electron/main.cjs`, `src/App.jsx`, `.trifix-brain/command-policy.md` | Add clearer offline/manual messaging |
| GUI QA / Playwright capability path | Capability detection and smoke-test path | Implemented structurally | No for capability checks, Yes for AI repair loop | `electron/preload.cjs`, `electron/main.cjs`, `src/App.jsx`, `scripts/quick-trifix-validation.ps1` | Install/revalidate Playwright locally |
| UI Quality / DOM audit / design review | Design-quality artifact generation and review structures | Implemented structurally | Partly | `electron/designQuality.cjs`, `electron/main.cjs`, `src/App.jsx` | Revalidate outputs on a sample project |
| UI library registry / stack recommendation | UI stack memory and recommendation system | Implemented | Partly | `electron/data/default-ui-library-registry.json`, `electron/designQuality.cjs`, `electron/main.cjs` | Check artifact outputs and docs |
| Dependency plan artifacts | Generates dependency planning artifacts for UI work | Implemented | Partly | `electron/preload.cjs`, `electron/main.cjs`, `electron/designQuality.cjs` | Re-run on a sample project |
| Design Improvement Loop structure | Design polish / improvement loop with persistence hooks | Implemented structurally | Yes for full value | `electron/preload.cjs`, `electron/main.cjs`, `src/App.jsx` | Revalidate with stable endpoints |
| Agent Tool Requests / approval policy | Records, approves, denies, and executes bounded tool requests | Implemented | Partly | `electron/preload.cjs`, `electron/main.cjs`, `src/App.jsx` | Test approval flow end-to-end |
| Autonomy runbook / artifacts | Runbook persistence, timeline, next-action, artifact index | Implemented structurally | Partly | `electron/preload.cjs`, `electron/main.cjs`, `electron/agent/runState.js`, `electron/agent/artifactLedger.js` | Validate resume/manual-review paths |
| Active-run navigation guard | Prevents unsafe overlapping runs/navigation during active work | Implemented | No | `electron/main.cjs`, `src/App.jsx` | Revalidate stop/resume edge cases |
| Recovery pointer / manual review state | Recovery items and manual review completion path | Implemented | No for display, Yes for AI-generated recovery content | `electron/main.cjs`, `electron/preload.cjs`, `src/App.jsx` | Exercise with controlled sample runs |
| Stop cleanup and active lock release | Releases in-memory active run lock on stop/failure | Implemented | No | `electron/main.cjs`, `scripts/restart-dev.ps1` | Test repeated start/stop scenarios |
| Autonomy queue dispatch diagnostics | Tracks queue state and start/dispatch failures | Implemented structurally | Yes | `electron/main.cjs`, `AUTONOMY_PLAN.md` | Revalidate with live endpoints |
| Pre-PM setup watchdog | Timeout handling before PM stage | Implemented | Yes | `electron/main.cjs` failure statuses and timers | Revalidate under real model setup |
| PM dispatch logging | Tracks PM dispatch timeout/failure states | Implemented | Yes | `electron/main.cjs`, `src/App.jsx` status mapping | Revalidate under live load |
| DEV strict JSON/fileOperations validation | Rejects malformed or empty DEV outputs | Implemented | Yes | `electron/main.cjs`, `electron/fileSystem.js` | Replace one-shot JSON with multi-phase generation |
| Root-relative path validation | Prevents writes escaping the intended project root | Implemented | No | `electron/fileSystem.js` path resolution and traversal checks | Keep and add regression tests |
| Nested project folder rejection signal | Detects nested `Sandbox folder` when required root files are missing | Implemented | Yes | `electron/main.cjs` required Vite file check | Add explicit tests and clearer user message |
| Required Vite file gate | Requires key Vite/React files in generated root | Implemented | Yes | `electron/main.cjs`, `electron/fileSystem.js` | Extend to additional project profiles |
| Bounded DEV JSON repair | Repairs/normalizes invalid JSON within bounded runtime | Implemented structurally | Yes | `electron/main.cjs`, `src/App.jsx` status handling | Replace with smaller phased outputs |
| Repair timeout handling | Handles repair timeout/failure outcomes | Implemented | Yes | `electron/main.cjs`, `src/App.jsx` | Revalidate with live endpoints |
