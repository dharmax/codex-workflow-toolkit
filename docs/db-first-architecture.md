# DB-First Workflow Architecture

## Revised Summary

This toolkit is now split into six practical layers:

1. `core/db`
   - SQLite-backed source of truth for files, symbols, claims, notes, candidates, entities, events, and search documents.
   - Facts, inferences, and proposals are explicit rows, not implied by markdown.

2. `core/parsers`
   - Deterministic indexing for JS/TS/JSM/JSX/TSX, Riot, CSS/SCSS/LESS, HTML, JSON, YAML, and Markdown.
   - Comments and tagged notes are extracted locally before any AI routing is considered.

3. `core/services`
   - Sync/index pipeline, candidate lifecycle review, project summaries, projection rendering, provider discovery, model routing, and Telegram preview formatting.

4. `cli`
   - Thin command surface over the core.
   - Project mutation goes through DB-aware commands such as `sync`, `project ticket create`, `project note add`, `project search`, `route`, and `telegram preview`.

5. `shared/codelets` and `runtime/scripts`
   - Reusable built-in codelets remain thin wrappers.
   - The codelet registry still supports project-local overrides under `.ai-workflow/codelets`.

6. `skills` and integrations
   - Agent adapters stay thin.
   - Telegram is prepared as a control/notification surface, not an overprivileged automation layer.

## Responsibility Split

- Skill adapters:
  - Tell an agent which CLI/core surfaces to use.
  - Do not own project memory or hidden automation.

- CLI:
  - Owns user-invoked actions, DB sync, local projections, config, install, and routing queries.
  - Can recommend session hygiene but cannot control remote agent history.

- Core:
  - Owns the DB schema, query/index logic, lifecycle review, deterministic parsing, and provider routing policy.

- Optional wrappers:
  - May schedule periodic sync/review work, push Telegram notifications, or orchestrate multi-agent sessions.
  - Are not required for the core system to function.

- Human operator:
  - Approves real work, reviews candidate tickets, configures providers, and decides what actions remain safe to expose externally.

## Proposed Tree

```text
.
├── cli/
│   └── lib/
├── core/
│   ├── db/
│   ├── lib/
│   ├── parsers/
│   └── services/
├── docs/
├── runtime/
│   └── scripts/
│       ├── ai-workflow/
│       └── codex-workflow/
├── shared/
│   └── codelets/
├── skills/
├── tests/
│   └── fixtures/
└── templates/
```

Project-local layout after install/sync:

```text
project/
├── .codex/skills -> central toolkit
├── .claude/skills -> central toolkit
├── .gemini/skills -> central toolkit
└── .ai-workflow/
    ├── cache/
    ├── codelets/
    ├── config.json
    ├── generated/
    ├── notes/
    └── state/
        └── workflow.db
```

## Phased Plan

### Phase 1

- DB-backed local store
- Deterministic repo sync/indexing
- Note and candidate lifecycle basics
- Projection rendering
- Provider discovery and routing
- Telegram preview formatter

### Phase 2

- Better language parsers for deeper symbol/call graphs
- Scheduled candidate review jobs
- More complete provider policy tuning
- richer note/comment staging flows

### Phase 3

- Telegram action gating
- Web UI on the same query/event model
- Optional orchestrator/wrapper processes

## Current Caveats

- Parsing is intentionally deterministic and lightweight; it is not yet AST-perfect for every supported language.
- Markdown kanban/epics are still useful views and bootstrap import sources, but the intended authority is the SQLite DB.
- Telegram integration is formatter/parser architecture only in this pass, not a production bot runner.
- Provider routing is policy-based and config-aware; it does not yet benchmark models dynamically.
