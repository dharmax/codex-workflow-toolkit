# @dharmax/ai-workflow: The Full Manual

## 1. Introduction
The **Autonomous Engineering OS** is a local-first platform that orchestrates Artificial Intelligence to perform professional-grade software engineering. It is not a simple "chat with your code" tool; it is a state-aware system that maintains a persistent SQLite database of your project's architecture, workplan, and health.

---

## 2. Core Philosophy

### 🛠️ Pessimistic Engineering
We assume that LLMs are talented but unreliable. The OS builds safety nets around every AI operation:
*   **Supergit:** All AI work happens on isolated temporary branches.
*   **Surgical Patching:** Only exact snippets are changed; the AI never rewrites a whole file.
*   **Verification:** Every patch is validated by tests before being merged.

### 📉 Token Efficiency
AI is expensive and slow when context is bloated. The OS uses a **Graph-Powered Context Packer** to send only the specific symbols, types, and dependencies required for a task, reducing token waste by up to 80%.

### 🏛️ Architectural Integrity
The OS views code as a hierarchy of **Modules** and **Features**. It actively identifies circular dependencies and leaky abstractions, acting as your automated Software Architect.

---

## 3. Architecture & Services

### 🧠 The Smart AI Router
The Router uses a **2D Competency Matrix** to pick the cheapest model capable of a task. It understands that a model might be a "5/5" at prose but a "2/5" at logic.
*   **Task Classes:** `pure-function`, `ui-layout`, `prose-composition`, `shell-planning`, etc.
*   **Capabilities:** `logic`, `prose`, `visual`, `data`, `strategy`.

### 🩹 Unified Patch Engine
Implements the `SEARCH/REPLACE` protocol. 
*   **Format:**
    ```text
    File: src/app.js
    <<<< SEARCH
    old code
    ====
    new code
    >>>>
    ```
*   **Safety:** The OS attempts exact matching first, then whitespace-insensitive matching. If it fails, it retries with the AI rather than guessing.

### 🛡️ Supergit
A high-level Git transaction engine.
*   **Pipeline:** Auto-Stash -> Temp Branch -> Execute AI -> Run Tests -> Merge Success -> Pop Stash.

---

## 4. Command Reference

### `ai-workflow shell [intent]`
The primary agentic interface. Supports natural language requests.
*   `"how are we doing?"` (Summary)
*   `"sweep bugs"` (Start autonomous fixer loop)
*   `"add feature X"` (Start interactive ideation)

### `ai-workflow ingest <file>`
The Artifact Digestor. Safely reads large PRDs or Design Docs.
*   **Workflow:** Architect assesses file -> Proposes Outline -> Human Approves -> System generates Epic/Tickets.

### `ai-workflow audit architecture`
Scans the SQLite graph for structural smells.
*   Detects Circular Dependencies and Leaky Abstractions.
*   Tags files with `god-artifact`, `zombie-code`, etc.

### `ai-workflow consult`
The asynchronous Q&A loop.
*   The AI will often encounter architectural choices it shouldn't make alone. These are saved as consultation tickets. Use this command to answer them.

### `ai-workflow metrics`
View project-wide AI efficiency statistics.
*   Success rates per model.
*   Token counts and average latency.

---

## 5. Standard Workflows

### Scenario A: Adding a Large Feature
1.  Place your PRD in `docs/features/`.
2.  Run `ai-workflow ingest docs/features/my-new-feature.md`.
3.  Interact with the PM agent to scope the Epic.
4.  Approve the tickets.
5.  Run `ai-workflow shell` to begin execution.

### Scenario B: Clearing Tech Debt
1.  Run `ai-workflow audit architecture`.
2.  Review the generated refactoring tickets in the Kanban.
3.  Type `ai-workflow shell "fix architectural violations"` to begin automated refactoring.

---
© 2026 Dharmax. Engineering, Automated.
