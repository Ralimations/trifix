# Setup And Run

## Prerequisites

- Windows environment was used during development.
- Node.js and npm are required.
- Electron, React, and Vite dependencies are already declared in `package.json`.
- Optional: Playwright and browser binaries if GUI QA is being revalidated.

## Node.js version expectation

The repository does not pin a `.nvmrc` or `engines` field. It uses Electron `^31.7.7`, Vite `^5.4.11`, and React `^18.3.1`, so a modern Node.js LTS version should be used and revalidated locally.

## Install dependencies

```bash
npm install
```

## Build the renderer

```bash
npm run build
```

`package.json` defines this as `vite build --base ./`.

## Run in development

```bash
npm run dev
```

This starts Vite first, then launches Electron through `scripts/dev.mjs`.

## Run the built app

```bash
npm start
```

This launches Electron through `scripts/start.mjs`.

## Existing helper scripts

- `npm run dev:restart`
  - Runs `scripts/restart-dev.ps1` to stop TriFix-owned dev processes and restart the app.
- `npm run dev:clean`
  - Runs the same script with cleanup only.
- `npm run dev:dryrun`
  - Shows what the restart/cleanup script would do.
- `scripts/quick-trifix-validation.ps1`
  - A validation helper that checks core project files, runs build, starts a dev server, detects a local URL, and optionally checks Playwright capability.

## Running without AI

TriFix can still be demonstrated in offline/manual mode:

- Launch the desktop app.
- Open tracked projects and inspect workspace panels.
- Use `Run Project`, `Stop Project`, and `Open URL` for deterministic project execution.
- Use the Commands panel and terminal history.
- Inspect settings, preflight status, recovery/runbook surfaces, and documentation artifacts.
- Use UI Quality or GUI QA helpers only where their local prerequisites are present.

## Configuring AI endpoints if available

Agent endpoints and models are defined through environment variables referenced in `shared/agentConfig.js`:

- `TRIFIX_PM_ENDPOINT`
- `TRIFIX_PM_MODEL`
- `TRIFIX_DEV_ENDPOINT`
- `TRIFIX_DEV_MODEL`
- `TRIFIX_QA_ENDPOINT`
- `TRIFIX_QA_MODEL`
- Optional timeout overrides:
  - `TRIFIX_PM_TIMEOUT_MS`
  - `TRIFIX_DEV_TIMEOUT_MS`
  - `TRIFIX_QA_TIMEOUT_MS`

The existing defaults expect OpenAI-compatible `/api/v1/chat` style endpoints.

## Common troubleshooting

- If the app does not launch, re-run `npm install` and `npm run build`, then retry `npm run dev`.
- If `npm run dev` leaves stale processes, use `npm run dev:restart` or `npm run dev:clean`.
- If model preflight shows offline/unavailable, live autonomy should be treated as unavailable until endpoints are fixed.
- If GUI QA is unavailable, check Playwright package and browser installation.
- If managed project execution behaves inconsistently, revalidate local paths, process cleanup, and runtime artifacts before deeper debugging.
