<!-- Responsibility: Define how GoE governs shell interpretation and produced code artifacts.
Scope: Planning artifact only. Final human handoff and persistence details belong to the next GoE ticket. -->

# GoE Shell And Artifact Governance

## Purpose

GoE should govern two different failure surfaces:

1. shell interpretation
   - did the system understand the task, mode, capability, and intended operation correctly?
2. produced artifact quality
   - is the generated code, fix, patch, or execution plan actually good enough?

These are related but not identical.

A route can interpret the task correctly and still generate weak code.
A route can also generate plausible code for the wrong task because the shell framed the work badly.

This ticket defines how GoE should cover both layers.

## Two-stage governance model

Use a two-stage model for governed coding or debugging work.

### Stage 1: shell interpretation governance

Govern:

- task understanding
- mode choice
- capability choice
- routing posture
- operation selection
- workflow-discipline fit

The governed artifact at this stage is the shell's proposed plan of action.

### Stage 2: produced artifact governance

Govern:

- code patch quality
- fix correctness
- verification sufficiency
- degraded-path handling
- consistency with the approved plan from stage 1

The governed artifact at this stage is the produced code or fix output plus its verification story.

The system should not collapse these into one vague "AI reviewed itself" step.

## Why both stages are necessary

### Without stage 1

The system can confidently produce code for the wrong task, wrong mode, wrong capability, or wrong blast radius.

Typical failures:

- solving a feature request as a fix
- patching when the task should remain bug-hunting
- mutating when workflow discipline should have blocked execution
- choosing a route that is too weak for the requested work

### Without stage 2

The system can produce a superficially reasonable plan and then emit weak implementation artifacts.

Typical failures:

- patch looks coherent but does not satisfy the plan
- verification is too weak
- degraded path is missing
- code introduces architecture drift
- diagnosis-driven fix still rests on weak evidence

## Stage 1: shell interpretation governance

GoE should review the shell interpretation before significant coding or debugging execution proceeds.

The interpretation candidate should include:

- requested task
- resolved shell mode
- selected capability or operation
- routing posture
- intended execution shape
- verification intent
- active ticket, feature, module, problem, and plan context

### What the critic should test at stage 1

- did the shell choose the correct work mode?
- did it identify the right capability and surface?
- did it pick the correct task class?
- did it preserve workflow discipline and mutation rules?
- is the proposed route too weak for the task?
- did it frame the next step as plan, diagnosis, repair, feature work, or audit appropriately?

### What the auditor should test at stage 1

- is the interpretation good enough to authorize downstream execution?
- is GoE required for the next stage or can the work remain direct under policy?
- should the work stay in planning or bug-hunting rather than proceed into code generation?

Stage 1 approval means:

- the shell understood the job well enough
- the execution path is coherent enough to allow stage 2 work

It does not mean the produced code is approved.

## Stage 2: produced artifact governance

After the system generates code, a fix plan, or a concrete patch, GoE should evaluate the artifact against the approved interpretation.

The artifact package should include:

- produced patch, code, or fix description
- files or surfaces touched
- verification run or intended verification
- degraded-path considerations
- relationship to the approved stage-1 plan

### What the critic should test at stage 2

- does the artifact actually implement the approved approach?
- is the scope too broad or too narrow?
- are failure modes or degraded paths ignored?
- is the verification plan too weak for the risk?
- does the patch smuggle in unrelated behavior?
- does a debugging artifact present an unproven hypothesis as a confirmed fix?

### What the auditor should test at stage 2

- is the artifact quality high enough for the autonomy level?
- does the evidence justify acceptance?
- should the artifact be rejected, revised, or escalated to a stronger route?

Stage 2 is where the system decides whether the produced artifact is good enough, not merely plausible.

## Stage coupling rules

The second stage should consume the first stage's approved interpretation rather than re-inventing it.

That means stage 2 should know:

- what mode was approved
- what capability was selected
- what problem or plan context mattered
- what scope boundary was approved
- what verification standard was expected

If stage 2 discovers the artifact depends on a different interpretation, it should force a return to stage 1 rather than silently revising history.

## Mode-specific governance implications

### `feature`

Stage 1 should verify:

- the requested capability addition is framed correctly
- the module and surface scope are appropriate

Stage 2 should verify:

- implementation matches the feature slice
- verification is strong enough for new behavior

### `fixing`

Stage 1 should verify:

- this is truly a bounded repair and not unresolved diagnosis

Stage 2 should verify:

- the fix addresses the stated defect
- the blast radius and degraded path are handled

### `bug-hunting`

Stage 1 should verify:

- the investigation path is evidence-driven
- the route is not skipping into speculative patching

Stage 2 should apply only if the flow legitimately transitions into `fixing`.

That transition should itself be justified by the stage-1-governed diagnosis.

### `auditing`

Stage 1 should verify:

- the review question and evidence set are correct

Stage 2 applies only if the audit produces a concrete remedial artifact or plan.

## Weak-model-sensitive artifact rule

When a cheap or weak route produces code for a task above its strength, artifact governance should be stricter, not looser.

That means:

- stronger expectation for critic objections
- stronger verification expectations
- quicker escalation to a stronger model if the artifact remains shaky after governance

This is one of the main mechanisms by which GoE improves weaker routes in practice.

## Verification under artifact governance

Artifact governance should treat verification as part of the artifact, not a later optional add-on.

The stage-2 package should therefore include at least one of:

- executed verification with results
- explicit verification commands to run next
- a justified reason why verification must wait

For high-risk surfaces, "patch looks right" is not evidence.

## Refusal and rollback behavior

GoE should be allowed to stop execution at either stage.

### Refuse at stage 1

Use when:

- the shell interpretation is not reliable enough
- the task should be reframed
- the route is too weak and no acceptable path is available yet

### Reject at stage 2

Use when:

- the produced artifact does not satisfy the approved interpretation
- verification is too weak
- the patch is risky, mis-scoped, or under-evidenced

Rejecting a stage-2 artifact should not erase the approved stage-1 plan. It should mean "the execution artifact failed the gate."

## Relationship to visibility and later handoff

This ticket sets the governance behavior, not the final persistence contract.

However, later visibility and handoff work should be able to show:

- stage-1 interpretation verdict
- stage-2 artifact verdict
- whether the artifact was revised, rejected, or escalated

That is how operators and host surfaces will understand whether failure happened in understanding or in implementation quality.

## Relationship to the final GoE ticket

This ticket defines:

- that shell interpretation and produced artifacts are governed separately
- what each stage is supposed to test
- when a flow should return from artifact review back to interpretation

This ticket does not define:

- how user-facing blocker tickets are created
- how stronger-model escalation artifacts are stored
- the final operator-facing approval or rejection record shape

Those belong to:

- `TKT-GOE-005`

The escalation, stored-verdict, and user-handoff contract is defined in [docs/goe-escalation-and-handoff-contract.md](./goe-escalation-and-handoff-contract.md).

## Acceptance criteria for the planning slice

This ticket is complete when later implementation no longer has to invent:

- whether GoE should govern shell interpretation separately from code quality
- what stage 1 and stage 2 each evaluate
- how the approved interpretation constrains artifact review
- when artifact review should bounce the flow back to interpretation
