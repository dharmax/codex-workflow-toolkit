---
name: codex-workflow-toolkit
description: Use for multi-step Codex CLI work in JS/TS repositories when you need disciplined project initialization, kanban-driven execution, planning, strict review, honest verification, and helper-script forging to reduce repeated reasoning. Prefer explicit invocation with a ticket or concrete scope. Allow implicit use only when the request is precise enough to identify files, verification, and kanban movement.
---

# Codex Workflow Toolkit

Use this skill when the task is substantial enough that scope, review, verification, or handoff discipline matter.

## Use It When

- working in a JS/TS repository with non-trivial edits
- the task should be tied to a ticket, plan, or verifiable outcome
- you need a strict review and evidence-backed closeout
- repeated context shaping or extraction should become a script

## Do Not Use It When

- the request is a one-off factual answer
- the repo is not meaningfully JS/TS-based
- the task is too small to justify kanban, planning, or scripted verification
- the user only wants brainstorming with no repository execution

## Invocation

- Prefer explicit invocation: `Use codex-workflow-toolkit for TKT-001.`
- Allow implicit invocation only if the task is precise enough to identify the ticket, touched files, verification path, and expected kanban movement.

## Operating Loop

1. If the project is not initialized, bootstrap it with `node scripts/init-project.mjs --target <repo>` from this toolkit repository.
2. In the target repo, treat `kanban.md` as the queue and source of ticket truth.
3. Read `execution-protocol.md`, `project-guidelines.md`, and `knowledge.md` before substantive implementation.
4. Read the active ticket with `node scripts/codex-workflow/kanban-ticket.mjs --id <ticket>`.
5. Condense current guidance with `node scripts/codex-workflow/guidance-summary.mjs --ticket <ticket> --changed`.
6. Plan before editing. Keep scope tight to the active ticket.
7. If the same reasoning step is appearing repeatedly, convert it into a helper script instead of paying prompt cost again.
8. Before claiming completion, run `review-summary.mjs`, `verification-summary.mjs`, and `workflow-audit.mjs` when workflow or guidance contracts are in scope.
9. Only move work to done when the evidence exists in the verification result.

## Audit Commands

- `node scripts/codex-workflow/workflow-audit.mjs`
  - validates required workflow docs, key policy sections, local doc refs, documented `pnpm -s` commands, kanban structure, and merged guideline-audit results
- `node scripts/codex-workflow/guideline-audit.mjs`
  - loads fenced `codex-workflow-audit` JSON blocks from project markdown docs
  - enforces file-header rules and required/forbidden regex rules scoped by path and extension

## Audit Extension Contract

- When a project-specific rule becomes important enough to enforce automatically, add it as a fenced `codex-workflow-audit` JSON block inside the owning markdown doc.
- Keep rules narrow, explainable, and file-scoped.
- Prefer doc-owned rule blocks over hardcoding one project’s style rules into the toolkit runtime.

## Non-Negotiable Rules

- Never mark work complete without evidence.
- Prefer scripts over repeated reasoning when practical.
- Keep changes narrow and ticket-shaped.
- Update `project-guidelines.md` and `knowledge.md` only for durable guidance.
- Treat strict review as a required step, not an optional polish pass.
- Prefer machine-enforced rules when a guidance rule becomes important enough to guard automatically.
