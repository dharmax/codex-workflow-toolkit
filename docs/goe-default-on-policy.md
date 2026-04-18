<!-- Responsibility: Define when GoE is enabled by default and how operators can override it.
Scope: Planning artifact only. Scope coverage and persistence details belong to later GoE tickets. -->

# GoE Default-On Policy

## Purpose

GoE should be on by default where it materially improves plan or execution quality, especially for cheaper or weaker model routes.

It should not run on every trivial shell turn. The policy must therefore define:

- the default enablement rule
- the narrow bypass class
- operator overrides
- configuration precedence

This ticket does not redefine the GoE loop. It defines when that loop should run.

## Default rule

GoE should be the default for non-trivial development work.

That includes work where any of these are true:

- the task is complex enough that a weak or cheap route may underperform
- the task is mutating and not purely deterministic
- the task spans multiple modules, surfaces, or policy layers
- the task is review-sensitive, debugging-heavy, or risk-heavy
- the shell emits a governance hint of:
  - `bounded but mutating`
  - `complex and review-sensitive`
  - `complex and weak-model-sensitive`

Default-on means:

- if no explicit override is present
- and the task is not in the narrow bypass class
- the governed flow should run

## Narrow bypass class

GoE may be skipped only for work that is both low-risk and low-ambiguity.

The v1 bypass class should stay narrow:

- deterministic shell-surface requests
- high-confidence heuristic replies with no mutation
- direct status, help, search, route, provider, or selector lookups
- explicit dedicated CLI actions that already have fixed deterministic behavior
- bounded local transformations whose correctness is mechanically checked before returning

The bypass class should not include work merely because it is short.

These should still default to GoE:

- short but mutating tasks
- short debugging tasks with unclear root cause
- short feature requests
- review or audit requests
- any task where the selected model route is meaningfully weak for the requested work

## Complexity triggers

Even when the user request is brief, GoE should turn on if any of these triggers fire:

- active shell mode is `feature`, `fixing`, `auditing`, or `bug-hunting`
- task touches provider, routing, shell, setup, fallback, workflow, or other shared infrastructure
- task requires synthesizing multiple workflow objects
- selected capability is degraded, blocked, or weakly verified
- the chosen model route is cheap but below the preferred strength for the task class
- the shell detects conflicting evidence, unclear requirements, or meaningful blast radius

This is how default-on stays tied to quality risk rather than prompt length.

## Override surfaces

GoE should support two override scopes.

### Request-scoped override

Use when the operator wants the current turn or invocation to differ from the default.

Supported forms should later include equivalents of:

- `goe on`
- `goe off`
- explicit CLI or host flags for one invocation

Request-scoped override should affect only the current request unless the operator is in an interactive session and explicitly asks for session persistence.

### Session-scoped override

Interactive shell sessions may keep a temporary GoE override:

- `goe on`
- `goe off`
- `goe auto`

`goe auto` returns to policy-based resolution.

Session-scoped override should end with the session. It should not become repo-global state by accident.

## Precedence

GoE enablement should resolve in this order:

1. explicit request-scoped override
2. explicit session-scoped override
3. project config default
4. built-in default-on policy
5. narrow bypass evaluation

Important:

- bypass evaluation does not overrule explicit `goe on`
- explicit `goe off` should still be refused for some protected task classes if later policy says GoE is mandatory there
- `auto` means "use policy," not "disable governance"

## Project config contract

Project config may define the default governance posture, but it should not silently weaken the built-in safety model.

Reasonable config roles:

- enable or disable GoE by default for the project
- define stricter mandatory classes
- tune the threshold for weak-model-sensitive governance

Project config should not be allowed to redefine the bypass class into something broad enough to make GoE meaningless.

## Protected classes

Some work should be treated as governance-protected even if the operator asks for `goe off`, unless later implementation introduces a clearly documented hard override.

Protected candidates for v1:

- risky mutating work on shared infrastructure
- audit or review requests used as release or readiness gates
- weak-model-sensitive coding tasks where the cheap route is known to underperform
- generated plans that will be executed autonomously without another human review step

For those classes, later implementation may either:

- refuse `goe off`
- or require an explicit stronger override with a visible warning

This ticket sets the planning expectation that not all overrides are equal.

## Economy rules

Default-on does not mean expensive-by-default.

The economy model should be:

- keep the suggester on the cheapest capable route first
- add critique and audit only where the policy says governance matters
- escalate model strength only after the governed loop proves the cheap route insufficient

This preserves the central purpose of GoE: making cheaper models more useful, not immediately replacing them.

## Visibility requirement

Every governed or bypassed turn should be able to report:

- whether GoE ran
- why it ran or was bypassed
- whether the state came from policy or override

If the operator cannot tell why GoE did or did not run, the policy is not operationally trustworthy.

## Relationship to later GoE tickets

This ticket defines:

- when GoE is default-on
- which turns may bypass it
- how overrides should resolve
- which classes are likely governance-protected

This ticket does not define:

- the exact task families GoE wraps in coding and debugging flows
- how GoE governs shell interpretation and produced code
- how escalation artifacts are persisted and shown to the user

Those belong to:

- `TKT-GOE-003`
- `TKT-GOE-004`
- `TKT-GOE-005`

The coding and debugging coverage contract is defined in [docs/goe-coding-debugging-coverage.md](./goe-coding-debugging-coverage.md).

## Acceptance criteria for the planning slice

This ticket is complete when later implementation no longer has to invent:

- whether GoE is normally on or off
- what counts as a legitimate bypass
- how `goe on`, `goe off`, and `goe auto` should behave
- whether config or session overrides beat policy
- which kinds of work should remain governance-protected
