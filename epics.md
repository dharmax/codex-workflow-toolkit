# Epics

_Generated from the workflow DB._

## EPC-001 Lean-ctx integration and context-efficiency bridge

- Goal: Make lean-ctx the required internal layer for context packing, surgical reads, dependency slicing, and router-ready prompt shaping. If lean-ctx is missing, offer install/setup instead of silently degrading.
- User stories:
  - As a workflow operator, I can rely on lean-ctx to shrink the evidence bundle before router calls so token-heavy reasoning stays cheap.
  - As a user, if lean-ctx is missing, I get an explicit install/setup path instead of a silent fallback.
  - As a shell operator, I can keep interactive worksets small and composable while the router uses them directly.
- Ticket batches:
  - Lean-ctx dependency detection, install/setup recovery, and explicit failure paths
  - Context packer refactor so lean-ctx is the first compression layer
  - Router and shell adoption of compact worksets
- Kanban tickets:
  - none linked yet
- DB graph entities and predicates:
  - Feature: FEAT-LCTX-01 Lean-ctx context layer
  - Modules:
    - MOD-CONTEXT-PACKER core/services/context-packer
  - Predicates:
    - FEAT-LCTX-01 implemented_by MOD-CONTEXT-PACKER
    - FEAT-LCTX-01 implemented_by MOD-ROUTER
    - FEAT-LCTX-01 implemented_by MOD-SHELL
    - EPC-001 owns FEAT-LCTX-01
    - EPC-002 depends_on EPC-001
    - EPC-003 depends_on EPC-001
    - EPC-004 depends_on EPC-001
    - EPC-005 depends_on EPC-001

## EPC-002 Semantic graph, registry sync, and projection hardening

- Goal: Promote semantic entities, predicates, and graph edges to first-class DB state so repo knowledge survives sync, search, and projection cycles. This includes feature/module materialization and search-friendly graph records.
- User stories:
  - As a maintainer, I can sync semantic entities into the DB so features, modules, and rules are searchable by name.
  - As a reviewer, I can follow epic-to-feature-to-module edges without re-deriving the graph from raw code.
  - As a contributor, I can turn discovered principles and violations into durable workflow memory.
- Ticket batches:
  - Semantic registry ingestion and entity normalization
  - Graph predicate normalization for dependency and ownership edges
  - Projection/search synchronization for epics, features, and modules
- Kanban tickets:
  - none linked yet
- DB graph entities and predicates:
  - Feature: FEAT-GRAPH-01 Semantic graph backbone
  - Modules:
    - MOD-CRITIC core/services/critic
    - MOD-DB core/db/sqlite-store
    - MOD-SYNC core/services/sync
  - Predicates:
    - FEAT-GRAPH-01 implemented_by MOD-SYNC
    - FEAT-GRAPH-01 implemented_by MOD-PROJECTIONS
    - FEAT-GRAPH-01 implemented_by MOD-DB
    - FEAT-GRAPH-01 implemented_by MOD-CRITIC
    - EPC-002 owns FEAT-GRAPH-01
    - EPC-002 depends_on EPC-001
    - EPC-003 depends_on EPC-002
    - EPC-004 depends_on EPC-002
    - EPC-005 depends_on EPC-002

## EPC-003 Smart provider routing and Ollama policy

- Goal: Make provider selection explicit, cheap, and diagnosable by routing tasks through the right model tier with local Ollama as the preferred low-cost path when suitable.
- User stories:
  - As an operator, I can see why a provider/model route was chosen for a task.
  - As a local-first user, I can keep cheap tasks on Ollama when it is capable and configured.
  - As a troubleshooter, I can get precise setup guidance when local hardware or models are missing.
- Ticket batches:
  - Task-class routing and provider diagnostics
  - Ollama hardware discovery and planner configuration
  - Budget and fallback policy for local-first execution
- Kanban tickets:
  - none linked yet
- DB graph entities and predicates:
  - Feature: FEAT-ROUTER-01 Adaptive provider routing
  - Modules:
    - MOD-OLLAMA-HW cli/lib/ollama-hw
    - MOD-ROUTER core/services/router
    - MOD-DOCTOR cli/lib/doctor
    - MOD-PROVIDERS core/services/providers
  - Predicates:
    - FEAT-ROUTER-01 implemented_by MOD-PROVIDERS
    - FEAT-ROUTER-01 implemented_by MOD-DOCTOR
    - FEAT-ROUTER-01 implemented_by MOD-OLLAMA-HW
    - FEAT-ROUTER-01 implemented_by MOD-ROUTER
    - EPC-003 owns FEAT-ROUTER-01
    - EPC-003 depends_on EPC-001
    - EPC-003 depends_on EPC-002
    - EPC-004 depends_on EPC-003

## EPC-004 Safe execution, patching, and git transactions

- Goal: Harden shell and orchestrator flows so multi-step AI work is bounded, side-effect-aware, and wrapped in clean git transactions that do not leave background processes behind.
- User stories:
  - As a contributor, I can execute a ticket through a bounded plan with explicit verification gates.
  - As a maintainer, I can patch code without hanging git processes or leaving background mutation behind.
  - As a reviewer, I can see the side effects and touched files before a mutation is accepted.
- Ticket batches:
  - Structured planner graphs and branch/replan loops
  - Patch engine resilience and verification-gated writes
  - Git transaction safety and process cleanup
- Kanban tickets:
  - none linked yet
- DB graph entities and predicates:
  - Feature: FEAT-SAFE-01 Safe mutation loop
  - Modules:
    - MOD-PATCH core/lib/patch
    - MOD-SHELL cli/lib/shell
    - MOD-EXECUTION-PLANNER core/services/execution-planner
    - MOD-ORCHESTRATOR core/services/orchestrator
    - MOD-SUPERGIT core/services/supergit
  - Predicates:
    - FEAT-SAFE-01 implemented_by MOD-ORCHESTRATOR
    - FEAT-SAFE-01 implemented_by MOD-SUPERGIT
    - FEAT-SAFE-01 implemented_by MOD-EXECUTION-PLANNER
    - FEAT-SAFE-01 implemented_by MOD-SHELL
    - FEAT-SAFE-01 implemented_by MOD-PATCH
    - EPC-004 owns FEAT-SAFE-01
    - EPC-004 depends_on EPC-001
    - EPC-004 depends_on EPC-002
    - EPC-004 depends_on EPC-003

## EPC-005 Workflow surfaces, codelets, and learning loop

- Goal: Make project codelets, kanban/epic projections, and durable lessons first-class so the tool can keep teaching itself without leaking context across turns.
- User stories:
  - As a user, I can ask ai-workflow for a feature or module and get a scoped answer from project codelets.
  - As a maintainer, I can turn solved lessons into durable knowledge instead of losing them in chat context.
  - As a planner, I can keep epics, kanban tickets, and codelet surfaces synchronized with the DB.
- Ticket batches:
  - Project codelet surfaces for locationing and review
  - Kanban/epics projection reliability and reviewability
  - Knowledge capture, retros, and durable lessons from solved work
- Kanban tickets:
  - none linked yet
- DB graph entities and predicates:
  - Feature: FEAT-WORKFLOW-01 Workflow codelets and learning
  - Modules:
    - MOD-PROJECTIONS core/services/projections
    - MOD-CODELETS cli/lib/codelets
    - MOD-KNOWLEDGE core/services/knowledge
    - MOD-PROJECT-CODELETS cli/lib/project-codelets
  - Predicates:
    - FEAT-WORKFLOW-01 implemented_by MOD-CODELETS
    - FEAT-WORKFLOW-01 implemented_by MOD-PROJECT-CODELETS
    - FEAT-WORKFLOW-01 implemented_by MOD-KNOWLEDGE
    - FEAT-WORKFLOW-01 implemented_by MOD-PROJECTIONS
    - EPC-005 owns FEAT-WORKFLOW-01
    - EPC-005 depends_on EPC-001
    - EPC-005 depends_on EPC-002
