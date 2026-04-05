# Responsibility: Define the top-level AI-agent operating protocol for this repo.
# Scope: This file points agents to the workflow docs and core operating loop; ticket-local implementation detail belongs elsewhere.
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
- Use `ai-workflow` first for project status, ticket lookup, projections, and guideline extraction; fall back to raw shell search/read only when the workflow tool cannot answer.
- If `ai-workflow` fails, stop, identify root cause, and either fix it or report the blocker before continuing.
- If you discover a bug while working on something else, stop and tell the operator unless they explicitly asked for full-batch triage.
- Prefer the cheapest capable model route when the tool can use it; if it is unavailable, say so instead of silently widening the fallback.
- Strictly adhere to the project's Architectural Graph and Module boundaries.
