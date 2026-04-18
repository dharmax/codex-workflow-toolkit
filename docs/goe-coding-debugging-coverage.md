<!-- Responsibility: Define which coding and debugging work GoE should govern by default.
Scope: Planning artifact only. Shell/code-output governance details belong to later GoE tickets. -->

# GoE Coding And Debugging Coverage

## Purpose

The default-on policy says GoE should run for most non-trivial development work.

This note makes that concrete for coding and debugging tasks:

- which work classes are governed by default
- which narrow classes may stay direct
- when weak or cheap model routes make GoE effectively mandatory
- how coding and debugging differ

## Coverage principle

GoE should wrap most coding and debugging work because both classes are prone to false confidence:

- coding work can produce plausible but mis-scoped or weakly verified changes
- debugging work can produce plausible but ungrounded diagnoses

The policy should therefore assume governance unless the work is both:

- narrow enough to be mechanically bounded
- strong enough in evidence that a governed loop would add little value

## Governed coding classes

The following coding work should default to GoE:

- feature implementation
- non-trivial fixes
- refactors with behavioral risk
- provider, routing, shell, setup, fallback, or workflow-surface changes
- cross-module or cross-surface changes
- code generation that depends on architecture or policy interpretation
- code changes proposed by a weak or cheap route for tasks above its normal strength

These classes should usually enter GoE through `feature` or `fixing` mode with the coding plan as the governed artifact.

## Governed debugging classes

The following debugging work should default to GoE:

- root-cause analysis where the cause is not already concrete
- intermittent or multi-factor failures
- degraded-path failures
- continuity, routing, subject-loss, or shell-behavior regressions
- failures involving shared infrastructure or provider behavior
- investigation that could easily collapse into premature patching

These classes should usually enter GoE through `bug-hunting` mode with the governed artifact being the diagnosis path, not a speculative patch.

## Narrow direct-work class

Coding or debugging work may bypass GoE only when all of these are true:

- the scope is tightly bounded
- the target behavior is already explicit
- the verification path is direct and strong
- the selected route is strong enough for the task
- the work does not touch shared infrastructure, policy, or degraded-path behavior

Examples of acceptable direct work:

- a one-file deterministic rename with mechanical verification
- a small syntax or wiring correction with an existing targeted test that directly proves it
- a bounded repro-data cleanup or narrow log inspection that does not require hypothesis debate

This class should stay small. "Simple-looking" is not enough.

## Weak-model-sensitive rule

Some tasks should be treated as GoE-governed by default specifically because the chosen model route is weak relative to the task.

Weak-model-sensitive coding or debugging includes:

- feature work on a cheap local model with non-trivial architectural consequences
- debugging work where the current route is good at syntax but weak at diagnosis
- tasks with broad blast radius but only a low-cost route currently available
- tasks where the route has recurring historical failure patterns

For these cases, GoE is not optional polish. It is the compensating control that makes the cheap route usable.

If the weak route still fails under GoE, the auditor may escalate to a stronger route under the triad contract.

## Coding-specific governance goals

For coding work, GoE should try to prevent:

- wrong scope cuts
- architecture drift
- missing degraded-path handling
- insufficient verification
- code that appears coherent but does not match the approved plan

That means the critic should focus on:

- scope and ownership boundaries
- required verification
- failure modes and rollback concerns
- capability or route mismatch

## Debugging-specific governance goals

For debugging work, GoE should try to prevent:

- patching before diagnosis
- overconfident root-cause claims
- confusing symptoms for causes
- missing alternative hypotheses
- premature convergence on the first plausible explanation

That means the critic should focus on:

- evidence quality
- hypothesis ranking
- missing reproduction steps
- missing counter-evidence
- whether the task should remain `bug-hunting` instead of switching to `fixing`

## Mode-to-coverage mapping

### `feature`

Default GoE posture:

- governed unless the implementation slice is trivial, bounded, and directly verified

Why:

- net-new capability work is where weak routes hallucinate structure most easily

### `fixing`

Default GoE posture:

- governed for most real fixes
- direct only for bounded repairs with explicit target behavior and strong verification

Why:

- many "simple fixes" are actually hidden diagnosis problems

### `bug-hunting`

Default GoE posture:

- governed by default

Why:

- ambiguity is the whole point of the mode, and critique materially improves diagnosis quality

### `auditing`

For coding/debugging coverage:

- governance is usually useful when the audit will drive a coding or debugging decision
- a purely deterministic evidence summary may bypass

### `planning`

For coding/debugging coverage:

- governance is useful when the plan will feed implementation or debugging work by a weak route
- a narrow deterministic planning lookup may bypass

## Transition rule between debugging and coding

GoE should help police the transition from diagnosis to repair.

Rule:

- if the work starts in `bug-hunting`, the governed artifact is the diagnosis or investigation plan
- the flow should switch to coding-oriented governance only when the likely cause and corrective path are concrete enough

This avoids letting a cheap route smuggle an unproven diagnosis into a code patch.

## Verification expectation under GoE

GoE should not only debate the coding idea. It should govern the proof expectation too.

Minimum expectations:

- coding work needs a coherent verification path
- debugging work needs evidence strong enough to justify any switch into `fixing`
- shared-infrastructure changes need degraded-path consideration
- weak-model-sensitive work needs stronger proof than "the patch looks right"

## Economy model for coding and debugging

The economy target is:

- keep the first-pass coding or debugging route cheap when possible
- let GoE critique and audit add quality before spending stronger-model budget
- escalate model strength only when the governed loop identifies a real weakness

This is how GoE creates practical uplift instead of just extra tokens.

## Relationship to later GoE tickets

This ticket defines coverage for coding and debugging work.

It does not define:

- how GoE governs shell interpretation and the produced code artifact itself
- how GoE verdicts are stored as user-facing blockers, plans, or approvals

Those belong to:

- `TKT-GOE-004`
- `TKT-GOE-005`

The shell-interpretation and produced-artifact governance contract is defined in [docs/goe-shell-and-artifact-governance.md](./goe-shell-and-artifact-governance.md).

## Acceptance criteria for the planning slice

This ticket is complete when later implementation no longer has to invent:

- which coding tasks default to GoE
- which debugging tasks default to GoE
- what small direct-work class is allowed to bypass
- when weak-model-sensitive tasks should force governance
- how coding and debugging differ in what GoE is governing
