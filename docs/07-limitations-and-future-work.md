# Limitations and Future Work

## Current Limitations

While TriFix AI is moving toward full autonomy, several limitations exist in the current implementation:

- **Manual Trigger for Tasks**: The multi-task decomposition (breaking a project into 10+ sub-tasks) is designed but still requires manual oversight for task transitions in the current UI.
- **Context Window Limits**: Even with Graphify, large projects can still hit context limits if too many files are selected simultaneously. The "Layered Context Policy" is being refined.
- **Local Model Constraints**: Performance depends heavily on the local LLM used. 7B-9B models may occasionally struggle with complex logic or strict formatting requirements (JSON parsing).
- **No Browser Interaction**: Currently, the system cannot perform browser-based smoke tests (e.g., Playwright/Cypress) autonomously, although process tracking for dev servers is implemented.
- **Single Task Focus**: The current queue resume after an application crash/restart is still in the "Pending" implementation phase.

## Future Work (Roadmap)

### Phase 5 Completion: Full Autonomous Queue
- Implement **Resume from State**: Allow the system to pick up a partially finished task queue after an app restart.
- **Multi-Task Decomposition**: Enable the PM to break large goals into a long queue of autonomous tasks.

### Phase 6: Extended Capabilities
- **Browser Smoke Tests**: Add a headless browser tool for agents to verify UI rendering.
- **Database Migrations**: Add safe support for local SQLite/PostgreSQL migrations.
- **External API Knowledge**: Integrate search/documentation retrieval tools for better support of new libraries.

### Phase 7: Collaborative Mode
- Multi-user syncing of the `.trifix` run state.
- Integration with Git (Commit/PR) as a final stage of the autonomous loop.
