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
