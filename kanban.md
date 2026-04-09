---
kanban-plugin: board
---

# Kanban

_Generated from the workflow DB. Edit through `ai-workflow project ...` or `ai-workflow sync`._
_Core lanes are fixed. Rare lanes only render when they contain cards. `Archived` history lives in `kanban-archive.md`._

## Deep Backlog

- No items

## Backlog

- [ ] TKT-RAG-001 Make workflow retrieval more efficient, robust, and smart
  - Summary: Improve retrieval and context selection so ai-workflow returns higher-signal evidence with lower token cost, better ranking, and safer fallback behavior when indexed or semantic evidence is weak.
  - State: open

## ToDo
<!-- canonical alias: ## Todo -->

- [ ] TKT-TELEGRAM-001 Pair Telegram identity and trust gate
  - Summary: Authorize a Telegram sender, persist the trust binding, and reject unknown chat commands.
  - Epic: EPIC-010
  - Parent: EPIC-010
  - State: open
- [ ] TKT-TELEGRAM-005 Add rollout controls and kill switch
  - Summary: Add feature flags, scope controls, and a fast disable path so remote control can be rolled out safely.
  - Epic: EPIC-010
  - Parent: EPIC-010
  - State: open
- [ ] TKT-TELEGRAM-002 Route read-only Telegram commands
  - Summary: Support status, summary, and current-work queries from Telegram without mutating state.
  - Epic: EPIC-010
  - Parent: EPIC-010
  - State: open
- [ ] TKT-TELEGRAM-004 Expose traces and audit history for remote actions
  - Summary: Show the selected model, the prompt path, and audit records for each Telegram remote-control request.
  - Epic: EPIC-010
  - Parent: EPIC-010
  - State: open
- [ ] TKT-TELEGRAM-003 Gate mutating Telegram commands with approval
  - Summary: Require explicit approval, dry-run, and confirmation before a Telegram command changes project state.
  - Epic: EPIC-010
  - Parent: EPIC-010
  - State: open

## Bugs P1

- No items

## Bugs P2/P3

- [ ] BUG-METRICS-001 Separate mock traffic and surface failing real-model metrics
  - Summary: The metrics view currently reports strong help-vs-baseline savings even when the latest real shell-planning runs are 0% success and ~20s latency, because mock-model traffic and zero-token local calls dominate the aggregate. Split mock versus real-provider traffic, call out failing real-model windows, and make the quality/help score reflect degraded results instead of optimistic blended averages.
  - State: open
- [ ] BUG-EPIC-PROJECTION-01 Preserve manual epic edits before projection rewrite
  - Summary: Projection rewrites can still delete manually edited epics if the DB has not imported the narrative yet; always reconcile epics.md and kanban.md drift before any projection write.
  - State: open

## In Progress

- [ ] TKT-METRICS-001 Add help-vs-baseline metrics command
  - Summary: Expose high-level cost and quality metrics that estimate how much ai-workflow helped versus not using it, sliced by session, last 4 real work hours, and trailing week.
  - State: open

## Human Inspection

- No items

## Suggestions

- No items

## Done

- [ ] BUG-SHELL-AI-LATENCY-01 Bound local shell planner latency and fallback ✅ 2026-04-07 ✅ 2026-04-07
  - Summary: Live Ollama shell-planning can stall for 25-45s+ on bounded JSON planning prompts even after prompt trimming; add a reliable planner timeout/abort path, lighter planner protocol, or fallback strategy so heavy local prompts complete or fail over quickly.
  - State: archived
- [ ] TOOL-DF-001 Implement tool-first dogfooding enforcement ✅ 2026-04-07 ✅ 2026-04-07 ✅ 2026-04-07 ✅ 2026-04-07
  - Summary: Add dogfood command/report, enforce operator-surface dogfooding in audits and project templates, and prove the shell/tool paths through ai-workflow itself.
  - State: archived
- [ ] TOOL-DF-002 Harden full AI shell dogfooding and progress reporting ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-07 ✅ 2026-04-07 ✅ 2026-04-07
  - Summary: Add a full-profile shell dogfood scenario that exercises live AI planning without hanging silently, and expose provider/model progress while non-interactive shell work is in flight.
  - State: archived
- [ ] BUG-SHELL-CONCURRENCY-01 Prevent concurrent shell/db lock failures ✅ 2026-04-07 ✅ 2026-04-07 ✅ 2026-04-07
  - Summary: Concurrent shell and dogfood runs can still hit SQLite ; add serialization, retry/backoff, or a read-only fast path so parallel shell starts do not fail under normal operator use.
  - State: archived
- [ ] BUG-SHELL-FASTPATH-01 Make smart-status shell reads truly fast-path ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-07 ✅ 2026-04-07 ✅ 2026-04-07
  - Summary: Read-only prompts like  still pay refresh/sync/context overhead in no-AI mode because they depend on smart status; move these lookups onto a lightweight deterministic path without planner refresh.
  - State: archived

%% kanban:settings
```
{"kanban-plugin":"board"}
```
%%
