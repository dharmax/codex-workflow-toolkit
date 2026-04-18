# DB-First Architecture

`ai-workflow` treats the local SQLite workflow DB as the source of truth for project memory.

## Stored State

- Files, symbols, claims, notes, and metrics
- Epics, tickets, modules, and features
- Architectural edges and durable workflow knowledge

## Projections

- `epics.md` and `kanban.md` are rendered from the DB
- Direct file edits are allowed, but they are reconciled back into the DB
- `sync` and projection writes must keep the DB and markdown views aligned

## Context Efficiency

- `lean-ctx` is the compression layer for surgical context handling
- The context packer should emit compact worksets before routing AI calls
- Provider routing should know whether lean-ctx is available

## Surfaces

- CLI and shell
- Skill / MCP / plugin surfaces
- Future host adapters

All surfaces share the same DB-backed judgment core. They should not rebuild their own project-memory model.

## Capability Intelligence

The canonical planning note for capability-aware workflow integrity lives in [docs/workflow-integrity-capability-model.md](./workflow-integrity-capability-model.md).
