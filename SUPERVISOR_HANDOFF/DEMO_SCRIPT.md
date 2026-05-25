# TriFix Supervisor Demo Script

This demo is designed for 5 to 8 minutes and does not rely on live AI responses.

## Opening

"TriFix is a local-first AI workflow workspace prototype. The core idea is not magic code generation by itself, but a safer workflow around planning, implementation, QA, project execution, and recovery."

## Demo flow

### 1. Open the main TriFix app

- Launch TriFix with the normal local dev flow.
- State that the application is an Electron desktop shell with a React frontend.

### 2. Show Home / project list

- Show the tracked project list and explain that TriFix keeps local project/workspace references.
- Point out that the project focus is TriFix itself, not a generated showcase app.

### 3. Show Workspace / agent panels

- Open a project workspace.
- Explain the PM / DEV / QA role structure in the UI.
- Clarify that these roles are part of the workflow design even when live AI is unavailable.

### 4. Show model settings / preflight area

- Open the settings or preflight section.
- Explain that TriFix checks endpoint/model availability before autonomy runs.
- State clearly: live autonomy requires working AI/model endpoints, which are not available in the current environment.

### 5. Show deterministic tooling

- Open the Commands panel.
- Show `Run Project`, `Stop Project`, and `Open URL` if available for a tracked project.
- Explain that these deterministic controls remain useful without AI.

### 6. Show Design Quality / UI Quality area

- Open the UI Quality / design review area.
- Explain that TriFix includes structures for UI stack recommendations, DOM audit/design review artifacts, and dependency planning.
- If Playwright capability is visible, explain that GUI QA depends on local tooling and is partly usable without AI.

### 7. Show Agent Tool Requests / approval policy

- Open the agent tool policy or approval section if visible.
- Explain that TriFix was built with command safety, approval gates, and bounded tool use rather than unrestricted automation.

### 8. Show runbook / recovery / manual review concepts

- Show recovery state, runbook history, or manual review surfaces if available.
- Explain that TriFix preserves artifacts and state so failed or partial runs can be resumed or manually reviewed.

### 9. Explain safe failure handling

- Mention example failure outcomes already modeled in the codebase:
  - `dev_invalid_json`
  - `dev_no_valid_file_operations`
  - `dev_missing_required_project_files`
  - `dev_json_repair_timeout`
  - `dependency_install_timeout`
  - `generated_needs_manual_verification`
  - `model_request_invalid_payload`
  - `pre_pm_setup_timeout`
  - `autonomy_worker_start_timeout`

### 10. Close with continuation roadmap

"The value of this handoff is that TriFix already contains a working local workspace shell, deterministic execution tools, quality/recovery systems, and an architecture for PM/DEV/QA automation. The next intern step is to reconnect stable model endpoints, revalidate the AI workflow, and make generation more reliable through smaller multi-phase outputs."

## Optional archived demo material

- `DEMO/smartops-showcase/` exists in the repository.
- It should be presented only as optional archived demo material, not as the official supervisor handoff focus.
