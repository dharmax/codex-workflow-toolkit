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

- `kanban.md` is live execution state, `kanban-archive.md` is history, and `knowledge.md` is for durable lessons rather than queue state.
- Tickets are execution units; epics or backlog docs carry the broader narrative.

## Pitfalls

- Repeating hard workflow rules in `knowledge.md` instead of keeping them in protocol or guideline docs.
- Letting stale lane position or outdated projections stand in for real status.
- Paying repeated review cost for the same issue instead of promoting it into an `ai-workflow-audit` rule.

## Durable Lessons

- Prefer one coherent burst over many tiny unrelated edits.
- If verification is no longer broad, stop using broad reruns.
- If a ticket is not actionable right now, it does not belong in the immediate-action lane.
- User instructions should be followed literally unless a narrow safety, integrity, or truthfulness exception is real and stated.
- If a UI or domain surface can be named, it usually needs explicit software ownership.
- If a child surface needs many loose props from one owner, redesign the contract around a compact view model plus explicit actions.
- If a rule keeps getting restated in review, encode it in an `ai-workflow-audit` block so the repo enforces it.
- If a claim still needs reliable non-human proof, keep it in the active workflow instead of closing it with human-only language.
- Explicit user queue ordering and inline ticket notes are part of the work contract, not optional hints.
- A live kanban only works if it is updated in real time; stale lane position is false status.
- `Done` is for recent completed work with dates, not for long-term history. Archive older entries into `kanban-archive.md`.
- `Deep Backlog` tickets should point at explicit epics rather than becoming an unstructured future bucket.
- Smart codelets stay trustworthy when they route through the router and feed new recurring patterns back into the workflow DB.

## Decisions

- YYYY-MM-DD: decision and reason

## Gaps

- Unknowns worth resolving later
