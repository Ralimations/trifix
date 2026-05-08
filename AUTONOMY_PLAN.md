# TriFix Autonomy Plan

This plan defines how TriFix grows from a user-triggered multi-agent coding pipeline into a local-first autonomous software workspace.

TriFix should not pretend to be magic. It should create real files, validate actual output, preserve artifacts, report uncertainty honestly, and ask the user only when a decision or missing dependency actually blocks progress.

The user should mainly see:

- model/server readiness
- current output folder
- files changed
- app URL or run status
- workflow progress
- validation/build status
- unavailable models
- blockers
- final report
- next prompt box for patching/extending output

The agents should not repeatedly reread every file. They should use global brain memory, project graph context, selected changed files, validation evidence, and targeted file excerpts.

---

## Current Product Direction

TriFix is moving away from fixed phase gates like:

```text
Phase 1 → Phase 2 → Phase 3

The current intended flow is:

Prompt → Preflight → Agent Workflow → Output/Review → Follow-up Prompt

The user does not need to click Accept/Deny after every run. The next prompt becomes the next patch, improvement, feature request, or new project instruction.

Example:

Prompt 1: Create a Vite React dashboard.
Output: files generated, validation/build status shown.

Prompt 2: Improve the card design and spacing.
Behavior: patch the existing generated project.

Prompt 3: Add working edit modal.
Behavior: patch/add feature to the existing generated project.

Prompt 4: Create a new project called Static HTML Test.
Behavior: start a new sandbox project.

This makes TriFix an iterative local dev assistant instead of a committee simulator with too many buttons. A touching act of mercy.

Current State

TriFix now has these implemented or partially implemented pieces:

Core Runtime
Electron backend with file and command access.
Sandbox task folders.
PM / Architect, Junior Dev, and Senior Dev / QA roles.
File operation executor.
Safe command allowlist.
Project recents and metadata.
.trifix project artifacts.
Final report generation.
Run logs and state persistence.
Follow-up prompt flow for patching/extending projects.
Global Brain Memory

TriFix now has a global .trifix-brain/ memory layer.

Purpose:

stores stable agent behavior rules
reduces repeated prompt bloat
keeps PM, Developer, and QA aligned
stores output contracts, command policy, QA rules, Vite standards, static HTML standards, verifier rules, known failures, and demo rules

The Global Brain is separate from project Graphify context.

Global Brain = how TriFix behaves
Graphify / Project Context = what this project contains
Preflight Initialization

TriFix now checks model availability before starting a run.

Preflight checks:

PM / Architect
Junior Dev / Developer
Senior Dev / QA

It distinguishes:

online
endpoint offline
model timeout
model unavailable
invalid response
unknown error

It also detects when an endpoint is reachable but a specific model does not respond. This matters because PM and QA may share the same LM Studio server.

Preflight states:

checking
ready
ready with warnings
degraded available
blocked
Run Modes

TriFix now supports or is moving toward these modes:

Normal

Required:

PM online
Developer online

Optional:

QA online
Normal with QA unavailable

Allowed when:

PM online
Developer online
QA offline or unavailable

Behavior:

PM plans
Developer builds
QA skipped
deterministic verification still runs
final status may be needs_review
Developer-only degraded mode

Allowed when:

PM offline/unavailable
Developer online

Behavior:

skip PM planning
skip QA if unavailable
send detailed user prompt directly to Developer
inject Global Brain for Junior
run deterministic verification
final status must be needs_review
final report records degraded mode

This mode is useful, but it requires detailed prompts. It should never pretend to be equivalent to the full PM → Dev → QA workflow.

Blocked

Occurs when:

Developer is offline

Behavior:

generation is blocked
no Proceed Anyway for file generation
user must start the Developer model/server first
Run Locking

TriFix now has active run protection.

Purpose:

prevents multiple runs from starting at the same time
prevents spam-clicking Run from spawning multiple PM calls
ignores stale/cancelled run results
protects the UI and project state from old run updates

Expected behavior:

One active run at a time.
Stop/Cancel before starting another.
Late cancelled results are ignored.
Workflow Progress

TriFix now uses an agent workflow instead of fixed phases.

Main workflow:

Planning → QA Check → Development → Verification → Final Review → Decision

The UI should show this as a visible stepper/progress bar, not as a bullet checklist.

Step states:

pending
active
complete
skipped
needs_review
failed
Vite vs Static HTML Validation

TriFix now separates Vite/React validation from static HTML validation.

Static HTML:

index.html can be opened directly
direct file preview is valid

Vite/React:

index.html is only an app shell
direct file:// index.html is not valid proof
validation should check package structure, scripts, imports, and build status
if build was not run, status should be build_unverified or needs_review

Vite projects should not show:

open index.html passed

unless it is clearly marked as not being real Vite validation.

QA Hardening

QA now receives more evidence:

original request
PM plan
expected files
proposed/generated files
actual written files
failed operations
verifier/build evidence
project type
validation mode
file excerpts

QA should not rubber-stamp.

QA should return:

pass
needs_review
fail

QA should not say PASS when:

required evidence is missing
build was requested but not run
required files are missing
verifier failed
generated files violate constraints
Updated Goal

TriFix should become a local-first, output-based autonomous coding workspace.

It should:

check model availability before running
choose the correct run mode
generate real files
validate actual disk output
distinguish static HTML from Vite/React
repair only when there is concrete evidence
preserve useful output even when final review fails
show clear workflow progress
write useful final reports
allow follow-up prompts as patches/features
support long-running local work without pretending uncertain states are complete
Architecture Principles
1. Output First

The product should center on generated output, not agent chatter.

Main user-visible output:

generated folder
changed files
validation/build state
app URL when available
final report
next prompt box

Agent messages are useful, but they are secondary.

2. Evidence Over Vibes

TriFix should not mark work as complete because a model says it is complete.

Completion should depend on evidence:

files exist
file operations succeeded
verifier passed
build passed if run
QA/final PM evidence supports completion

If evidence is incomplete:

needs_review

Not fake success. We have suffered enough from confident nonsense.

3. Preflight Before Runtime

Before starting a run, TriFix should check:

required model availability
optional model availability
endpoint vs model failure
selected run mode

The run should not start blindly.

4. Degraded Mode Is Explicit

Developer-only mode is allowed, but must be labeled clearly.

It should never be presented as full autonomy.

5. Follow-up Prompt Is the Decision

Normal flow:

Output generated → user reviews → user sends another prompt if needed

Avoid unnecessary Accept/Deny gates unless the operation is unsafe, destructive, or manually blocked.

Runtime Model Roles
PM / Architect

Responsibilities:

interpret user request
reduce ambiguity
define file scope
create compact implementation plan
avoid overengineering
define acceptance criteria
make final planning decisions when available

PM is required for normal mode.

If PM is unavailable, Developer-only mode may proceed only with user confirmation.

Junior Dev / Developer

Responsibilities:

generate actual files
return file operations or path-tagged code blocks
request safe commands through structured command requests
avoid advice-only output
follow project-relative paths
implement patches/features on existing output

Developer is required for all generation modes.

Senior Dev / QA

Responsibilities:

review PM plan
review generated files/evidence
check constraints
check verifier/build evidence
suggest focused fixes
avoid expanding scope unnecessarily

QA is optional.

If QA is unavailable:

QA skipped → deterministic verification continues → likely needs_review
Preflight Initialization
Purpose

Avoid confusing failures caused by offline models, wrong model names, sleeping LM Studio servers, or VPN issues.

Health Check Payload
{
  "model": "<model-name>",
  "system_prompt": "Return OK only.",
  "input": "OK"
}
Health Policy
default health timeout: 5000ms
max health timeout: 10000ms
health timeout must never be used for real generation calls
generation timeouts are separate
Health Stability

Health checks should be grouped by endpoint.

Example:

PM: 10.8.0.3:3011
QA: 10.8.0.3:3011
Developer: 127.0.0.1:3010

PM and QA should be checked sequentially because they share one LM Studio endpoint.

Developer can be checked in parallel because it uses a different endpoint.

If endpoint is reachable but a model times out, retry once.

Health Result Shape
{
  "online": false,
  "endpointReachable": true,
  "modelResponded": false,
  "endpoint": "http://10.8.0.3:3011/api/v1/chat",
  "model": "google/gemma-4-e2b",
  "attempts": 2,
  "elapsedMs": 10012,
  "perAttemptElapsedMs": [5003, 5002],
  "classification": "model_timeout",
  "error": "Timed out after 5000ms.",
  "statusCode": 0
}
Preflight UI

Show:

status summary
active models
unavailable models
recommended mode
actions

Actions:

Start Run
Proceed Anyway, only for Developer-only degraded mode
Recheck Models
Back to Landing
Workflow Progress

Replace the old fixed phase UI with an agent workflow stepper.

Steps
Planning → QA Check → Development → Verification → Final Review → Decision
Step Mapping
Preflight active → Initialization / Planning pending
PM planning → Planning active
PM complete → Planning complete
QA health/review → QA Check active
QA unavailable → QA Check skipped
Junior generating → Development active
Junior fulfilled → Development complete
File apply/verifier/build → Verification active
Build not run → Verification needs_review / build_unverified
Final QA/PM → Final Review active
Final PM timeout after files exist → Final Review needs_review
Final status → Decision complete / needs_review / failed
Visual Requirements

The progress UI should be a real stepper:

[✓ Planning]──[○ QA Check]──[● Development]──[○ Verification]──[○ Final Review]──[○ Decision]

Not a bullet list.

The stepper should be visible:

before run
during preflight
during run
after completion/review/failure
Validation Policy
Static HTML

Static HTML validation applies only when:

index.html exists
no package.json
no vite.config.*
no src/main.*
no src/App.*

Rules:

index.html must exist
full document should use <!doctype html>
direct file preview is valid
Vite / React

Vite validation applies if any of these exist:

package.json mentions Vite
scripts mention vite
vite.config.*
src/main.*
src/App.*

Rules:

package.json must parse
dev script should run Vite
build script should run Vite build
entry file exists
App file exists
CSS imports resolve
relative imports resolve
direct file:// index.html is not success evidence

If build was not run:

build_unverified / needs_review

If build ran and failed:

validation failed / needs_patch

If build ran and passed:

validation passed
Global Brain Memory

Global folder:

.trifix-brain/
  core-rules.md
  model-roles.md
  output-contract.md
  command-policy.md
  qa-policy.md
  vite-react-standard.md
  static-html-standard.md
  verifier-rules.md
  known-failures.md
  demo-rules.md
Purpose

The Global Brain stores TriFix-wide behavior rules.

Examples:

Junior must return files, not advice
PM must keep plans compact
QA must use evidence
Vite is not static HTML
commands must follow allowlist
QA offline is skipped, not fatal
final PM timeout after files exist is needs_review, not failed
Future Improvement

Add a small in-app editor for .trifix-brain later, but not yet.

Current realistic priority:

Keep Global Brain file-based and simple.
Do not add embeddings yet.
Do not add a database yet.
Project Memory and Graph Context

Graphify remains optional.

TriFix should not require Graphify for baseline operation.

Project-local structure:

.trifix/
  run-state.json
  run-log.jsonl
  memory.md
  decisions.md
  artifacts.json
  final-report.md
  graph/
    graph.json
    GRAPH_REPORT.md
    graph.html
    index-status.json
Graphify Use

Graphify can help answer:

what files import this file?
what components exist?
where is routing implemented?
what files likely relate to this validation error?
Realistic Next Step

Do not make Graphify part of every prompt yet.

Instead:

build graph on demand
store graph report
inject small graph summary only when available
use graph query mainly for repair/follow-up work
Context Selection Policy

Context should be layered:

Run Summary
project name
current workflow state
current user task
last validation result
last changed files
Global Brain
role-specific rules
output contract
Vite/static standards
known failures
Project Memory
.trifix/memory.md
previous decisions
final report summary
Graph Context
graph summary
relevant nodes/files
only if graph exists
Touched Files
files changed by last run
files with validation/build failures
user-selected files
Raw File Content
capped by token budget
only most relevant files
never include node_modules, .git, dist, build
Run State

Run state should be durable.

Example:

{
  "runId": "run-20260508-210000",
  "mode": "normal",
  "status": "needs_review",
  "startedAt": "2026-05-08T21:00:00.000Z",
  "maxRuntimeMinutes": 480,
  "workflowStep": "verification",
  "attempt": 1,
  "changedFiles": [
    "package.json",
    "index.html",
    "vite.config.js",
    "src/main.jsx",
    "src/App.jsx",
    "src/index.css"
  ],
  "projectType": "vite-react",
  "validationMode": "vite-structure",
  "lastValidationStatus": "build_unverified",
  "qaStatus": "skipped",
  "finalPmStatus": "completed",
  "nextAction": "manual_review_or_followup_prompt"
}
Status Values

Use clear status values:

running
output_ready
ready_for_review
needs_review
build_unverified
needs_patch
validation_failed
failed
cancelled
completed

Avoid using waiting_for_decision as a normal user-facing state.

Artifact Ledger

Every run should preserve:

files proposed
files written
files modified
failed file operations
commands requested
commands run
validation results
QA/final

## Artifact Ledger

Every run should preserve:

- files proposed
- files written
- files modified
- failed file operations
- commands requested
- commands run
- validation results
- QA/final PM status
- final report path
- generated output folder
- process/app runner state if available

If useful files exist and final PM fails:

```text
preserve files
status = needs_review
do not mark global failed

If QA is unavailable:

preserve files
status = needs_review unless strong validation supports completion
QA status = skipped/unavailable

If build was not run for a Vite project:

projectType = vite-react
validationMode = vite-structure
status = build_unverified or needs_review

If build ran and failed:

status = validation_failed or needs_patch
include exact build error

If build ran and passed:

status = validation_passed
include command and result

The artifact ledger should become the main source of truth for output status. Model claims are secondary. Disk evidence wins. Tiny victory for reality.

Validation and Repair Loop

For each run:

PM creates a compact plan, unless degraded Developer-only mode is used.
Junior generates file operations.
Executor writes files.
Artifact ledger records writes.
Verifier detects project type and validation mode.
Verifier checks structure and imports.
If command validation is enabled, TriFix runs build/test safely.
If validation fails:
capture exact evidence
send evidence to QA if available
ask Junior for a focused patch
apply patch
retry within attempt limit
If validation is unverified:
stop with needs_review / build_unverified
do not loop forever
If validation passes:
final QA/PM review if available
report completion or needs_review based on evidence
Repair Should Trigger Only For Concrete Failures

Repair should trigger for:

missing required files
failed file operations
invalid package.json
broken imports
actual build failure
verifier failed
QA concrete blocker with evidence

Repair should not trigger for:

QA unavailable
final PM timeout after files exist
Vite build not run
needs_review alone
missing optional model
direct file:// index.html preview being blank for Vite

This keeps TriFix from “repairing” honest uncertainty into a worse mess. A deeply underrated software principle.

Process Manager

TriFix should track long-running app processes.

Process record:

{
  "id": "proc-dev-server",
  "command": "npm run dev",
  "cwd": "sandbox/tasks/example",
  "pid": 12345,
  "port": 5174,
  "status": "running",
  "healthUrl": "http://127.0.0.1:5174",
  "stdoutLog": ".trifix/processes/dev.stdout.log",
  "stderrLog": ".trifix/processes/dev.stderr.log"
}

UI actions:

Open URL
Stop Process
Restart Process
View Logs
Realistic Next Improvements
better port detection
clearer “app is running” card
one-click npm install
one-click npm run build
one-click npm run dev
separate AI Run status from Project Run status
process crash detection
persisted process state after reopening project

Generated project execution should feel like:

Generate files → Run Project → Open URL

Not:

Generate files → hunt through folders → guess commands → wonder why Vite hates file://

Humanity has suffered enough from local dev ceremonies.

Capability Profiles

TriFix should keep command capability profiles.

Safe

Allowed:

read/write sandbox files
run npm run build
run npm test
run node <file>
inspect package metadata
read logs
Project

Allowed with normal project permission:

npm install
npm run dev
npm run start
local SQLite/file DB creation
local port health checks
local browser preview
Extended

Allowed only after explicit user/project setting:

browser smoke tests
database migrations
seed scripts
Graphify index/watch
longer-running local services
screenshot capture for UI review
Approval Required

Always requires explicit user approval:

delete non-generated folders
arbitrary PowerShell
shell pipes
secrets access
publishing/deployment
destructive commands
network downloads outside declared dependency commands
commands outside sandbox
credential or token access

The command system should never turn “autonomy” into “surprise, I deleted your folder.” A bold and controversial stance.

Overnight Mode

Overnight mode is still a future goal, not the current main priority.

It should expose:

max runtime
max attempts per task
max command time
allowed command profile
stop on first blocker
continue on recoverable validation failures
final report path
optional checkpoint interval
optional “pause before installing dependencies”

Overnight mode should not be trusted until:

run locking is stable
preflight is reliable
process manager is stable
validation is evidence-based
stale run results are ignored
final report is accurate
generated app runner is reliable
repair loop has hard limits
Realistic Overnight MVP

A realistic first version should only support:

one project
one queue
limited attempts
safe commands only
stop on blocker
final report
no automatic deployment

Do not build “full autonomous company overnight” yet. That is how people accidentally create a haunted CI pipeline.

UI Direction

Make the UI output-first.

Recommended layout:

Top
preflight status
workflow stepper
current status
active run lock indicator
Left
project files
generated files
output folder
graph status
Center
output preview/status
final report summary
validation/build state
app preview/run card
Right
agent cards
model availability
process/app runner
logs
Bottom / Floating
next prompt box
Run / Check Models & Run
Stop
Recheck Models
agent chatter, optional and cosmetic only
Normal User Flow
Start New Project
→ enter prompt
→ Check Models & Run
→ Preflight
→ Start Run
→ Output generated
→ review or send follow-up prompt
Button Naming

Avoid ambiguous labels.

Preferred:

Check Models & Run = runs AI pipeline
Run Project = runs generated app
Start New Project = creates new sandbox/project context
Stop = cancels active AI run
Recheck Models = reruns preflight

Do not show two different buttons both called “Run” unless the goal is to summon confusion like a demon in a UX lab.

Implementation Roadmap
Completed / Mostly Implemented
1. Durable Output Artifacts
.trifix/run-state.json
.trifix/run-log.jsonl
.trifix/artifacts.json
.trifix/final-report.md
file write tracking
command/result logging
hidden .trifix from normal file context
2. Global Brain Memory
.trifix-brain
role-specific brain injection
PM/Junior/QA brain budgets
Vite/static rules
known failure rules
output contract
QA policy
command policy
3. Preflight and Model Health
preflight before run
PM/Dev/QA checks
endpoint vs model failure classification
grouped health checks by endpoint
retry once on model timeout
degraded Developer-only mode
blocked mode when Developer is offline
clearer active/unavailable model cards
4. Run Locking
one active run at a time
duplicate start rejection
stale/cancelled run protection
late result ignoring
5. Workflow UX
agent workflow replacing fixed phase UI
visible stepper
prompt → output/review flow
no normal waiting-for-decision gate
6. Vite / Static Validation Split
Vite detected as project type
static HTML direct-open validation separated
Vite source no longer judged by file:// index.html
build unverified state supported
7. QA Evidence Hardening
QA receives structured evidence
QA cannot pass without enough evidence
project type and validation mode included
build status recognized
missing scripts/imports/files can be flagged
Near-Term Roadmap
Milestone A: Demo Reliability

Goal:

Make TriFix reliable enough for a live supervisor demo.

Tasks:

confirm all-model preflight works repeatedly
confirm QA-offline path works
confirm PM-offline Developer-only path works
confirm Developer-offline blocked path works
confirm Vite output does not show open index.html passed
confirm workflow stepper updates during run
confirm Run Project opens generated app correctly
confirm final-report records correct status
confirm follow-up prompt patches same project

Definition of done:

A Vite React dashboard can be generated,
files are visible,
validation status is honest,
project can be opened/run,
and follow-up prompt patches the same project.
Milestone B: Generated Project Runner

Goal:

Make generated Vite projects easy to run.

Tasks:

one-click npm install
one-click npm run build
one-click npm run dev
show detected local URL
show build/dev logs
keep process state in .trifix/processes
clearly separate AI Run vs Run Project
show “build not run” separately from “build failed”

Definition of done:

User can generate a Vite app and run it from inside TriFix without guessing commands.
Milestone C: Better Patch Mode

Goal:

Make follow-up prompts reliably patch existing projects.

Tasks:

include changed files and validation result in context
include project type
include relevant file excerpts
avoid regenerating entire project unless requested
detect “new project” intent clearly
summarize previous output before patching
preserve existing working behavior unless asked to replace it

Definition of done:

User can say “fix edit button” or “make UI better”
and TriFix patches the existing generated project.
Milestone D: Build-Aware Validation

Goal:

Use real build results when possible.

Tasks:

if package has build script, offer/run build safely
capture build errors
send build errors to QA/Junior for repair
distinguish build failed vs build not run
show build result in final report
prevent repair loops on build_unverified

Definition of done:

Vite project generation ends with either build passed,
build failed with evidence,
or build unverified.
Milestone E: Graph Context Stabilization

Goal:

Use Graphify only where it helps.

Tasks:

build graph on demand
summarize graph report
query graph during patch/repair
do not inject huge graph context
fall back cleanly if missing
avoid treating Graphify failure as project failure

Definition of done:

Graph context improves patch accuracy without becoming required.
Later Roadmap
1. Task Queue V2

Add durable PM-created tasks.

But do not return to old rigid phases.

Queue item example:

{
  "id": "task-dashboard-search",
  "goal": "Implement dashboard search filter",
  "targetFiles": ["src/App.jsx", "src/index.css"],
  "acceptance": [
    "Search filters rows by name",
    "Empty search shows all rows"
  ],
  "status": "pending",
  "attempts": 0
}

This queue should support medium projects, but it should not become visible clutter for simple tasks.

2. Browser Smoke Tests

Add basic browser checks:

app loads
root renders non-empty content
key text appears
no console error
buttons exist
expected header/text appears
app root is not blank

Do this only after process manager is stable.

3. Screenshot-Based UI Review

Optional future feature:

run app
capture screenshot
ask QA to review visual completeness
compare against user requirements

Keep this manual or semi-automatic first.

4. Local Memory Summaries

Each project can maintain:

.trifix/memory.md
.trifix/decisions.md

Use these to summarize:

project purpose
important user decisions
known issues
generated architecture
next recommended changes
previous failed fixes
5. Model Profiles

Add model health and role profile settings:

preferred PM model
preferred Developer model
preferred QA model
fallback model
expected speed
context size
last successful health check
average health latency
average generation latency
6. Packaging / Installer

Only after runtime stabilizes:

package Electron app
define default sandbox location
define default .trifix-brain
startup checks
first-run onboarding
model endpoint setup screen
Non-Goals For Now

Do not prioritize:

cloud deployment
secrets management
production database migrations
arbitrary shell execution
multi-repo automation
automatic package publishing
full autonomous overnight coding without checkpoints
replacing human review
building a full IDE
embedding/vector database infrastructure before simple file memory is stable

The realistic goal is:

A local AI development assistant that can generate,
patch, validate, and run small-to-medium sandbox projects safely.

Not:

a fully autonomous senior engineer in a box

Because we are ambitious, not hallucinating. Usually.

Current Status Summary

TriFix is now past the “basic prototype” stage.

It has:

multi-agent local model routing
global brain memory
model preflight
endpoint/model health classification
sequential endpoint health checks
degraded Developer-only mode
run locking
stale result protection
workflow progress
Vite/static validation separation
QA evidence hardening
artifact tracking
process manager beginnings
follow-up patch flow

The main remaining work is not “make the AI smarter.”

The main remaining work is:

make runtime behavior predictable
make validation evidence stronger
make generated projects easier to run
make follow-up patching reliable
make final reports trustworthy

## Future Implementations

These are realistic future features to add after the current runtime stabilizes. They should be implemented gradually, only after the core loop is reliable:

```text
Preflight → Agent Workflow → File Output → Validation → Review → Follow-up Patch

The priority should remain predictable runtime behavior, safe file generation, and honest validation.

1. Preflight Profiles and Model Presets

TriFix should support saved model profiles.

Each profile can define:

PM / Architect endpoint and model
Developer endpoint and model
QA endpoint and model
preferred health timeout
expected latency
context size
fallback mode behavior

Example profiles:

{
  "name": "Local + Supervisor Laptop",
  "pm": {
    "endpoint": "http://10.8.0.3:3011/api/v1/chat",
    "model": "google/gemma-4-e2b"
  },
  "developer": {
    "endpoint": "http://127.0.0.1:3010/api/v1/chat",
    "model": "qwen/qwen3.5-9b"
  },
  "qa": {
    "endpoint": "http://10.8.0.3:3011/api/v1/chat",
    "model": "gemma-4-e4b-uncensored-hauhaucs-aggressive"
  }
}

This avoids manually editing environment variables every time a model setup changes.

Priority: High

Reason:

Model routing is currently central to TriFix stability. Profiles would make demos and normal usage less fragile.

2. First-Run Setup Wizard

Add a first-run onboarding screen.

It should guide the user through:

selecting sandbox location
setting PM endpoint/model
setting Developer endpoint/model
setting QA endpoint/model
testing model health
creating default .trifix-brain
choosing safe command profile

The wizard should end with:

TriFix is ready.
PM: online
Developer: online
QA: online/skipped

Priority: High

Reason:

The current setup works, but it still depends too much on manual memory, PowerShell variables, and the sacred ritual of “did we open LM Studio?”

3. In-App Global Brain Editor

Add a simple editor for .trifix-brain.

It should allow users to view and edit:

core rules
model roles
output contract
command policy
QA policy
Vite/React standards
known failures
demo rules

Rules:

edits should be saved as markdown files
show last modified time
allow restore defaults
do not hide the files from the user
do not use a database yet

Priority: Medium

Reason:

The Global Brain is now a real part of TriFix behavior. Editing it should not require digging through folders like a raccoon in a hard drive.

4. Project Memory Summaries

Each generated project should maintain lightweight memory files:

.trifix/memory.md
.trifix/decisions.md
.trifix/known-issues.md
.trifix/next-actions.md

These should summarize:

what the project is
generated structure
user decisions
known bugs
previous failed attempts
next recommended fixes
validation/build history

These summaries should be injected into future patch prompts.

Priority: High

Reason:

Follow-up patching becomes much better when the model remembers what happened without rereading every generated file.

5. Better Patch Intent Detection

TriFix should classify user follow-up prompts into:

patch existing project
add feature
improve UI
fix bug
run/build/test project
create new project
explain current project
summarize status

Examples:

"Make it look better" → patch existing project
"Fix the edit button" → bug fix
"Add login" → feature add
"Create a new todo app" → new project
"Run this" → project execution

Priority: High

Reason:

The new Prompt → Output/Review flow depends on follow-up prompts behaving naturally.

6. Build-Aware Auto Validation

TriFix should offer or automatically run safe validation commands when appropriate.

For Vite projects:

npm install
npm run build
npm run dev

For Node projects:

npm install
npm test
npm run build

For static HTML:

open index.html
basic structure check

Validation should be classified as:

not_run
build_unverified
passed
failed
blocked
needs_review

Priority: High

Reason:

A generated Vite project is not truly verified until the build or dev server proves it. Otherwise, we are admiring file names and pretending that is engineering.

7. One-Click Generated Project Runner

After generation, TriFix should show a project runner card:

Generated app detected: Vite React
[Install Dependencies]
[Build]
[Run Dev Server]
[Open App]
[Stop Server]
[View Logs]

It should:

detect package manager
run safe commands
show logs
detect local URL
track process status
keep process records in .trifix/processes

Priority: High

Reason:

The user should not need to open PowerShell manually just to prove the generated project works.

8. Browser Smoke Testing

After the process manager is stable, TriFix should add browser smoke checks.

Basic checks:

app URL opens
root element renders non-empty content
expected title/header appears
no fatal console errors
key buttons exist
table/cards/forms render
theme toggle/search buttons do not crash immediately

For Vite dashboards, smoke test examples:

Header exists
3 KPI cards exist
Table exists
Search input exists
No blank screen

Priority: Medium

Reason:

Build passing is useful, but browser render passing is better. Frontend apps love failing only after the browser gets involved, because apparently one runtime was not enough.

9. Screenshot-Based UI QA

Optional future feature:

run generated app
capture screenshot
send screenshot/visual summary to QA
ask QA to compare against user requirements
produce UI feedback

QA should check:

layout completeness
spacing
visual hierarchy
missing requested sections
obvious broken rendering
responsiveness issues

Priority: Medium

Reason:

For dashboard/site generation, visual output matters. Code-only review can miss “technically works but looks like a tax form from 2007.”

10. Graphify-Assisted Patch Mode

Graphify should be used mainly for existing projects and repair work.

Use it when:

patching existing generated projects
fixing build/import errors
modifying components
adding features to larger projects
finding related files

Do not require it for simple first-generation tasks.

Future behavior:

User says: "Fix the edit modal"
TriFix queries graph:
- components related to edit
- files importing modal
- state handlers
- related CSS
Then sends only relevant files to Developer.

Priority: Medium

Reason:

Graph context is useful, but making it mandatory too early will turn TriFix into a slow graph worship machine. Optional first, useful later.

11. Local Task Queue V2

Add a durable task queue for medium-sized projects.

Tasks should be created only when useful, not for every tiny prompt.

Example:

{
  "id": "task-fix-edit",
  "goal": "Fix edit functionality in dashboard table",
  "targetFiles": ["src/App.jsx", "src/index.css"],
  "acceptance": [
    "Edit opens selected row",
    "Save updates correct row",
    "Cancel closes without changes"
  ],
  "status": "pending",
  "attempts": 0
}

Queue states:

pending
active
validating
needs_patch
completed
blocked
failed

Priority: Medium

Reason:

Useful for larger projects, but overkill for simple one-shot generation. Let’s not re-invent Jira inside Electron unless forced by some ancient curse.

12. Safer Command Approval Center

Add a dedicated approval panel for risky commands.

It should show:

command
cwd
reason
risk level
expected output
agent requesting it
allow/deny buttons

Risk levels:

safe
project
extended
approval required
blocked

Priority: Medium

Reason:

As TriFix gains autonomy, command boundaries must stay visible and boring. Boring is good when the alternative is “AI ran random PowerShell.”

13. Better Final Reports

Final reports should become more structured and useful.

Report sections:

Run Summary
Preflight Result
Run Mode
Generated Files
Modified Files
Validation Result
Build Result
QA Result
Final PM Status
Known Issues
Next Recommended Actions
Commands Run
Artifacts

For Vite projects:

Project type: vite-react
Validation mode: vite-structure / vite-build
Build status: not_run / passed / failed
Preview instructions: npm install → npm run dev

Priority: High

Reason:

The final report is the proof that TriFix did real work, not just agent theatre with file writes.

14. Model Performance Dashboard

Track basic model metrics:

health check latency
generation time
timeout count
failure count
average tokens/sec if available
last successful run
current availability

Show per role:

PM / Architect
Developer
QA

Priority: Low to Medium

Reason:

Very useful for debugging local AI setups, especially when multiple laptops, VPNs, and LM Studio are involved. Which is to say: chaos with a dashboard.

15. Better Degraded Mode Templates

Developer-only mode should provide prompt templates.

When PM is offline but Developer is online, TriFix can show:

Developer-only mode needs detailed instructions.
Try this structure:

Project type:
Required files:
UI requirements:
Functionality:
Constraints:
Acceptance criteria:

Priority: Medium

Reason:

Developer-only mode can work well, but only if the prompt is specific. Without PM, the user becomes the PM. Tragic promotion, unpaid.

16. Project Type Templates

Add built-in templates for common project types:

Static HTML page
Vite React dashboard
Vite React CRUD app
Simple Node API
Express + static frontend
SQLite demo app
Portfolio site
Admin dashboard

Each template should define:

required files
default scripts
validation rules
common acceptance criteria
known pitfalls

Priority: Medium

Reason:

Templates reduce model ambiguity and improve generation reliability.

17. Runtime Snapshot / Restore

Before applying major patches, TriFix should save a snapshot.

Snapshot contents:

changed files
run-state
artifacts
final report
validation state

User actions:

view snapshot
restore previous output
compare changes

Priority: Low to Medium

Reason:

As patching becomes more powerful, rollback becomes necessary. Future-you will thank present-you. Present-you will ignore this, naturally.

18. Multi-Model Fallbacks

If PM or QA is unavailable, TriFix could optionally use fallback models.

Example:

PM preferred: google/gemma-4-e2b
PM fallback: gemma-4-e4b-uncensored-hauhaucs-aggressive
QA preferred: gemma-4-e4b-uncensored-hauhaucs-aggressive
QA fallback: none

Fallback rules must be explicit.

Do not silently swap models without telling the user.

Priority: Low to Medium

Reason:

Useful, but dangerous if hidden. The user should know when a less ideal model is doing the work.

19. Auto-Summarized Run Memory

After every run, TriFix should append a short summary to project memory.

Example:

## 2026-05-08 Run Summary

User asked for a Vite React dashboard.
Generated package.json, index.html, vite.config.js, src/main.jsx, src/App.jsx, src/index.css.
Validation mode: vite-structure.
Build was not run.
Next recommended action: run npm install and npm run build.

Priority: High

Reason:

This helps follow-up prompts and keeps future context compact.

20. Demo Mode

Add a “Demo Mode” toggle for supervisor presentations.

Demo Mode should:

use safer prompts
avoid oversized tasks
prefer Vite React dashboard template
show preflight clearly
show workflow stepper clearly
stop after output/review
avoid long overnight behavior
produce a clean final report

Priority: Medium

Reason:

A demo should be controlled. Live AI chaos is not a feature, no matter how dramatic it feels.

Future Implementation Priority Order

Recommended order:

1. Generated Project Runner
2. Better Patch Mode
3. Build-Aware Validation
4. Auto-Summarized Run Memory
5. Project Type Templates
6. Better Final Reports
7. Preflight Profiles / Model Presets
8. First-Run Setup Wizard
9. Browser Smoke Testing
10. Graphify-Assisted Patch Mode
11. Task Queue V2
12. In-App Global Brain Editor
13. Screenshot-Based UI QA
14. Safer Command Approval Center
15. Model Performance Dashboard
16. Runtime Snapshot / Restore
17. Multi-Model Fallbacks
18. Demo Mode

This order keeps the roadmap grounded. First make generated projects easy to run and patch. Then improve validation. Then improve memory and templates. Only after that should TriFix chase bigger autonomy.

Future Implementation Rule

Every future feature must answer:

Does this make TriFix more reliable, safer, or easier to use?
If the answer is no, delay it.

TriFix should not become bigger just because it can. It should become more dependable.