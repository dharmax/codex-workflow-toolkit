# Implementation Plan & Brutal Assessment: The Autonomous Architect

## Brutal, Unfiltered Assessment

The vision is incredible. If successful, this moves the tool from an "editor" to a "CTO." However, from an implementation standpoint, **this is the most dangerous phase yet.** 

Here is why:

### 1. The "Deep Sync" Token Trap
**The Flaw:** If the `sync` process uses AI to semantically map every file to a module and feature on a cold start, indexing a mid-sized legacy project will cost $50 and take 30 minutes. 
**The Brutal Reality:** We cannot use AI for the initial mapping of every file. Period.
**The Fix:** Phase 1 MUST rely 100% on cheap, dumb heuristics (folder paths, `package.json` workspaces, naming conventions) to create the "Draft Modules." The AI only gets involved in *Phase 3* (Progressive Refinement) when it is already looking at a specific file for a specific ticket. It "learns as it works," not all at once.

### 2. The "Critic" Hallucination Risk
**The Flaw:** If we let the AI run an "eval" on the whole graph, it will invent imaginary dependencies and flag false positives because it doesn't understand the runtime context (e.g., dynamic imports or dependency injection).
**The Brutal Reality:** If the Critic opens 3 "Batched Tickets" that are based on hallucinations, and you run `sweep bugs`, the AI will start tearing apart perfectly good, working code to fix a non-existent architectural problem.
**The Fix:** The Critic must be restricted to analyzing *mathematically verifiable data* from the AST (e.g., "File A physically imports File B, but they are in different modules"). It should never flag "low cohesion" purely based on semantic vibes.

### 3. The `needs-consultation` Choke Point
**The Flaw:** If the system pauses execution every time it wants to ask a question about architecture, the "Autonomous Loop" dies. It becomes a synchronous nag.
**The Brutal Reality:** The AI will use this as a crutch. If it's unsure how to implement something, it will throw a `needs-consultation` flag instead of trying.
**The Fix:** The orchestrator must be designed to *continue working on other tickets* while a consultation ticket sits in a `Blocked` lane. The shell must aggregate these questions and present them only when you type `ai-workflow consult`.

---

## The Phased Implementation Plan

If we respect the brutal realities above, here is how we build it safely and efficiently.

### Phase 1: Database & Heuristic Foundation (Fast & Dumb)
*   **Goal:** Establish the schema and baseline map without spending a single token.
*   **Action 1:** Update `core/db/schema.mjs` to include `modules`, `features`, and `architectural_graph` tables.
*   **Action 2:** Update `core/parsers/` to emit Module boundaries based strictly on directory paths (e.g., `src/ui/*` -> Module `ui`).
*   **Action 3:** Update `SqliteWorkflowStore` to insert these heuristic modules and map `belongs_to` predicates during the standard `syncProject` run.

### Phase 2: The Progressive Refiner (Smart & Targeted)
*   **Goal:** Let the AI refine the map only when it's already working on a file, saving tokens.
*   **Action 1:** Update `orchestrator.mjs` (specifically `sweepBugs` and `ideateFeature`). Whenever an AI touches a file, give it a system prompt instruction to optionally output a `Refinement` object.
*   **Action 2:** The Refinement JSON now explicitly includes Features:
    `{"action": "refine_map", "file": "x", "module": "auth", "features": ["user-login", "permissions"]}`
*   **Action 3:** Update the DB. This turns the system into a learning organism that maps technical modules to product features.

### Phase 3: The AST-Strict Critic (Safe & Verifiable)
*   **Goal:** Detect bad wiring using hard facts, not AI vibes, and tag artifacts for efficiency.
*   **Action 1:** Create `core/services/critic.mjs`.
*   **Action 2:** Implement an **Architectural Health Tagging** system in the DB.
*   **Action 3:** Define Predefined Tags:
    *   **Negative (Smells):**
        *   `leaky-abstraction`: Direct coupling between high-level UI and low-level DB/IO.
        *   `circular-dependency`: Bi-directional imports between distinct modules.
        *   `god-artifact`: Single file/module with excessive outbound dependencies or symbol count.
        *   `zombie-code`: Symbols or files that are never imported or called.
        *   `high-coupling`: Direct imports where an abstraction/adapter was expected.
    *   **Positive (Patterns):**
        *   `clean-boundary`: Module with a strictly enforced, minimal public API.
        *   `agnostic-integration`: Adapter that successfully hides transport/DB implementation details.
        *   `high-cohesion`: Logic focused strictly on a single responsibility.
        *   `canonical-example`: A high-quality implementation that other agents should use as a reference.
*   **Action 4:** Create a shell command `ai-workflow audit architecture`. It runs the SQL queries, applies the tags, and generates a single Batched Ticket for high-priority negative tags.

### Phase 4: The Consultation Loop (Asynchronous Q&A)
*   **Goal:** Allow the AI to ask questions without stopping the world.
*   **Action 1:** Add a `needs-consultation` state to the `entities` table schema.
*   **Action 2:** Update the shell dispatcher to support an `ai-workflow consult` command, which loops through blocked tickets, prints the AI's question, records your answer into the `data_json`, and moves it back to `Todo`.

---

## Conclusion
This plan avoids the token bankruptcy of a "Deep Sync," prevents the AI from ripping apart your code based on architectural hallucinations, and preserves the autonomous nature of the loop. Do you approve this pessimistic, iterative approach?