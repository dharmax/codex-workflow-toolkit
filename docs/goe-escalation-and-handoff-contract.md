<!-- Responsibility: Define GoE escalation records, user handoff artifacts, and implementation-ready proof expectations.
Scope: Planning artifact only. Runtime implementation belongs to the next execution step. -->

# GoE Escalation And Handoff Contract

## Purpose

The prior GoE notes define:

- the triad loop
- default-on policy
- coding/debugging coverage
- shell-interpretation and artifact governance

This note closes the planning epic by defining what happens when GoE finishes:

- what verdict record is stored
- how stronger-model escalation is packaged
- how unsolved work is handed to the user
- what implementation order and proof matrix should be used for the first real build

The goal is to make the next step implementation-ready rather than conceptually complete but operationally vague.

## Final outcome classes

Every governed run should end in one final outcome class:

- `approved`
- `rejected`
- `escalate-model`
- `escalate-user`

These are final outcomes, not intermediate critic states.

The run may also contain intermediate statuses such as `dissatisfied` or `satisfied`, but the terminal record must resolve to one of the four classes above.

## Canonical verdict record

Every completed GoE run should produce one canonical verdict record.

Minimum fields:

- `goeRunId`
- `terminalOutcome`
- `stageReached`
  - interpretation
  - artifact
- `approvedCandidateSummary`
- `criticFindings`
- `auditorVerdict`
- `diagnosis`
- `selectedMode`
- `selectedCapability`
- `selectedRoute`
- `evidenceRefs`
- `relatedPlanId`
- `relatedProblemId`
- `relatedTicketId`
- `nextAction`
- `createdAt`

Rules:

- `approvedCandidateSummary` may be null when the outcome is `escalate-user`
- `relatedPlanId` should be present when the outcome approves or preserves a plan
- `relatedProblemId` should be present when the outcome identifies a blocker or failure

This is the minimum stable shape the next implementation should target even if the final JSON field names evolve.

## Stronger-model escalation package

When the terminal outcome is `escalate-model`, the stronger route should receive a compact escalation package instead of a full raw transcript dump.

Minimum escalation package:

- the original task
- current shell mode and task class
- selected capability
- current route and why it proved insufficient
- stage reached before escalation
- best candidate so far
- unresolved critic objections
- auditor diagnosis
- relevant workflow objects:
  - feature
  - module
  - ticket
  - plan
  - problem
- verification evidence already gathered

Rules:

- do not ask the stronger route to rediscover context the governed loop already has
- do not erase earlier failed attempts; include the useful failure boundary
- do not escalate without the diagnosed reason for doing so

## User handoff artifact

When the terminal outcome is `escalate-user`, GoE should create an operator-visible handoff artifact instead of leaving the blocker in transcript-only form.

The default artifact should be a workflow-visible `problem` plus a linked ticket for the user when action is required.

### Problem record

The `problem` entity should capture:

- concise blocker title
- blocker category:
  - missing decision
  - conflicting constraints
  - missing capability
  - missing evidence
  - route weakness with no acceptable fallback
- impact summary
- evidence summary
- explicit question or decision needed from the user
- suggested next action after user input arrives

### User-facing ticket

Create a linked ticket when the user needs to do something concrete, not merely read a warning.

Recommended ticket characteristics:

- owner narrative may be `user` or `maintainer`, whichever is accurate
- title should describe the missing decision or prerequisite
- summary should state why GoE could not responsibly continue
- lane should be an operator-visible waiting lane such as `Human Inspection` when available, or the nearest project-approved equivalent

Do not create a ticket for purely internal escalations that can continue automatically on a stronger route.

## Approval and rejection records

### `approved`

On approval:

- persist the approved plan or approved artifact linkage
- record the verification expectation that made approval acceptable
- expose the result to shell and host surfaces as a positive governed verdict

### `rejected`

On rejection:

- persist why the candidate failed
- preserve any still-valid plan context
- make it clear whether the next step is revision, reframing, or manual intervention

Rejection should not disappear into logs. It is a first-class workflow fact.

## Storage contract

Use the existing workflow storage primitives, with roles tightened for GoE.

### `workflow_runs`

Use one run per governed GoE execution.

Recommended run metadata:

- `prompt`
  - original task or request
- `status`
  - running, completed, failed, paused
- `current_state`
  - proposal, critique, audit, escalation, handoff
- `result_json`
  - canonical verdict record

### `workflow_state`

Use for live mutable GoE execution state:

- current stage
- round count
- selected mode
- selected capability
- selected route
- current candidate summary
- current critic findings
- current diagnosis
- related plan or problem ids

### `workflow_transitions`

Use to record:

- proposal -> critique
- critique -> audit
- audit -> approve
- audit -> reject
- audit -> escalate-model
- audit -> escalate-user

Transition payload should include the reason and the changed evidence basis.

### `events`

Use immutable events for:

- `goe_run_started`
- `goe_round_completed`
- `goe_outcome_recorded`
- `goe_model_escalated`
- `goe_user_handoff_created`

### `entities` and `claims`

Use entities only for durable operator-facing products:

- approved plan
- blocker problem
- user-action ticket

Useful claims:

- `approved_by_goe`
- `rejected_by_goe`
- `escalated_by_goe`
- `requires_user_input`
- `derived_from_goe_run`

## Surface contract

### Shell

Shell should be able to render:

- final governed verdict
- why the verdict happened
- whether more model work will continue automatically
- whether the operator must act

### Host and `ask` surfaces

Host surfaces should receive the same verdict structure and not reconstruct the reason from prose.

### Verification summaries

Verification artifacts should show:

- governed yes or no
- final outcome class
- whether failure happened in interpretation, artifact quality, or missing external input

## Implementation order

The first implementation pass should proceed in this order:

1. add the GoE run state machine and canonical verdict record
2. add stage-1 interpretation governance wiring
3. add stage-2 artifact governance wiring
4. add model-escalation package generation
5. add user-handoff problem and ticket creation
6. expose verdicts through shell or host structured output
7. add verification and dogfood coverage

This order keeps the execution core stable before adding storage and operator-facing handoff surfaces.

## First implementation proof matrix

The first real implementation should ship with proof at four levels.

### 1. Unit or module proof

Cover:

- verdict classification
- stage transitions
- escalation package building
- user-handoff artifact building
- override and policy resolution interactions

### 2. Entry-point proof

Cover at least one real shell or workflow entry point for:

- governed approval
- governed rejection
- model escalation
- user handoff

Helper-only tests are not enough.

### 3. Degraded-path proof

Cover at least one case where:

- the cheap route is too weak
- GoE identifies that weakness
- the system escalates or hands off correctly

This is the core promise of the feature and must be proved explicitly.

### 4. Operator-surface proof

Before declaring implementation complete, run:

- `node runtime/scripts/ai-workflow/workflow-audit.mjs`
- `node cli/ai-workflow.mjs dogfood --surface shell,provider,workflow,init --profile bootstrap --json`

If implementation changes shell or host structured output materially, add or extend dogfood scenarios for:

- governed approval flow
- governed user handoff flow

## Non-goals for the first implementation pass

The first pass does not need:

- a perfect UI for browsing historical GoE runs
- cross-session preference storage beyond the already planned override model
- broad analytics dashboards

It does need:

- correct verdict semantics
- durable handoff artifacts
- proof that weak-route uplift is working on at least one governed path

## Compact handoff readiness

Once this ticket is closed, the repo should have a compact GoE planning set:

- loop contract
- default-on policy
- coding/debugging coverage
- shell/artifact governance
- escalation and handoff contract

That is enough to start implementation on a fresh thread without reopening the product definition.

## Acceptance criteria for the planning slice

This ticket is complete when the next implementation step no longer has to invent:

- the final outcome classes
- the stronger-model escalation package
- the user-facing blocker artifact shape
- the minimum stored verdict record
- the implementation order
- the first-pass test and proof matrix
