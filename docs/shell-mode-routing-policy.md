<!-- Responsibility: Define per-mode shell routing, action, and response policy.
Scope: Planning contract only. Implementation wiring and transcript recording belong to later tickets. -->

# Shell Mode Routing Policy

## Purpose

The shell already has partial routing and heuristic logic, but it still decides too much from scattered prompt heuristics.

This note defines the policy contract for what each visible shell work mode means operationally:

- which task classes it should absorb
- how much grounding it should gather before answering
- what routing posture it should prefer
- what actions it may propose or execute
- how mutation should be treated
- how the answer should be framed to the operator

This is the behavioral companion to:

- [docs/shell-work-mode-model.md](./shell-work-mode-model.md)
- [docs/shell-mode-inference-and-override.md](./shell-mode-inference-and-override.md)
- [docs/workflow-integrity-capability-model.md](./workflow-integrity-capability-model.md)

## Policy axes

Each effective mode should resolve a policy profile across five axes:

1. task class
2. routing posture
3. action eligibility
4. mutation posture
5. answer style

The shell should not treat visible mode as cosmetic. It should map mode onto all five axes consistently.

## Shared grounding requirement

Before mode-specific routing runs, the shell should assemble shared workflow context from the judgment core.

Minimum inputs for non-trivial work:

- relevant capability or operation
- active ticket and ticket state
- active problems and plans
- relevant modules and features
- surface and integration availability
- verification and health evidence

This is required for two reasons:

- the shell must know what it can actually do in this repo, not only what the base tool supports
- the shell must guide the operator using repo reality: features, epics, surfaces, modules, problems, and approved plans

If the shared context is thin, the shell may still answer, but it should surface the missing evidence explicitly.

## Global routing rules

These rules apply before per-mode specialization:

### Cheapest capable route

Prefer the cheapest capable route that satisfies the mode's quality bar.

Rules:

- deterministic shell-surface requests should stay local
- high-confidence heuristic turns should stay local
- local models should be preferred when the task is bounded and the quality bar is met
- if the preferred cheap route is unavailable or below the quality bar, surface that fact instead of silently pretending the route was equivalent

### Workflow discipline stays global

Mode never bypasses:

- one-active-ticket mutation discipline
- dedicated command surfaces for lifecycle changes
- capability availability checks
- projection refresh after mutation

### GoE is an overlay, not a visible mode

GoE should later govern some work, but it should not replace the visible mode taxonomy.

For this ticket's contract:

- mode answers what kind of work the shell is doing
- GoE later answers whether that work needs governed debate, critique, audit, or escalation

The shell routing layer should therefore be able to emit governance hints such as:

- trivial and deterministic
- bounded but mutating
- complex and review-sensitive
- complex and weak-model-sensitive

Those hints are consumed by later GoE tickets.

## Mode policy profiles

### `planning`

Task classes:

- ticket decomposition
- sequencing and rollout design
- migration planning
- capability gap analysis
- project guidance and next-step selection

Routing posture:

- deterministic lookup first
- heuristic planning second
- AI planning only when the request is multi-step, ambiguous, repo-wide, or needs tradeoff synthesis
- prefer low-cost local planning when the context is already grounded

Action eligibility:

- may inspect workflow state, docs, modules, features, problems, plans, and capabilities
- may suggest lifecycle actions
- may execute only explicit workflow commands whose purpose is state organization rather than workspace mutation, and only when normal gates pass
- should not silently drift into implementation

Mutation posture:

- default to read-heavy and synthesis-first
- allow workflow-state mutation only through explicit operator requests or dedicated command surfaces
- do not mutate project files just because a plan implies code work later

Answer style:

- explain the proposed path, assumptions, and decision points
- name the relevant features, modules, tickets, problems, and capabilities when available
- surface what is missing or uncertain
- end with the next concrete step

### `fixing`

Task classes:

- bounded repair
- regression correction with known target behavior
- config or integration repair
- follow-through on an already approved correction plan

Routing posture:

- if the fault and target file set are already grounded, heuristic or cheap local planning may be enough
- prefer AI planning when the blast radius is non-trivial, the fix path is ambiguous, or degraded-path behavior matters
- emit a governance hint when the task touches shared infrastructure, routing, providers, shell behavior, or other high-risk surfaces

Action eligibility:

- may inspect failures, tests, logs, docs, and relevant workflow problems
- may propose and execute bounded repairs when mutation gates pass
- should prefer existing approved plans, linked tickets, and known problems over free-form patching
- should redirect to `bug-hunting` when root cause is still materially unclear

Mutation posture:

- mutation-enabled only when the shell is in a mutation-allowed stance and workflow discipline passes
- prefer smallest coherent repair
- require explicit degraded-path consideration for provider, shell, routing, setup, fallback, and workflow-surface work

Answer style:

- state the failure or defect being addressed
- show why this is a repair rather than investigation
- call out blast radius and verification path
- keep the response execution-oriented

### `feature`

Task classes:

- new capability implementation
- net-new workflow behavior
- surface or integration expansion
- approved enhancement work

Routing posture:

- prefer AI planning for any feature work that crosses modules, surfaces, or policy layers
- bounded feature slices may use cheap local planning if the shared context is already strong
- emit a governance hint for complex feature work, especially when a weaker model is selected for coding

Action eligibility:

- may inspect adjacent features, modules, capabilities, plans, and tests
- may propose implementation slices and then execute them when mutation gates pass
- should not skip planning just because the request says "add"
- should prefer feature-linked plans and capability applicability over prompt-only interpretation

Mutation posture:

- mutation-enabled only after the shell has a concrete implementation slice
- require explicit verification intent before execution on high-impact surfaces
- keep writes within the ownership boundary implied by the active ticket and module graph

Answer style:

- frame the work as capability addition, not generic coding
- identify target surface, feature, module, and verification expectations
- surface dependencies, rollout risks, and missing capability support

### `auditing`

Task classes:

- review-first requests
- readiness and risk inspection
- architecture or policy inspection
- regression-surface and verification-gap analysis
- capability quality or workflow-integrity assessment

Routing posture:

- deterministic and heuristic grounding should be preferred first
- use AI synthesis when the audit spans multiple artifacts, risks, or conflicting evidence
- prefer read-only routes unless the operator explicitly asks for a follow-up plan artifact

Action eligibility:

- may inspect code, docs, workflow state, tests, dogfood evidence, and open problems
- may create or update planning artifacts when the operator asks for an audit-backed plan
- should not auto-mutate code as part of the audit pass
- may recommend switching to `fixing` or `feature` only after findings are grounded

Mutation posture:

- effectively read-only by default
- workflow-state mutations should be limited to explicit audit outputs such as tickets, plans, or findings

Answer style:

- findings first
- evidence-backed severity and risk
- explicit gaps in verification or capability health
- clear recommendation on whether implementation should proceed

### `bug-hunting`

Task classes:

- root-cause analysis
- reproduction work
- intermittent or unclear failure investigation
- continuity, routing, degraded-path, or subject-loss diagnosis
- hotspot and fault-isolation work

Routing posture:

- prefer AI or governed planning more often than `fixing`, because ambiguity is intrinsic
- cheap local planning is acceptable for narrow repro or log-trace work when the evidence is already constrained
- emit a governance hint when the task is complex, cross-surface, or weak-model-sensitive

Action eligibility:

- may inspect logs, tests, workflow issues, problems, and prior plans
- may collect evidence, propose hypotheses, and rank likely causes
- may apply instrumentation or a reversible narrow probe when mutation gates pass
- should not present a speculative patch as a confirmed fix
- should switch to `fixing` only once the likely root cause and correction path are concrete enough

Mutation posture:

- read-heavy by default
- allow narrow investigative mutations only when they materially improve evidence quality
- prefer reversible or low-risk probes over broad edits

Answer style:

- hypothesis-oriented
- explicit evidence and uncertainty
- separate observed facts from suspected causes
- name the trigger for switching into `fixing`

## Auto-mode policy resolution

When requested mode is `auto`, the shell should do two resolutions:

1. resolve the effective visible mode
2. resolve the matching policy profile

The second step matters because two requests can both look like "implementation" in plain language while needing different routing:

- a known regression with a bounded fix path -> `fixing`
- a vague failure with uncertain root cause -> `bug-hunting`
- a net-new capability -> `feature`

Visible mode therefore determines downstream routing and not only status text.

## Transition rules between modes

The shell should switch policy profiles when evidence crosses these boundaries:

- from `planning` to `feature` when the operator approves implementation and the slice is concrete
- from `planning` to `fixing` when the correction path is concrete enough to act
- from `fixing` to `bug-hunting` when the proposed repair lacks a grounded cause
- from `bug-hunting` to `fixing` when the root cause and correction path are specific
- from any mutating mode to `auditing` when the user explicitly asks for review or risk assessment before action

When an automatic transition materially changes action eligibility, the shell should say so.

## Capability-awareness requirement inside routing

Mode routing should always answer two capability questions before execution:

1. does the shell have the capability needed for this task in this repo and surface?
2. is that capability healthy enough for the requested level of autonomy?

Examples:

- a feature request may map to a real repo capability with strong tests and healthy codelets
- the same feature request may instead map to a degraded or missing capability, in which case the shell should guide the operator, not bluff competence
- an audit request may discover that the shell can inspect evidence but cannot verify the degraded path yet, which should change the answer and the next step

This is how shell mode becomes part of workflow integrity instead of a prompt-only convenience flag.

## What this ticket owns

This ticket defines:

- the per-mode routing contract
- the per-mode action and mutation policy
- the per-mode answer style
- the cross-cutting capability and workflow grounding requirement
- governance hints that later GoE work can consume

This ticket does not define:

- the exact DB schema for recording mode transitions
- the exact GoE loop implementation
- the final provider-selection algorithm
- the final transcript and projection shape

Those belong to:

- `TKT-SHELL-MODES-004`
- `TKT-GOE-001`
- `TKT-GOE-002`
- `TKT-GOE-003`
- `TKT-GOE-004`

## Acceptance criteria for the planning slice

This ticket is complete when later implementation work can answer, without inventing new policy:

- what each shell work mode routes to
- when each mode may mutate
- when work should stay heuristic, use AI planning, or emit governance pressure
- how the shell should talk differently in planning, fixing, feature, auditing, and bug-hunting
- how capability health and project situational awareness constrain routing
