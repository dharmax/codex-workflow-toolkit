---
name: ai-workflow-gemini
description: Thin Gemini adapter for JS/TS coding workflows that delegates deterministic workflow tasks to the local ai-workflow CLI and shared codelets.
---

# AI Workflow Gemini Adapter

Keep this skill thin. Route ticket extraction, guideline extraction, review, verification, and session-hygiene preparation through `ai-workflow`.

## Routing

- extract active ticket first
- extract compact guidelines second
- use deterministic local codelets before model reasoning for bounded tasks
- recommend `/compact` or `/new` only from explicit evidence such as a compact handoff artifact
- never imply direct control over chat-history internals
