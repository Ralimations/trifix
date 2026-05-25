# TriFix Supervisor Handoff

## 1. Project overview

TriFix is a local-first Electron + Vite + React prototype for managing AI-assisted software development workflows. It combines a desktop workspace, deterministic project tools, and an optional PM / DEV / QA agent flow intended to help structure software tasks safely.

## 2. What TriFix is

- A prototype and proof-of-concept.
- A continuation-ready foundation for future interns.
- A local-first AI workflow workspace with deterministic tooling.
- A desktop environment for planning, running, reviewing, and recovering project work.

## 3. What TriFix is not

- Not a completed autonomous app builder.
- Not production-ready or enterprise-ready.
- Not fully autonomous in the current environment.
- Not guaranteed to generate complete apps reliably.

## 4. Main features

- Electron desktop shell with React renderer UI.
- Project/workspace tracking and persistent project list.
- PM / DEV / QA role structure and model endpoint settings.
- Model preflight / health checks.
- Managed project runner with `Run Project`, `Stop Project`, and `Open URL`.
- Commands panel and terminal history.
- Command safety and approval policy controls.
- GUI QA / Playwright capability path.
- UI Quality, DOM audit, design review, UI stack recommendation, and dependency plan artifacts.
- Agent Tool Requests, approval flow, and runbook/recovery concepts.
- Active-run navigation guard, stop cleanup, and recovery/manual review handling.

## 5. Current state

TriFix is best understood as an intern-expandable prototype. The application shell, local project controls, quality/review surfaces, and substantial autonomy plumbing exist in the repository. Full end-to-end AI autonomy cannot currently be demonstrated here because the original model endpoints are no longer available.

## 6. What works without AI

- Launching the Electron + Vite app shell.
- Viewing tracked projects and workspace panels.
- Inspecting settings and model preflight UI.
- Running and stopping local projects through the managed runner.
- Opening detected local URLs.
- Using the Commands panel and terminal history.
- Viewing runbooks, recovery state, and manual review status if artifacts already exist.
- Running deterministic UI Quality / GUI QA helpers when local prerequisites are installed.

## 7. What needs AI/model endpoints

- PM planning and scoped task generation.
- DEV file generation and repair loops.
- QA review, verdicts, and patch guidance.
- Full autonomy queue flow and design improvement loop with AI-driven decisions.
- Reliable GUI QA repair and final PM approval when the workflow expects agent responses.

## 8. How to run the app

See `SETUP_AND_RUN.md` in this folder. The short version is:

```bash
npm install
npm run build
npm run dev
```

Then use the TriFix desktop UI. `npm start` launches Electron against the built app. `npm run dev:restart` and `npm run dev:clean` are available helper scripts.

## 9. How to navigate the project

- `src/`: React renderer UI.
- `electron/`: Electron main process, IPC, project runner, quality systems, and autonomy logic.
- `shared/`: shared agent configuration.
- `scripts/`: local dev and validation helpers.
- `docs/`: earlier project documentation.
- `.trifix-brain/`: rules and prompt policy memory used by the agent workflow.
- `DEMO/smartops-showcase/`: optional archived demo material only.

## 10. Suggested handoff/demo flow

Use `DEMO_SCRIPT.md`. The official handoff demo should focus on TriFix itself: app shell, tracked projects, workspace panels, settings/preflight, managed commands, quality systems, recovery/manual review, and future continuation. Do not use SmartOps as the main demo.

## 11. Known limitations

- AI endpoints used during development are not available in the current environment.
- Full autonomy cannot be demonstrated without restored model access.
- Local small models previously struggled with large strict JSON output.
- Current support is strongest for Vite/React web app generation paths.
- Some runtime paths and consistency edges need fresh revalidation after setup.

See `KNOWN_LIMITATIONS.md` for the direct version.

## 12. Suggested next steps for future interns

- Re-run local setup and confirm the app still launches cleanly.
- Document all offline/manual capabilities that remain useful.
- Reconnect compatible AI endpoints and revalidate PM / DEV / QA flow.
- Replace large one-shot DEV JSON generation with a multi-phase workflow.
- Strengthen tests, run-state consistency, and project-type support.

See `NEXT_STEPS_FOR_INTERNS.md` for the fuller roadmap.

## 13. Important folders/files

- `package.json`
- `src/App.jsx`
- `electron/main.cjs`
- `electron/preload.cjs`
- `electron/fileSystem.js`
- `electron/designQuality.cjs`
- `electron/agent/runState.js`
- `electron/agent/artifactLedger.js`
- `electron/agent/modelHealth.js`
- `shared/agentConfig.js`
- `scripts/dev.mjs`
- `scripts/start.mjs`
- `scripts/restart-dev.ps1`
- `scripts/quick-trifix-validation.ps1`
- `AUTONOMY_PLAN.md`
- `dev.current.stderr.log`
- `dev.ps1.stderr.log`
