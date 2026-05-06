# Autonomy Runtime

The Autonomy Runtime is the evolution of the TriFix pipeline into a self-driving system. It moves beyond "Run Once" buttons toward a persistent background loop.

## Core Mechanisms

### 1. Persistent State (`.trifix/`)
The system maintains a project-local `.trifix` directory. This allows the agent team to "wake up" and know exactly where they left off, even if the application is restarted.
- **Run State**: Tracks current phase, task ID, attempt count, and last validation status.
- **Run Log**: A JSONL file recording every event (file write, command result, agent call).

### 2. Automated Validation Loop
After every file write by the Junior Dev:
1.  **Execution**: The system applies file operations.
2.  **Validation**: It automatically runs safe setup commands (e.g., `npm run build` or `npm test`).
3.  **Diagnosis**: If validation fails, the Senior Dev is called to diagnose the error.
4.  **Auto-Repair**: The Junior Dev generates a patch based on the diagnosis.
5.  **Retry**: The cycle repeats (up to a max attempt limit) until success or a hard blocker is hit.

### 3. Context Layering
To prevent token bloat, the runtime uses a layered context budget:
- **Layer 1: Run Summary**: Current phase/task and last result.
- **Layer 2: Graph Context**: Structural summary from Graphify.
- **Layer 3: Touched Files**: Files recently modified or involved in failures.
- **Layer 4: Selection**: Specific files the user or agents have flagged.

### 4. Process Management
The runtime tracks long-running processes (like `npm run dev`) under `.trifix/processes`.
- **Log Streaming**: Stdout and Stderr are written to files.
- **Health Checks**: The system detects local app URLs and provides "Open URL" or "Stop Process" controls.

## Autonomy Modes

| Mode | Trigger | Persistence | Interaction |
| :--- | :--- | :--- | :--- |
| **Manual** | UI Button | Session-based | User reviews every step. |
| **Partial (Current)** | UI Trigger | Durable Files | System auto-repairs 1-2 times before stopping. |
| **Autonomous (In-Dev)** | Background Loop | Durable Queue | System works through a task queue overnight. |

## Stop Conditions
The runtime will pause or stop if:
- Maximum attempts per task are reached.
- An unsafe command is requested.
- A missing secret/API key is detected.
- The output fails to produce a runnable entry point after multiple repairs.
