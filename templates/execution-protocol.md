<!-- Responsibility: Define the required execution order, scope control, validation behavior, and closure policy.
Scope: Project-specific technical standards and durable lessons belong in project-guidelines.md and knowledge.md, not in this protocol. -->
# Execution Protocol

Keep execution disciplined, test-backed, and easy to hand off.

## Required Order

1. If the work is large enough to span an epic or a multi-ticket batch, create a fresh branch before implementation starts.
2. If the repo state is already in motion, capture a baseline commit and push it before opening the next implementation slice.
3. Read the target ticket in `kanban.md`.
4. Read the owner docs needed for that ticket.
5. Move one ticket or one explicit batch ticket to `In Progress` with `scripts/codex-workflow/kanban-move.mjs`.
6. State the burst shape: target family, intended outcome, validation plan.
7. Make the smallest coherent burst that solves the ticket honestly.
8. Validate at the real risk level of the change.
9. Update kanban, then guidance docs if durable contracts changed, and archive stale done cards when needed.
10. If the thread is getting heavy, create a compact handoff artifact before continuing.

## Ticket Ownership

- `kanban.md`: live execution state
- `kanban-archive.md`: completed ticket history that no longer belongs on the live board
- `epics.md`: deep-backlog epic catalog and names
- `execution-protocol.md`: execution order, scope control, and closure truthfulness
- `project-guidelines.md`: durable engineering constraints and architecture boundaries
- `knowledge.md`: durable lessons, traps, and regression memory
- `enforcement.md`: machine-enforced baseline rules and narrow exceptions

## Kanban Discipline

- Update `kanban.md` in real time as work moves.
- When you start a ticket, move it to `In Progress` immediately.
- Keep the center working queue in `ToDo`.
- Keep high-priority bug work explicit in `Bugs P1` and lower-priority bug work in `Bugs P2/P3`.
- Keep larger later work in `Deep Backlog` and tie each such ticket to an epic in `epics.md`.
- Keep human-only acceptance work in `Human Inspection`.
- Put optional refactors, feature ideas, and polish candidates in `Suggestions`.
- Keep `kanban.md` in Obsidian Kanban plugin format.
- Use `scripts/codex-workflow/kanban-new.mjs`, `scripts/codex-workflow/kanban-next.mjs`, `scripts/codex-workflow/kanban-move.mjs`, `scripts/codex-workflow/kanban-archive.mjs`, and `scripts/codex-workflow/kanban-migrate-obsidian.mjs` instead of hand-editing when possible.

## Scope Control

- Default to one epic at a time when the work is roadmap-level or broader.
- Default to one owned problem family at a time.
- Batch only when the safer fix is systemic and the ticket says so explicitly.
- New findings become new tickets unless they block the active ticket.
- Avoid hidden refactors, broad renames, and style churn.
- If the user gives a lane order or ticket-group order, treat that as the active queue until a real blocker appears.
- Keep the immediate-action lane honest: only immediately actionable tickets belong there.
- If the user points to inline ticket notes as active instructions, do that work now instead of deferring it behind cleaner opportunistic tasks.

## Burst Budget

- Low-risk visual/system polish: 3-8 related tickets or one explicit sweep ticket.
- Medium-risk UI/runtime behavior: 2-4 tightly coupled tickets.
- High-risk mechanics, persistence, routing, or data integrity: one ticket or one narrow regression family.

## Validation Rules

- Never claim a command was run if it was not.
- Validation goal: minimum time and token cost that still preserves reliability.
- Reliability is not negotiable; efficiency chooses the smallest sufficient proof, not weaker proof.
- Prefer deterministic local extraction, changed-file summaries, and verification helpers over repeated model reasoning for bounded low-risk tasks.
- Prefer targeted validation before broad sweeps.
- Default validation cadence:
  - small ticket: quick but meaningful unit or module tests first
  - related batch or one larger ticket: E2E, including visual checks when UI is part of the change
  - every few batches or when risk accumulates: super-E2E, simulation, or emulator-backed runs when the project supports them
  - special flows: add special tests for the exact mechanism or path that carries unique risk
- Default validation stack:
  - workflow/docs/kanban changes: `workflow-audit`
  - small source changes: targeted checks plus typecheck when applicable
  - related batches and larger tickets: targeted integration or E2E
  - accumulated regression confidence: super-E2E or simulation layer when available
  - human-only acceptance: keep the card in `Human Inspection`
- Replace passive waiting with explicit readiness checks when tests look stalled.
- Define a stop condition before broad reruns.
- If a full rerun isolates one failing artifact, stop the sweep and switch to focused reproduction.
- End long verification work in one truthful state only: green with proof, bounded checkpoint, or explicit blocker.
- If workflow docs or project rules changed, run `node scripts/codex-workflow/workflow-audit.mjs`.

## Session Hygiene

- Keep live context small: extract the active ticket and relevant guidelines instead of dragging full boards and docs through the hot path.
- Recommend `/compact` when the current thread still has useful recent state but the working set details are starting to sprawl.
- Recommend `/new` when a compact handoff artifact exists and continuing in the current thread would mostly carry stale detail.
- Treat `/clear` as a human/operator action only. Do not pretend the tool can force or verify internal chat-history deletion.

## Validation Examples

- Small ticket:
  - example: one reducer fix, one parser guard, one helper bug
  - default proof: focused unit/module test plus typecheck when relevant
- Related batch or larger ticket:
  - example: several related UI cards, one modal contract sweep, one persistence regression family
  - default proof: targeted E2E, including visual proof when the change is user-visible
- Every few batches or accumulated-risk checkpoint:
  - example: after multiple UI batches, after several state-flow batches, before a release handoff
  - default proof: super-E2E, simulation, or emulator-backed run when the project supports it
- Special flow:
  - example: import/export, payment path, migration, background sync, AI-forged artifact validation
  - default proof: add a special-purpose test for that exact mechanism instead of trusting generic coverage

## Status Rules

- A ticket may end only as `DONE`, `PARTIAL`, or `BLOCKED`.
- `DONE` requires complete implementation plus explicit verification.
- `PARTIAL` means meaningful progress exists but required work or proof is still missing.
- `BLOCKED` means completion is not currently possible because of a real dependency, missing information, or concrete failure.
- Never describe `PARTIAL` work in `DONE` language.

## Proof Standard

- A claim without evidence does not count as verification.
- For each acceptance criterion, mark it satisfied, not satisfied, or partially verified.
- Tie proof to the actual change through commands run, observed behavior, changed code paths, or relevant artifacts.

## Closure Gate

- Do not move a ticket to `Done` unless every requested item was implemented.
- Check each acceptance criterion explicitly.
- Include concrete proof tied to the actual change.
- If any required work or proof is missing, keep the ticket open as `PARTIAL` or `BLOCKED`.

## Adversarial Self-Check

- what requested work is still missing?
- what acceptance criterion is not truly verified?
- what changed that was not requested?
- what assumption might still be wrong?
- why would a strict reviewer reject closure?

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
