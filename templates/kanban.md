# Kanban

Keep tickets small, concrete, verifiable, updated in real time, and compatible with the Obsidian Kanban plugin.
Use one task card per ticket under the lane heading.

Ticket body fields:

- `Outcome`: concrete result.
- `Scope`: files or subsystems expected to change.
- `Verification`: commands or checks required for completion.
- `Notes`: blockers, assumptions, or handoff details.
- `Epic`: required for `Deep Backlog` tickets and should match an epic in `epics.md`.
- Done tickets should use a checked card line with `✅ YYYY-MM-DD`.

Lane order is intentional. Keep the board in this order.

## Deep Backlog

## Backlog

- [ ] TKT-001 Replace this example ticket
  - Outcome: State the concrete result.
  - Scope: Name the files or subsystems expected to change.
  - Verification: List the commands or checks required for completion.
  - Notes: Capture blockers, assumptions, or handoff details.

## ToDo

## Bugs P1

## Bugs P2/P3

## In Progress

## Human Inspection

## Suggestions

## Done

- [x] TKT-000 Example completed ticket ✅ 2026-03-23
  - Outcome: Show the required done-card format.
  - Scope: Example only.
  - Verification: None.
  - Notes: Move entries older than roughly seven days into `kanban-archive.md`.

%% kanban:settings
```json
{"kanban-plugin":"board"}
```
%%
