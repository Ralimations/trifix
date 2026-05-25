# Test Evidence

This file summarizes only evidence visible in the repository. It does not claim fresh successful runs that were not performed during this handoff.

## Verified

- Source implementation exists for the Electron main process, preload bridge, React renderer, managed process runner, model health checks, runbook state, artifact ledger, file/path safety, and design-quality systems.
- `package.json` defines runnable local scripts for `dev`, `build`, `preview`, and `start`.

## Build-verified

- `dist/` exists and contains a built renderer bundle, indicating a prior build artifact was produced.

## Previously observed

- `dev.ps1.stdout.log` shows Vite serving the renderer on `http://127.0.0.1:5173/`.
- `dev.ps1.stderr.log` includes a renderer `render-probe` entry with:
  - `hasBridge: true`
  - title `TriFix AI: Tiny Office Mode`
- `dev.current.stderr.log` contains multiple `render-probe` entries showing the UI loaded previously.
- `dev.current.stderr.log` also contains `process-url-detect found` entries for managed project runs, showing URL detection was exercised previously.

## Needs revalidation

- Fresh `npm install`
- Fresh `npm run build`
- Fresh `npm run dev`
- Current Electron launch behavior on this machine
- Managed project run/stop/open URL on a clean local sample
- GUI QA and Playwright flows
- UI Quality and design loop artifact generation
- Recovery/manual review/resume paths

## Not currently testable without AI

- PM planning quality
- DEV generation quality
- QA review quality
- Full PM / DEV / QA autonomy run
- Full design-improvement loop with AI-driven patching

## Useful evidence sources in the repo

- `dev.ps1.stdout.log`
- `dev.ps1.stderr.log`
- `dev.current.stderr.log`
- `dist/`
- `scripts/quick-trifix-validation.ps1`
- `AUTONOMY_PLAN.md`
