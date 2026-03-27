<!-- Responsibility: Define an execution-ready host-neutral integration plan for ai-workflow across CLI and AI-host/plugin surfaces.
Scope: Specify the first shippable protocol, exact phase ordering, acceptance criteria, ownership boundaries, and the failure semantics needed to avoid shell-driven behavior leaks. -->

# Dual-Surface Host Integration: Execution Plan

## Brutal Assessment

The direction is correct, but the previous version of this document was still too abstract to execute safely.

The main risks were:

1. Operation names without hard contracts
   `discover_work_context`, `investigate_artifact_map`, and `evaluate_readiness` sounded right, but their boundaries were vague enough to overlap and rot.

2. Hidden dependency on DB quality
   If the workflow DB is incomplete, stale, or weakly linked, higher-level host operations will simply produce better-formatted nonsense.

3. Architecture drift
   Without a first walking skeleton, the shell, Codex skill, and future Gemini adapter would each be tempted to rebuild judgment logic differently.

4. UX failure under uncertainty
   The known beta-readiness failure was not just a prompt problem. It was a missing product contract for evidence, confidence, and incomplete-information behavior.

This document fixes that by defining:

- one strict first slice
- exact request/response envelopes
- clear operation boundaries
- failure semantics
- phased rollout with acceptance criteria

## Product Decision

`ai-workflow` will have one workflow-native core and two first-class surfaces:

- CLI / shell / scripts
- host integrations such as Codex, Gemini, and future adapters

The core owns:

- discovery
- evidence assembly
- ranking
- guideline enforcement
- continuation state
- execution semantics

The surfaces own:

- user interaction
- presentation formatting
- host-specific capability negotiation
- deciding which core operation to call

No host surface is allowed to invent a parallel reasoning stack for project-state judgment.

## The First Walking Skeleton

Do not start by implementing every proposed operation.

Start with one end-to-end operation:

- `evaluate_readiness`

Reason:

- it directly addresses a real, already-observed failure mode
- it forces the system to define evidence, blockers, confidence, and insufficient-evidence behavior
- it is broad enough to prove the dual-surface architecture
- it is narrow enough to ship without boiling the ocean

Only after `evaluate_readiness` is real and shared should the system add:

1. `discover_work_context`
2. `investigate_artifact_map`
3. `rank_work_for_goal`
4. `enforce_guidelines`
5. `plan_execution`
6. `continue_from_state`

## Non-Negotiable Rules

1. No critical judgment may exist only in shell prompt behavior.
2. No critical judgment may exist only in Codex or Gemini adapter glue.
3. Every high-level operation must have a stable JSON input/output contract.
4. Every opinionated result must include explicit evidence and assumptions.
5. Every operation must define what happens when evidence is insufficient.
6. Default interactive output must expose conclusions, blockers, confidence, and next checks, not internal planner chatter.
7. The core may synthesize, but it may not pretend the DB knows what it does not know.

## Operation Boundary Definitions

These boundaries exist to stop semantic overlap.

### `evaluate_readiness`

Purpose:
Return a goal-specific readiness opinion for a named objective such as beta testing, release readiness, migration readiness, or handoff readiness.

It may:

- inspect active work
- inspect verification signals
- inspect related artifacts
- rank blockers against the goal
- return confidence and required next checks

It may not:

- generate implementation plans beyond immediate recommended checks
- mutate project state
- replace artifact-level exploration for unrelated goals

### `discover_work_context`

Purpose:
Return the most relevant current working set for a goal, ticket, or question.

It may:

- identify likely relevant tickets
- identify likely files and symbols
- summarize evidence gaps

It may not:

- make a final readiness judgment
- output enforcement verdicts beyond lightweight notes

### `investigate_artifact_map`

Purpose:
Produce a structured map of artifacts, symbols, claims, verification targets, and architectural edges around a narrow subject.

It may:

- map files to symbols and claims
- identify supporting docs and tests
- expose verification targets

It may not:

- substitute for current-work ranking
- make product-level go/no-go calls unless invoked through another operation

### `rank_work_for_goal`

Purpose:
Rank tickets, modules, or risks against a goal.

It may:

- rank items
- justify ranking with evidence
- expose blockers and assumptions

It may not:

- pretend ranking alone is a readiness verdict

### `enforce_guidelines`

Purpose:
Return merged toolkit and project guidance structurally, with advisory vs blocking findings.

It may:

- merge global and project rules
- identify required checks
- classify violations

It may not:

- bury enforcement only in prose

## Shared Protocol V1

This is the first implementable protocol surface.

### Versioning And Compatibility

The protocol must be versioned from day one.

Rules:

1. Every request and response must carry a `protocol_version`.
2. V1 adapters must reject unsupported major versions explicitly.
3. Adding optional fields is backward-compatible.
4. Renaming, removing, or changing the meaning of existing fields is a breaking change.
5. New operations may be added in the same major version only if they do not alter existing operation semantics.
6. Human-readable shell formatting may evolve, but JSON contracts may not drift silently.

V1 recommendation:

- use semantic major versioning at the protocol layer
- start with `protocol_version: "1.0"`
- keep operation schemas independently testable under the same major version

Compatibility behavior:

- if the major version is unsupported, return `error` with a contract-mismatch reason
- if the minor version is newer but backward-compatible, continue and ignore unknown optional fields
- host adapters must surface version mismatch clearly instead of falling back to prompt reasoning

### Request Envelope

```json
{
  "protocol_version": "1.0",
  "operation": "evaluate_readiness",
  "goal": {
    "type": "beta_readiness",
    "target": "app",
    "question": "Is the app ready for beta testing?"
  },
  "constraints": {
    "allow_mutation": false,
    "context_budget": "medium",
    "time_budget_ms": 15000,
    "guideline_mode": "advisory"
  },
  "inputs": {
    "tickets_scope": "active_and_blocked",
    "artifact_scope": "goal_relevant_only",
    "verification_scope": "tests_metrics_docs"
  },
  "host": {
    "surface": "cli",
    "capabilities": {
      "supports_json": true,
      "supports_streaming": true,
      "supports_followups": true
    }
  },
  "continuation_state": null
}
```

### Response Envelope

```json
{
  "protocol_version": "1.0",
  "operation": "evaluate_readiness",
  "status": "complete",
  "summary": "Not ready for beta testing yet.",
  "opinion": {
    "verdict": "not_ready",
    "confidence": 0.74
  },
  "blockers": [
    {
      "id": "blk_missing_e2e_signal",
      "title": "Critical user flows lack recent verification evidence",
      "severity": "high",
      "reason": "No recent passing e2e or equivalent verification found for onboarding and settings flows."
    }
  ],
  "evidence": [
    {
      "kind": "ticket",
      "ref": "TKT-123",
      "claim": "Release-critical work remains active",
      "source": "workflow_db"
    },
    {
      "kind": "verification",
      "ref": "tests/shell-chat.test.mjs",
      "claim": "Shell path is covered, but product-critical readiness path is not",
      "source": "filesystem"
    }
  ],
  "assumptions": [
    "Beta readiness requires recent verification of critical user flows.",
    "Open high-priority blockers count against readiness unless explicitly waived."
  ],
  "gaps": [
    "No explicit beta-exit checklist found.",
    "No recent artifact proving onboarding smoke test success."
  ],
  "recommended_next_actions": [
    "Verify critical user flows against current main branch state.",
    "Review blocked and in-progress tickets tagged as release-affecting.",
    "Define or ingest a beta-exit checklist if one does not exist."
  ],
  "guideline_findings": [],
  "continuation_state": {
    "token": "eval-readiness-001",
    "next_allowed_operations": [
      "discover_work_context",
      "investigate_artifact_map"
    ]
  }
}
```

## Routing Policy

The system needs one shared intent-to-operation policy or each surface will fork behavior again.

### Routing Rules

1. Prefer the narrowest operation that can answer the question.
2. Prefer structured goal-aware operations over broad summaries for judgment questions.
3. Use `project_summary` only for broad status and orientation, not as a substitute for specialized evaluation.
4. If an operation returns `insufficient_evidence`, continue with the next allowed operation from `continuation_state` instead of restarting from a generic summary.
5. If the user explicitly asks for process, graph, or internals, the surface may add diagnostic output, but the underlying operation choice should not change without reason.

### Intent-To-Operation Table

| User intent | Preferred operation | Fallback |
| --- | --- | --- |
| "Is this ready for beta / release / handoff?" | `evaluate_readiness` | `discover_work_context` then `evaluate_readiness` |
| "What am I working on right now?" | `discover_work_context` | `project_summary` |
| "What files, symbols, and docs relate to this?" | `investigate_artifact_map` | `discover_work_context` |
| "Which tickets matter most for this goal?" | `rank_work_for_goal` | `discover_work_context` |
| "What rules apply here?" | `enforce_guidelines` | project guidance summary |
| "What should happen next?" | `plan_execution` | `discover_work_context` plus host synthesis |

### Routing Ownership

The routing policy belongs to the toolkit core and shared adapter layer, not to a host-specific prompt.

Hosts may choose when to ask follow-up questions.
Hosts may not invent their own operation selection taxonomy for core product behaviors.

## Failure Semantics

These are mandatory. If they are not defined, the system will regress into shell theater.

### Status Values

- `complete`
- `insufficient_evidence`
- `blocked`
- `error`

### Required Behavior By Status

#### `complete`

The system has enough evidence to issue a verdict with confidence and blockers.

#### `insufficient_evidence`

The system must not fail with planner junk or a null answer.
It must return:

- best current partial opinion
- explicit gaps
- exact next evidence-gathering steps
- reusable continuation state

#### `blocked`

The system was unable to continue because a dependency is missing or a source is inaccessible.
It must say what is missing and what can still be concluded.

#### `error`

This is for actual execution or contract failures, not uncertainty.
Lack of evidence is never an `error`.

### Timeout Semantics

Time budgets must produce partial value, not silent collapse.

Rules:

1. If the operation exceeds `time_budget_ms`, return the best current result with either `complete` or `insufficient_evidence`, depending on the remaining gaps.
2. Timeout alone should not force `error` unless execution was interrupted before any trustworthy output could be assembled.
3. Responses should include a note in `gaps` or metadata when the time budget limited evidence gathering.
4. Hosts may choose to continue via `continuation_state` rather than restarting the whole operation.

## Evidence Provenance Rules

Every evidence item must carry a source category.

Allowed source categories in V1:

- `workflow_db`
- `filesystem`
- `test_results`
- `metrics`
- `manual_input`

Rules:

1. If evidence is inferred rather than directly observed, mark the claim text accordingly.
2. Confidence must drop when evidence comes mostly from indirect signals.
3. Missing evidence must be surfaced as `gaps`, not hidden.
4. The same fact should not appear as both evidence and assumption.

## Confidence Model

Confidence is not decorative. It must be generated by simple, explainable rules.

V1 model:

1. Start from a neutral baseline.
2. Raise confidence when:
   - multiple evidence categories agree
   - recent verification signals exist
   - active blockers are explicitly absent or resolved
   - a checklist or release criterion artifact exists and is satisfied
3. Lower confidence when:
   - evidence is mostly inferred
   - ticket state is stale or incomplete
   - verification signals are missing, old, or contradictory
   - the verdict depends on assumptions not backed by explicit artifacts
4. Cap confidence aggressively when critical evidence classes are missing.

V1 practical rule:

- if no recent verification signal exists for a readiness judgment, confidence may not exceed a conservative threshold even if ticket state looks clean

The exact formula may evolve, but the reasons for confidence movement must remain inspectable in tests.

## Freshness And Staleness Rules

The protocol must treat stale information as a first-class risk.

Rules:

1. Evidence sources should carry freshness metadata where available.
2. If ticket state or verification data is stale beyond a defined threshold, the response must either:
   - lower confidence, or
   - return `insufficient_evidence`, or
   - return `blocked` if the source cannot be refreshed
3. Hosts must not mask staleness by presenting old data as current truth.
4. Where cheap refresh is possible, the core should prefer refreshing key signals before issuing a strong verdict.

V1 recommendation:

- treat missing freshness metadata as lower-trust evidence
- prefer conservative judgments over false certainty

## Continuation-State Semantics

Continuation state exists to support multi-step discovery without restarting the world.

Rules:

1. `continuation_state` is an opaque core-generated token plus optional safe metadata.
2. Hosts may store and replay it, but may not mutate its internal meaning.
3. Continuation state must expire when the underlying project state changes materially or when a freshness threshold is crossed.
4. Reusing expired continuation state must return a clear `blocked` or `error` response indicating invalidation.
5. Continuation state must narrow the next step, not become an open-ended hidden memory channel.

V1 recommendation:

- include:
  - token
  - originating operation
  - allowed next operations
  - creation timestamp
- do not include large hidden summaries that adapters cannot reason about safely

## Guideline Precedence

Guidance must merge predictably or enforcement becomes political.

Precedence order, highest to lowest:

1. hard safety constraints of the current operation
2. explicit task constraints
3. project-specific blocking guidance
4. toolkit-wide blocking guidance
5. project-specific advisory guidance
6. toolkit-wide advisory guidance
7. host presentation preferences

Rules:

1. Host preferences may affect presentation, not core enforcement outcomes.
2. Blocking guidance must not be silently downgraded by an adapter.
3. If guidance conflicts at the same precedence level, the response must surface the conflict explicitly.

## Mutation Boundary

Split read-only and mutating operations now, before future execution features arrive.

Read-only operations in this plan:

- `evaluate_readiness`
- `discover_work_context`
- `investigate_artifact_map`
- `rank_work_for_goal`
- `enforce_guidelines`

Future mutating operations:

- `plan_execution` may remain read-only if it only proposes actions
- any operation that edits files, tickets, DB state, or runtime artifacts must be classified separately as mutating

Rules:

1. `allow_mutation: false` must be honored by every surface and adapter.
2. Mutating operations must require explicit confirmation semantics at the surface layer when appropriate.
3. Read-only operations must never have hidden side effects beyond safe caching or telemetry.

## DB Preconditions

This plan depends on DB quality. Say it plainly.

`evaluate_readiness` is only as trustworthy as these inputs:

- ticket states are current
- working-set inference is usable
- verification artifacts are discoverable
- architectural and artifact links are not badly stale

Therefore, before implementing protocol consumers, the core must define a minimum-readiness data contract:

1. Active and blocked ticket retrieval must be reliable.
2. Search over docs, tests, and key artifacts must be reliable.
3. Verification-signal lookup must be reliable enough to answer whether recent proof exists.
4. Each response must tolerate missing DB data by surfacing gaps instead of hallucinating completeness.

If these preconditions are not met, the protocol should still exist, but V1 confidence must remain conservative.

## Observability And Diagnostics

Cross-surface consistency is impossible to debug without minimal tracing.

Every protocol execution should produce:

- an operation name
- a trace or correlation id
- protocol version
- status
- elapsed time
- evidence source categories used
- whether freshness or timeout constraints affected the result

Rules:

1. Trace data should be available in debug and logs, not dumped into default interactive output.
2. CLI and host adapters should preserve the same trace id when forwarding or formatting the same result.
3. Diagnostic information should help explain disagreement between surfaces without requiring prompt archaeology.

## Trust Boundaries

External hosts are not automatically trusted.

Rules:

1. Host-provided goals and constraints are inputs, not proof.
2. Hosts may request summaries, but the core decides what evidence can be returned structurally.
3. Host adapters must not be allowed to spoof core evidence provenance.
4. Path, artifact, and project references coming from hosts must be validated before use.
5. Manual input may contribute evidence, but it must be marked as `manual_input`, never as DB or filesystem truth.

## Surface Behavior Rules

### CLI / Shell

Default interactive mode should show:

- verdict
- confidence
- top blockers
- next checks

It should not show:

- assert-node chatter
- self-correction internals
- graph mechanics

Unless:

- `--json` is used
- debug mode is enabled
- the user explicitly asks for process details

### Codex

Codex should decide whether to call:

- direct deterministic subcommands
- `evaluate_readiness`
- follow-up discovery operations using continuation state

Codex must not reconstruct readiness logic in the skill prompt.

### Gemini

Gemini gets the same protocol, the same response semantics, and the same continuation model.

No Gemini-specific reasoning fork is allowed in V1.

## Implementation Plan

This is the executable rollout order.

### Phase 0: Contract Freeze

Goal:
Define V1 contracts before touching multiple surfaces.

Actions:

1. Add a core contract module for protocol types and response helpers.
2. Freeze `evaluate_readiness` request and response schemas.
3. Define status semantics and evidence source enums centrally.

Acceptance criteria:

- one schema source of truth exists
- CLI and host adapters can both import it
- tests fail on invalid response shapes

### Phase 1: Core Readiness Evaluator

Goal:
Build one shared core service that produces a readiness opinion from DB and filesystem evidence.

Actions:

1. Create a service such as `core/services/readiness-evaluator.mjs`.
2. Implement evidence gathering for:
   - active and blocked tickets
   - verification artifacts
   - relevant docs and checklists
3. Implement blocker ranking with conservative confidence scoring.
4. Return `insufficient_evidence` instead of failing when proof is weak.

Acceptance criteria:

- service can answer the beta-readiness example without shell-specific logic
- service always returns verdict or partial verdict plus gaps
- service never emits planner chatter

### Phase 2: Structured CLI Entry Point

Goal:
Expose the evaluator through a deterministic machine-usable CLI surface.

Actions:

1. Add a structured CLI command or subcommand for `evaluate_readiness`.
2. Support JSON output as the default integration surface.
3. Add a human-readable formatter that consumes the same response object.

Acceptance criteria:

- CLI JSON output is stable and documented
- human-readable shell output is a pure presentation layer
- no judgment logic exists only in `cli/lib/shell.mjs`

### Phase 3: Shell Routing Upgrade

Goal:
Stop broad judgment questions from falling back to `project_summary`.

Actions:

1. Update shell routing heuristics so readiness-style questions prefer `evaluate_readiness`.
2. Preserve `project_summary` for broad status, not goal-aware judgments.
3. Ensure recovery paths continue from `continuation_state` and `gaps`, not generic restarts.

Acceptance criteria:

- beta-readiness-style prompts no longer route to summary dumps
- insufficient evidence produces a useful partial answer
- recovery loop uses next checks instead of restarting shallowly

### Phase 4: Host Adapter Extraction

Goal:
Make Codex and future Gemini integrations thin wrappers over the same core operation.

Actions:

1. Define an adapter layer that translates host requests into the shared protocol.
2. Keep host-specific capability handling at the edge.
3. Reuse the same formatter contracts and continuation state.

Acceptance criteria:

- Codex path and CLI path produce materially equivalent verdicts from the same underlying evidence
- host adapters contain no duplicated ranking or readiness logic

### Phase 5: Expand The Operation Set

Goal:
Add the remaining operations only after the first slice is proven.

Order:

1. `discover_work_context`
2. `investigate_artifact_map`
3. `rank_work_for_goal`
4. `enforce_guidelines`
5. `plan_execution`
6. `continue_from_state`

Rule:

Each new operation must repeat the same discipline:

- exact boundary
- schema
- failure semantics
- acceptance tests

## Test Plan

This work is not real until the failures are testable.

### Core Tests

Add tests proving:

1. `evaluate_readiness` returns `complete` when evidence is sufficient.
2. `evaluate_readiness` returns `insufficient_evidence` with gaps when verification proof is missing.
3. confidence drops when the result depends on inferred evidence.
4. invalid evidence source values are rejected by schema validation.

### CLI Tests

Add tests proving:

1. JSON shape is stable.
2. human-readable output does not expose planner internals.
3. readiness prompts do not route to `project_summary`.

### Regression Tests

Add a regression fixture for the observed beta-readiness failure:

- user asks for a reliable beta-readiness opinion
- system must not dump the full board
- system must return verdict or partial verdict, blockers, confidence, and next checks

## Execution Status

Status as of 2026-03-27:

- Phase 0 is implemented.
- Phase 1 is implemented in a V1 form.
- Phase 2 is implemented.
- Phase 3 is implemented for readiness-style shell routing.
- Phase 4 is implemented in a thin V1 adapter form.
- Phase 5 has not started.

### Landed Components

- shared protocol contract module:
  - `core/contracts/dual-surface-protocol.mjs`
- shared readiness evaluator:
  - `core/services/readiness-evaluator.mjs`
- shared service export:
  - `core/services/sync.mjs`
- deterministic CLI entry point:
  - `ai-workflow project readiness`
- shell routing upgrade:
  - readiness prompts now route to `evaluate_readiness`
- host-style adapter path:
  - `runtime/scripts/codex-workflow/tutorial-web.mjs`
  - `GET /api/readiness`

### Implemented Behavior

The system now returns a stable structured readiness payload containing:

- `protocol_version`
- `operation`
- `status`
- `summary`
- `opinion.verdict`
- `opinion.confidence`
- `blockers`
- `evidence`
- `assumptions`
- `gaps`
- `recommended_next_actions`
- `continuation_state`
- `meta`

The current V1 evaluator is intentionally conservative about blockers but still simple about verification quality.

### Test Coverage Status

Implemented tests now cover:

- contract validation for `evaluate_readiness`
- sufficient-evidence readiness case
- insufficient-evidence readiness case
- CLI JSON shape
- shell regression ensuring readiness questions do not fall back to `project_summary`
- tool-dev CLI evidence-root path
- host/API adapter path for readiness

Relevant test files:

- `tests/workflow-db.test.mjs`
- `tests/router-and-cli.test.mjs`
- `tests/shell.test.mjs`
- `tests/cli.test.mjs`

### Live Validation Record

The readiness evaluator was tested against the real project:

- evidence repo:
  - `/home/dharmax/work/adventure-machine2`

The following surfaces were exercised:

1. direct executable mode from the project root
2. tool-dev executable mode from the toolkit root using the project as `evidence_root`
3. host-style API mode via `web tutorial` and `GET /api/readiness`

Observed result:

- all three surfaces returned the same `evaluate_readiness` verdict
- verdict:
  - `not_ready`
- status:
  - `complete`
- confidence:
  - `0.6`
- top blockers included:
  - `BUG-OVERLAY-01`
  - `BUG-MODAL-BACK-01`
  - `BUG-ROUTE-EXPLICIT-01`
  - `HUMAN-REF-APP-SHELL-01`
  - `REF-APP-SHELL-01`

This proves the first dual-surface slice is real:

- executable mode and host/plugin-style mode now share the same readiness evaluator
- tool-dev correctly keeps the toolkit as repair target and the external repo as evidence root
- the result is no longer shell-summary theater

### Important Weaknesses Still Present

The first slice is real, but it is not yet a high-trust readiness judge.

Current weaknesses:

1. verification quality is still inferred mostly from artifact presence
   existing test files and checklist-like docs count as evidence, but recent passing execution is not yet distinguished from mere existence

2. freshness is only partially enforced
   the evaluator uses last-sync metadata, but it does not yet inspect whether verification results themselves are stale, recent, or contradictory

3. blocker severity is lane-driven more than goal-driven
   the system finds obvious active blockers, but it does not yet deeply model which blockers are specifically beta-critical versus background backlog

4. `complete` currently means “enough evidence to issue a verdict”
   it does not mean “ready”
   on the real project run, the evaluator returned `complete` plus `not_ready`, which is correct under the current contract but should be documented clearly for future readers

5. continuation state exists, but follow-up operations beyond readiness are not yet implemented

### Required Next Hardening Work

Before claiming that readiness evaluation is strong rather than merely shared, implement:

1. verification-result ingestion
   distinguish test/checklist existence from recent passing proof

2. stronger freshness semantics
   mark stale verification as a gap or confidence cap

3. goal-aware blocker weighting
   separate beta-critical blockers from non-blocking backlog noise

4. follow-up discovery operations
   at minimum:
   - `discover_work_context`
   - `investigate_artifact_map`

5. a real host adapter beyond the tutorial server
   Codex or Gemini integration should call the same protocol directly instead of relying on shell phrasing

## Ownership Boundaries

This matters because mixed ownership causes duplicate brains.

### Core

Responsible for:

- protocol contracts
- readiness evaluation
- evidence assembly
- confidence and blocker logic
- guideline findings
- continuation state

### CLI

Responsible for:

- command parsing
- human formatting
- JSON emission
- debug-mode visibility

### Host Adapters

Responsible for:

- host capability translation
- host transport concerns
- passing protocol requests to core
- rendering or relaying results

Not responsible for:

- independent project-state reasoning
- host-specific blocker ranking logic

## Immediate Execution Checklist

If implementation starts now, do this in order:

1. Freeze the V1 `evaluate_readiness` schema.
2. Create the shared core evaluator service.
3. Add fixture-backed tests for sufficient and insufficient evidence.
4. Expose the evaluator through a JSON CLI command.
5. Route shell readiness questions to that command.
6. Add the beta-readiness regression test.
7. Only then extract the host adapter path.

## Definition Of Done

This initiative is done for V1 when all of the following are true:

1. A beta-readiness question no longer depends on prompt choreography.
2. CLI and host surfaces use the same underlying readiness evaluator.
3. The system emits structured evidence, blockers, confidence, and gaps.
4. Insufficient evidence produces a useful answer instead of an execution failure.
5. Shell output is clean by default and debug details are opt-in.
6. The next operation expansion can proceed without redefining the architecture again.
