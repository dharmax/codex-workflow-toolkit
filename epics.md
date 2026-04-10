# Epics

_Generated from the workflow DB._

## EPIC-DOCS-001 Semantic manual and shell guidance integration

### Goal

Build a complete canonical manual, generate a semantic HTML companion from code, and make shell guidance consume the manual as a first-class operational source without outranking live workflow state.

### Status

- [x] Archived
<!-- status: archived -->

### User stories
#### Story 1

**As an operator**, I can read one complete manual with setup, commands, examples, patterns, and configuration in a format that is simple to scan.

#### Story 2

**As a maintainer**, I can update one canonical manual and regenerate a semantic HTML version deterministically from code.

#### Story 3

As shell guidance, I can use the manual as a first-class source for command and configuration behavior without losing ticket-aware prioritization.

### Ticket batches
- Rewrite the canonical manual into a complete operator and developer reference.
- Generate semantic HTML from the canonical manual via a Node utility and npm script.
- Integrate the manual into shell and guidance summarization and enforce freshness in audit/tests.

### Kanban tickets
- TKT-DOCS-001 Rewrite the canonical manual into a complete operator and developer reference ✅ 2026-04-10 ✅ 2026-04-10 [Done]
- TKT-DOCS-002 Generate semantic HTML from the canonical manual ✅ 2026-04-10 ✅ 2026-04-10 [Done]
- TKT-DOCS-003 Make shell guidance consume the manual as a first-class source ✅ 2026-04-10 ✅ 2026-04-10 [Done]
- TKT-DOCS-004 Enforce manual and HTML freshness in audit and tests ✅ 2026-04-10 ✅ 2026-04-10 [Done]

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
- TKT-RAG-003 Make retrieval fallback and confidence honest under weak evidence ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 [Done]
- TKT-RAG-004 Add regression coverage for retrieval, context packing, and working sets ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 [Done]
- TKT-RAG-001 Make workflow retrieval more efficient, robust, and smart ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 [Done]
- TKT-RAG-002 Rebalance retrieval ranking toward implementation evidence ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 [Done]
