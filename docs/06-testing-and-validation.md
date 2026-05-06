# Testing and Validation

TriFix AI prioritizes output correctness through a multi-layered validation strategy.

## Validation Layers

### 1. File Operation Verification
Immediately after the Junior Dev writes file operations, the system verifies the disk state:
- **Write Check**: Confirms files were actually written to the expected paths.
- **Path Verification**: Ensures no files escaped the sandbox or hit blocked paths.

### 2. Automated Build & Setup
The system automatically executes "Safe Commands" as part of the pipeline:
- `npm install`: To ensure dependencies are present.
- `npm run build`: To verify project structure and syntax correctness.
- `npm test`: To run existing unit/integration tests.

### 3. Senior Dev / QA Review
The `Supervisor` agent performs a final review of the output.
- **PRD Alignment**: Checks if the code actually meets the requirements defined by the PM.
- **Risk Reporting**: Identifies potential security, performance, or logic issues that automated tests might miss.
- **Checklist Verification**: Matches output against the "Acceptance Criteria" defined in the PM's plan.

## The Auto-Repair Loop

When a validation command (like `npm run build`) fails, the following loop is triggered:
1.  **Capture**: The system captures the full `stdout` and `stderr` of the failing command.
2.  **Diagnosis**: The error log is sent to the **Senior Dev (Supervisor)**.
3.  **Patching**: The **Junior Dev (Junior)** receives the diagnosis and generates a repair patch.
4.  **Re-Validation**: The system applies the patch and re-runs the validation command.
5.  **Persistence**: The outcome is logged in `.trifix/run-state.json`.

## Safe Command Policy

TriFix restricts command execution to a pre-defined allowlist to prevent destructive actions:
- **Allowed**: `npm install`, `npm run build`, `npm run dev`, `npm test`, `node <file>`, `python <file>`, `mkdir <folder>`.
- **Blocked**: Dangerous shell syntax (`&&`, `||`, `|`), path traversal (`..`), external script pipes (`curl | sh`), and system-level commands (`rm -rf /`).
