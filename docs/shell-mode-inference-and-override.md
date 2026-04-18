<!-- Responsibility: Define shell mode inference, override behavior, and session persistence rules.
Scope: Planning contract only. Implementation and recording details belong to later shell-mode tickets. -->

# Shell Mode Inference and Override

## Purpose

The canonical mode set is defined in [docs/shell-work-mode-model.md](./shell-work-mode-model.md).

This note defines:

- how the shell should infer the effective mode
- how explicit overrides should work
- what should persist within a session
- what should reset between sessions

## Current state

Observed behavior today:

- the shell accepts `plan` and `mutate`
- the shell displays only a coarse `plan-only` or `mutating` status
- follow-up behavior already uses active turn memory and continuation state
- task-family classification already exists, but it is not yet surfaced as a stable operator-visible mode

That means the shell already has enough raw signals to infer visible modes; it just does not expose or govern them cleanly.

## Effective mode resolution

The shell should resolve the effective mode in this order:

1. explicit operator override
2. continuation inheritance from the current session
3. workflow-state evidence
4. request-language inference
5. default fallback to `planning`

### 1. Explicit operator override

If the operator sets:

- `mode planning`
- `mode fixing`
- `mode feature`
- `mode auditing`
- `mode bug-hunting`

that requested mode stays active for the current shell session until:

- another explicit mode command replaces it
- the operator runs `mode auto`
- the session exits

Explicit override wins over inference.

### 2. Continuation inheritance

If the request is a follow-up on the same thread of work, inherit the prior effective mode unless:

- the operator explicitly changes mode
- the new request clearly asks for a different kind of work
- workflow-state evidence contradicts the inherited mode strongly enough to justify a switch

Examples:

- follow-up after a diagnosis thread should usually stay `bug-hunting`
- follow-up after a review-first thread should usually stay `auditing`
- follow-up after an approved implementation thread may stay `fixing` or `feature`

### 3. Workflow-state evidence

Prefer workflow DB evidence over prompt wording when it is stronger.

Useful signals:

- active ticket intent
- linked plan or problem nodes
- feature and module applicability
- open workflow problems
- capability applicability from the shared judgment core

Examples:

- if the user says "continue that" and the active plan is a review pass, prefer `auditing`
- if the active problem is unresolved and the work is still exploratory, prefer `bug-hunting`
- if the approved plan is an implementation slice, prefer `feature` or `fixing`

### 4. Request-language inference

Use prompt wording when no stronger session or workflow evidence exists.

Default mappings:

- sequencing, decomposition, roadmap, rollout -> `planning`
- fix, repair, patch, implement the correction -> `fixing`
- add, build, support, new behavior -> `feature`
- review, inspect, audit, readiness, risk check -> `auditing`
- debug, investigate, find the fault, hotspot search -> `bug-hunting`

### 5. Fallback

If the evidence is weak or mixed, fall back to `planning`.

That is the safest visible default because it preserves discovery and explanation before action.

## Switching rules

The shell may switch effective mode automatically only when the evidence is strong enough to justify it.

Allowed reasons:

- explicit operator command
- follow-up inheritance
- strong workflow-state contradiction
- clearly different request intent

Automatic switching should not happen just because one keyword appears in a longer prompt.

## Command contract

The user-facing commands should be:

- `mode status`
- `mode auto`
- `mode planning`
- `mode fixing`
- `mode feature`
- `mode auditing`
- `mode bug-hunting`

### `mode status`

Should report:

- requested mode
- effective mode
- mode source
- execution stance
- trace state

Example:

```text
mode: auto -> auditing | source: inferred-from-workflow | stance: plan-only | trace: off
```

### `mode auto`

Clears the explicit override and returns the shell to inference mode for subsequent requests in the same session.

### `mode <name>`

Sets the requested mode explicitly for the current interactive session.

It does not disable workflow safety gates.

## Session persistence rules

### Interactive shell session

Persist for the current session:

- requested mode override
- execution stance
- trace state
- continuation-derived effective mode where relevant

Do not persist beyond the session:

- inferred mode with no explicit override
- transient fallback decisions

### One-shot shell invocation

For a one-shot command such as:

```bash
ai-workflow shell "review the routing changes"
```

use:

- requested mode = `auto`
- no cross-process persistence
- inference only for that invocation

If later CLI flags are added for explicit mode selection, they should apply only to that invocation unless a future config surface is intentionally introduced.

### Across sessions

Do not persist explicit work-mode overrides across shell sessions in this ticket's model.

Reason:

- session-local override is predictable
- cross-session persistence risks surprising the operator
- future persistent preferences can be added deliberately if needed

## Relationship to `plan` and `mutate`

`plan` and `mutate` remain stance controls.

They should not:

- change the requested work mode
- clear an explicit work-mode override
- imply `planning`

Examples:

- `mode bug-hunting` + `plan` means bug-hunting in plan-only stance
- `mode feature` + `mutate` means feature work in mutation-enabled stance

## Output and UX rules

The shell should surface mode information:

- at session start
- after explicit mode changes
- when the operator asks `mode status`
- when a strong automatic switch happens and that switch materially changes behavior

Do not spam mode-change messages on every turn.

Announce automatic switching only when it would otherwise surprise the operator.

## Ambiguity rules

When multiple modes are plausible:

- prefer `auditing` over `fixing` if the user explicitly asks for review before code
- prefer `bug-hunting` over `fixing` if root cause is still unclear
- prefer `planning` over `feature` when the user is still sequencing or scoping
- prefer `feature` over `fixing` when the request is clearly net-new capability

If ambiguity remains high, use `planning`.

## What this ticket owns

This ticket defines:

- inference precedence
- explicit override commands
- session persistence rules
- ambiguity handling
- mode status output contract

This ticket does not define:

- DB fields for recording mode transitions
- routing-policy differences by mode
- transcript/projection visibility

Those belong to:

- `TKT-SHELL-MODES-003`
- `TKT-SHELL-MODES-004`
