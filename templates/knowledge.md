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

- Prefer one coherent burst over many tiny unrelated edits.
- If verification is no longer broad, stop using broad reruns.
- If a ticket is not actionable right now, it does not belong in the immediate-action lane.
- User instructions should be followed literally unless a narrow safety, integrity, or truthfulness exception is real and stated.
- If a UI or domain surface can be named, it usually needs explicit software ownership.
- If a child surface needs many loose props from one owner, redesign the contract around a compact view model plus explicit actions.
- If a rule keeps getting restated in review, encode it in a `ai-workflow-audit` block so the repo enforces it.
- Workflow and guidance changes are not done until `node scripts/ai-workflow/workflow-audit.mjs` passes.
- If a claim still needs reliable non-human proof, keep it in the active workflow instead of closing it with human-only language.
- Explicit user queue ordering and inline ticket notes are part of the work contract, not optional hints.
- A live kanban only works if it is updated in real time; stale lane position is false status.
- `Done` is for recent completed work with dates, not for long-term history. Archive older entries into `kanban-archive.md`.
- `Deep Backlog` tickets should point at explicit epics rather than becoming an unstructured future bucket.
- Smart codelets are a first-class built-in surface. The tool should route them through the AI router. Prefer the cheapest capable model route when the tool can use it; if it is unavailable, say so instead of silently widening the fallback. Auto-document new candidate codelets or recurring problems in dev-mode observer flows.
- Use `ai-workflow` first for project status, ticket lookup, projections, and guideline extraction; fall back to raw shell search/read only when the workflow tool cannot answer.
- Shell planning should use the live model-fit matrix plus cached web evidence and explicit refresh controls; `providers.ollama.plannerModel` is a manual override, not the default policy.

## Decisions

- YYYY-MM-DD: decision and reason

## Gaps

- Unknowns worth resolving later
