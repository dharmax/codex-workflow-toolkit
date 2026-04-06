---
kanban-plugin: board
---

# Kanban

_Generated from the workflow DB. Edit through `ai-workflow project ...` or `ai-workflow sync`._
_Core lanes are fixed. Rare lanes only render when they contain cards. `Archived` history lives in `kanban-archive.md`._

## Deep Backlog

- [ ] ART-002 Integrate judged artifacts into verification summaries
  - Summary: Surface AI artifact judgments in verification and readiness flows without replacing deterministic checks.
  - Story: As a reviewer, I can see AI judgments alongside hard verification so fuzzy outputs are handled explicitly.
  - Epic: EPIC-009
  - Parent: EPIC-009
  - State: open
- [ ] ART-001 Build a rubric-driven artifact judge codelet
  - Summary: Implement an AI codelet that scores fuzzy artifacts against an explicit rubric and returns pass, fail, or needs_human_review.
  - Story: As a maintainer, I can ask the workflow to judge a generated artifact against a rubric and get a structured verdict.
  - Epic: EPIC-009
  - Parent: EPIC-009
  - State: open

## Backlog

- No items

## ToDo
<!-- canonical alias: ## Todo -->

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

- [ ] SHELL-001 Local-first shell planner routing ✅ 2026-04-04 ✅ 2026-04-05 ✅ 2026-04-06 ✅ 2026-04-06
  - Summary: Use the live model-fit matrix for shell planning, cache Ollama discovery across turns, and cover the refresh and routing policy with regression tests.
  - Epic: EPC-008
  - Parent: EPC-008
  - State: archived
- [ ] EXE-013 JS-to-JS execution path and runner cleanup ✅ 2026-04-04 ✅ 2026-04-04 ✅ 2026-04-05 ✅ 2026-04-06 ✅ 2026-04-06
  - Summary: Shift internal smart-codelet execution to in-process service calls, remove hard-coded branching from the runner, and clean up Codex-era naming and wrappers.
  - Epic: EPC-007
  - Parent: EPC-007
  - State: archived
- [ ] EXE-014 Tests and projection updates for smart-codelet runtime split ✅ 2026-04-04 ✅ 2026-04-04 ✅ 2026-04-05 ✅ 2026-04-06 ✅ 2026-04-06
  - Summary: Add focused tests for registry caching, helper-assisted execution, and workflow projection updates so the runtime split stays stable.
  - Epic: EPC-007
  - Parent: EPC-007
  - State: archived
- [ ] EXE-011 Registry-driven smart codelet resolution and cache ✅ 2026-04-04 ✅ 2026-04-04 ✅ 2026-04-05 ✅ 2026-04-06 ✅ 2026-04-06
  - Summary: Move smart-codelet identity and lookup into the core registry path, cache codelet metadata in-process, and remove the hard-coded catalog from the runner.
  - Epic: EPC-007
  - Parent: EPC-007
  - State: archived
- [ ] EXE-012 Shared smart-codelet runtime helper and lean-ctx context packing ✅ 2026-04-04 ✅ 2026-04-04 ✅ 2026-04-05 ✅ 2026-04-06 ✅ 2026-04-06
  - Summary: Introduce a reusable runtime/helper layer that builds structured run context, uses lean-ctx where relevant, and keeps prompt payloads compact.
  - Epic: EPC-007
  - Parent: EPC-007
  - State: archived

%% kanban:settings
```
{"kanban-plugin":"board"}
```
%%
