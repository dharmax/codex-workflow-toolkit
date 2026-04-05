# @dharmax/ai-workflow

## High-Integrity Engineering Workbench: Surgical, Requirement-Synced, and Token-Lean.

Most AI coding tools produce "spaghetti at scale"—passive wrappers that bloat context and ignore architectural boundaries. **@dharmax/ai-workflow** is a high-integrity engineering platform designed for developers who treat code as a craft. It operates as a strict conductor that coordinates multiple LLM "compute engines" (Gemini, Claude, local Ollama) to evolve your codebase while maintaining religious adherence to your architectural guidelines.

### 🎯 The Philosophy

- **Tight Sync Loop:** Your workflow stays locked to your requirements. The system maintains a live link between the project brief, the Kanban status, and the code, ensuring no feature drifts into "hallucination territory."

- **Architectural Discipline:** Unlike standard AI assistants, this system enforces strict coding and design patterns. It treats your architectural guidelines as law, preventing the leaky abstractions and "zombie code" typically introduced by LLMs.

- **Fanatical Token Economy:** We religiously reduce token overhead. By leveraging the brilliant [lean-ctx](https://github.com/dharmax/lean-ctx "null") (deep gratitude to the creators), we prune context to the bone. This isn't just about cost—it's about keeping the LLM focused on the surgery at hand, not the noise.


### 🚀 Key Capabilities

- **Requirement-Aware Fixer Loop:** Automatically identifies bugs in your Kanban board, builds surgical context, generates patches, and verifies fixes via local tests.

- **Soft Artifact Verification:** Judge generated docs, code, and screenshots against a rubric with pass/fail/needs-human-review output.

- **Architectural Intelligence:** Proactive auditing for circular dependencies and leaky abstractions. It understands "Modules" and "Features" as first-class entities.

- **Brief-to-Epic Decomposition:** Safely ingest messy project descriptions, normalize them into a living brief, and decompose them into scoped, executable tickets.

- **Surgical Patch Engine:** Uses a strict SEARCH/REPLACE protocol. No more full-file rewrites that destroy unrelated logic or blow through your monthly API budget.

- **Supergit Safety Net:** Pessimistic Git transactions (Auto-Stash -> Temp Branch -> Test -> Merge) ensure the AI never touches your active working tree until the code is proven.


### 🛠️ Installation

**Requirements:**

- Node.js 22+

- `pnpm` or `npm`


**Choose your path:**

1. **One-off project bootstrap:**

    ```
    npx @dharmax/ai-workflow setup --project .
    ```

2. **Global install:**

    ```
    pnpm add -g @dharmax/ai-workflow
    # or
    npm install -g @dharmax/ai-workflow
    ```


**Post-install setup:**

```
# Bootstrap a repo
ai-workflow install --project .

# (Optional) Initialize from a brief
ai-workflow init --brief ./project-brief.md

# Sync DB and projections
ai-workflow sync --write-projections
```

### Documentation

- [Technical manual](docs/MANUAL.md)

### 🧭 Core Workflow

- **Context:** Use `ai-workflow` first for project status, ticket lookup, projections, and guideline extraction; fall back to raw shell search/read only when the workflow tool cannot answer.
- **Routing:** Prefer the cheapest capable model route when the tool can use it; if it is unavailable, say so instead of silently widening the fallback.
- **Ideate:** `ai-workflow shell "add feature User Auth"` (Starts the planning phase)

- **Sync:** `ai-workflow sync --write-projections` (Updates the internal knowledge graph)

- **Audit:** `ai-workflow audit architecture` (Checks for guideline violations)

- **Execute:** `ai-workflow shell "sweep bugs"` (Starts the autonomous fixer)

- **Verify soft artifacts:** `ai-workflow verify --artifact ./screenshot.png --rubric "Matches the design reference"`

- **Consult:** `ai-workflow consult` (Answer architectural questions for the AI)


### 🤖 Shell Mode

`ai-workflow shell` is the interactive planning loop. It syncs project context before each turn, then routes the request through the live model-fit matrix built from current provider discovery and cached web evidence.

- If Ollama models change, refresh the matrix with `ai-workflow doctor --refresh-models` or `ai-workflow provider refresh models`.
- The shell reuses discovery for a few hours per session and only reprobes on new sessions or explicit refresh.
- Pass `--plan-only` to preview the plan without executing it.
- Pass `--no-ai` to force heuristic-only planning.


### 🏛️ Architecture & Standards

The system is built on a **DB-First Architecture** using SQLite to maintain a persistent graph of Symbols, Features, and Tickets.

- **Extreme KISS:** We prefer simple, native patterns. No monolithic abstractions.

- **Pessimistic Engineering:** We assume the AI will fail. We build gates, tests, and isolated branches to contain that failure.

- **Graph-Powered Context:** We use the local AST to send the absolute minimum code required for any task.


**A special thank you to the creators of `lean-ctx`.** Their work is foundational to the token efficiency of this system.

© 2026 Dharmax. High-Integrity Engineering for the Modern Era.
