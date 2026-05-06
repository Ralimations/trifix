# TriFix Autonomy Plan

This plan defines how TriFix can move from a user-triggered multi-agent pipeline into an output-based autonomous software agent that can work on medium-sized projects for long sessions.

## Goal

TriFix should create real project output, validate it, repair it, and continue through planned phases with minimal user interruption.

The user should mainly see:

- current output folder
- files changed
- app URL or run status
- validation status
- blockers
- decision card
- final report

The agents should not repeatedly reread every file. They should use a persistent project map, selected changed files, and targeted graph queries.

## Current State

TriFix already has useful pieces:

- Electron backend with file and command access.
- Sandbox task folders.
- PM, Senior Dev/QA, and Junior Dev roles.
- File operation executor.
- Safe command allowlist.
- Project recents and metadata.
- Output review with accept, patch, and discard actions.

Main gaps:

- Run state is mostly UI/session state.
- No durable autonomous task queue.
- No persistent project memory.
- No repo graph/index layer.
- Validation and repair loop is not yet a full autonomous controller.
- Generated files are not yet treated as a durable artifact ledger.
- Long-running backend/dev servers are only lightly tracked.

## Reference Pattern

OpenClaw/Hermes-like autonomy is not just better prompting. It is a runtime pattern:

1. persistent memory
2. tool registry
3. task queue
4. background loop
5. command/process manager
6. validation and repair cycles
7. structured reports
8. user interruption points only when needed

TriFix should implement this pattern locally and sandbox-first.

## Graphify / graphifyy Fit

Graphifyy can help prevent agents from scanning the same files over and over.

Graphify builds a knowledge graph from a project and outputs:

- `graphify-out/graph.json`
- `graphify-out/graph.html`
- `graphify-out/GRAPH_REPORT.md`

Useful properties for TriFix:

- AST-level extraction across code files.
- Relationship map for imports, classes, calls, concepts, docs, and diagrams.
- Persistent graph output that can be reused between runs.
- Incremental/watch mode is advertised by Graphify sources, so changed files can update the graph instead of rebuilding everything.
- Agents can receive a compact graph summary plus targeted files instead of a raw directory dump.

TriFix should treat Graphify as an optional local context engine. Do not make it required for baseline operation.

## Proposed Graph Context Layer

Add a project-local folder:

```text
.trifix/
  run-state.json
  run-log.jsonl
  memory.md
  decisions.md
  artifacts.json
  graph/
    graph.json
    GRAPH_REPORT.md
    graph.html
    index-status.json
```

### Graph Index Lifecycle

1. On project open:
   - detect `.trifix/graph/graph.json`
   - if missing, offer or auto-run graph build in autonomous mode
2. On file write:
   - mark graph stale for changed paths
   - queue incremental graph update
3. Before agent prompt:
   - include graph report summary
   - include relevant graph nodes
   - include changed/touched files only
4. After validation error:
   - query graph for related files around the failing file or symbol

### Graphify Commands

Suggested internal commands:

```text
graphify update .
graphify watch .
graphify query "what files implement routing?"
```

TriFix should call these only if `graphify` is installed. If missing, show:

```text
Graph context unavailable. Install with: pip install graphifyy
```

Do not auto-install Python packages without a user policy allowing dependency installs.

## Context Selection Policy

Replace "send selected files only" with a layered context budget:

1. **Run Summary**
   - project name
   - current phase
   - current task
   - last validation result
   - last changed files

2. **Graph Context**
   - graph report summary
   - relevant nodes and edges
   - related files from graph query

3. **Touched Files**
   - files DEV just wrote
   - files with test/build failures
   - files selected by user

4. **Raw File Content**
   - only the top relevant files
   - capped by token budget
   - never scan `node_modules`, `.git`, `dist`, `build`

This lets agents reason from structure first, content second.

## Autonomous Runner V1

Add a backend runner that owns the loop instead of the renderer.

```text
start run
load run-state
plan next task
prepare context
call agents
write files
refresh tree
run validation
if pass: checkpoint and continue
if fail: diagnose and patch
if repeated fail: stop with blocker
write report
```

### Run State

```json
{
  "runId": "run-20260505-210000",
  "mode": "autonomous",
  "status": "running",
  "startedAt": "2026-05-05T21:00:00.000Z",
  "maxRuntimeMinutes": 480,
  "currentPhase": "Backend API",
  "currentTaskId": "task-api-crud",
  "attempt": 2,
  "changedFiles": ["server/index.js", "package.json"],
  "lastCommand": "npm run build",
  "lastValidationStatus": "failed",
  "nextAction": "patch"
}
```

## Task Queue

PM should create durable tasks:

```json
{
  "id": "phase-2-api",
  "phase": "Backend API",
  "goal": "Create CRUD endpoints for todos",
  "targetFiles": ["server/index.js", "server/db.js"],
  "allowedCommands": ["npm install", "npm run build", "npm test"],
  "acceptance": [
    "Server starts",
    "GET /api/todos returns JSON",
    "POST /api/todos creates an item"
  ],
  "status": "pending",
  "attempts": 0
}
```

The UI should show the queue as the main autonomous work surface.

## Validation and Repair Loop

For each task:

1. Junior Dev writes file operations.
2. Executor applies file operations immediately.
3. Tree refreshes.
4. Graph marks changed files stale.
5. Validation runs.
6. If validation fails:
   - capture command output
   - ask Senior Dev for diagnosis
   - ask Junior Dev for patch
   - apply patch
   - repeat
7. If validation passes:
   - checkpoint
   - move to next task

Stop conditions:

- max attempts reached
- unsafe command requested
- command exits with repeated same error
- missing secret/API key
- generated output has no runnable entry
- graph/index repeatedly fails

## Backend Capability Profiles

Autonomy should be controlled by profiles.

### Safe

- read/write sandbox files
- run `npm run build`
- run `npm test`
- run `node <file>`

### Project

- `npm install`
- `npm run dev`
- `npm run start`
- local SQLite/file DB creation
- local port health checks

### Extended

- browser smoke tests
- database migrations
- seed scripts
- graphify index/watch

### Approval Required

- delete non-generated folders
- network downloads outside declared dependency commands
- shell pipes
- arbitrary PowerShell
- secrets access
- publishing/deployment

## Process Manager

TriFix needs tracked process records:

```json
{
  "id": "proc-dev-server",
  "command": "npm run dev",
  "cwd": "sandbox/tasks/example",
  "pid": 12345,
  "port": 5174,
  "status": "running",
  "healthUrl": "http://127.0.0.1:5174",
  "stdoutLog": ".trifix/processes/dev.stdout.log",
  "stderrLog": ".trifix/processes/dev.stderr.log"
}
```

Add UI actions:

- open app URL
- stop process
- restart process
- view logs

## Overnight Mode

Autonomous mode should expose:

- max runtime
- max attempts per task
- max total command time
- allowed command profile
- stop on first blocker
- continue on recoverable validation failures
- final report path

Overnight final report:

```text
AUTONOMY REPORT

Completed:
- Created API server
- Created frontend views
- Added package scripts
- Ran build successfully

Still failing:
- npm test has 1 route assertion failure

Needs user:
- Choose auth provider

Artifacts:
- sandbox/tasks/simpledash
- .trifix/run-log.jsonl
- .trifix/graph/GRAPH_REPORT.md
```

## UI Changes

Make the UI output-first:

- left: project files/artifacts
- center: current output preview/status
- right: autonomous queue and validation
- floating: agent chat
- popup: decision card

Avoid showing raw command requirements as user decisions. Commands should appear in logs unless blocked.

## Implementation Phases

### Phase 1: Durable Output Loop

- create `.trifix/run-state.json`
- create `.trifix/run-log.jsonl`
- persist every agent stage and command result
- refresh tree after every file write
- keep changed files selected for the next phase

Status:

- Started in TriFix backend.
- `.trifix/run-state.json`, `.trifix/run-log.jsonl`, `.trifix/memory.md`, `.trifix/decisions.md`, and `.trifix/artifacts.json` are created per project/sandbox.
- Agent progress, file writes, command results, validation results, and accept decisions are logged.
- `.trifix` is hidden from the normal project file tree so agents do not reread run metadata as source context.

### Phase 2: Auto Repair

- run validation after writes
- send validation error to Senior Dev
- ask Junior Dev for patch
- retry with max attempts
- stop with blocker report

Status:

- Started in the main process.
- After DEV fileOperations are written, TriFix now runs safe setup commands and validation automatically inside the project sandbox.
- Existing-project DEV fileOperations are applied to disk before validation instead of staying as proposals only.
- On validation failure, TriFix runs one targeted auto-repair pass and applies Junior Dev repair fileOperations.
- Final validation result is stored on the pipeline result and `.trifix/run-state.json`.

### Phase 3: Graph Context

- detect `graphify` CLI
- add "Build Graph" backend command
- store graph outputs under `.trifix/graph`
- add graph summary to PM/QA/DEV context
- query graph for related files before each task

Status:

- Started.
- TriFix now creates `.trifix/graph/index-status.json` per project.
- Backend can detect `graphify` or `graphifyy` on PATH and records availability in graph status/artifacts.
- Project panel shows graph context status with Check and Build actions.
- Build action runs Graphify from the project root, writes `.graphifyignore`, and copies `graph.json`, `GRAPH_REPORT.md`, and `graph.html` into `.trifix/graph`.
- Backend graph query IPC is available for asking Graphify about related files.
- Pipeline runs an optional graph query before PM/QA/DEV calls and injects a compact `GRAPH_CONTEXT` block into the shared prompt.
- If Graphify is missing, unindexed, or fails, the run falls back to selected files and uploaded context.

### Phase 4: Process Manager

- track long-running dev servers
- store stdout/stderr logs
- detect ports and health URLs
- show app URL in output card

Status:

- Started.
- `npm run dev` / `npm run start` launched through Run Project now create tracked process records under `.trifix/processes`.
- stdout and stderr are written to per-process log files and summarized in command history.
- TriFix detects local app URLs from server output and exposes Open URL / Stop Process actions in the Logs tab.
- Stop Process terminates the tracked process tree and updates persisted process state.
- Project refresh/reopen now reloads persisted process records from `.trifix/processes/processes.json`.
- Workspace shows a dedicated project process card with Open URL, Logs, Restart, and Stop controls.
- Logs can be viewed from the process card or command history without leaving TriFix.

### Phase 5: Overnight Mode

- add autonomous mode toggle
- add runtime/attempt limits
- run task queue in backend
- write final report
- pause only for blocked/unsafe actions

Status:

- Started in the main process.
- Added backend autonomy queue IPC: start, status, and stop.
- Autonomy queue runs the existing PM/Senior Dev/Junior Dev pipeline outside the renderer run button path.
- Queue tasks write files, run validation, invoke the auto-repair pass, and persist state to `.trifix/run-state.json`.
- Completed autonomy runs write `.trifix/final-report.md`.
- Office UI now has an Autonomous Run control, Stop Auto control, and a compact autonomy status card.
- Autonomy runs now have an 8-hour default runtime budget, a 12-hour hard maximum, and persisted deadline/runtime metadata.
- Landing recents and reopened projects now surface the last persisted autonomy state from `.trifix/run-state.json`.
- Persisted queue resume after app restart and multi-task decomposition are still pending.

## First Concrete Build

Start with:

```text
Autonomous Runner V1
- persistent run-state.json
- run-log.jsonl
- task queue
- auto validate after file writes
- patch retry loop
- final report
```

Graphify should come immediately after that because it solves the context growth problem, but the runner should not depend on it.
