<!-- Responsibility: Define durable engineering constraints, architectural boundaries, and review standards for the project.
Scope: Queue state belongs in kanban.md and machine-enforced baseline rules belong in enforcement.md, not in this narrative guidance doc. -->
# Project Guidelines

Keep this file short and durable. If a point is ticket-local, keep it out.

## Non-Negotiables

- Keep deterministic state mutation deterministic.
- Treat AI output as untrusted input: validate, bound, and default safely.
- Treat the AI router and the tool as first-class actors in workflow narratives: `user`, `maintainer`, `tool`, and `AI` are all valid story owners when they are the right owner.
- Do not let non-critical async work block the main user loop.
- Preserve access to core state and critical controls when reshaping UI surfaces.
- Keep hot-path guidance lean. Archive history elsewhere instead of turning active guidance files into context sinks.
- Keep the core kanban lanes fixed and only show rare lanes when populated. `Archived` is not a live lane; it belongs in `kanban-archive.md`.
- Smart codelets should be routed through the router and the cheapest suitable provider, not hardcoded to one model family.
- Shell planning should use the live model-fit matrix plus cached web evidence and explicit refresh controls; `providers.ollama.plannerModel` is a manual override, not the normal default.
- Mutating shell work must be blocked until the board has exactly one ticket in `In Progress`; the shell should tell the operator to move the ticket first instead of bypassing workflow state. State changes with their own command surface should use that command surface instead of shell execution.

## Architecture

- The workflow DB is the canonical operational state. `kanban.md` and `epics.md` are controlled projections, and direct edits must be reconciled instead of silently overwritten.
- Shell, codelets, and CLI surfaces orchestrate work; durable domain behavior belongs in cohesive modules and services behind stable APIs.
- Keep Architectural Graph facts in the DB and workflow services instead of duplicating predicate lists in narrative markdown.
- Critical surfaces should preserve a real entrypoint, a degraded path, and testable seams at each boundary.

## Layer Boundaries

- Keep domain logic behind cohesive module APIs.
- UI should orchestrate modules; domain invariants should be testable without browser rendering.
- Avoid reverse imports from domain layers into UI layers.

## Change Boundaries

- Prefer minimal diffs.
- Preserve established patterns unless the ticket requires a deliberate change.
- Avoid unrelated cleanup during delivery work.
- If one local bug reveals a shared contract problem, fix the smallest complete shared contract.
- Make the smallest coherent burst that solves the ticket honestly; do not fragment systemic fixes into fake micro-progress.
- For roadmap work, finish one epic before starting the next unless a blocker or dependency makes the order impossible.

## Data Contracts

- Prefer explicit contract shapes over ad-hoc object literals.
- Handle unknown external or AI-shaped payloads defensively.
- Normalize and validate external or AI-shaped payloads at the boundary so downstream code can stay simple.

## Structure and Ownership

- Before introducing significant logic or state, choose the right construct deliberately: `interface`, `type`, `class`, module object, or singleton service.
- Stateful domain entities should expose behavior through cohesive modules or classes, not scattered inline mutation.
- If a semantic UI surface can be named, give it owned component or module representation before it becomes a giant anonymous template.
- Keep generic shells generic; domain-specific content selection belongs outside the shell.

## File Responsibility Headers

- Every source or owned-doc file should start with a short `Responsibility:` and `Scope:` header.
- Keep both lines concise. If the header cannot stay honest and short, the file boundary is probably wrong.
- When a file starts owning multiple unrelated concerns, split it instead of widening the header until it becomes meaningless.

## UI Discipline

- Prefer CSS-first interaction behavior for presentation changes.
- JS should toggle semantic state, not drive cosmetic pixel math unless there is a real exception.
- Keep DOM depth, event-handler duplication, and class vocabulary under control.
- Prefer shallow owner-scoped selectors and base-plus-modifier patterns over one-off helper class families.
- Avoid native `title` tooltips for important product surfaces; use explicit tooltip contracts instead.

## Concurrency and Persistence

- Every lock start must have a terminal unlock path.
- Early returns in action or async flow must still emit required completion or failure paths.
- Use watchdogs only as safety nets, not primary flow control.
- Save logic should be debounced where practical and immediate on critical lifecycle events.

## Test Strategy

- Goal: maximize efficiency in time and token cost without compromising reliability.
- Prefer fast deterministic module tests for domain behavior.
- Add integration or E2E coverage only where user-visible flows or system boundaries require it.
- No placeholder tests: every test should be capable of catching a real bug.
- When fixing a bug, add the test that would have caught that bug.
- Operator-surface changes should be dogfooded through `ai-workflow` itself before closure, not only through internal function tests.
- Operator-surface changes are not done until `ai-workflow dogfood` (or `node scripts/ai-workflow/dogfood.mjs`) and `workflow-audit` both pass.
- For provider, shell, routing, setup, and fallback changes, add at least one test at the actual entrypoint and one test for the degraded path. Do not count helper-only or happy-path-only coverage as sufficient.
- When asserting Ollama behavior, tests must keep `configured`, `installed`, and `available` separate so a broken probe cannot hide behind a passing registry fallback.
- Keep verification layered:
  - workflow/guidance/kanban contract changes should prove themselves through `workflow-audit`
  - operator-surface changes should prove themselves through `workflow:dogfood` plus `workflow-audit`
  - small tickets should default to quick but meaningful unit or module tests
  - related batches or larger tickets should add E2E, including visual proof when UI behavior changed
  - every few batches should run super-E2E, simulation, or emulator-backed flows when the project supports them
  - special mechanisms and rare flows should get special-purpose tests instead of being left to generic coverage
  - domain changes should prefer focused deterministic tests before broader runs
  - E2E should cover system paths and regressions, not replace module-level proof
  - human-only acceptance should stay explicit instead of being implied by green automation

## Definition of Done

- A ticket is not done because a helper changed. It is done when the requested behavior exists at the real entrypoint that the operator or host surface uses.
- If the behavior claims workflow awareness, it must be grounded in canonical DB-backed state instead of prompt glue, transient locals, or duplicated surface-specific memory.
- Shell, `ask`, status queries, operator-brain, and host adapters should resolve the same capability, surface, feature, module, problem, or plan consistently.
- Capability-sensitive behavior must be able to explain:
  - what it can do
  - why it believes that
  - what its limits are
  - what the operator should do next
- State-bearing workflow behavior is not done unless its transitions are inspectable where they belong: DB state first, projections or operator surfaces second.
- Helper-only proof is not enough for provider, shell, routing, setup, fallback, or workflow-surface work. Require one real entrypoint test and one degraded-path test.
- Workflow state must stay honest before closure: sync, projections, ticket lane, and archived state should all agree with the implemented result.
- Operator-surface work is not done until the required surface gates pass: `ai-workflow dogfood` when applicable, and `workflow-audit` whenever workflow docs or operator contracts changed.
- Documentation is part of closure when the contract changed. Narrative docs must describe the real behavior, not the intended one.
- Failure honesty is part of done: if the system lacks evidence, capability, or readiness, it must surface that clearly instead of bluffing.
- GoE or model-governance work is not done just because the loop exists. It is done when weaker or cheaper routes show observable quality uplift under the governed flow.

## Review Triggers

- Config or dependency changes require explicit mention.
- Production code without tests requires justification.
- Guidance-file edits should be rare and intentional.
- If a guidance file keeps growing with old notes, extract durable rules and move the rest into archives or ticket artifacts.
- File boundaries should stay honest. If a responsibility header is hard to keep concise, the file boundary is probably wrong.
- If the same review guidance keeps recurring, move it into an audit rule instead of paying that review cost repeatedly.
- If a shell, provider, workflow, or init path changed, refresh the dogfood report before claiming the surface still works.

```ai-workflow-audit
{
  "requiredPatterns": [
    {
      "id": "critical-path-test-coverage",
      "include": ["project-guidelines.md"],
      "extensions": [".md"],
      "pattern": "For provider, shell, routing, setup, and fallback changes, add at least one test at the actual entrypoint and one test for the degraded path."
    },
    {
      "id": "ollama-state-split",
      "include": ["project-guidelines.md"],
      "extensions": [".md"],
      "pattern": "When asserting Ollama behavior, tests must keep `configured`, `installed`, and `available` separate so a broken probe cannot hide behind a passing registry fallback."
    },
    {
      "id": "dogfood-before-closure",
      "include": ["project-guidelines.md"],
      "extensions": [".md"],
      "pattern": "Operator-surface changes should be dogfooded through `ai-workflow` itself before closure, not only through internal function tests."
    }
  ]
}
```

## Audit Extensions

Add machine-readable rule blocks in fenced `ai-workflow-audit` JSON blocks when a project-specific rule becomes important enough to enforce automatically.
Keep the rules narrow, file-scoped, and explainable.

Schema example:

```json
{
  "headers": [],
  "forbiddenPatterns": [],
  "requiredPatterns": [],
  "forbiddenImports": [],
  "allowlists": []
}
```
