# TriFix AI V2: Software Team Simulator

Desktop developer tool that simulates a small AI software team around a local project or task sandbox.

## Stack

- Electron main process for filesystem access, IPC, local metadata, context upload, and safe commands
- Vite + React renderer for the team UI, speech bubbles, project tracking, and decision flow
- Local-only file reads through a restricted preload API

## Setup

```bash
npm install
npm run dev
```

DEV and QA use the VPN endpoint:

```text
POST http://10.8.0.3:3011/api/v1/chat
```

PROJECT MANAGER uses:

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

## V2 Workflow

TriFix keeps the existing three-agent architecture but repurposes the roles:

1. PROJECT MANAGER: reads uploaded FSD/docs/image metadata, creates PRD, defines phases and tasks, and makes final scope decisions.
2. QA: converts PM direction into DEV steps, reviews implementation output, checks PRD alignment, and reports risks.
3. DEV: implements the task, returns patches, and requests safe project commands when needed.

The loop is:

```text
PM -> QA -> DEV -> QA -> PM
```

Each run can produce:

- PRD goals, features, constraints
- phase and task tracking
- QA instructions and review
- DEV implementation patches
- PM final decision
- command requests and command logs

## Context Input

The UI can upload:

- `.pdf`
- `.txt`
- `.md`
- `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`

TriFix summarizes uploaded context before it is sent to the agents. Images are stored as design context metadata; local OCR is not performed.

## Command Controls

The renderer exposes explicit user controls:

- Run Project
- Debug Project
- Add Instruction

Commands run only inside the current project folder. Supported commands include:

- `npm install`
- `npm run dev`
- `npm run build`
- `npm test`
- `node <file>`
- `python <file>`
- `mkdir <folder>`

Dangerous shell syntax, path traversal, external script pipes, and destructive system commands are blocked.

## File Access Rules

Blocked names: `node_modules`, `.git`, `.env`, `.env.*`, `dist`, `build`.

Allowed extensions: `.js`, `.ts`, `.jsx`, `.tsx`, `.json`, `.css`, `.html`, `.md`, `.txt`, `.pdf`, images, `.cpp`, `.h`, `.hpp`, `.py`, `.sql`.

The Electron main process rejects absolute selected paths, path traversal, blocked directories/files, unsupported extensions, files above 180 KB, and selections above 10 files.

When a project is opened, TriFix creates `Sandbox folder/` at the project root. AI patches may create new files and nested folders inside that sandbox. Outside `Sandbox folder/`, patches must target existing project files.

Prompt-only runs create a task sandbox under:

```text
Documents/TriFix AI Sandbox/sandbox/tasks/task-YYYYMMDD-HHMMSS/
```

## Folder Structure

```text
electron/
  agent/orchestrator.js  V2 PM/QA/DEV pipeline and prompt compaction
  constants.js           endpoint, models, file limits
  fileSystem.js          safe project tree, file reads, patch preview/apply
  main.cjs               Electron window, IPC, context upload, safe commands
  preload.cjs            narrow renderer API
src/
  App.jsx                Software team UI and state
  main.jsx               React entry
  styles.css             dashboard styling and status animation
```

Agent names, roles, prompt instructions, speech habits, and sprite paths live in [shared/agentConfig.js](</d:/ralskunk/trifix/shared/agentConfig.js>).
