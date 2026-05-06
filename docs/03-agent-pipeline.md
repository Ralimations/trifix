# Agent Pipeline: The Software Team Loop

The core of TriFix is its structured multi-agent pipeline. It mimics a professional software development workflow by separating concerns between planning, implementation, and review.

## The Standard Loop

The pipeline follows a **PM -> QA -> DEV -> QA -> PM** flow:

1.  **Project Manager (Architect)**: 
    - Analyzes the input and project context.
    - Creates a Product Requirements Document (PRD).
    - Defines phases and task tracking.
2.  **Senior Dev/QA (Supervisor)**: 
    - Converts the PM's high-level direction into specific DEV instructions.
    - Performs an initial technical review of the plan.
3.  **Junior Dev (Junior)**: 
    - Implements the task based on QA instructions.
    - Returns file patches and requests necessary commands (e.g., `npm install`).
4.  **Patch Pass (Junior Dev)**:
    - If the Senior Dev identifies issues in a parallel review, the Junior Dev performs a "Patch Pass" to refine the implementation before the final review.
5.  **Final Review (Supervisor)**:
    - Checks the implementation against the PRD and QA instructions.
    - Reports risks and confirms completion.
6.  **Final Decision (Architect)**:
    - Makes the final "Accept" or "Needs Patch" decision based on the team's output.

## Agent Roles & Configurations

Agents are defined in `shared/agentConfig.js`. Each has specific habits, models, and endpoints.

| Role | Agent ID | Model (Default) | Focus |
| :--- | :--- | :--- | :--- |
| **Project Manager** | `architect` | `gemma-4-e4b` | Product vision, scope, final decisions. |
| **Senior Dev/QA** | `supervisor` | `qwen3.5-9b` | Code review, instructions, safety checks. |
| **Junior Dev** | `junior` | `qwen3.5-9b` | Implementation, patching, file operations. |

## Communication Flow

- **Parallel Review**: The Senior Dev often reviews the plan in parallel with the Junior Dev's initial coding to save time.
- **Compact Context**: TriFix uses a "Compact Context" builder to ensure agents only receive the most relevant information (selected files, graph nodes, uploaded docs) rather than raw dumps.
- **Speech Habits**: Agents have personality traits (e.g., "brief and direct", "technical and critical") that influence their generated dialogue in the UI.
