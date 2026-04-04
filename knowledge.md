# Knowledge

## Durable Lessons

- `epics.md` is not a flat epic-name index. Each epic should read as a natural-language user-story package with a goal, user stories, and ticket batches underneath it.
- Epic projections should include an explicit status block with a visible checkbox and a machine-readable status comment, and user-story actors should be bolded in the rendered file.
- User-story actors may be the `AI`, the `tool`, the `router`, a `user`, or a `maintainer`; choose the actor that owns the action and bold the actor phrase in the epic story.
- Graph predicates and architectural details stay in the DB and should be queried from workflow functions instead of being written as predicate lists in `epics.md`.
- The workflow order is:
  - epic
  - user stories
  - kanban tickets
  - DB-backed query surfaces
- Kanban tickets are downstream execution units. They should not be used as a substitute for the epic narrative.
- For epic-scale or multi-ticket work, the default operating loop is: create a fresh branch, baseline commit, push, then plan and execute one epic at a time.
- The workflow should reconcile direct edits to `epics.md` and `kanban.md` instead of silently overwriting user-authored changes.
- State-changing workflow commands should refresh the DB and projection files immediately, and active work should move to `In Progress` before model work starts so the board stays live while the burst is running.
- The core kanban lanes stay fixed. Rare lanes should only appear when populated, and `Archived` history belongs in `kanban-archive.md`.
- Smart codelets are a first-class built-in surface. The tool should route them through the AI router, prefer cheap local providers when suitable, and auto-document new candidate codelets or recurring problems in dev-mode observer flows.
