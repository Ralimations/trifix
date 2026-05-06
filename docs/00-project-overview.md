# Project Overview: TriFix AI (V2)

TriFix AI is a desktop developer tool designed to simulate a small, specialized AI software team within a local project or task sandbox. It leverages a multi-agent orchestration pipeline to automate software development tasks while maintaining human-in-the-loop oversight.

## Core Concept

The project focuses on moving beyond simple chat-based AI assistants toward a **durable, output-based autonomous agent runtime**. Instead of just generating code snippets, TriFix manages a full development lifecycle:
1. **Planning**: Defining goals and requirements (PRD).
2. **Implementation**: Generating file patches and executing commands.
3. **Validation**: Running tests and builds to ensure correctness.
4. **Repair**: Automatically diagnosing and fixing failures.

## Key Components

- **Electron Main Process**: Handles filesystem access, IPC, local metadata, and safe command execution.
- **Vite + React Renderer**: Provides a premium "Tiny Office" dashboard for monitoring the team, project tracking, and decision flow.
- **Multi-Agent Pipeline**: A structured workflow involving three distinct roles:
    - **Project Manager (Architect)**: Scope decisions and high-level planning.
    - **Senior Dev/QA (Supervisor)**: Technical review, instruction generation, and risk reporting.
    - **Junior Dev (Junior)**: Code implementation and patching.
- **Sandbox Environment**: All work is performed in restricted task folders to ensure safety and isolation.

## Technical Stack

- **Frontend**: React 18, Vite 5, Tailwind CSS (via custom styles), Lucide React.
- **Backend**: Electron 31, Node.js (filesystem, child processes).
- **AI Integration**: Local LM Studio-compatible endpoints (e.g., Qwen 2.5, Gemma 2) and VPN-based remote endpoints.

## Current Focus: Autonomy

TriFix is currently evolving from a user-triggered multi-agent assistant into a fully autonomous runner capable of long-running sessions with minimal user interruption. This includes persistent run states, automated validation loops, and structural context awareness via tools like Graphify.
