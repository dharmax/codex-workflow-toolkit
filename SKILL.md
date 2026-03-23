---
name: codex-workflow-toolkit
description: Thin Codex adapter for JS/TS coding workflows that routes ticket extraction, guideline extraction, review, verification, installation, and session hygiene through the local ai-workflow CLI and shared codelets.
---

# Codex Workflow Toolkit

This root skill mirrors the Codex adapter in `skills/codex/` for local development and direct use.

## Use It When

- the task is real JS/TS repository work with concrete files, tickets, or verification needs
- compact ticket and guideline extraction will reduce repeated context use
- deterministic local review or verification helpers can handle bounded low-risk work

## Do Not Use It When

- the request is casual conversation or one-off factual lookup
- the work is too small to justify workflow orchestration
- the repo is not meaningfully JS/TS-oriented and no project adaptation exists

## Routing

- Prefer `ai-workflow extract ticket <id>` before reading broad kanban state.
- Prefer `ai-workflow extract guidelines ...` before rereading full guidance docs.
- Prefer `ai-workflow run review`, `ai-workflow verify ...`, and other deterministic codelets for bounded low-risk tasks.
- Use `ai-workflow run context-pack ...` before recommending `/compact` or `/new`.
- Use `ai-workflow install codex` when linking the shared toolkit into a project.
- Treat `/clear` as operator-controlled. Do not claim direct control over internal chat history.

## Fallback

If `ai-workflow` is unavailable, use the underlying project-local scripts directly.
