# Phase Completion & Trust: The "Dogfooding" Milestone

The technical mechanics of the Autonomous Engineering OS (Phases 1-4) are built. The next immediate milestone is crossing the "Trust Threshold" so the system can be reliably used in production without risking project integrity.

## The Goal
To ensure the system is vastly superior to manual AI chatting (Gemini/Codex) by being:
1.  **Cheaper:** Near-zero token waste.
2.  **Safer:** Mathematically impossible to delete un-targeted code.
3.  **Smarter:** Understands the full project context automatically and strictly adheres to general and project-specific guidelines for best engineering practices.
4.  **Eat Your Own Food:** We must achieve a state where we confidently and efficiently develop *this tool* using *this tool itself*.

---

## Core Enhancements (The "Trust" Checklist)

### 1. Codelet Composability & "Supergit"
*   **Composability:** Codelets must not be silos. They must be designed to natively invoke the `routeTask` AI service and execute other codelets, creating a web of cheap, reusable logic blocks.
*   **The "Supergit" Codelet:** A foundational, intelligent Git wrapper. 
    *   It provides standard Git passthrough but layers on high-level, AI-assisted operations (e.g., semantic commit generation, smart stashing, conflict summary) while strictly minimizing expensive model calls.
    *   **The Revert Button:** Integrated directly into Supergit. Before the `sweep bugs` loop modifies files, Supergit creates a snapshot or temp branch. If the autonomous test phase fails, Supergit automatically reverts the workspace, leaving a clean slate for the next attempt.

### 2. Resilient & Asynchronous Patch Engine
*   **Goal:** Maximum automation. Human intervention should be a last resort.
*   **AI Auto-Resolution:** If the patch engine detects an ambiguous `SEARCH` block (e.g., a typo by the generating model), it does not immediately fail. Instead, it queries a cheap, local logic model with the exact file context and the broken block, asking it to repair the patch block autonomously.
*   **Async Deferral:** If the cheap AI cannot resolve the ambiguity, the task is safely set aside (e.g., moved to a "Blocked/Needs Human" lane). The orchestrator does not wait; it continues sweeping the next tickets, acknowledging the developer might be AFK.

### 3. Smart Input & The Ingestion Engine (Artifact Digestor)
*   **Smart Paste:** The interactive shell must gracefully intercept and automatically handle the pasting of massive text blocks or images (via paths/URLs), abstracting them into usable context objects rather than breaking the REPL stream.
*   **The Ingestion Pipeline:** Processing raw artifacts (PRDs, UX wireframes, architectural docs) is a specialized, multi-stage process:
    1.  **Assessment Phase:** An initial AI routing step determines the nature of the inputted artifact(s).
    2.  **Decomposition:** If the artifact is mixed (e.g., a PDF with text and images), it is broken down into specific typed pieces.
    3.  **Specialized Handling:** Each piece is routed to the appropriate handler (e.g., Vision model for wireframes, Extraction model for text). The pipeline ultimately generates structured Epics and Tickets, actively querying the user for clarifications *before* finalizing the Kanban board.

### 4. Testing: The "Mock Project" Crucible
*   Before we point this tool at its own source code, we must validate the pipeline. We will create a mini mock project with a few files and use *only* the `ai-workflow` tool to develop it, testing the Epics -> Decompose -> Sweep -> Supergit loop in a real-world scenario.
