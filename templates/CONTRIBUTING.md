<!-- Responsibility: Define the contributor execution loop, validation expectations, and closure truthfulness rules.
Scope: Ticket-local implementation detail and project-specific technical constraints belong in kanban or project-guidelines docs, not here. -->
# Contributing

## Read Order

1. `kanban.md`
2. `execution-protocol.md`
3. `enforcement.md`
4. `project-guidelines.md`
5. `knowledge.md`

## Burst Rule

- For epic-scale or multi-ticket work, start on a fresh branch, make a baseline commit, and push before substantive edits.
- Plan and execute one epic at a time; do not interleave roadmap epics unless a real blocker forces the split.
- Move exactly one ticket or one explicit batch ticket to `In Progress` before substantive edits.
- Keep `ToDo` as the immediate next queue, not a parking lot.
- Batch by one owned problem family, not by convenience.
- Keep unrelated cleanup out of the same slice unless it is required for the ticket.
- If new issues are discovered, add tickets instead of silently expanding scope.

## Kanban Maintenance

- `Deep Backlog`: larger later work tied to an epic in `epics.md`.
- `Backlog`: real work worth tracking, but not next-up.
- `ToDo`: the next actionable queue.
- `Bugs P1`: urgent regressions that outrank normal `ToDo`.
- `Bugs P2/P3`: non-critical bugs still worth scheduling explicitly.
- `In Progress`: the one live ticket being worked now.
- `Human Inspection`: tickets waiting on human eyes, ears, or product judgment.
- `Suggestions`: optional improvements to consider, not committed scope.
- `Done`: recently finished tickets only; add `- Done: YYYY-MM-DD` and archive older entries into `kanban-archive.md`.
- Keep the standard lanes fixed in order. Only render rare lanes such as `AI Candidates`, `Risk Watch`, `Doubtful Relevancy`, and `Ideas` when they actually have cards. `Archived` history belongs in `kanban-archive.md`, not on the live board.
- Keep `kanban.md` in Obsidian Kanban plugin format. Do not invent an alternate board shape.
- Use `node scripts/ai-workflow/kanban.mjs new --id <ticket> --title <title> --to <lane>` to create normalized cards.
- Use `node scripts/ai-workflow/kanban.mjs next` to inspect the next ticket by lane priority.
- Use `node scripts/ai-workflow/kanban.mjs move --id <ticket> --to <lane>` for reliable lane moves.
- Use `node scripts/ai-workflow/kanban.mjs archive` to sweep stale `Done` work into `kanban-archive.md`.
- Use `node scripts/ai-workflow/kanban.mjs migrate` once when an older repo still uses the legacy board format.

## Validation By Risk

- Workflow or guidance changes: run `node scripts/ai-workflow/workflow-audit.mjs`.
- Docs-only: run the lightest workflow/doc checks that prove the change.
- Small ticket: quick but meaningful unit or module tests.
- Related batch or larger ticket: E2E, including visual checks when UI is involved.
- Every few batches: super-E2E, simulation, or emulator-backed flows when available.
- Special mechanisms or unique flows: add special tests for that path directly.
- Low-risk UI copy or styling: typecheck plus a targeted browser check when relevant.
- Domain logic, persistence, or state changes: typecheck plus focused automated tests.
- User-visible system-path regressions: add targeted integration or E2E coverage when the bug justifies it.
- Broad sweeps are for closure, accumulated confidence, or regression verification, not every small edit.

## Audit Extensions

Add machine-readable project rules in fenced `ai-workflow-audit` JSON blocks inside markdown guidance docs.
`workflow-audit.mjs` merges those blocks automatically, so durable project rules can become executable instead of remaining advisory text.

## Truthfulness Rules

- Truth outranks speed, appearance, and ticket closure.
- Never present unfinished work as finished.
- Never imply a requested behavior works unless it was actually verified.
- Never claim a test was run if it was not.
- User instructions are binding unless a narrow exception is required for product integrity, safety, truthfulness, or higher-priority constraints.
- If the user gives an explicit work order across tickets or lanes, follow that order until it is exhausted or a real blocker is stated.

## Closure Checklist

- what requested work is still missing?
- what acceptance criterion is not truly verified?
- what changed that was not requested?
- what assumption might still be wrong?
- why would a strict reviewer reject closure?
