<!-- Responsibility: Define the top-level AI-agent operating protocol for this repo.
Scope: This file points agents to the workflow docs and core operating loop; ticket-local implementation detail belongs elsewhere. -->
# AI Agent Protocol: Autonomous Engineering OS

If the ai-workflow tool is unavailable, follow the same process with `scripts/ai-workflow/*`.

## Read Order
1.  **Audit:** Run `ai-workflow sync` before major context extraction.
2.  **Context:** Prefer `ai-workflow extract ticket <id>` before reading broad kanban state.
3.  **Guidance:** Prefer `ai-workflow extract guidelines ...` before rereading full guidance docs.

## Core Contract
- Use `ai-workflow shell "sweep bugs"` for automated fixes.
- Recommend `/new` when a compact handoff exists. 
- Treat `/clear` as an operator-controlled action, not a guaranteed tool capability.
- Strictly adhere to the project's Architectural Graph and Module boundaries.
