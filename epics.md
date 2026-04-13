# Epics

_Generated from the workflow DB._

## EPIC-SHELL-CANONICAL-001 EPIC-SHELL-CANONICAL-001

### Goal

Pending natural-language scope.

### Status

- [ ] Active
<!-- status: open -->

### User stories
#### Story 1

None captured yet.

### Ticket batches
- None captured yet.

### Kanban tickets
- TKT-SHELL-CANONICAL-004 Add verified-fix finalization with ticket resolve/reopen lifecycle ✅ 2026-04-11 [Done]
- TKT-SHELL-CANONICAL-003 Migrate shell planning, fallback, and recovery onto the shared operator backend [Todo]
- TKT-SHELL-CANONICAL-005 Add live comparative benchmark and transcript gate for shell superiority [Todo]
- TKT-SHELL-CANONICAL-002 Migrate ask and host surfaces onto the shared operator backend [Todo]
- TKT-SHELL-CANONICAL-001 Build a shared operator-brain backend for natural-language workflow handling [Todo]

## EPIC-SHELL-JS-ORCHESTRATOR EPIC-SHELL-JS-ORCHESTRATOR

### Goal

Transition the `ai-workflow` Shell from a sequential JSON command parser to a Sandboxed JS Orchestrator. The LLM will generate an async JavaScript function with CLI codelets injected into its scope. This unlocks native control flow, dynamic data transformation, and leverages the LLM's inherent strength in writing async logic.

### Status

- [ ] Active
<!-- status: open -->

### User stories
#### Story 1

As a user, I want to give conditional instructions (e.g. "Run tests, if they fail, pass the error string to the fix routine") and have the shell execute them natively.
As a user, I want the shell to manipulate data between commands seamlessly using standard JS functions (e.g., `filter`, `map`).
As a developer, I want to inject the `ai-workflow` API securely into a runtime context without exposing the host OS to LLM hallucinations.
As a user, I want to review and approve the generated JS code before it runs, just like I can review a plan.

### Ticket batches
- None captured yet.

### Kanban tickets
- TKT-SHELL-JS-001 Spike: Evaluate Function constructor and vm scoping for JS Orchestrator [Todo]
