<!-- Responsibility: Record durable lessons, traps, and decisions that should outlive a single ticket.
Scope: The active queue and baseline enforcement rules belong in kanban.md and enforcement.md, not in this lessons log. -->
# Knowledge

Record durable facts that reduce future context cost. Do not mirror transient ticket notes.

## Load Order

1. `kanban.md`
2. `execution-protocol.md`
3. `enforcement.md`
4. `project-guidelines.md`
5. this file

## Facts

- `epics.md` is a natural-language epic catalog, not a flat epic-name index.
- The canonical workflow order is epic -> user stories -> kanban tickets -> DB-backed query surfaces.

## Pitfalls

- Writing graph predicates or architectural edge lists into `epics.md` instead of querying the workflow DB.
- Letting projection rewrites silently overwrite direct edits in `epics.md` or `kanban.md`.
- Treating kanban tickets as the narrative source instead of execution units underneath epics.

## Durable Lessons

- Epic projections should include an explicit status block with a visible checkbox and a machine-readable status comment, and user-story actors should be bolded in the rendered file.
- User-story actors may be the `AI`, the `tool`, the `router`, a `user`, or a `maintainer`; choose the actor that owns the action and bold the actor phrase in the epic story.
- Kanban tickets are downstream execution units. They should not be used as a substitute for the epic narrative.
- For epic-scale or multi-ticket work, the default operating loop is: create a fresh branch, baseline commit, push, then plan and execute one epic at a time.
- The workflow should reconcile direct edits to `epics.md` and `kanban.md` instead of silently overwriting user-authored changes.
- State-changing workflow commands should refresh the DB and projection files immediately, and active work should move to `In Progress` before model work starts so the board stays live while the burst is running.
- The core kanban lanes stay fixed. Rare lanes should only appear when populated, and `Archived` history belongs in `kanban-archive.md`.
- Smart codelets only stay trustworthy when they route through the router and feed new recurring patterns back into the workflow DB.

## Decisions

- YYYY-MM-DD: decision and reason

## Gaps

- Unknowns worth resolving later
