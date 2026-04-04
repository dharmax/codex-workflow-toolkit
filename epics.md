# Epics

_Generated from the workflow DB._

## EPC-001 Lean-ctx integration and context-efficiency bridge

### Goal

Make lean-ctx the required internal layer for context packing, surgical reads, dependency slicing, and router-ready prompt shaping. If lean-ctx is missing, offer install/setup instead of silently degrading.

### Status

- [x] Archived
<!-- status: archived -->

### User stories
#### Story 1

**As the tool**, I can rely on lean-ctx to shrink the evidence bundle before router calls so token-heavy reasoning stays cheap.

#### Story 2

**As a user**, if lean-ctx is missing, I get an explicit install/setup path instead of a silent fallback.

#### Story 3

**As the tool and its codelets**, when I need AI help for a directory walk or codelet burst, I can route compact context through lean-ctx before asking the cheapest suitable provider.

### Ticket batches
- Lean-ctx dependency detection, install/setup recovery, and explicit failure paths
- Context packer refactor so lean-ctx is the first compression layer
- Router and shell adoption of compact worksets

### Kanban tickets
- EXE-005 Lean-ctx detection and context compression [Done]

## EPC-002 Semantic graph, registry sync, and projection hardening

### Goal

Promote semantic entities, predicates, and graph edges to first-class DB state so repo knowledge survives sync, search, and projection cycles. This includes feature/module materialization and search-friendly graph records.

### Status

- [x] Archived
<!-- status: archived -->

### User stories
#### Story 1

**As a maintainer**, I can sync semantic entities into the DB so features, modules, and rules are searchable by name.

#### Story 2

**As the tool**, I can follow epic-to-feature-to-module edges without re-deriving the graph from raw code.

#### Story 3

**As a contributor**, I can turn discovered principles and violations into durable workflow memory.

### Ticket batches
- Semantic registry ingestion and entity normalization
- Graph predicate normalization for dependency and ownership edges
- Projection/search synchronization for epics, features, and modules

### Kanban tickets
- EXE-006 Complete semantic graph, registry sync, and projection hardening [Done]

## EPC-003 Smart provider routing and Ollama policy

### Goal

Make provider selection explicit, cheap, and diagnosable by routing tasks through the right model tier with local Ollama as the preferred low-cost path when suitable.

### Status

- [x] Archived
<!-- status: archived -->

### User stories
#### Story 1

**As the AI router**, I can see why a provider/model route was chosen for a task.

#### Story 2

**As a local-first user**, I can keep cheap tasks on Ollama when it is capable and configured.

#### Story 3

**As the tool and its codelets**, when I need AI help for a directory walk or codelet burst, I can route compact context through lean-ctx before asking the cheapest suitable provider.

#### Story 4

**As a troubleshooter**, I can get precise setup guidance when local hardware or models are missing.

### Ticket batches
- Task-class routing and provider diagnostics
- Ollama hardware discovery and planner configuration
- Budget and fallback policy for local-first execution
- Lean-ctx pre-routing compression before provider selection

### Kanban tickets
- EXE-007 Complete smart provider routing and Ollama policy [Done]

## EPC-004 Safe execution, patching, and git transactions

### Goal

Harden shell and orchestrator flows so multi-step AI work is bounded, side-effect-aware, and wrapped in clean git transactions that do not leave background processes behind.

### Status

- [x] Archived
<!-- status: archived -->

### User stories
#### Story 1

**As the tool**, I can execute a ticket through a bounded plan with explicit verification gates.

#### Story 2

**As a maintainer**, I can patch code without hanging git processes or leaving background mutation behind.

#### Story 3

**As a reviewer**, I can see the side effects and touched files before a mutation is accepted.

### Ticket batches
- Structured planner graphs and branch/replan loops
- Patch engine resilience and verification-gated writes
- Git transaction safety and process cleanup

### Kanban tickets
- EXE-008 Complete safe execution, patching, and git transactions [Done]

## EPC-005 Workflow surfaces, codelets, and learning loop

### Goal

Make project codelets, kanban/epic projections, and durable lessons first-class so the tool can keep teaching itself without leaking context across turns.

### Status

- [x] Archived
<!-- status: archived -->

### User stories
#### Story 1

**As a user**, I can ask ai-workflow for a feature or module and get a scoped answer from project codelets.

#### Story 2

**As the tool**, I can turn solved lessons into durable knowledge instead of losing them in chat context.

#### Story 3

**As the planner**, I can keep epics, kanban tickets, and codelet surfaces synchronized with the DB.

#### Story 4

**As a user**, I can edit epics.md or kanban.md directly and have ai-workflow detect drift, preserve my edits, and reconcile missing or deleted DB entities instead of silently overwriting them.

#### Story 5

**As the tool**, when a ticket starts executing, I can see it move to In Progress immediately and keep seeing kanban and epics refresh after each workflow mutation.

#### Story 6

**As a user**, I can query epics and user stories directly through ai-workflow instead of reading the whole board.

### Ticket batches
- Project codelet surfaces for locationing and review
- Kanban/epics projection reliability and reviewability
- Knowledge capture, retros, and durable lessons from solved work
- Two-way reconciliation between narrative projections and DB entities, including create/update/delete handling for edited epics and kanban tickets
- Real-time projection refresh after state-changing commands, including in-progress visibility during execution bursts
- Query functions for listing, fetching, and searching epics and user stories from the DB

### Kanban tickets
- EXE-004 Refresh live projections after every workflow mutation [Done]

## EPC-006 Smart codelet catalog and observer loop

### Goal

Define a built-in catalog of AI-routed smart codelets for common repo work and add an observer loop that notices repeated project patterns, recommends new codelets, and auto-documents those suggestions in dev-mode.

### Status

- [x] Archived
<!-- status: archived -->

### User stories
#### Story 1

**As the tool**, I can run built-in smart codelets for common work such as CSS refactors, Riot component simplification, component extraction, API extraction, import cleanup, test healing, docs refresh, and kanban reconciliation.

#### Story 2

**As the AI observer**, I can watch project progress and suggest new codelets when the same kind of work keeps showing up.

#### Story 3

**As a maintainer**, I can review, promote, or retire smart codelets without reworking the whole workflow surface.

#### Story 4

**As the tool**, I can document codelet ideas, recurring problems, and improvement candidates automatically in dev-mode so the offering gets better over time.

### Ticket batches
- Built-in smart codelet catalog for the first 10-20 common task families
- AI-router-backed runner for codelet planning and response shaping
- Observer loop that spots repeated patterns and proposes new codelets
- Automatic dev-mode documentation for codelet suggestions, problems, and follow-up work

### Kanban tickets
- EXE-009 Complete smart codelet catalog and observer loop [Done]
