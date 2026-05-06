# Problem and Goals

## The Problem

Traditional AI coding assistants often suffer from several key limitations:
1. **Statelessness**: They lack a durable understanding of the project's state and history across sessions.
2. **Context Growth**: Sending the entire codebase for every request is expensive and exceeds token limits.
3. **Execution Gap**: Most assistants can suggest code but cannot safely execute commands, run tests, or verify their own output.
4. **Manual Overhead**: Multi-agent systems often require constant user clicking to proceed through stages.

## Project Goals

TriFix AI aims to solve these problems by building an autonomous runtime that operates like a real software team.

### Primary Goals

- **Durable Output**: Move from session-based chat to output-based persistence. Every action, decision, and file write is logged and recoverable.
- **Minimal Interruption**: The system should work through planned phases autonomously, only stopping for critical blockers or unsafe actions.
- **Safety First**: Use a sandbox-first approach with restricted filesystem access and a command allowlist.
- **Context Efficiency**: Implement a layered context policy using persistent project maps and structural graphs (Graphify) instead of raw file scanning.

### Target Features (The "Tiny Office" Vision)

- **24/7 Autonomy (Planned)**: Capability for "Overnight Mode" where agents work through a task queue.
- **Validation & Repair**: A closed-loop system where agents run builds/tests and fix errors until the task is complete.
- **Structural Awareness**: Using AST-level extraction to understand imports, classes, and relationships across the repo.
- **Premium UX**: A dashboard that prioritizes "Decision Cards" and "Artifact Ledgers" over raw chat logs.
