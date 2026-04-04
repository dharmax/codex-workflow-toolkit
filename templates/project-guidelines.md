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
- Smart codelets should be routed through the cheapest suitable provider, not hardcoded to one model family.

## Architecture

- Runtime:
- Primary entry points:
- State and data boundaries:
- Test layers:

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

## Type Safety

- Use strict TypeScript.
- Prefer explicit domain types over ad-hoc object literals.
- Avoid `any` unless a boundary truly forces it and the reason is documented.
- Handle unknown external or AI-shaped payloads defensively.

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

## Verification

- Required checks:
- Fast targeted checks:
- Manual checks that matter:

## Test Strategy

- Goal: maximize efficiency in time and token cost without compromising reliability.
- Prefer fast deterministic module tests for domain behavior.
- Add integration or E2E coverage only where user-visible flows or system boundaries require it.
- No placeholder tests: every test should be capable of catching a real bug.
- When fixing a bug, add the test that would have caught that bug.
- Keep verification layered:
  - workflow/guidance/kanban contract changes should prove themselves through `workflow-audit`
  - small tickets should default to quick but meaningful unit or module tests
  - related batches or larger tickets should add E2E, including visual proof when UI behavior changed
  - every few batches should run super-E2E, simulation, or emulator-backed flows when the project supports them
  - special mechanisms and rare flows should get special-purpose tests instead of being left to generic coverage
  - domain changes should prefer focused deterministic tests before broader runs
  - E2E should cover system paths and regressions, not replace module-level proof
  - human-only acceptance should stay explicit instead of being implied by green automation

## Test Examples

- Small ticket example:
  - fix one selector bug -> one focused unit test
  - clamp one malformed payload path -> one focused module contract test
- Batch example:
  - normalize several related UI tickets -> targeted browser/E2E plus visual check
  - land one larger routing/persistence ticket -> E2E for the affected user path
- Super-E2E example:
  - after a few related batches, run the heavier emulator/simulation path to regain broader confidence
- Special-test example:
  - imports, migrations, AI artifact shaping, payment paths, or other unusual flows should get purpose-built tests

## Review Triggers

- Config or dependency changes require explicit mention.
- Production code without tests requires justification.
- Guidance-file edits should be rare and intentional.
- If a guidance file keeps growing with old notes, extract durable rules and move the rest into archives or ticket artifacts.
- File boundaries should stay honest. If a responsibility header is hard to keep concise, the file boundary is probably wrong.
- If the same review guidance keeps recurring, move it into an audit rule instead of paying that review cost repeatedly.

## Audit Extensions

Add machine-readable rule blocks in fenced `codex-workflow-audit` JSON blocks when a project-specific rule becomes important enough to enforce automatically.
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
