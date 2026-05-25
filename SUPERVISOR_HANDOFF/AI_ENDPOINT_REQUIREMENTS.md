# AI Endpoint Requirements

## What kind of endpoint TriFix expected

TriFix was built around model endpoints that behave like OpenAI-compatible chat APIs. The existing defaults in `shared/agentConfig.js` point to `/api/v1/chat` style HTTP endpoints.

## Local LM Studio / OpenAI-compatible endpoint concept

The intended setup appears to be local or LAN-hosted chat-model servers such as LM Studio-compatible endpoints or similar OpenAI-style wrappers. The code expects HTTP POST requests with:

- a model name
- a system prompt
- a user/input payload

## Why endpoint availability matters

Without working endpoints, TriFix loses the live AI parts of the workflow:

- PM cannot generate scoped plans.
- DEV cannot generate or repair file operations.
- QA cannot review outputs or return verdicts.
- AI-assisted design improvement cannot complete end-to-end.

The desktop workspace and deterministic tools still remain useful, but the autonomy layer does not.

## What PM / DEV / QA need from the model

- PM
  - compact planning
  - required files
  - constraints
  - acceptance criteria
- DEV
  - file generation
  - structured file operations
  - safe command requests
  - bounded repair output
- QA
  - evidence-based review
  - patch guidance
  - PASS / NEEDS PATCH style verdicts

## Known issue: malformed JSON from local models

One of the main practical issues in this project was that local smaller models could return malformed or incomplete JSON, especially when asked to generate too many files or too much structure in one response.

## Recommended model/output approach

- Use smaller prompts.
- Use multi-phase generation instead of one giant response.
- Enforce a strict schema for each phase.
- Keep retry/repair bounded and explicit.
- Retain deterministic validation after each phase.

## Practical recommendation

If future interns restore model access, they should prioritize reliability over ambition. A smaller scoped AI loop with deterministic validation is more useful than a larger autonomy claim that fails under real use.
