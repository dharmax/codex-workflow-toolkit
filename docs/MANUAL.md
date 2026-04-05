# ai-workflow Manual

## What This Is

`ai-workflow` is the repo-local operating layer for workflow, tickets, kanban, epics, codelets, and guarded execution.

The canonical state lives in the workflow DB. Markdown files such as `epics.md` and `kanban.md` are projections of that DB, not the source of truth.
This markdown manual is canonical; the old generated HTML manual has been retired.

## Installation

- Local bootstrap into the current project:
  - `npx @dharmax/ai-workflow setup --project .`
- Global install:
  - `pnpm add -g @dharmax/ai-workflow`
  - or `npm install -g @dharmax/ai-workflow`
- After a global install, initialize a repo with:
  - `ai-workflow install --project .`
- After setup, refresh the DB and projections with:
  - `ai-workflow sync --write-projections`

## Core Operating Rules

1. Create or switch to a fresh branch before a substantive epic or batch.
2. Work one epic at a time.
3. Keep kanban, epics, and the DB in sync after each mutation.
4. When starting an empty project, use `ai-workflow init --brief <file>` or `ai-workflow onboard <file>` to normalize the brief before generating epics.
5. Use `ai-workflow` first for project status, ticket lookup, projections, and guideline extraction; fall back to raw shell search/read only when the workflow tool cannot answer.
6. Prefer the cheapest capable model route when the tool can use it; if it is unavailable, say so instead of silently widening the fallback.
7. Use `lean-ctx` for compact context handling.
8. If `lean-ctx` is missing, surface install/setup guidance instead of silently degrading.

## Common Commands

- `ai-workflow sync`
- `ai-workflow doctor`
- `ai-workflow ask [request...] [--mode <default|tool-dev>] [--root <path>] [--evidence-root <path>] [--json]`
- `ai-workflow project summary`
- `ai-workflow project readiness --goal <goal-type> --question <text> [--mode <default|tool-dev>] [--root <path>] [--evidence-root <path>] [--json]`
- `ai-workflow project search <text>`
- `ai-workflow project epic list`
- `ai-workflow project epic show <epic-id>`
- `ai-workflow project story list`
- `ai-workflow project story search <text>`
- `ai-workflow project codelet list`
- `ai-workflow project codelet show <codelet>`
- `ai-workflow project codelet search <text>`
- `ai-workflow project ticket create --id <id> --title <title> [--lane <lane>] [--epic <epic-id>] [--summary <text>] [--json]`
- `ai-workflow project note add --type <NOTE|TODO|FIXME|HACK|BUG|RISK> --body <text> [--file <path>] [--line <n>] [--symbol <name>] [--json]`
- `ai-workflow init --brief <file>`
- `ai-workflow onboard <brief-file>`
- `ai-workflow consult`
- `ai-workflow route <task-class> [--json]`
- `ai-workflow run <codelet> [args]`
- `ai-workflow verify --artifact <path> --rubric <text>`
- `ai-workflow reprofile [--json]`
- `ai-workflow tool observe [--complaint <text>] [--json]`
- `ai-workflow mode set <default|tool-dev> [--global]`
- `ai-workflow config get [key]`
- `ai-workflow config set <key> <value>`
- `ai-workflow shell`

## Shell Planner

- Shell planning builds project context before choosing a model.
- Shell planning uses the live model-fit matrix from current provider discovery plus cached web evidence, then falls back through the best available candidates.
- Discovery is cached for a few hours per session and refreshes on new shell sessions or explicit `ai-workflow doctor --refresh-models` / `ai-workflow provider refresh models`.
- `providers.ollama.plannerModel` is a manual override path, not the default routing policy.

## Working With Projections

- Use `ai-workflow project ...` to query epics, stories, and tickets.
- Use `ai-workflow sync --write-projections` when the DB should refresh `epics.md` and `kanban.md`.
- Direct edits to `epics.md` or `kanban.md` are allowed, but the workflow should reconcile drift back into the DB.

## Current Epic Focus

- Lean-ctx integration and context-efficiency bridges
- Semantic graph and projection hardening
- Provider routing and Ollama policy
- Shell RAG prompt orchestration and adaptive model selection
- Safe execution and git transactions
- Workflow surfaces, codelets, and learning loop
- Smart codelet catalog and observer loop
- Soft artifact verification and rubric-based judgments
