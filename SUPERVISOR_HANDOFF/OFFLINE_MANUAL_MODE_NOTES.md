# Offline / Manual Mode Notes

## What remains useful without AI

- Project list and workspace browsing.
- Managed `Run Project` / `Stop Project`.
- `Open URL` for detected local app URLs.
- Commands panel and terminal history.
- Local build verification flows.
- GUI QA capability checks if Playwright is installed.
- UI Quality Check and related design artifacts where deterministic paths apply.
- Runbook and artifact viewing.
- Recovery and manual review surfaces.
- Settings and model visibility/preflight messaging.
- Local project documentation and review/export surfaces.

## What changes conceptually when AI is unavailable

TriFix should be treated as a local workflow workspace with deterministic tools and dormant AI plumbing, not as an active autonomous builder. The PM / DEV / QA structures still help explain the design, but live execution cannot be relied on until model endpoints are restored.

## Recommended future Offline/Manual Mode polish

- Add a visible offline/manual mode badge.
- Disable or relabel AI-only buttons when no endpoint is available.
- Offer clear fallback actions instead of letting AI-only flows fail late.
- Provide a simple manual project creation/testing flow for demonstrating the desktop workspace without autonomy.
- Make manual review and recovery actions easier to understand without prior project context.
