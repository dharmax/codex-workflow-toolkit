# Knowledge

## Durable Lessons

- `epics.md` is not a flat epic-name index. Each epic should read as a natural-language user-story package with a goal, user stories, ticket batches, and DB graph facts underneath it.
- The workflow order is:
  - epic
  - user stories
  - kanban tickets
  - DB graph entities and predicates
- Kanban tickets are downstream execution units. They should not be used as a substitute for the epic narrative.
- For epic-scale or multi-ticket work, the default operating loop is: create a fresh branch, baseline commit, push, then plan and execute one epic at a time.
- The workflow should reconcile direct edits to `epics.md` and `kanban.md` instead of silently overwriting user-authored changes.
