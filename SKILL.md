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
2. In the target repo, treat `kanban.md` as the live queue, `kanban-archive.md` as closed-history storage, and `epics.md` as the source of deep-backlog epic names.
3. Read `execution-protocol.md`, `enforcement.md`, `project-guidelines.md`, and `knowledge.md` before substantive implementation.
4. Read the active ticket with `node scripts/codex-workflow/kanban-ticket.mjs --id <ticket>`.
5. Condense current guidance with `node scripts/codex-workflow/guidance-summary.mjs --ticket <ticket> --changed`.
6. If the ticket is not already in `In Progress`, move it there with `node scripts/codex-workflow/kanban-move.mjs --id <ticket> --to "In Progress"` before substantive editing.
7. Plan before editing. Keep scope tight to the active ticket.
8. If new work is discovered, create the right card with `kanban-new.mjs` instead of leaving implicit TODOs in prose.
9. Use `kanban-next.mjs` when you need the next item by queue priority instead of scanning manually.
10. If the repo still uses the older non-Obsidian board shape, migrate it with `kanban-migrate-obsidian.mjs` before relying on the kanban helpers.
11. If the same reasoning step is appearing repeatedly, convert it into a helper script instead of paying prompt cost again.
12. Match validation to the work shape: small ticket -> quick but meaningful unit tests; related batch or larger ticket -> E2E including visual checks when relevant; every few batches -> super-E2E/simulation/emulation when available; special flows -> special tests for that path.
13. Before claiming completion, run `review-summary.mjs`, `verification-summary.mjs`, and `workflow-audit.mjs` when workflow or guidance contracts are in scope.
14. Only move work to done when the evidence exists in the verification result, then archive stale done cards with `kanban-archive.mjs`.

## Token Discipline

- Prefer `guidance-summary.mjs` over rereading full guidance docs repeatedly.
- Read full docs only when the current ticket genuinely needs their exact wording or deeper detail.
- Keep file reads narrow: target the active files, ticket, and owner docs instead of broad repo scans.
- Use scripts for kanban, review, verification, and migration operations instead of narrating or reconstructing them in prompt text.
- Summarize evidence and diffs compactly; do not paste large logs when a short truthful summary is enough.

## Execution Contracts To Preserve

- State the burst shape before substantive edits: owned problem family, intended outcome, and validation plan.
- The agent is responsible for maintaining `kanban.md` during execution, not the user.
- Update `kanban.md` in real time with the helper scripts: move the active ticket to `In Progress` when work starts, keep the next actionable queue in `ToDo`, and move completed work to `Done` only when proof exists.
- Ticket creation, start, finish, and archive should default to scripts rather than manual markdown edits.
- Treat explicit user queueing, ticket ordering, and inline ticket notes as binding unless a narrow safety, integrity, or truthfulness exception is real and stated plainly.
- Use `DONE`, `PARTIAL`, and `BLOCKED` truthfully. Never describe partial work in done language.
- Check acceptance criteria explicitly and attach proof to the actual change, not just to intent.
- Optimize for efficient proof, not maximal testing volume. Reliability is mandatory; wasted token/time spend is not.
- Minimize context churn: read the smallest sufficient guidance surface, then act.
- Keep immediate-action lanes actionable. Conditional reopeners and vague later work belong in backlog, not in the active queue.
- Keep `Deep Backlog` tied to `epics.md`, `Human Inspection` for human-eye acceptance, and `Suggestions` for optional future ideas you want the user to consider.
- Keep `kanban.md` Obsidian-compatible. Do not invent a custom board format.
- Keep `Done` dated and current. Move entries older than roughly a week into `kanban-archive.md`.
- If verification narrows to one concrete failing artifact, stop broad reruns and switch to focused reproduction.
- When a durable rule keeps reappearing in review, promote it into guidance and, when practical, into a `codex-workflow-audit` rule.

## Audit Commands

- `node scripts/codex-workflow/workflow-audit.mjs`
  - validates required workflow docs, key policy sections, local doc refs, documented `pnpm -s` commands, kanban structure, and merged guideline-audit results
  - groups findings by category in text output and emits structured findings with `--json`
- `node scripts/codex-workflow/guideline-audit.mjs`
  - loads fenced `codex-workflow-audit` JSON blocks from project markdown docs
  - enforces file-header rules, required/forbidden regex rules, and forbidden import boundaries scoped by path and extension
  - applies allowlists to suppress specific rule findings and emits structured findings with `--json`

## Audit Extension Contract

- When a project-specific rule becomes important enough to enforce automatically, add it as a fenced `codex-workflow-audit` JSON block inside the owning markdown doc.
- Keep rules narrow, explainable, and file-scoped.
- Prefer doc-owned rule blocks over hardcoding one project’s style rules into the toolkit runtime.
- Use allowlists only for narrow, path-scoped exceptions that should be explicitly documented.

## Non-Negotiable Rules

- Never mark work complete without evidence.
- Prefer scripts over repeated reasoning when practical.
- Keep changes narrow and ticket-shaped.
- Update `project-guidelines.md` and `knowledge.md` only for durable guidance.
- Treat strict review as a required step, not an optional polish pass.
- Prefer machine-enforced rules when a guidance rule becomes important enough to guard automatically.
- Assume initialized repos start from a strict baseline and must conform or narrow it explicitly.
