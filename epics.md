# Epics

_Generated from the workflow DB._

## EPIC-009 AI-judged artifact verification

### Goal

Add rubric-driven AI evaluation for fuzzy artifacts such as generated code, documents, and visual outputs while keeping hard verification authoritative.

### Status

- [ ] Active
<!-- status: open -->

### User stories
#### Story 1

**As a maintainer**, I can judge fuzzy artifacts against a concrete rubric instead of pretending exact diffs are always enough.

#### Story 2

**As a reviewer**, I can see pass/fail/needs-human-review outcomes for soft artifacts.

#### Story 3

**As a project owner**, I can apply the same judge to docs, generated code, and screenshots.

### Ticket batches
- Rubric schema, judge codelet, and prompt contract
- Artifact verdict integration and human-review fallback

### Kanban tickets
- ART-002 Integrate judged artifacts into verification summaries [Deep Backlog] | Story: As a reviewer, I can see AI judgments alongside hard verification so fuzzy outputs are handled explicitly.
- ART-001 Build a rubric-driven artifact judge codelet [Deep Backlog] | Story: As a maintainer, I can ask the workflow to judge a generated artifact against a rubric and get a structured verdict.
