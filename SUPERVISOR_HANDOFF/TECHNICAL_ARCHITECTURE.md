# Technical Architecture

## Frontend stack

TriFix uses React 18 with Vite for the renderer UI. The main workspace UI is in `src/App.jsx`, with supporting styling in `src/styles.css`.

## Electron main / preload / renderer relationship

- `electron/main.cjs`
  - Owns the desktop window, IPC handlers, managed process runner, autonomy state, quality systems, and file/project operations.
- `electron/preload.cjs`
  - Exposes a controlled `window.trifix` bridge to the renderer.
- `src/App.jsx`
  - Uses the preload bridge to drive project management, run controls, model preflight, quality tools, runbooks, and recovery UI.

## Project runner

The managed project runner is implemented in the Electron main process. It supports starting project commands, tracking managed processes, detecting health URLs, stopping processes, and reopening local URLs in the browser.

## Agent workflow concept

TriFix is designed around three roles configured in `shared/agentConfig.js`:

- PM / Architect
- DEV / Junior
- QA / Supervisor

These roles represent planning, implementation, and review steps rather than unrestricted automation. In the current environment, the workflow concept remains present, but live AI execution depends on restoring model endpoints.

## Deterministic tools

TriFix includes deterministic local tooling around:

- project/workspace selection
- file and path validation
- managed command execution
- process tracking
- runbooks and artifact indexing
- UI quality and GUI QA helpers
- approval-gated agent tool requests

## Artifact / runbook system

The repository includes multiple persistence concepts under `.trifix`-style runtime data:

- run state
- JSONL timelines/logs
- artifact ledgers
- runbooks
- next-action state
- manual review and recovery pointers

This supports continuation after interrupted or partially complete runs.

## GUI QA / UI Quality systems

TriFix includes a quality layer beyond code generation:

- Playwright capability checks
- GUI smoke-test hooks
- UI quality contract generation
- DOM audit / design review artifacts
- UI stack recommendation
- dependency plan generation
- design improvement loop structure

These systems are implemented as local tooling, but AI-assisted repair/review still depends on working endpoints.

## Model endpoint integration

Model endpoint health checks are implemented in `electron/agent/modelHealth.js`. The system expects OpenAI-compatible `/api/v1/chat` style endpoints and classifies failures such as:

- endpoint offline
- model timeout
- model unavailable
- invalid response

The UI also contains model preflight and availability messaging to gate autonomy actions.

## Failure handling strategy

TriFix contains explicit failure-state handling rather than assuming success. Examples in the code include:

- `dev_invalid_json`
- `dev_no_valid_file_operations`
- `dev_missing_required_project_files`
- `dev_json_repair_timeout`
- `dependency_install_timeout`
- `generated_needs_manual_verification`
- `model_request_invalid_payload`
- `pre_pm_setup_timeout`
- `autonomy_worker_start_timeout`

It also includes active-run locking, stop cleanup, manual review states, and recovery item tracking to reduce unsafe or ambiguous runtime behavior.
