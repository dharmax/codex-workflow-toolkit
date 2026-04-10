# Epics

_Generated from the workflow DB._

## EPIC-RAG-001 Workflow retrieval hardening and cost control

### Goal

Improve workflow retrieval and context selection so shell-facing ticket work pulls higher-signal implementation evidence at lower token cost, with honest fallback/confidence behavior under weak evidence.

### Status

- [x] Archived
<!-- status: archived -->

### User stories
#### Story 1

**As an operator**, I can ask for ticket help and get implementation-first evidence instead of test floods or weak lexical noise.

#### Story 2

**As a maintainer**, I can trust retrieval confidence and fallback stage to reflect actual evidence quality instead of result count.

#### Story 3

**As a maintainer**, I can evolve retrieval safely because regression tests lock ranking, context packing, and working-set behavior.

### Ticket batches
- Rebalance retrieval ranking toward implementation evidence.
- Make retrieval fallback and confidence honest under weak evidence.
- Add regression coverage for retrieval, context packing, and working sets.

### Kanban tickets
- TKT-RAG-003 Make retrieval fallback and confidence honest under weak evidence ✅ 2026-04-10 [Done]
- TKT-RAG-004 Add regression coverage for retrieval, context packing, and working sets ✅ 2026-04-10 [Done]
- TKT-RAG-002 Rebalance retrieval ranking toward implementation evidence ✅ 2026-04-10 [Done]
- TKT-RAG-001 Make workflow retrieval more efficient, robust, and smart ✅ 2026-04-10 [Done]
