<!-- Responsibility: Define the current host integration contract for ai-workflow across shell and external host surfaces.
Scope: Keep one shared judgment core and allow multiple presentation surfaces to call it. -->

# Dual-Surface Host Integration

## Contract

`ai-workflow` has one shared core and multiple surfaces:

- CLI / shell
- skill or plugin surfaces
- MCP / host adapters

The core owns:

- project discovery
- workflow DB access
- context packing
- provider routing
- execution planning
- projection writes

The surfaces own:

- user interaction
- formatting
- capability negotiation
- calling the correct core operation

## Lean-ctx Requirement

`lean-ctx` is part of the core operating contract for compact context handling.

- If lean-ctx is available, use it for surgical context work.
- If lean-ctx is missing, surface install/setup guidance instead of silently degrading.

## Current First Slice

The current shared protocol should keep the following stable:

- readiness and status evaluation
- epics and story queries
- ticket and kanban reconciliation

Each operation must return explicit evidence, assumptions, and a clear failure mode when the project state is incomplete.

## Shared Judgment Core

Every surface should consume one DB-backed judgment core instead of rebuilding workflow memory in its own prompt assembly or adapter glue.

The shared core owns:

- capability, surface, integration, problem, plan, feature, module, and ticket retrieval
- selector resolution and evidence lookup
- mutation eligibility and workflow-discipline checks
- verification and health evidence lookup
- projection refresh after state changes

Surfaces may format results differently, but they should not disagree about the underlying state.

## Governance Entry Points

Use one governance path across these entry points:

- shell
- `ask` / host resolution
- operator-brain
- JS orchestrator
- plugin or MCP adapters

That path should answer four questions consistently:

1. what workflow state is relevant?
2. what capability or operation is being requested?
3. is the action allowed in the current workflow state?
4. what evidence, limits, and next step should be shown?

## Hook Layers

Plan the governance hooks in layers rather than as ad hoc per-surface conditionals.

### Layer 1: Request normalization

Normalize the incoming request into:

- caller surface or integration id
- requested capability or operation
- task class or mode hints
- mutation intent
- continuation context

### Layer 2: Shared context assembly

Build context from the workflow DB:

- capabilities
- surfaces and integrations
- active epics, tickets, problems, and plans
- modules and features
- verification and health evidence

### Layer 3: Governance checks

Run shared checks before execution:

- ticket-in-progress discipline
- surface or integration enablement
- capability health and availability
- required evidence freshness
- mutation vs read-only permission

### Layer 4: Surface execution

Only after the shared checks pass should the surface-specific executor run:

- shell local reply
- host summary or protocol reply
- operator-brain planning
- JS orchestration
- plugin or MCP adapter action

### Layer 5: Result recording

Record:

- the effective capability used
- evidence shown
- degraded-path or override decisions
- resulting plan, problem, or state transition

## Surface Responsibilities

### Shell

- owns interactive phrasing and conversational continuity
- does not own canonical capability memory
- should retrieve capability judgments, limits, and evidence from the shared core

### Host and `ask` surfaces

- own transport and response formatting
- should use the same selector, evidence, and capability-resolution path as shell

### Operator-brain

- owns plan generation and execution steering
- should not invent a separate project-memory model
- should consume the same capability, problem, and plan entities used by shell

### JS orchestrator and hooks

- own deterministic execution and lifecycle hook boundaries
- should receive already-governed operations instead of re-deciding workflow truth in isolation

### Plugin and MCP adapters

- own external protocol mapping
- should expose host/integration metadata, not duplicate workflow-state derivation

## Read vs Mutating Contract

All surfaces should distinguish:

- read-only capability questions
- planning and guidance
- state-changing workflow actions

Read-only questions may answer directly from shared state.

Planning and guidance may synthesize, but should still cite shared state.

State-changing actions must pass the same workflow-discipline gates regardless of surface:

- one active ticket rule where applicable
- explicit capability availability
- enabled integration or surface
- projection refresh after mutation

## Minimum Adapter Contract

Each non-shell adapter should identify:

- `surface` or `integration` id
- transport capabilities
- supported workflow capabilities
- whether it is read-only or can request mutation

Transport capabilities alone are not enough. The shared core also needs to know what workflow capabilities the adapter is meant to expose.

## Relationship to the Capability Model

The canonical state model for these hooks lives in [docs/workflow-integrity-capability-model.md](./workflow-integrity-capability-model.md).

This document defines how surfaces should consume that model:

- shared retrieval
- shared governance checks
- surface-specific formatting only after shared judgment

## Planning Outcome

This planning slice is done when later implementation work can answer:

- where request normalization lives
- where shared governance checks live
- which responsibilities stay in shell or host formatting layers
- which responsibilities must move into the shared judgment core
- how shell, `ask`, operator-brain, JS orchestrator, and adapters avoid drift
