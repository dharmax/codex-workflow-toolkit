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
