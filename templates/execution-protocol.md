# Execution Protocol

Keep execution disciplined, test-backed, and easy to hand off.

## Required Order

1. Read the target ticket in `kanban.md`.
2. Read the owner docs needed for that ticket.
3. Move one ticket or one explicit batch ticket to `In Progress`.
4. State the burst shape: target family, intended outcome, validation plan.
5. Make the smallest coherent burst that solves the ticket honestly.
6. Validate at the real risk level of the change.
7. Update kanban, then guidance docs if durable contracts changed.

## Scope Control

- Default to one owned problem family at a time.
- Batch only when the safer fix is systemic and the ticket says so explicitly.
- New findings become new tickets unless they block the active ticket.
- Avoid hidden refactors, broad renames, and style churn.
- If the user gives a lane order or ticket-group order, treat that as the active queue until a real blocker appears.

## Burst Budget

- Low-risk visual/system polish: 3-8 related tickets or one explicit sweep ticket.
- Medium-risk UI/runtime behavior: 2-4 tightly coupled tickets.
- High-risk mechanics, persistence, routing, or data integrity: one ticket or one narrow regression family.

## Validation Rules

- Never claim a command was run if it was not.
- Prefer targeted validation before broad sweeps.
- Replace passive waiting with explicit readiness checks when tests look stalled.
- Define a stop condition before broad reruns.
- If a full rerun isolates one failing artifact, stop the sweep and switch to focused reproduction.
- End long verification work in one truthful state only: green with proof, bounded checkpoint, or explicit blocker.
- If workflow docs or project rules changed, run `node scripts/codex-workflow/workflow-audit.mjs`.

## Status Rules

- A ticket may end only as `DONE`, `PARTIAL`, or `BLOCKED`.
- `DONE` requires complete implementation plus explicit verification.
- `PARTIAL` means meaningful progress exists but required work or proof is still missing.
- `BLOCKED` means completion is not currently possible because of a real dependency, missing information, or concrete failure.
- Never describe `PARTIAL` work in `DONE` language.

## Closure Gate

- Do not move a ticket to `Done` unless every requested item was implemented.
- Check each acceptance criterion explicitly.
- Include concrete proof tied to the actual change.
- If any required work or proof is missing, keep the ticket open as `PARTIAL` or `BLOCKED`.

## Completion Report

- `Status: DONE | PARTIAL | BLOCKED`
- requested changes implemented
- files changed
- unrequested changes made
- acceptance criteria verification
- tests and checks actually run
- remaining gaps
- risks or uncertainties
- whether the ticket should be reopened
