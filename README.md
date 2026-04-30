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

Junior and Supervisor use the VPN endpoint:

```text
POST http://10.8.0.3:3011/api/v1/chat
```

Architect uses:

```text
POST http://localhost:3010/api/v1/chat
```

Override them when needed:

```bash
set TRIFIX_AI_ENDPOINT=http://10.8.0.3:3011/api/v1/chat
set TRIFIX_ARCHITECT_ENDPOINT=http://localhost:3010/api/v1/chat
set TRIFIX_ARCHITECT_MODEL=google/gemma-4-e4b
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

When a project is opened, TriFix creates `Sandbox folder/` at the project root. AI patches may create new files and nested folders inside that sandbox, including complete throwaway projects such as `Sandbox folder/example-app/package.json`. Outside `Sandbox folder/`, patches must target existing project files. The sandbox still blocks `.git`, `.env`, `.env.*`, `.trifix-backups`, and `node_modules`.

If a user runs a prompt without opening a project, TriFix automatically creates and opens `Documents/TriFix AI Sandbox/`, then uses `Documents/TriFix AI Sandbox/Sandbox folder/` as the writable AI sandbox.

## Pipeline

1. YOU (`r` / Junior Dev): `google/gemma-4-e2b`
2. SUPERVISOR (`j`): `gemma-4-e4b-uncensored-hauhaucs-aggressive`
3. ARCHITECT (`a`): `google/gemma-4-e4b`

## Agent Config

Agent names, roles, prompt instructions, speech habits, and sprite paths live in [shared/agentConfig.js](</d:/ralskunk/trifix/shared/agentConfig.js>).

Example: the supervisor is configured with `speech.prefix = "Bai"`, and that habit is injected into the system prompt during orchestration.

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
