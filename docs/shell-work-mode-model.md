<!-- Responsibility: Define the canonical operator-visible shell work-mode model.
Scope: Planning contract only. UX wiring, inference rules, and persistence details belong to later shell-mode tickets. -->

# Shell Work-Mode Model

## Purpose

The shell currently exposes an internal two-state switch:

- `plan`
- `mutate`

That is not the operator model we want.

It mixes two different concerns:

- what kind of work the shell believes it is doing
- whether mutation is currently allowed

This note defines the canonical operator-visible work-mode model so later implementation tickets can make the shell explainable without weakening mutation discipline.

## Current state

Observed behavior today:

- interactive shell status renders `mode: plan-only | trace: ...` or `mode: mutating | trace: ...`
- shell commands accept `plan` and `mutate`
- mutation gating is enforced internally around ticket state and safe execution
- the planner already classifies requests into capability/task families such as project planning, debugging, review, refactor planning, design direction, and bug hunting

That means the shell already has partial task understanding, but the user-facing mode surface is still too coarse and too safety-oriented.

## Canonical operator-visible modes

The shell should expose these work modes:

- `auto`
- `planning`
- `fixing`
- `feature`
- `auditing`
- `bug-hunting`

These are operator-facing modes, not low-level permissions.

### `auto`

Default mode.

Meaning:

- the shell infers the most likely work mode from the request, active workflow state, and recent turn memory
- the shell still reports the effective resolved mode

### `planning`

Use for:

- sequencing work
- decomposing tickets
- rollout design
- migration planning
- project-state guidance

Default posture:

- read-heavy
- synthesis-first
- mutation only when the requested command explicitly changes workflow state and the normal gates pass

### `fixing`

Use for:

- bounded repairs
- regressions already understood well enough to act on
- concrete code or config fixes

Default posture:

- implementation-oriented
- strongly grounded in the requested file, ticket, or failing path

### `feature`

Use for:

- new behavior
- expanding an existing workflow or product surface
- structured implementation of an approved capability

Default posture:

- implementation and integration oriented
- should stay tied to feature, module, and workflow context rather than drifting into open-ended ideation

### `auditing`

Use for:

- review
- readiness checks
- architecture or policy inspection
- "is this good enough?" questions

Default posture:

- evidence-first
- findings before summary
- explicit limits and residual risk

### `bug-hunting`

Use for:

- exploratory diagnosis
- subject-loss, continuity, routing, or degraded-path investigations
- identifying likely hotspots before a fix is chosen

Default posture:

- discovery-first
- preserve uncertainty honestly
- prefer narrowing the fault before mutating code

## Internal controls stay separate

The visible work mode must not replace the internal safety model.

Keep these as distinct concepts:

1. `workMode`
   - the operator-visible kind of work
2. `executionStance`
   - whether the shell is currently plan-only or mutation-enabled
3. `modeSource`
   - auto, explicit command, inherited continuation, or recovered fallback
4. `trace`
   - visibility of prompts and model-selection data

This separation matters because:

- `auditing` may still be mutation-disabled
- `feature` work may begin in plan-only stance
- `fixing` and `bug-hunting` are different even if both eventually lead to code changes

## Effective shell state

The shell should eventually be able to report:

- requested mode
- effective mode
- mode source
- execution stance
- trace state

Canonical example:

```text
mode: auto -> bug-hunting | source: inferred | stance: plan-only | trace: off
```

This ticket only defines that state model. Recording and projecting it belongs to later tickets.

## Command contract

The operator-facing command surface should become:

- `mode <name>`
- `mode auto`
- `mode status`

Where `<name>` is one of:

- `planning`
- `fixing`
- `feature`
- `auditing`
- `bug-hunting`

### Backward compatibility

Keep `plan` and `mutate`, but reframe them as stance commands rather than work-mode commands.

- `plan`
  - set `executionStance=plan-only`
- `mutate`
  - set `executionStance=mutation-enabled`

They should not imply `workMode=planning` or any other visible work mode.

This avoids breaking current shell muscle memory while fixing the conceptual model.

## What this ticket owns

This ticket defines:

- the visible mode set
- the meaning of each mode
- the separation between work mode and mutation stance
- the effective shell state tuple
- the operator command contract shape

This ticket does not define:

- detailed inference rules
- persistence rules
- transcript/DB recording fields
- routing-policy differences per mode

Those belong to:

- `TKT-SHELL-MODES-002`
- `TKT-SHELL-MODES-003`
- `TKT-SHELL-MODES-004`

The routing and execution policy for those modes is defined in [docs/shell-mode-routing-policy.md](./shell-mode-routing-policy.md).

The visibility and recording contract for those modes is defined in [docs/shell-mode-visibility-model.md](./shell-mode-visibility-model.md).

## Relationship to workflow integrity

These modes should consume the shared capability and governance model rather than invent their own world model.

That means mode resolution should eventually use:

- capability applicability
- active tickets and plans
- features and modules
- open problems
- governance checks from the shared judgment core

The shell should not pick a visible mode from prompt wording alone when the workflow DB already has stronger evidence.
