# Demo Script: The Autonomous Software Team

This script demonstrates the "Tiny Office" autonomous workflow.

## Scenario: Building a Todo API in the Sandbox

### 1. The Goal
Show the user starting with an empty sandbox and a single instruction: *"Build a Node.js Express API for a Todo list with CRUD endpoints."*

### 2. Planning Phase
- **Highlight**: The PM (Architect) appears in the UI.
- **Outcome**: The UI displays a "Product Requirements Document" and a list of "Planned Tasks" (e.g., `Setup Express`, `Implement Routes`, `Add Validation`).
- **Persistence**: Point out that `.trifix/run-state.json` has been created.

### 3. Implementation Phase
- **Highlight**: The Junior Dev (Junior) starts "coding".
- **Action**: File operations appear in the UI (e.g., `server.js`, `package.json`).
- **Persistence**: Show the `Sandbox folder/` filling up with files.

### 4. The Validation & Auto-Repair Loop (Crucial)
- **Scenario**: The Junior Dev forgets to include `express` in `package.json`.
- **Action**: The system runs `npm run build` (or a node check) and it fails with `Error: Cannot find module 'express'`.
- **Highlight**: The UI shows the Senior Dev (Supervisor) diagnosing the error: *"The 'express' dependency is missing from package.json."*
- **Action**: The Junior Dev automatically generates a patch adding `express`.
- **Outcome**: The system re-runs the check and it passes.

### 5. Review & Decision
- **Highlight**: The Senior Dev performs a final review and flags any risks.
- **Action**: The PM makes the final decision.
- **Outcome**: The UI shows a "Success" status and a final report summary.

### 6. Process Monitoring
- **Action**: Run the project using the "Run Project" button.
- **Highlight**: The "Logs" tab shows `npm run dev` starting.
- **Outcome**: The system detects the local port and provides an "Open URL" link.

## Key Talking Points
- *"TriFix isn't just generating code; it's managing the state of the project."*
- *"Notice how the agents fixed the build error without me having to copy-paste anything."*
- *"Everything you see is persisted locally in the `.trifix` folder, making it a durable autonomous runner."*
