# Kanban

Keep tickets small, concrete, verifiable, updated in real time, and compatible with the Obsidian Kanban plugin.
Use one task card per ticket under the lane heading.
Keep the standard lanes fixed. Optional lanes like `AI Candidates`, `Risk Watch`, `Doubtful Relevancy`, and `Ideas` should only appear when they contain cards. `Archived` history belongs in `kanban-archive.md`, not on the live board.

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
- No items

%% kanban:settings
```json
{"kanban-plugin":"board"}
```
%%
