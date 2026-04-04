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

- No items

## Bugs P1

- No items

## Bugs P2/P3

- No items

## In Progress

- No items

## Human Inspection

- No items

## Suggestions

- No items

## Done

- [ ] EXE-005 Lean-ctx detection and context compression ✅ 2026-04-04 ✅ 2026-04-04
  - Summary: Add lean-ctx probing, install/setup guidance, and prompt-pack awareness so context-heavy work fails loudly when the dependency is missing.
  - Parent: EPC-001
  - State: archived
- [ ] EXE-010 Remote builtin knowledge refresh from configured source ✅ 2026-04-04 ✅ 2026-04-04
  - Summary: Fetch builtin knowledge.json from a configured remote URL and persist it safely.
  - State: archived
- [ ] EXE-004 Refresh live projections after every workflow mutation ✅ 2026-04-04 ✅ 2026-04-04
  - Summary: Move active tickets to In Progress before execution and refresh kanban/epics immediately after each DB mutation.
  - Parent: EPC-005
  - State: archived
- [ ] EXE-006 Complete semantic graph, registry sync, and projection hardening ✅ 2026-04-04 ✅ 2026-04-04
  - Summary: Close the semantic registry and projection backlog once the DB-backed graph is search-friendly and stable.
  - Parent: EPC-002
  - State: archived
- [ ] EXE-007 Complete smart provider routing and Ollama policy ✅ 2026-04-04 ✅ 2026-04-04
  - Summary: Close the provider-routing backlog once local-first routing, diagnostics, and lean-ctx compression are in place.
  - Parent: EPC-003
  - State: archived
- [ ] EXE-008 Complete safe execution, patching, and git transactions ✅ 2026-04-04 ✅ 2026-04-04
  - Summary: Close the safe-mutation backlog once bounded execution, patching, and git cleanup are consistently enforced.
  - Parent: EPC-004
  - State: archived
- [ ] EXE-009 Complete smart codelet catalog and observer loop ✅ 2026-04-04 ✅ 2026-04-04
  - Summary: Close the smart-codelet backlog once the built-in catalog, observer loop, and dev-mode documentation are wired up.
  - Parent: EPC-006
  - State: archived

%% kanban:settings
```
{"kanban-plugin":"board"}
```
%%
