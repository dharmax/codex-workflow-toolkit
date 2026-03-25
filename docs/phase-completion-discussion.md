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
*   **The "Supergit" Codelet:** A foundational, intelligent Git wrapper built on **Pessimistic Engineering**.
    *   It provides standard Git passthrough but layers on high-level operations (semantic commits, conflict summary).
    *   **CRITICAL FLAG: The Working Tree Problem:** If `sweep bugs` creates a temp branch while the user has uncommitted changes, those changes will bleed into the AI's workspace (or block the checkout). 
    *   **The Bulletproof Solution:** Supergit MUST either (A) enforce a clean working tree (`git diff --quiet`) before starting an autonomous loop, or (B) use `git worktree add` to perform the autonomous loop in a completely hidden, isolated directory. Given our goal is to edit the user's *current* workspace, we will enforce a strict **Auto-Stash -> Temp Branch -> Test -> Merge -> Auto-Pop** pipeline. If it fails, it deletes the temp branch and pops the stash, guaranteeing the user's uncommitted work is untouched.

### 2. Resilient & Asynchronous Patch Engine
*   **Goal:** Maximum automation without sacrificing safety.
*   **Strict Application:** AI must NOT "guess" how to apply a broken patch. If a `SEARCH` block fails exact or fuzzy whitespace matching, the operation halts immediately. 
*   **The Feedback Loop:** Instead of trying to patch the patch, the engine feeds the error (and the current file state) back to the *original* generating model for a retry.
*   **Async Deferral:** If the retry fails, the task is safely set aside (moved to a "Blocked/Needs Human" lane). The orchestrator does not wait or hang; it continues sweeping the next tickets. 
*   **UX Reality Check:** Because autonomous loops are high-latency, the CLI UX must present them as background async jobs (like a CI pipeline) rather than blocking the user's terminal prompt.

### 3. Smart Input & The Ingestion Engine (Artifact Digestor)
*   **CRITICAL FLAG: The TTY Buffer Problem:** Pasting a 50-page PRD directly into a Node.js `readline` prompt will cause buffer overflows and terrible UX. 
*   **The Bulletproof Solution:** The interactive shell should detect multi-line pastes and convert them to temp files under the hood, OR strictly encourage file-based ingestion: `ai-workflow ingest ./docs/prd.md`.
*   **The Ingestion Pipeline:** Processing raw artifacts (PRDs, UX wireframes, architectural docs) is highly prone to "Ticket Bloat" (hallucinated, over-engineered sub-tasks). The pipeline must strictly gate this:
    1.  **Assessment:** Route to the correct model (Vision for wireframes, Extraction for text).
    2.  **Outline First (Human Gate):** The AI generates a high-level outline of proposed Epics/Tickets. The system *stops* and forces the human to approve/edit this outline.
    3.  **Generation:** Only upon human approval are the DB entities generated.

### 4. Testing: The "Mock Project" Crucible
*   **CRITICAL FLAG: Token Bankruptcy in CI:** We cannot run `pnpm test` if it makes real API calls.
*   **The Bulletproof Solution:** All new features (Supergit, Ingestion, Patch Retries) MUST be tested using the local HTTP mock server pattern established in `TKT-TEST-ORCH`. Zero network calls during tests.
*   Before we point this tool at its own source code, we must validate the pipeline. We will create a mini mock project with a few files and use *only* the `ai-workflow` tool to develop it, testing the Epics -> Decompose -> Sweep -> Supergit loop in a real-world scenario.
