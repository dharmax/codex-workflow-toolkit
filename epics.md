# Epics

_Generated from the workflow DB._

## EPIC-GOE-001 Add governed operator execution loops

### Goal

Define a default-on governed execution flow that uses a suggester, critic, and auditor or escalator loop to improve planning and coding quality, especially for weaker or cheaper models.

### Status

- [x] Archived
<!-- status: archived -->

### User stories
#### Story 1

**As an operator**, I can rely on a bounded debate loop to improve plans and code before the system claims a result is good enough.

#### Story 2

**As a host integration**, I can inspect GoE verdicts, escalations, and overrides through the shared workflow surfaces.

### Ticket batches
- Plan the fixed v1 triad and iteration rules.
- Plan default-on enablement and override behavior.
- Plan GoE coverage for shell interpretation, planning, and most coding or debugging work.

### Kanban tickets
- TKT-GOE-005 Plan GoE escalation outcomes and human handoff [Done]
- TKT-GOE-004 Plan GoE on shell interpretation and produced code [Done]
- TKT-GOE-003 Plan GoE coverage for coding and debugging work [Done]
- TKT-GOE-002 Plan default-on GoE policy and overrides [Done]
- TKT-GOE-001 Plan fixed v1 GoE triad and iteration contract [Done]

## EPIC-SETTINGS-001 AI Provider Settings & Configuration Flow

### Goal

Pending natural-language scope.

### Status

- [x] Archived
<!-- status: archived -->

### User stories
#### Story 1

None captured yet.

### Ticket batches
- None captured yet.

### Kanban tickets
- none linked yet

## EPIC-SHELL-MODES-001 Add explicit shell work modes and switching policy

### Goal

Pending natural-language scope.

### Status

- [x] Archived
<!-- status: archived -->

### User stories
#### Story 1

**As an operator**, I can see what kind of work the shell thinks it is doing and override that choice with an explicit mode command.

#### Story 2

**As a workflow auditor**, I can inspect why a mode was selected, when it changed, and what execution policy it implied.

### Ticket batches
- Plan the canonical shell work-mode model and UX.
- Plan automatic mode inference and manual override behavior.
- Plan mode-aware routing, execution policy, and transcript visibility.

### Kanban tickets
- TKT-SHELL-MODES-004 Plan shell mode visibility in DB and transcripts [Done]
- TKT-SHELL-MODES-003 Plan mode-aware routing and execution policy [Done]
- TKT-SHELL-MODES-002 Plan shell mode inference and override UX [Done]
- TKT-SHELL-MODES-001 Plan canonical shell work-mode model [Done]

## EPIC-WORKFLOW-INTEGRITY-001 Repair workflow entity and projection integrity

### Goal

Make workflow state trustworthy and complete enough that the shell and every host surface can reason from one shared view of capabilities, project structure, active problems, and current plans.

### Status

- [x] Archived
<!-- status: archived -->

### User stories
#### Story 1

**As an operator**, I can trust `epics.md`, `kanban.md`, and the workflow DB to represent the same epics, tickets, features, modules, problems, and plans.

#### Story 2

**As a host integration**, I can consume shared workflow metadata instead of rebuilding project memory outside the core.

#### Story 3

**As a shell operator**, I can ask what the system can do here, how it knows that, and how to improve it, with answers grounded in built-in tools, configured extensions, and live project state.

### Ticket batches
- Repair epic and projection integrity before adding new planning work.
- Define feature, module, and host-surface representation requirements in the DB.
- Plan shared shell and plugin or MCP integration hooks around one judgment core.
- Plan capability intelligence and project situational awareness on top of the shared workflow core.

### Kanban tickets
- TKT-WORKFLOW-INTEGRITY-003 Plan shared governance hooks for shell and host integrations [Done]
- TKT-WORKFLOW-INTEGRITY-004 Plan shell capability intelligence and project situational awareness [Done]
- TKT-WORKFLOW-INTEGRITY-002 Plan DB coverage for features modules and host surfaces [Done]
- TKT-WORKFLOW-INTEGRITY-001 Plan epic and projection integrity repair [Done]
