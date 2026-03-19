# Contributing

## Read Order

1. `kanban.md`
2. `execution-protocol.md`
3. `project-guidelines.md`
4. `knowledge.md`

## Burst Rule

- Move exactly one ticket or one explicit batch ticket to `In Progress` before substantive edits.
- Batch by one owned problem family, not by convenience.
- Keep unrelated cleanup out of the same slice unless it is required for the ticket.
- If new issues are discovered, add tickets instead of silently expanding scope.

## Validation By Risk

- Workflow or guidance changes: run `node scripts/codex-workflow/workflow-audit.mjs`.
- Docs-only: run the lightest workflow/doc checks that prove the change.
- Low-risk UI copy or styling: typecheck plus a targeted browser check when relevant.
- Domain logic, persistence, or state changes: typecheck plus focused automated tests.
- User-visible system-path regressions: add targeted integration or E2E coverage when the bug justifies it.
- Broad sweeps are for closure or regression verification, not every small edit.

## Audit Extensions

Add machine-readable project rules in fenced `codex-workflow-audit` JSON blocks inside markdown guidance docs.
`workflow-audit.mjs` merges those blocks automatically, so durable project rules can become executable instead of remaining advisory text.

## Truthfulness Rules

- Truth outranks speed, appearance, and ticket closure.
- Never present unfinished work as finished.
- Never imply a requested behavior works unless it was actually verified.
- Never claim a test was run if it was not.
- User instructions are binding unless a narrow exception is required for product integrity, safety, truthfulness, or higher-priority constraints.

## Closure Checklist

- what requested work is still missing?
- what acceptance criterion is not truly verified?
- what changed that was not requested?
- what assumption might still be wrong?
- why would a strict reviewer reject closure?
