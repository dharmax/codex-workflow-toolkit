# Epics

_Generated from the workflow DB._

## EPC-007 Registry-driven smart codelet runtime

### Goal

Make smart codelet execution registry-driven, cache codelet metadata in-process, and move execution context, routing, and helper logic into a shared runtime service. The shell should stay thin; JS-to-JS calls should be the default inside the tool. Lean-ctx should be used inside the helper/runtime layer wherever context compression or router shaping matters.

### Status

- [x] Archived
<!-- status: archived -->

### User stories
#### Story 1

**As the core**, I can resolve the exact registered smart codelet from the project registry and cache its metadata so repeated calls are cheap.

#### Story 2

**As a smart codelet**, I can receive a structured run context and use shared helper services for lean-ctx packing, project summary lookup, and target resolution.

#### Story 3

**As the tool**, I can execute JS-backed codelets through direct JS-to-JS calls instead of shell pipes when they opt in.

#### Story 4

**As a maintainer**, I can keep the runtime generic and remove hard-coded codelet catalogs while still documenting observer notes and runtime insights.

### Ticket batches
- Registry cache and lookup for smart codelets in the core
- Shared runtime helper and lean-ctx-aware context packing
- JS-to-JS execution path and runner cleanup
- Tests and projection updates for the runtime split

### Kanban tickets
- EXE-011 Registry-driven smart codelet resolution and cache [Done]
- EXE-012 Shared smart-codelet runtime helper and lean-ctx context packing [Done]
- EXE-013 JS-to-JS execution path and runner cleanup [Done]
- EXE-014 Tests and projection updates for smart-codelet runtime split [Done]

## EPC-008 Adaptive shell RAG prompt routing

### Goal

Wrap shell input in a retrieval-aware prompt pipeline that gathers project context, selects the best available model automatically, and proposes the strongest fallback when confidence is low.

### Status

- [ ] Active
<!-- status: open -->

### User stories
#### Story 1

**As a user**, my shell input is enriched with project context so the assistant can answer from evidence instead of guessing.

#### Story 2

**As the shell**, I can automatically pick the best available model for the request or propose the top candidate with a short rationale.

#### Story 3

**As a maintainer**, I can plug in local or remote AI services and have the shell adapt to whatever models are currently available.

#### Story 4

**As an operator**, I can see a stable fallback path when a preferred model is unavailable or underpowered.

### Ticket batches
- Retrieval/context wrapper for shell input and project evidence
- Provider-aware model scoring, proposal, and fallback selection
- Interactive shell UX for automatic selection and clear model recommendations
- Tests and docs for the shell RAG path

### Kanban tickets
- none linked yet
