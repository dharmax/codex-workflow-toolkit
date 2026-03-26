# Kanban

Keep tickets small, concrete, verifiable, updated in real time, and compatible with the Obsidian Kanban plugin.
Use one task card per ticket under the lane heading.

Ticket body fields:

- `Outcome`: concrete result.
- `Scope`: files or subsystems expected to change.
- `Verification`: commands or checks required for completion.
- `Notes`: blockers, assumptions, or handoff details.
- `Epic`: required for `Deep Backlog` tickets and should match an epic in `epics.md`.
- Done tickets should use a checked card line with `✅ YYYY-MM-DD`.

Lane order is intentional. Keep the board in this order.

## Deep Backlog

## Backlog

- [ ] TKT-001 Replace this example ticket
  - Outcome: State the concrete result.
  - Scope: Name the files or subsystems expected to change.
  - Verification: List the commands or checks required for completion.
  - Notes: Capture blockers, assumptions, or handoff details.

## ToDo

## Bugs P1
* look at the following session. analyze what's wrong with it. think what should be the correct correspondence. see how you make it happen. generate work tickets. execute. test.
  pnpm exec ai-workflow shell
  ai-workflow shell
  planner: ollama:dolphin-mistral:latest @ http://lotus:11434 (competency 3/5 for strategy, local-first candidate, low cost tier)
  Type 'help' for examples. Type 'exit' to quit.

ai-workflow> what's the status of the project?
Planned actions:
1. ai-workflow sync [mutates state]
2. ai-workflow project summary
   Run mutating actions? [y/N] y
   planner: ollama:dolphin-mistral:latest @ http://lotus:11434 (competency 3/5 for strategy, local-first candidate, low cost tier)
1. ai-workflow sync [mutates state]
2. ai-workflow project summary
   Planners updated: planner: ollama:dolphin-mistral:latest @ http://lotus:11434 (competency 3/5 for strategy, local-first candidate, low cost tier)

Strategy: Perform a sync operation to ensure the latest data is available, then generate a project summary.


> ai-workflow sync
DB: /home/dharmax/work/adventure-machine2/.ai-workflow/state/workflow.db
Indexed files: 963
Symbols: 16056
Claims: 23200
Notes: 7
Imported tickets: 0
Reviewed candidates: 0

> ai-workflow project summary
Files indexed: 963
Symbols indexed: 16056
Notes tracked: 7
Tickets: 2
Candidates: 2
ai-workflow> can you tell me about the tickets? what's inside them exactly?
planner: ollama:dolphin-mistral:latest @ http://lotus:11434 (competency 3/5 for strategy, local-first candidate, low cost tier)
Strategy: Perform a sync operation to ensure the latest data is available, then extract both active tickets.

The project currently has two active tickets: TKT-001 and TKT-002. Let me provide you with more details on each ticket.
ai-workflow> go ahead
planner: ollama:dolphin-mistral:latest @ http://lotus:11434 (competency 3/5 for strategy, local-first candidate, low cost tier)
Strategy: Perform a local sync to ensure up-to-date information, then extract the details of the two active tickets for review.

I understood your strategy: "Perform a local sync to ensure up-to-date information, then extract the details of the two active tickets for review.", but I couldn't map it to CLI actions. Try being more specific or using a different command.
ai-workflow> show active tickets
planner: ollama:dolphin-mistral:latest @ http://lotus:11434 (competency 3/5 for strategy, local-first candidate, low cost tier)
Strategy: The long-term plan or next steps for the developer

Please wait while I perform a local sync and extract the details of the two active tickets. This will ensure we have up-to-date information and can provide you with a comprehensive overview.
ai-workflow>

----
## Bugs P2/P3

## In Progress

## Human Inspection

## Suggestions

## Done

- [x] TKT-000 Example completed ticket ✅ 2026-03-23
  - Outcome: Show the required done-card format.
  - Scope: Example only.
  - Verification: None.
  - Notes: Move entries older than roughly seven days into `kanban-archive.md`.

%% kanban:settings
```json
{"kanban-plugin":"board"}
```
%%
