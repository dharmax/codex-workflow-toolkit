# AGENTS

Use `codex-workflow-toolkit` for non-trivial JS/TS work when the request is specific enough to tie to a ticket, file scope, and verification plan.

Prefer explicit invocation such as `Use codex-workflow-toolkit for TKT-001.`
Implicit use is acceptable only when the intended ticket, touched files, and expected verification path are all clear.

If the skill is unavailable, follow the same process with `scripts/codex-workflow/*`.

## Read Order

1. `kanban.md`
2. `execution-protocol.md`
3. `project-guidelines.md`
4. `knowledge.md`
5. `CONTRIBUTING.md`

## Core Contract

- `kanban.md` is the execution queue and ticket source of truth.
- Work one ticket or one explicit batch ticket at a time.
- Keep changes narrow to one owned problem family.
- Do not mark work complete without verification evidence.
- Prefer helper scripts over repeating the same reasoning in prompt text.
- Update guidance files only for durable rules, not ticket-local notes.
- Run `review-summary.mjs` and `verification-summary.mjs` before closure claims.
- Use `workflow-audit.mjs` when workflow docs or enforceable project rules are part of the change.

## Session Modes

- `feature`: implement one scoped ticket end to end.
- `bugfix`: reproduce, fix, validate, and close one regression.
- `architecture`: clarify boundaries, docs, and workflow contracts.
- `validation`: run sweeps, turn findings into tickets, and land targeted fixes only when needed.

## Project Notes

- Stack:
- Primary commands:
- Risky areas:
- Fast verification path:
