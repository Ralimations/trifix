# Known Limitations

- AI/model endpoints used during development are not available in the current environment.
- Full autonomy cannot currently be demonstrated without restored model access.
- TriFix should not be described as fully autonomous or production-ready.
- Local smaller models previously struggled with long strict JSON file-generation payloads.
- The current AI generation loop needs a multi-phase approach to improve reliability.
- Runtime paths, process cleanup behavior, and some reporting paths need fresh revalidation after setup.
- GUI QA and the design improvement loop exist structurally, but full end-to-end use still depends on stable model endpoints and local tool availability.
- Current project support is strongest for Vite/React web apps.
- Non-web app support will need future project-type profiles and validators.
- Some run-state, stop-state, and reporting consistency paths still need cleanup and testing.
- Existing earlier documentation sometimes speaks in a more autonomy-forward tone than is appropriate for supervisor handoff; this package intentionally uses a more conservative description.
