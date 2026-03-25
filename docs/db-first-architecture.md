# DB-First Architecture: Autonomous Engineering OS

The system is designed around a **Single Source of Truth**—a local SQLite database that maintains the living state of the project. This architecture ensures that AI agents always have access to consistent, non-hallucinated data about the codebase, workplan, and architectural boundaries.

## 1. The SQLite Storage Layer
The database (`.ai-workflow/workflow.db`) acts as the project's memory. It indexes:
*   **Files & AST Facts:** Every file, symbol, import, and call.
*   **Engineering Entities:** Epics, Tickets, and Modules.
*   **Contextual Meta:** Project-specific guidelines, knowledge nodes, and metrics.

## 2. Stateless Logic, Stateful Data
AI Agents (Compute Engines) are treated as stateless. Every operation follows a strict pattern:
1.  **Pull State:** Query the DB for surgical context.
2.  **Process:** AI generates a patch or plan.
3.  **Update State:** Write results (patches, metrics, tickets) back to the DB.

## 3. The Orchestration Stack
The `ai-workflow` CLI coordinates the flow between these components:
*   **Parsers:** Populate the DB from the filesystem.
*   **Router:** Selects the best brain for the task.
*   **Orchestrator:** Manages complex loops (Ideation, Fixer, Critic).
*   **Supergit:** Ensures all filesystem mutations are safe and transactional.

## 4. Integration & UI
The system is accessible via:
*   **CLI/Shell:** The primary interface for local development.
*   **Companion UI (Future):** Telegram integration for remote oversight and triage.

---
© 2026 Dharmax.
