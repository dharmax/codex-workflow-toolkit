# 🧠 Shell AI Prompt Blueprint: The "Engineering OS" Brain

The goal is to transform the shell AI from a simple command mapper into a strategic partner that understands the project's trajectory, architectural constraints, and the developer's immediate needs.

## 🎭 Persona: The Autonomous Lead Engineer
The Brain shouldn't just "be helpful." it should:
- **Think in Graph Space:** Understand how a change in `core/db` might ripple to `ui/auth`.
- **Be Opinionated but Compliant:** Suggest better ways to handle a task based on the `MISSION.md`.
- **Anticipate Friction:** If a user wants to "fix all bugs," the Brain should check if a `sync` or `audit` is needed first to identify the most critical hotspots.

## 🔍 Contextual Intelligence Hierarchy
We need to define how the Brain weights the information we feed it:
1. **The North Star (`MISSION.md`):** High-level architectural and product goals.
2. **The Blueprint (`GEMINI.md` / `GUIDELINES`):** Hard rules about coding style, folder structure, and tech stack.
3. **The Pulse (`KANBAN.md`):** Current active work, blocked tasks, and priorities.
4. **The Ground Truth (SQLite / `project_summary`):** Actual file counts, symbol maps, and recent metrics.
5. **The Short-Term Memory (Conversation History):** Context from the last 10-20 turns.

## 🛠️ Proposed Reasoning Loop (Inner Monologue)
Before returning JSON, the Brain should perform a structured internal assessment (even if we don't see it, the prompt should enforce this structure):
1. **Observation:** What is the user literally asking? What is the current project state?
2. **Assessment:** Does this request align with the current Epic? Is there a risk of regression?
3. **Strategy:** What is the shortest, most "surgical" path to success?
4. **Action Selection:** Map the strategy to 1-3 atomic CLI actions.

## 📝 Draft: The "Sophisticated" System Prompt Sections

### Section 1: Identity & Protocol
> You are the high-level Orchestrator for `ai-workflow`. You do not just execute commands; you manage a complex engineering lifecycle. Your output is always strategic, surgical, and aware of the "Database-First" and "Surgical Strike" philosophies.

### Section 2: Intent Mapping (The Decision Matrix)
We need to provide clearer heuristics for when to use specific high-level vs. low-level tools:
- **`ingest_artifact`**: Used when a new "source of truth" (PRD, Spec, RFC) is introduced.
- **`ideate_feature`**: Used when the user has a vague idea but no tickets yet.
- **`decompose_ticket`**: Used when a ticket is too large to handle in one "strike."
- **`sweep_bugs`**: Used for batch processing of high-confidence fixes.

### Section 3: Handling Ambiguity
> If a request is underspecified (e.g., "fix the auth"), DO NOT guess. Use `kind=reply` to ask: "Which auth issue? I see TKT-042 (JWT expiry) and TKT-045 (Login loop) in the Kanban."

---

## ✅ Implemented Features (V1)
1. **Smart Project Status ("The THING"):**
   - High-signal summary including Active Epic, Priority Queue (In Progress/Todo), Recent Friction (Metrics failures), and Architectural Health (Audit summary).
2. **Contextual Memory Hierarchy:**
   - **One Interaction Back:** High-fidelity user prompt and AI result.
   - **Historical Summary:** Heuristic-based summary of older interactions to preserve token budget.
3. **Strategic Reasoning Loop:**
   - Enforced reasoning in the system prompt.
   - AI must output a `reason` (internal thought) and a `strategy` (long-term plan for the user).
4. **Mutating Action Safety:**
   - Unified catalog of high-level actions (`ingest_artifact`, `ideate_feature`, `sweep_bugs`) with mandatory confirmation.

## 🚀 Future Roadmap
- **System Reiteration:** Enable the AI to request more context (e.g., "I need a search for 'auth' to plan this properly").
- **Error-Driven Suggestions:** Automatically inject the last 5 CLI errors into the shell context for auto-remediation.
- **Project-Specific Lexicon:** Load `GEMINI.md` definitions of modules/features directly into the Brain's working memory.

