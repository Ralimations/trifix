# TriFix AI: Tiny Office Mode

Desktop developer tool for running a three-agent code review and repair pass against a local snippet or selected project files.

## Stack

- Electron main process for filesystem access, IPC, and AI calls
- Vite + React renderer for the Tiny Office UI
- Local-only file reads through a restricted preload API

## Setup

```bash
npm install
npm run dev
```

The AI endpoint is expected to be reachable over VPN:

```text
POST http://10.8.0.3:3011/api/v1/chat
```

Override it when needed:

```bash
set TRIFIX_AI_ENDPOINT=http://10.8.0.3:3011/api/v1/chat
npm run dev
```

## Build

```bash
npm run build
npm start
```

## Folder Structure

```text
electron/
  agent/orchestrator.js  AI pipeline, prompt compaction, timeout/error handling
  constants.js           endpoint, models, file limits
  fileSystem.js          safe project tree and selected file reads
  main.js                Electron window and IPC
  preload.cjs            narrow renderer API
src/
  App.jsx                Tiny Office UI and state
  main.jsx               React entry
  styles.css             dashboard styling and status animation
scripts/
  dev.mjs                starts Vite then Electron
```

## File Access Rules

Blocked names: `node_modules`, `.git`, `.env`, `.env.*`, `dist`, `build`.

Allowed extensions: `.js`, `.ts`, `.jsx`, `.tsx`, `.json`, `.css`, `.html`, `.md`, `.cpp`, `.h`, `.hpp`, `.py`, `.sql`.

The Electron main process rejects absolute selected paths, path traversal, blocked directories/files, unsupported extensions, files above 180 KB, and selections above 10 files.

## Pipeline

1. Junior Explainer: `google/gemma-4-e2b`
2. Senior Critic: `gemma-4-e4b-uncensored-hauhaucs-aggressive`
3. Lead Architect: `google/gemma-4-e4b`

Each run returns:

```json
{
  "explanation": "",
  "critique": "",
  "fixedCode": "",
  "recommendation": "",
  "filesAnalyzed": []
}
```
