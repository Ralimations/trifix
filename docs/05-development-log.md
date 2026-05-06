# Development Log

This log reconstructs the development timeline of TriFix AI based on Git history and internal project milestones.

## Phase 1: Foundation & Scaffolding (Early 2026)
*Inferred from initial commits and scaffolding scripts.*
- **Initialization**: Set up Electron + Vite + React infrastructure.
- **Core Utilities**: Built the initial `fileSystem.js` for safe project tree reads and `orchestrator.js` for basic agent calls.
- **Sandbox**: Implemented the `Sandbox folder/` and `task-YYYYMMDD` folder structures to ensure work isolation.

## Phase 2: Multi-Agent Pipeline (V2)
*Milestone: Branch `v2`*
- **Role Definition**: Formalized the PM (Architect), Senior Dev/QA (Supervisor), and Junior Dev (Junior) roles in `shared/agentConfig.js`.
- **Pipeline Workflow**: Developed the PM -> QA -> DEV -> QA -> PM loop in `orchestrator.js`.
- **UI Overhaul**: Created the "Tiny Office" dashboard with agent sprites, speech bubbles, and project status tracking.
- **PRD Generation**: Added automated Product Requirements Document generation and phase planning.

## Phase 3: Durable Run State (The Shift to Autonomy)
*Milestone: Branch `autonomous`*
- **Persistence**: Implemented `.trifix/run-state.json` and `.trifix/run-log.jsonl` to track runs across app restarts.
- **Artifact Ledger**: Added tracking for proposed vs applied files and command requests.
- **Auto-Repair Pass**: Introduced the Phase 2 "Auto-Repair" pass where the Senior Dev diagnoses build failures and the Junior Dev patches them automatically.

## Phase 4: Structural Context (Graphify)
*Current Milestone*
- **Context Engine**: Integrated `graphifyy` (optional) to build project knowledge graphs.
- **Graph Indexing**: Added backend commands to build and update the graph in `.trifix/graph/`.
- **Query IPC**: Implemented IPC handlers to allow agents to query the graph for related files.

## Phase 5: Process Management & Task Queue
*Ongoing*
- **Process Tracker**: Added tracking for long-running servers like `npm run dev` in `.trifix/processes`.
- **Autonomy Queue**: Added backend IPC for starting, stopping, and monitoring an autonomous task queue outside the UI's "Run" button path.
- **Overnight Mode**: Added default 8-hour/12-max runtime budgets and deadline metadata.
