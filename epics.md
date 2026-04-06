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

## EPIC-010 Telegram remote-control

### Goal

Build a Telegram-driven remote-control layer that lets trusted operators inspect status, trigger safe actions, and roll out mutating capabilities in phases with explicit confirmation, traceability, and rollback controls.

### Status

- [ ] Active
<!-- status: open -->

### User stories
#### Story 1

**As an operator**, I can pair a Telegram identity with the project so commands are only accepted from trusted senders.

#### Story 2

**As an operator**, I can ask for project status and current work from Telegram without leaving the chat.

#### Story 3

**As an operator**, I can request mutating actions through staged approvals and dry-runs before anything changes.

#### Story 4

**As an operator**, I can see trace output, audit history, and the selected AI model for each command.

#### Story 5

**As an operator**, I can gradually enable new control surfaces and disable them quickly if something misbehaves.

### Ticket batches
- Phase 1: Telegram identity, pairing, and trust boundaries.
- Phase 2: Read-only command routing and status responses.
- Phase 3: Mutating commands with explicit approval, dry-run, and confirmation.
- Phase 4: Trace logging, audit trail, safety checks, and rollback controls.
- Phase 5: Operator UX, rollout guardrails, and polish.

### Kanban tickets
- TKT-TELEGRAM-001 Pair Telegram identity and trust gate [Todo] | Story: As an operator, I can pair a Telegram identity with the project so remote commands are only accepted from trusted senders.
- TKT-TELEGRAM-005 Add rollout controls and kill switch [Todo] | Story: As an operator, I can gradually enable new control surfaces and disable them quickly if something misbehaves.
- TKT-TELEGRAM-003 Gate mutating Telegram commands with approval [Todo] | Story: As an operator, I can request mutating actions through staged approvals and dry-runs before anything changes.
- TKT-TELEGRAM-004 Expose traces and audit history for remote actions [Todo] | Story: As an operator, I can see trace output, audit history, and the selected AI model for each command.
- TKT-TELEGRAM-002 Route read-only Telegram commands [Todo] | Story: As an operator, I can ask for project status and current work from Telegram without leaving the chat.
