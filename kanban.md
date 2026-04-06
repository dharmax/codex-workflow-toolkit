---
kanban-plugin: board
---

# Kanban

_Generated from the workflow DB. Edit through `ai-workflow project ...` or `ai-workflow sync`._
_Core lanes are fixed. Rare lanes only render when they contain cards. `Archived` history lives in `kanban-archive.md`._

## Deep Backlog

- No items

## Backlog

- No items

## ToDo
<!-- canonical alias: ## Todo -->

- No items

## Bugs P1

- No items

## Bugs P2/P3

- [ ] BUG-SHELL-AI-LATENCY-01 Bound local shell planner latency and fallback
  - Summary: Live Ollama shell-planning can stall for 25-45s+ on bounded JSON planning prompts even after prompt trimming; add a reliable planner timeout/abort path, lighter planner protocol, or fallback strategy so heavy local prompts complete or fail over quickly.
  - State: open
- [ ] BUG-SHELL-CONCURRENCY-01 Prevent concurrent shell/db lock failures
  - Summary: Concurrent shell and dogfood runs can still hit SQLite ; add serialization, retry/backoff, or a read-only fast path so parallel shell starts do not fail under normal operator use.
  - State: open

## In Progress

- [ ] TOOL-DF-001 Implement tool-first dogfooding enforcement
  - Summary: Add dogfood command/report, enforce operator-surface dogfooding in audits and project templates, and prove the shell/tool paths through ai-workflow itself.
  - State: open

## Human Inspection

- No items

## Suggestions

- No items

## Done

- [ ] TOOL-DF-002 Harden full AI shell dogfooding and progress reporting ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06
  - Summary: Add a full-profile shell dogfood scenario that exercises live AI planning without hanging silently, and expose provider/model progress while non-interactive shell work is in flight.
  - State: archived
- [ ] BUG-SHELL-FASTPATH-01 Make smart-status shell reads truly fast-path ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06
  - Summary: Read-only prompts like  still pay refresh/sync/context overhead in no-AI mode because they depend on smart status; move these lookups onto a lightweight deterministic path without planner refresh.
  - State: archived

%% kanban:settings
```
{"kanban-plugin":"board"}
```
%%
