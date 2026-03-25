# Token Efficiency & Safety: Engineering OS Strategy

Maximum token efficiency is achieved by strictly controlling the context window and forbidding full-file rewrites.

## 1. Surgical Context Packing
The **Context Packer** uses the project graph to build minimal prompts. Instead of full files, it provides:
*   Relevant symbol snippets.
*   Immediate dependency metadata.
*   Active ticket requirements.
*   Specific guideline extracts.

## 2. Tiered AI Delegation
The **Smart AI Router** eliminates "economical suicide" by matching tasks to the cheapest capable model:
*   **Low Tier (Ollama 8B):** Shell requests, basic logic, data extraction.
*   **Medium Tier (Gemini Flash):** Bug sweeping, refactoring, unit tests.
*   **High Tier (Sonnet/Pro):** Architectural design, complex ideation, deep debugging.

## 3. The SEARCH/REPLACE Protocol
The **Unified Patch Engine** prevents regressions by forcing the AI to only output surgical edits.
*   **Safety:** The system verifies patches against current file state.
*   **Economy:** 10-line patches replace 500-line file rewrites, saving thousands of output tokens per session.

## 4. Transactional Git Loops
The **Supergit** engine wraps all autonomous loops in isolated Git transactions.
*   **Isolation:** AI work happens on temporary branches.
*   **Persistence:** Only verified successes are merged back into the master workspace.

---
© 2026 Dharmax.
