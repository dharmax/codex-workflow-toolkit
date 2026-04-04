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

- [ ] EXE-011 Registry-driven smart codelet resolution and cache ✅ 2026-04-04
  - Summary: Move smart-codelet identity and lookup into the core registry path, cache codelet metadata in-process, and remove the hard-coded catalog from the runner.
  - Parent: EPC-007
  - State: archived
- [ ] EXE-012 Shared smart-codelet runtime helper and lean-ctx context packing ✅ 2026-04-04
  - Summary: Introduce a reusable runtime/helper layer that builds structured run context, uses lean-ctx where relevant, and keeps prompt payloads compact.
  - Parent: EPC-007
  - State: archived
- [ ] EXE-013 JS-to-JS execution path and runner cleanup ✅ 2026-04-04
  - Summary: Shift internal smart-codelet execution to in-process service calls, remove hard-coded branching from the runner, and clean up Codex-era naming and wrappers.
  - Parent: EPC-007
  - State: archived
- [ ] EXE-014 Tests and projection updates for smart-codelet runtime split ✅ 2026-04-04
  - Summary: Add focused tests for registry caching, helper-assisted execution, and workflow projection updates so the runtime split stays stable.
  - Parent: EPC-007
  - State: archived

%% kanban:settings
```
{"kanban-plugin":"board"}
```
%%
