<!-- Responsibility: Define the repo-wide execution contract and read order for human and agent contributors.
Scope: Project-specific technical rules belong in project-guidelines.md and enforcement.md, not in this top-level workflow contract. -->
# AGENTS

Use `codex-workflow-toolkit` for non-trivial JS/TS work when the request is specific enough to tie to a ticket, file scope, and verification plan.

Prefer explicit invocation such as `Use codex-workflow-toolkit for TKT-001.`
Implicit use is acceptable only when the intended ticket, touched files, and expected verification path are all clear.

If the skill is unavailable, follow the same process with `scripts/codex-workflow/*`.
If `ai-workflow` is installed locally in the project, prefer it as the stable top-level command surface and let it route into the local helper codelets.

## Read Order

1. `kanban.md`
2. `execution-protocol.md`
3. `enforcement.md`
4. `project-guidelines.md`
5. `knowledge.md`
6. `CONTRIBUTING.md`

## Core Contract

- `kanban.md` is the execution queue and ticket source of truth.
- Keep hot-path guidance lean. `AGENTS.md`, `knowledge.md`, and `kanban.md` should not become archives.
- Keep `kanban.md` updated in real time: move work into `In Progress` when it starts and into `Done` only when evidence exists.
- Keep older completed tickets in `kanban-archive.md`, not in the live board.
- Keep `Deep Backlog` tickets tied to `epics.md`.
- Prefer `workflow:new-ticket`, `workflow:next-ticket`, `workflow:move-ticket`, `workflow:archive-done`, and `workflow:migrate-kanban` over manual board editing when possible.
- Prefer `ai-workflow extract ticket` and `ai-workflow extract guidelines` when available; otherwise use the underlying scripts directly.
- Work one ticket or one explicit batch ticket at a time.
- Keep changes narrow to one owned problem family.
- Do not mark work complete without verification evidence.
- Prefer helper scripts over repeating the same reasoning in prompt text.
- Recommend `/compact` when recent thread state is still useful but detail is accumulating. Recommend `/new` when a compact handoff exists. Treat `/clear` as an operator-controlled action, not a guaranteed skill capability.
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
