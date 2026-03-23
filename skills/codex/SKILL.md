---
name: ai-workflow-codex
description: Thin Codex adapter for JS/TS coding workflows that routes ticket extraction, guideline extraction, review, verification, and session hygiene through the local ai-workflow CLI and shared codelets.
---

# AI Workflow Codex Adapter

Use this skill for non-trivial JS/TS repository work when the request is concrete enough to identify the active ticket, file scope, and verification path.

## Use When

- the task is real repository work, not a one-off factual answer
- the work benefits from compact ticket and guideline extraction
- deterministic local verification or review helpers can reduce repeated model work

## Do Not Use When

- the request is casual conversation or pure brainstorming
- the repo is not meaningfully JS/TS-oriented and no project-specific adaptation exists
- the task is too small to justify workflow orchestration

## Routing

- Prefer `ai-workflow extract ticket <id>` before reading broad kanban state.
- Prefer `ai-workflow extract guidelines ...` before rereading full guidance docs.
- Prefer `ai-workflow run review`, `ai-workflow verify ...`, and other deterministic codelets for bounded low-risk work.
- Use `ai-workflow run context-pack ...` before recommending `/compact` or `/new`.
- Treat `/clear` as operator-controlled. Do not claim direct control over internal chat history.

## Fallback

If `ai-workflow` is unavailable, use the underlying project-local scripts directly.
