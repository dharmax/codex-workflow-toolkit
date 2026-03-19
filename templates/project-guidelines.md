# Project Guidelines

Keep this file short and durable. If a point is ticket-local, keep it out.

## Non-Negotiables

- Keep deterministic state mutation deterministic.
- Treat AI output as untrusted input: validate, bound, and default safely.
- Do not let non-critical async work block the main user loop.
- Preserve access to core state and critical controls when reshaping UI surfaces.

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

- Prefer fast deterministic module tests for domain behavior.
- Add integration or E2E coverage only where user-visible flows or system boundaries require it.
- No placeholder tests: every test should be capable of catching a real bug.
- When fixing a bug, add the test that would have caught that bug.

## Review Triggers

- Config or dependency changes require explicit mention.
- Production code without tests requires justification.
- Guidance-file edits should be rare and intentional.
- File boundaries should stay honest. If a responsibility header is hard to keep concise, the file boundary is probably wrong.

## Audit Extensions

Add machine-readable rule blocks in fenced `codex-workflow-audit` JSON blocks when a project-specific rule becomes important enough to enforce automatically.
Keep the rules narrow, file-scoped, and explainable.

Schema example:

```json
{
  "headers": [],
  "forbiddenPatterns": [],
  "requiredPatterns": []
}
```
