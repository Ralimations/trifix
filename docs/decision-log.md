# Decision Log

This log tracks key architectural and design decisions made during the development of TriFix AI.

## 2026-04-10: Multi-Agent Pipeline (V2)
- **Decision**: Move from a single-agent chat to a structured PM -> QA -> DEV pipeline.
- **Rationale**: Single agents often hallucinate complex project structures or forget constraints. Separation of concerns between Planning, Instruction, and Implementation improves reliability.
- **Impact**: Introduced `architect`, `supervisor`, and `junior` roles.

## 2026-04-25: Durable Persistence Layer
- **Decision**: Create a hidden `.trifix` directory at the project root for run state and logs.
- **Rationale**: UI state is ephemeral. To support autonomy, the system must be able to resume after crashes, restarts, or long idle periods.
- **Impact**: Added `run-state.json`, `run-log.jsonl`, and `artifactLedger.js`.

## 2026-05-01: Graphify Integration
- **Decision**: Use `graphifyy` as an optional local context provider.
- **Rationale**: Manually selecting files is a bottleneck for autonomy. Graph-based context allows agents to "search" the codebase structurally (imports, classes) without exceeding token budgets.
- **Impact**: Added Graphify Build/Query IPC and `.trifix/graph/` storage.

## 2026-05-04: Automated Validation & Repair Loop
- **Decision**: Automatically execute safe commands (build/test) after file writes.
- **Rationale**: The "Execution Gap" is the biggest hurdle for AI agents. By closing the loop with automated checks and multi-agent diagnosis, we achieve true "self-correcting" autonomy.
- **Impact**: Implemented the Phase 2 Auto-Repair pass.

## 2026-05-05: Process Management
- **Decision**: Track long-running child processes in `.trifix/processes`.
- **Rationale**: Agents need to know if the dev server they started is still running, what port it's on, and if it's logging errors.
- **Impact**: Added process records, port detection, and log file streaming.
