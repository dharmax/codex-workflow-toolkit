<!-- Responsibility: Define the canonical workflow-state model needed for capability-aware shell behavior and shared host integrations.
Scope: Planning artifact for workflow integrity. This does not change runtime behavior by itself. -->

# Workflow Integrity Capability Model

## Why this exists

`ai-workflow` already keeps a DB-first project memory model, but the shell's understanding of "what I can do here" still comes from several partially overlapping sources:

- `summary.activeTickets`, `modules`, and status selectors
- toolkit and project codelet registries
- provider discovery and model-fit capability data
- operator surface definitions
- manual and guidelines text

That is enough for partial grounding, but not enough for one canonical answer to all of these:

- What can the shell do in this repo right now?
- Which of those capabilities are built-in, configured, or project-provided?
- Which surfaces and integrations expose them?
- Which capabilities are weak, missing, blocked, or need operator improvement?
- What parts of the project do those capabilities apply to?
- What are the active problems and approved plans around them?

This note defines the workflow-state model required to answer those questions from one shared source of truth.

## Current state

Observed in the current repo:

- `entities` already stores operator-facing nodes such as `epic`, `ticket`, `story`, `surface`, `codelet`, and `test`.
- `modules` is already first-class and populated heuristically from the indexed file snapshot.
- `features` exists as a first-class table but is barely populated and not yet part of the normal project-memory flow.
- `architectural_graph` already supports cross-node predicates such as `belongs_to` and `implements`.
- host capability envelopes currently describe transport concerns such as `supports_json`, `supports_streaming`, and `supports_followups`, not operator-visible development capabilities.
- the shell planner context currently mixes DB-backed state with transient capability knowledge from codelets, provider state, manuals, and local heuristics.

The result is a system that can often answer capability questions, but not from a single durable graph.

## Canonical model

Use three layers instead of one overloaded bucket:

1. Inventory tables for stable repo structure discovered from code or artifacts.
2. Operator-facing entities for workflow-visible concepts that users discuss directly.
3. Graph edges and claims for relationships, evidence, and applicability.

### 1. Inventory tables

Keep these as first-class tables because they are high-volume, stable, and queried structurally:

- `files`
- `symbols`
- `modules`
- `features`
- `metrics`
- `test_runs`
- `workflow_runs`
- `workflow_issues`

Rules:

- `modules` stays the canonical structural module inventory.
- `features` becomes mandatory, not optional. It should represent real product or workflow features, not only refinement leftovers from artifact ingest.
- `workflow_issues` remains the machine-oriented ledger of runtime or governance failures.
- These tables should not be projected directly as kanban state unless wrapped by an operator-facing entity.

### 2. Operator-facing entities

Use `entities` for concepts the operator can ask about, inspect, approve, reject, prioritize, or improve.

Existing entity types to keep:

- `epic`
- `story`
- `ticket`
- `surface`
- `codelet`
- `test`

New entity types to add as part of workflow integrity:

- `capability`
  - Operator-visible development abilities such as `project-status`, `ticket-planning`, `bug-fixing`, `feature-implementation`, `review`, `audit`, `codelet-execution`, `model-routing`, `capability-explainer`, and `capability-improvement-guidance`.
  - This is the missing node type that lets the shell explain what it can do, where that ability comes from, and whether it is healthy.
- `integration`
  - Host, plugin, MCP, skill, or adapter surfaces beyond the built-in operator surfaces.
  - Examples: a Codex host bridge, a future Telegram control surface, or an MCP adapter.
- `problem`
  - Operator-visible issues that matter to planning and guidance, whether or not they already map 1:1 to a ticket.
  - Sources include failed dogfood checks, workflow audit findings, unresolved `workflow_issues`, recurring shell-quality regressions, and explicit user complaints.
- `plan`
  - Durable plans that have not yet been fully compiled into tickets, or that need approval/audit lifecycle beyond a single shell turn.
  - This is where GoE-approved or GoE-rejected proposals should land when they need durable memory.

Entity-type guidance:

- If a node needs kanban/projection presence, approval state, operator dialogue, or cross-surface visibility, prefer `entities`.
- If a node is mostly structural or high-volume repo inventory, prefer a dedicated table plus graph edges.

### 3. Graph edges and claims

Use `architectural_graph` and `claims` as the canonical relationship layer.

Required predicates for this work:

- `belongs_to`
  - file -> module
- `implements`
  - file or module -> feature
  - codelet or surface -> capability
- `exposes`
  - surface or integration -> capability
- `uses`
  - capability -> module
  - capability -> codelet
  - capability -> provider profile or model-fit route class
- `governs`
  - capability -> surface
  - GoE plan or mode policy -> capability
- `applies_to`
  - capability -> feature
  - plan -> feature, epic, ticket, module, or surface
- `blocked_by`
  - capability, plan, or ticket -> problem
- `addresses`
  - ticket or plan -> problem
- `verified_by`
  - capability, surface, feature, or plan -> test or dogfood scenario
- `owned_by`
  - capability or integration -> surface

Use `claims` for softer evidence:

- health summaries
- confidence scores
- source provenance
- suggested next actions
- "why this capability exists"
- "why this capability is weak"

## Required DB coverage

The workflow DB must become able to answer these without rebuilding context in the shell:

### Capability coverage

For each capability, store:

- stable id and title
- source kind: built-in, configured, project-provided, or derived
- owning surface or integration
- enabled or disabled state
- health state: healthy, degraded, blocked, experimental
- evidence links to codelets, providers, tests, dogfood, docs, and modules
- improvement path:
  - can explain usage
  - can propose improvements
  - can say what is missing

### Project situational awareness coverage

The DB must make these queryable as first-class workflow memory:

- active features
- active epics and linked tickets
- known operator surfaces
- host integrations
- modules and their responsibilities
- open problems
- approved plans and rejected plans
- verification evidence tied to those nodes

### Scope and applicability coverage

The shell should not answer capability questions in the abstract. It needs DB-backed answers to:

- what capabilities apply to this repo
- what capabilities apply to this feature or module
- what capabilities are missing for this task
- what capability is the right one for planning, fixing, adding a feature, auditing, or bug-hunting

That means capability nodes must link to:

- modes
- task classes
- surfaces
- modules
- features
- tickets and plans

## Population strategy

Populate the model from deterministic sources first.

### Deterministic sources

- operator surface definitions
- codelet manifests
- provider discovery and model-fit knowledge
- indexed modules and architectural graph edges
- workflow projections and entities
- dogfood scenario manifests and test run evidence

### Derived sources

- feature extraction from PRDs, briefs, and refinement maps
- capability health synthesis from dogfood, workflow audit, and issue history
- plan and problem synthesis from shell sessions, GoE verdicts, and repeated failures

Rule:

- deterministic discovery should create the base node
- derived synthesis may enrich it, but must not be the only source of truth for existence

## Query surfaces that must consume this model

This ticket is planning-only, but the resulting model should drive later work in these surfaces:

### Shell

Consumes:

- capability inventory
- applicability links
- problem and plan nodes
- feature, module, and surface graph context

This enables:

- accurate "what can you do here?"
- grounded "how would you approach this task?"
- explicit "what is missing or weak?"
- guided "how do we improve this capability?"

## Shell capability intelligence contract

The shell should stop treating capability awareness as a mostly static help reply plus ad hoc planner context. It should treat capability reasoning as normal workflow state retrieval.

### Capability sources the shell must unify

When the shell talks about what it can do, it should reconcile four source classes:

- built-in capabilities
  - shell actions, workflow commands, built-in surfaces, built-in codelets
- configured capabilities
  - provider availability, planner routes, enabled integrations, configured adapters
- project-provided capabilities
  - project codelets, project docs, project-specific surfaces, repo-local modules and features
- derived capability judgments
  - health, gaps, weak spots, suggested improvements, and applicability to the current task

The shell may still gather raw inputs from provider discovery, codelet manifests, manuals, and surface definitions, but those sources should refresh the DB-backed capability graph instead of being consulted independently at answer time.

### Shell question classes

The shell should be able to answer these classes from the same model:

1. inventory questions
   - "what can you do here?"
   - "what capabilities do you have in this repo?"
2. justification questions
   - "how do you know that?"
   - "why do you think you can handle this?"
3. applicability questions
   - "can you help with this module, feature, or task?"
   - "which mode or workflow should handle this?"
4. deficiency questions
   - "what are you missing?"
   - "where are you weak?"
5. improvement questions
   - "how do we make you better at this?"
   - "what should we add, wire, or test?"
6. situational questions
   - "what is going on in this project?"
   - "what are the current features, epics, problems, and plans?"
7. guided development questions
   - "how should we approach this task?"
   - "what should we do next?"

These are not separate product areas. They are different read views over the same state model.

### Shell context assembly

For non-trivial development guidance, the shell should assemble context in this order:

1. requested task or question
2. relevant capabilities
3. applicable surfaces and integrations
4. relevant modules and features
5. active epics, tickets, problems, and plans
6. verification and health evidence

That means the shell should not jump from a user prompt straight to generic planner guidance when the DB can answer:

- which capabilities match
- which project areas are involved
- which open problems already constrain the work
- which approved plans already exist

### Shell answer contract

For capability-aware replies, the shell should be able to render four fields even if the user asks in plain prose:

- capability judgment
  - what it believes it can do
- evidence
  - why it believes that, grounded in the workflow DB
- limits
  - what is missing, weak, blocked, or unverified
- next step
  - what the operator should do next

This does not require a rigid UI, but it does require the underlying data to exist.

### Capability improvement loop

The shell should also treat capability improvement as first-class workflow work.

When the user asks how to improve a capability, the shell should be able to identify:

- the owning surface or integration
- the backing modules, codelets, and tests
- the relevant problems blocking quality
- the active or missing plans
- the downstream tickets that should implement the fix

That is why `problem` and `plan` entities are part of workflow integrity instead of an optional shell convenience layer.

### Project situational awareness minimum

For the shell to guide the user through any development task, it needs a stable DB view of:

- current features
- current epics and stories
- in-progress and queued tickets
- operator surfaces
- enabled integrations
- relevant modules
- open problems
- approved plans and rejected plans

If any of these only live in prompt assembly, shell quality will drift as soon as another surface tries to answer the same question.

### Status and host resolution

Consumes:

- shared selectors for feature, module, surface, capability, integration, problem, and plan
- stable IDs across shell and non-shell surfaces

This prevents host adapters from rebuilding repo memory in bespoke logic.

### GoE and shell modes

Consumes:

- capability nodes as the object being selected, debated, audited, and improved
- problem nodes as blockers and escalations
- plan nodes as durable outputs of governed planning

This is the bridge between workflow integrity and the later GoE and shell-mode tickets.

## Rollout order

Do this in four passes.

### Pass 1: Normalize the graph contract

- define the canonical node types and predicates above
- decide which current data stays in tables versus `entities`
- make selectors and summary builders capable of reading the new nodes

Primary consumer tickets:

- `TKT-WORKFLOW-INTEGRITY-002`
- `TKT-WORKFLOW-INTEGRITY-003`

### Pass 2: Make features and integrations real

- populate `features` from deterministic project sources
- add `integration` entities for non-core host surfaces
- connect surfaces, integrations, codelets, and capabilities

Primary consumer tickets:

- `TKT-WORKFLOW-INTEGRITY-003`
- `TKT-WORKFLOW-INTEGRITY-004`

### Pass 3: Add capability and problem memory

- create `capability` and `problem` entities
- attach health/evidence claims
- expose them through status selectors and shell context

Primary consumer tickets:

- `TKT-WORKFLOW-INTEGRITY-004`
- `TKT-SHELL-MODES-001`
- `TKT-SHELL-MODES-003`

### Pass 4: Add durable plan memory

- create `plan` entities with approval, rejection, and escalation state
- let GoE write approved or rejected plans into the DB
- link plans to capabilities, problems, tickets, and epics

Primary consumer tickets:

- `TKT-GOE-001`
- `TKT-GOE-004`
- `TKT-GOE-005`

## Non-goals for this slice

- No new runtime planner behavior yet.
- No GoE loop implementation yet.
- No shell mode UX implementation yet.
- No automatic migration of all historical shell turns into plan entities.

This slice only defines the canonical state model that those later tickets should use.

## Acceptance criteria for the planning slice

This ticket is complete when the repo has an agreed model that answers:

- which concepts are canonical tables versus entities
- which new entity types are required
- which graph predicates are required
- how capabilities, surfaces, integrations, problems, and plans relate
- which downstream tickets consume which parts of the model

If later implementation work needs to invent a new node type for these topics, this planning slice was not specific enough.
