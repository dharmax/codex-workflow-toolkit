<!-- Responsibility: Define the fixed v1 GoE debate loop contract.
Scope: Planning artifact only. Enablement policy, scope coverage, and persistence details belong to later GoE tickets. -->

# GoE Triad Contract

## Purpose

GoE exists to raise plan quality without assuming the first model answer is good enough.

Its main value is not "multiple models talk." Its value is disciplined disagreement with bounded escalation:

- one role proposes
- one role attacks weak points
- one role decides whether the plan is good enough, needs escalation, or must be turned into a user-visible blocker

This is especially important when the base coding or planning route is cheap or weak. The contract should let those cheaper routes produce stronger outcomes through structured critique instead of blind trust.

## Fixed v1 roles

### 1. Suggester

Owns:

- generating the current best candidate plan
- revising the plan after criticism
- preserving context from prior rounds
- stating assumptions and intended execution path

The suggester is the constructive role. It is allowed to change its mind between rounds.

### 2. Critic

Owns:

- finding faults, gaps, contradictions, and missing evidence
- testing whether the candidate is actually grounded in workflow reality
- deciding whether the candidate is satisfactory enough to move to audit

The critic does not produce the main plan. Its job is to try to break it.

### 3. Auditor or escalator

Owns:

- auditing any candidate that the critic marks satisfactory
- rejecting "locally satisfactory but still not good enough" plans
- diagnosing stalled loops after repeated dissatisfaction
- deciding whether to escalate to a stronger model or create a user-facing blocker

This role is not a second critic. It is the final quality gate and meta-reasoner.

## Shared input contract

All GoE roles should receive the same grounded context pack:

- requested task
- effective shell mode and routing posture
- relevant capability judgment
- relevant features, modules, surfaces, integrations, tickets, plans, and problems
- verification and health evidence
- prior round artifacts

Without a shared evidence pack, disagreement becomes prompt drift instead of useful governance.

## Core loop

The fixed v1 loop has three phases.

### Phase 1: proposal

The suggester produces a candidate with:

- proposed approach
- evidence and assumptions
- expected risks
- next execution step

### Phase 2: critique

The critic returns one of two verdicts:

- `dissatisfied`
- `satisfied`

If `dissatisfied`, it must state why in actionable form:

- missing evidence
- capability mismatch
- unhandled failure mode
- invalid assumption
- bad scope cut
- weak verification plan
- violation of workflow or module boundaries

The critic should not reject with vague style complaints.

### Phase 3: audit or escalation

If the critic is satisfied, the auditor evaluates the candidate and returns one of:

- `approved`
- `rejected`
- `escalate-model`
- `escalate-user`

If the critic is still dissatisfied after the bounded retry count, the auditor switches into escalator mode and diagnoses the stall.

## Iteration contract

### Retry budget

Allow at most three suggester or critic rounds before the auditor must intervene as escalator.

That means:

1. initial suggestion
2. revised suggestion after first dissatisfaction
3. revised suggestion after second dissatisfaction

If the critic is still dissatisfied after the third candidate, the loop must stop normal back-and-forth and move to escalation analysis.

### What carries between rounds

Each new suggester round should carry forward:

- prior candidate
- critic findings
- evidence already gathered
- constraints already accepted as real

The loop should not restart from zero unless the auditor explicitly says the framing itself was wrong.

### What counts as progress

A new round counts as progress only if it changes at least one of:

- plan structure
- evidence base
- scope boundary
- verification path
- capability or provider choice

Rewording without material improvement should not consume more cycles.

## Satisfaction and approval rules

### Critic satisfaction

The critic may mark a candidate `satisfied` only when:

- the approach addresses the actual task
- the assumptions are explicit enough
- the plan is grounded in the available workflow state
- major foreseeable failure modes are handled or called out
- the verification path is coherent

`satisfied` means "worthy of final audit," not "automatically approved."

### Auditor approval

The auditor may mark a candidate `approved` only when:

- the critic is satisfied
- the plan quality is high enough for the intended autonomy level
- the capability and model route are appropriate for the task complexity
- the remaining uncertainty is acceptable and clearly stated

The auditor should reject plans that are merely plausible but underpowered, underspecified, or mis-scoped for the requested work.

## Stall diagnosis by the auditor

When the loop stalls after repeated dissatisfaction, the auditor should classify the root problem before deciding the next action.

Preferred diagnosis buckets:

- `missing-context`
  - the workflow state or task evidence is not rich enough
- `capability-gap`
  - the shell or current surface cannot yet support the requested task well
- `model-too-weak`
  - the current suggester route is not capable enough
- `conflicting-constraints`
  - the user's requirements or project rules conflict
- `bad-task-framing`
  - the task should be split, reordered, or reframed

The diagnosis should drive escalation, not just decorate the failure.

## Escalation outcomes

### `approved`

The candidate is good enough to become the active plan for downstream work.

### `rejected`

The candidate is not good enough and no immediate better route is justified.

This should record why the governed loop stopped.

### `escalate-model`

Use when the main blocker is model weakness rather than missing project truth.

The escalator should hand the suggester a stronger route together with:

- the current evidence pack
- the failed candidate history
- the critic's unresolved objections
- the diagnosed reason for escalation

This prevents the stronger route from paying to rediscover the same context.

### `escalate-user`

Use when the blocker is not solvable by more internal debate.

Examples:

- a required decision is missing
- constraints conflict
- the repo lacks necessary capability or evidence
- the task is underspecified in a way the system cannot responsibly guess

This outcome should create a workflow-visible artifact for the user rather than burying the blocker inside a chat transcript.

## Output contract

The governed loop should produce a structured result even when the user sees plain prose.

Minimum fields:

- `goeStatus`
  - proposed, dissatisfied, satisfied, approved, rejected, escalate-model, escalate-user
- `roundCount`
- `candidateSummary`
- `criticFindings`
- `auditorVerdict`
- `diagnosis`
- `evidenceRefs`
- `nextAction`

Later GoE persistence work can decide the exact schema, but not the required semantics.

## Economy rules

GoE should improve weaker routes, not erase the benefit of using them.

Therefore:

- keep the suggester on the cheapest capable route unless the loop proves it is not enough
- keep the critic bounded and evidence-focused
- reserve the auditor escalation path for approval and stall handling
- do not spend stronger-model budget before the governed loop has identified a real reason

This is the core mechanism for making cheaper models practically smarter in the workflow, not just cheaper.

## Relationship to later GoE tickets

This ticket defines the loop contract only.

It does not define:

- when GoE is enabled by default
- which shell modes or task families invoke it
- how GoE governs code output and shell interpretation
- how GoE artifacts are persisted into plans, problems, or host-visible records

Those belong to:

- `TKT-GOE-002`
- `TKT-GOE-003`
- `TKT-GOE-004`
- `TKT-GOE-005`

The default-on policy and override contract is defined in [docs/goe-default-on-policy.md](./goe-default-on-policy.md).

## Acceptance criteria for the planning slice

This ticket is complete when later implementation work no longer has to invent:

- who the three roles are
- how the retry budget works
- when the critic is allowed to say `satisfied`
- when the auditor approves, rejects, escalates the model, or escalates to the user
- what structured output the loop must produce
