# The Autonomous Architect: Execution Plan (Features & Modules)

The system must view the codebase as a living organism composed of semantic **Modules**, **Features**, boundaries, and contracts. It acts as a Software Architect, enforcing separation of concerns, designing clean APIs, mapping features to code, and actively managing technical debt.

## 1. Database Representation (First-Class Citizens)

We are expanding the SQLite schema to track high-level engineering concepts:

### The `modules` Table
Tracks architectural boundaries and responsibilities.
*   `id`, `name` (e.g., `core/router`, `ui/auth`)
*   `responsibility`: AI-generated justification for the module's existence.
*   `api_paradigm`: How it communicates (e.g., `method-calls`, `event-driven`, `http-rest`). Default is KISS (synchronous abstraction).

### The `features` Table
Maps user-facing capabilities to the codebase.
*   `id`, `name` (e.g., `user-onboarding`, `payment-processing`)
*   `description`: What the feature does from a product perspective.
*   `status`: active, deprecated, planned.

### The `architectural_graph` (Predicates)
*   `file X -> belongs_to -> module A`
*   `module A -> implements -> feature Y`
*   `module A -> depends_on -> module B` (metadata: "imports", "fires-event-to")
*   `symbol Z -> exposed_by -> module A` (Public API tracking)

---

## 2. The Execution Phases

### Phase 1: AI-Driven Architectural Mapping (The Deep Sync)
Mapping an existing codebase perfectly on day one is impossible. Instead, the map deepens progressively:
*   **The Baseline Sync:** The AI uses heuristics (folders, `package.json`) combined with semantic analysis of file contents to propose an initial set of Modules and Features.
*   **Continuous Refinement:** Every time the AI processes a ticket or a PRD, it enriches the map, associating new files with features or realizing a module has split responsibilities.

### Phase 2: The Tech Debt Critic & Batched Auto-Ticketing
The system continuously audits the graph for "bad wiring" (circular dependencies, leaky abstractions, God modules).
*   **Anti-Ticket-Bloat Strategy:** If the Critic finds 50 leaky abstractions in legacy code, it does *not* open 50 tickets. It opens **1 Epic** ("Refactor Data Access Layer") containing **Batched Tickets** (e.g., "Decouple UI from DB in `src/ui/` (14 files)").
*   **Progressive Breakdown:** When the system starts executing the batched ticket, it dynamically breaks it down into individual file tasks using the Orchestrator.

### Phase 3: The "Consult Developer" Workflow
Architecture decisions often require human context.
*   **The `needs-consultation` Denotation:** Tickets can be tagged with specific questions (e.g., "Module `auth` is tightly coupled. Should we upgrade this to an event-driven service?").
*   **Indexed Queries:** These denotations are indexed in the DB.
*   **The Periodic Check-in:** The system periodically (or on demand via shell) presents these blocked/consultation tickets to the user: *"I have 3 architectural questions for you. Ready?"*

## 3. Architectural Health Tagging
To make the system more efficient, artifacts (files, symbols, modules) will be tagged with predefined "Health Indicators":

*   **Negative Tags (Smells):** `leaky-abstraction`, `circular-dependency`, `god-artifact`, `zombie-code`, `high-coupling`.
*   **Positive Tags (Patterns):** `clean-boundary`, `agnostic-integration`, `high-cohesion`, `canonical-example`.

The "Critic" uses these tags to focus its attention, and the "Orchestrator" uses positive tags to provide high-quality reference examples to coding agents.

---

## Summary of Agreements
1.  **Module/Feature Definition:** Driven by AI analyzing folders, explicit docs, and implicit semantics, constantly refined over time via Progressive Refinement JSON.
2.  **Ticketing:** Aggressive detection using AST-strict SQL queries, but batched/grouped ticketing to prevent board bloat.
3.  **Paradigms:** Default to KISS abstractions. Upgrades (e.g., moving to message queues) are proposed via tickets and require explicit developer consultation.
4.  **Health Tagging:** Systematic tagging of artifacts to drive smarter context packing and automated refactoring.
