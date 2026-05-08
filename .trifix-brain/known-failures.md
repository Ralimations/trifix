# Known Failures
Qwen may output advice instead of files. Enforce file-only output.
Reasoning models may output Thinking Process. Parser should ignore reasoning.
Malformed <doctype html> must be corrected to <!doctype html>.
QA offline should be unavailable/skipped, not error.
Vite Electron builds need base ./.
Do not create Tailwind files unless Tailwind is requested.
