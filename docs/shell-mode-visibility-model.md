<!-- Responsibility: Define how shell mode state is recorded and exposed across DB-backed surfaces.
Scope: Planning contract only. Runtime wiring belongs to later implementation work. -->

# Shell Mode Visibility Model

## Purpose

The shell work-mode model is only useful if operators and host surfaces can see the same resolved state.

This note defines:

- which shell-mode facts are ephemeral versus durable
- where durable mode facts should live in the workflow DB
- which surfaces should expose them
- how mode visibility should support audit, guidance, host parity, and capability-aware workflow integrity

It complements:

- [docs/shell-work-mode-model.md](./shell-work-mode-model.md)
- [docs/shell-mode-inference-and-override.md](./shell-mode-inference-and-override.md)
- [docs/shell-mode-routing-policy.md](./shell-mode-routing-policy.md)
- [docs/dual-surface-host-integration.md](./dual-surface-host-integration.md)

## Visibility goals

Mode visibility exists for four consumers:

1. the operator
   - to understand what kind of work the shell believes it is doing
2. host and adapter surfaces
   - to render the same judgment as shell instead of inventing their own state
3. audit and verification flows
   - to judge whether the shell routed and spoke appropriately
4. workflow memory
   - to connect later plans, problems, tickets, and capability judgments back to the mode context that produced them

## What must be visible

For any non-trivial shell turn, the system should be able to recover:

- caller surface or integration
- requested mode
- effective mode
- mode source
- execution stance
- trace state
- task class
- capability or operation selected
- governance hint
- active ticket or plan context when present
- whether a mode switch occurred
- why the switch happened

This is more than a status line. It is the minimum evidence needed to explain shell behavior later.

## Ephemeral vs durable state

### Ephemeral session state

Keep these session-local and non-project-global:

- explicit mode override for the live shell session
- current trace toggle
- continuation-local fallback decisions
- transient UI phrasing choices

This state may live in process memory or session-local workflow state, but it should not be projected as persistent repo truth across sessions.

### Durable turn evidence

Persist these for shell turns that materially answer, plan, route, or mutate:

- requested mode
- effective mode
- mode source
- stance
- selected task class
- selected capability or operation
- active workflow selector context
- governance hint
- transition reason if the mode changed
- result classification:
  - reply
  - plan
  - mutation
  - escalation
  - refusal

Durable turn evidence is what later transcript judges, host adapters, and workflow reviews should read.

### Durable derived workflow memory

Persist downstream workflow objects separately from shell turn evidence:

- plans
- problems
- tickets
- capability judgments

Those objects should reference the mode context that produced them, but they should not be replaced by raw shell-turn logging.

## Canonical storage model

Use existing DB primitives with clear roles instead of inventing a bespoke transcript subsystem.

### `workflow_runs`

Use `workflow_runs` for shell sessions or one-shot shell executions that are treated as governed runs.

Recommended shell-specific payload:

- `prompt`
  - operator request or session opener
- `status`
  - running, completed, failed, paused
- `current_state`
  - current effective shell mode or execution phase
- `result_json`
  - terminal result summary, including final mode and outcome class

For interactive sessions, one run may cover a session. For one-shot shell calls, one run may cover one invocation.

### `workflow_state`

Use `workflow_state` for live mutable shell-session facts:

- `requested_mode`
- `effective_mode`
- `mode_source`
- `stance`
- `trace_state`
- `task_class`
- `selected_capability`
- `active_ticket_id`
- `active_plan_id`
- `governance_hint`

This is the right place for current session truth because it is queryable without pretending the state is global forever.

### `workflow_transitions`

Use `workflow_transitions` for meaningful mode changes and stance changes.

Examples:

- `planning` -> `feature`
- `bug-hunting` -> `fixing`
- `auto` request resolving to `auditing`
- read-only stance becoming mutation-enabled

`payload_json` should capture:

- transition reason
- previous and new mode source
- ticket, plan, problem, or capability evidence that drove the change
- whether the change was operator-forced or system-inferred

### `events`

Use `events` for immutable turn records and shell-mode observations.

Preferred event types:

- `shell_turn_recorded`
- `shell_mode_switch`
- `shell_mode_refused`
- `shell_mode_escalated`

The payload should include the durable turn evidence listed above plus references to related workflow objects created or touched by the turn.

### `entities` and `claims`

Do not make every shell turn a first-class entity.

Use entities and claims only for operator-visible derived objects:

- a plan approved from a planning or GoE turn
- a problem synthesized from bug-hunting or audit evidence
- a capability judgment that the shell exposes to the user

Those entities should carry claims such as:

- `originated_in_mode`
- `originated_from_surface`
- `originated_from_run`
- `originated_from_transition_reason`

That preserves explainability without polluting the entity model with raw chat turns.

## Projection and surface rules

### Interactive shell

`mode status` should read from current session state and show:

- requested mode
- effective mode
- mode source
- stance
- trace state
- selected task class
- selected capability or operation when known

If the effective mode changed recently, the shell may also show the last transition reason.

### One-shot shell output

One-shot shell responses should include mode metadata in JSON or structured output surfaces even if the human-readable reply stays concise.

Minimum one-shot metadata:

- requested mode
- effective mode
- mode source
- stance
- task class
- governance hint

### `ask` and host adapters

Host surfaces should be able to retrieve the same mode tuple from the shared judgment path.

That means host responses should not independently infer mode from prompt text when the shell run already resolved:

- effective mode
- selected capability
- relevant evidence
- limits and next step

Mode visibility is therefore part of host parity, not a shell-only convenience.

### Status and projection surfaces

Do not project shell-mode state into `kanban.md` or `epics.md`.

Those projections are for project work state, not transient shell control state.

Instead, shell-mode visibility should appear in:

- session or run inspection views
- transcript artifacts
- verification summaries
- host JSON envelopes
- derived plan or problem records when relevant

### Verification artifacts

Shell transcript artifacts should include enough metadata for transcript judges to verify:

- whether the mode matched the request
- whether the answer style matched the mode
- whether mutation posture matched the mode and workflow gates
- whether a later switch was justified

This can be a header block or structured sidecar, but the information must be durable.

## Capability-aware visibility requirement

Shell mode visibility should not stop at `effective_mode=feature`.

For capability-aware workflow integrity, the system should also expose:

- what capability the shell believed it was using
- why it believed that capability applied
- what evidence or limits were attached
- whether the capability was healthy, degraded, or blocked

Without this, the shell can claim it is in the right mode while still hiding that the underlying capability was weak or missing.

## Minimum query contract

Later implementation should make these queries answerable from shared state:

1. what mode did the shell resolve for this turn or run?
2. why did it resolve that mode?
3. what capability and task class did it select?
4. did the mode change during the session, and why?
5. was the shell in read-only or mutating stance?
6. which plan, problem, ticket, or capability judgment came out of that mode context?
7. what should host surfaces render to preserve parity with shell?

If any of these still require transcript-only scraping, this planning slice was not specific enough.

## Non-goals for this slice

- No requirement to persist global mode preferences across sessions.
- No requirement to add shell-mode rows to kanban or epic projections.
- No requirement to store full natural-language transcripts in the DB.
- No requirement to finalize the exact JSON schema for every event payload.

This slice defines storage roles and visibility boundaries, not the full runtime implementation.

## What this ticket owns

This ticket defines:

- the shell-mode visibility contract
- the separation between ephemeral session state and durable turn evidence
- the recommended use of `workflow_runs`, `workflow_state`, `workflow_transitions`, `events`, `entities`, and `claims`
- the projection boundaries for shell, host, and verification surfaces
- the requirement that capability judgments be visible alongside mode judgments

This ticket does not define:

- the exact implementation patch set
- the final host envelope schema
- the final GoE persistence model

Those belong to later implementation and GoE tickets.
