# @dharmax/ai-workflow: Autonomous Engineering OS

An autonomous, local-first engineering platform designed to manage the entire development lifecycle—from feature ideation and architectural auditing to automated bug fixing and surgical code patching. 

Unlike passive AI wrappers, this system operates as an **Autonomous OS** that coordinates multiple LLM "compute engines" (Gemini, Claude, local Ollama) to evolve your codebase while strictly maintaining architectural integrity.

## 🚀 Key Capabilities

*   **Autonomous Fixer Loop (`sweep bugs`):** Automatically identifies bugs in your Kanban board, build surgical context, generates patches, and verifies fixes via tests.
*   **Architectural Intelligence:** First-class database support for **Modules** and **Features**. The system proactively audits for circular dependencies, leaky abstractions, and "zombie" code.
*   **Project Brief Onboarding:** Safely ingest a messy project description, normalize it into a living brief, ask clarifying questions, and then decompose it into scoped Epics and Tickets.
*   **Surgical Patch Engine:** Uses a strict `SEARCH/REPLACE` protocol to eliminate file rewrites, reduce token cost by 80%, and prevent regressions.
*   **Supergit Safety Net:** Pessimistic Git transactions (Auto-Stash -> Temp Branch -> Test -> Merge) ensure the AI never ruins your active working tree.
*   **Living Knowledge Base:** A dynamic system that learns architectural mappings and project-specific patterns as it works.

## 🛠️ Installation

```bash
npx @dharmax/ai-workflow setup --project .
# or, for a global install:
pnpm install -g @dharmax/ai-workflow
```

For a brand-new project brief, follow setup with `ai-workflow init --brief ./project-brief.md`.

## 📖 Documentation & Manual

The system includes a rich, comprehensive manual covering philosophy, architecture, and command reference.

*   **[Full Manual (HTML)](docs/manual.html)** - *Best for visual browsing*
*   **[Technical Manual (Markdown)](docs/MANUAL.md)**

## 🧭 Core Workflow

1.  **Ideate:** `ai-workflow shell "add feature User Auth"`
2.  **Audit:** `ai-workflow audit architecture`
3.  **Execute:** `ai-workflow shell "sweep bugs"`
4.  **Consult:** `ai-workflow consult` (Answer architectural questions from the AI)
5.  **Monitor:** `ai-workflow metrics`

---

## 🏛️ Architecture

The system is built on a **DB-First Architecture** using SQLite to maintain a persistent graph of:
*   **Files & Symbols:** Extracted via local AST parsers.
*   **Modules & Features:** Architectural boundaries and product capabilities.
*   **Tickets & Epics:** The live state of the workplan.
*   **Metrics:** Real-time tracking of AI performance and token efficiency.

## 🛡️ Engineering Standards

*   **Extreme KISS:** Prefer simple, native patterns over monolithic abstractions.
*   **Pessimistic Engineering:** Assume the AI will fail; build strict gates, tests, and isolated Git branches.
*   **Token Efficiency:** Use the Graph-Powered Context Packer to send the absolute minimum code required for any task.

---
© 2026 Dharmax. Autonomous Engineering for the Modern Era.
