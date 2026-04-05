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

-

## Pitfalls

-

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
- Smart codelets are a first-class built-in surface. The tool should route them through the AI router. Prefer the cheapest capable model route when the tool can use it; if it is unavailable, say so instead of silently widening the fallback. Auto-document new candidate codelets or recurring problems in dev-mode observer flows.
- Use `ai-workflow` first for project status, ticket lookup, projections, and guideline extraction; fall back to raw shell search/read only when the workflow tool cannot answer.
- Shell planning should use the live model-fit matrix plus cached web evidence and explicit refresh controls; `providers.ollama.plannerModel` is a manual override, not the default policy.

## Decisions

- YYYY-MM-DD: decision and reason

## Gaps

- Unknowns worth resolving later
