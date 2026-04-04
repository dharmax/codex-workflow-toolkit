# ai-workflow Manual

## What This Is

`ai-workflow` is the repo-local operating layer for workflow, tickets, kanban, epics, codelets, and guarded execution.

The canonical state lives in the workflow DB. Markdown files such as `epics.md` and `kanban.md` are projections of that DB, not the source of truth.

## Core Operating Rules

1. Create or switch to a fresh branch before a substantive epic or batch.
2. Work one epic at a time.
3. Keep kanban, epics, and the DB in sync after each mutation.
4. When starting an empty project, use `ai-workflow init --brief <file>` or `ai-workflow onboard <file>` to normalize the brief before generating epics.
5. Use `lean-ctx` for compact context handling.
6. If `lean-ctx` is missing, surface install/setup guidance instead of silently degrading.

## Common Commands

- `ai-workflow sync`
- `ai-workflow doctor`
- `ai-workflow project summary`
- `ai-workflow project epic list`
- `ai-workflow project epic show <epic-id>`
- `ai-workflow project story search <text>`
- `ai-workflow init --brief <file>`
- `ai-workflow onboard <brief-file>`
- `ai-workflow project ticket create --id <id> --title <title> --lane <lane> --epic <epic-id>`
- `ai-workflow route <task-class>`
- `ai-workflow run <codelet>`
- `ai-workflow shell`

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
