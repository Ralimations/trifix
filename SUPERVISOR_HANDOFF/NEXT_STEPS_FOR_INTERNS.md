# Next Steps For Interns

## Recommended continuation roadmap

1. Get the project running locally.
   - Re-run `npm install`, `npm run build`, and `npm run dev`.
   - Confirm the Electron app launches and the preload bridge works.

2. Verify the basic local workflow.
   - Confirm tracked project views load.
   - Confirm managed run/stop/open URL behavior works for a local sample app.

3. Document the offline/manual feature set clearly.
   - Capture what remains useful without any AI endpoint.
   - Note every button/path that should be disabled or relabeled when AI is unavailable.

4. Reconnect or configure AI endpoints.
   - Restore OpenAI-compatible endpoints for PM, DEV, and QA.
   - Re-run model preflight and classify endpoint/model failures accurately.

5. Revalidate the PM / DEV / QA flow.
   - Run a small controlled task first.
   - Confirm runbook, artifact, approval, and failure-state behavior.

6. Replace one huge DEV JSON response with multi-phase generation.
   - Phase 1: scaffold
   - Phase 2: `src/App.jsx`
   - Phase 3: `src/styles.css`
   - Phase 4: `package.json` and dependencies
   - Phase 5: validation pass

7. Improve run-state consistency.
   - Re-test active-run locking.
   - Re-test stop cleanup and resume/manual-review transitions.
   - Tighten status/reporting normalization.

8. Strengthen offline/manual mode.
   - Make offline/manual mode explicit in the UI.
   - Ensure deterministic tools still feel intentional even with AI disabled.

9. Add project-type profiles.
   - Vite React
   - static HTML
   - Node API
   - Python CLI
   - Python computer vision

10. Add stable tests and smoke checks.
   - File/path validation tests
   - Managed process runner smoke checks
   - Runbook/resume tests
   - GUI QA capability tests
   - Offline/manual mode smoke tests

11. Prepare packaging/release flow.
   - Revalidate production build/start flow.
   - Decide whether an installer or portable internal package is needed.

## Recommended next milestone

The best next milestone is not “full autonomy.” It is:

"TriFix runs cleanly offline, clearly shows what is AI-dependent, and can complete a small AI-assisted Vite/React workflow reliably with restored endpoints and multi-phase DEV generation."
