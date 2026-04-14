---

kanban-plugin: board

---

## Kanban



## Deep Backlog

- [ ] No items


## Backlog

- [ ] No items


## ToDo

- [ ] TKT-SETTINGS-001 Add separate tabs for local and paid providers in AI settings
	  - Epic: EPIC-SETTINGS-001
	  - Parent: EPIC-SETTINGS-001
	  - State: open
- [ ] EPIC-SETTINGS-001 AI Provider Settings & Configuration Flow
	  - Epic: true
	  - Parent: true
	  - State: open
- [ ] TKT-TELEGRAM-001 Pair Telegram identity and trust gate
	  - Summary: Authorize a Telegram sender, persist the trust binding, and reject unknown chat commands.
	  - Epic: EPIC-010
	  - Parent: EPIC-010
	  - State: open
- [ ] TKT-TELEGRAM-002 Route read-only Telegram commands
	  - Summary: Support status, summary, and current-work queries from Telegram without mutating state.
	  - Epic: EPIC-010
	  - Parent: EPIC-010
	  - State: open
- [ ] TKT-TELEGRAM-005 Add rollout controls and kill switch
	  - Summary: Add feature flags, scope controls, and a fast disable path so remote control can be rolled out safely.
	  - Epic: EPIC-010
	  - Parent: EPIC-010
	  - State: open
- [ ] TKT-TELEGRAM-004 Expose traces and audit history for remote actions
	  - Summary: Show the selected model, the prompt path, and audit records for each Telegram remote-control request.
	  - Epic: EPIC-010
	  - Parent: EPIC-010
	  - State: open
- [ ] TKT-TELEGRAM-003 Gate mutating Telegram commands with approval
	  - Summary: Require explicit approval, dry-run, and confirmation before a Telegram command changes project state.
	  - Epic: EPIC-010
	  - Parent: EPIC-010
	  - State: open


## Bugs P1

- [ ] No items


## Bugs P2/P3

- [ ] No items


## In Progress

- [ ] No items


## Human Inspection

- [ ] No items


## Suggestions

- [ ] No items


## Done

- [ ] TKT-RESILIENCE-001 Improve JSON parsing and provider JSON modes ✅ 2026-04-14
	  - State: archived
- [ ] TKT-HOOKS-004 Expose hook configuration in CLI settings ✅ 2026-04-14
	  - Epic: EPIC-SETTINGS-001
	  - Parent: EPIC-SETTINGS-001
	  - State: archived
- [ ] TKT-HOOKS-003 Integrate hooks into JS Orchestrator (Action phase) ✅ 2026-04-14
	  - Epic: EPIC-SETTINGS-001
	  - Parent: EPIC-SETTINGS-001
	  - State: archived
- [ ] TKT-HOOKS-002 Integrate hooks into Operator Brain (Plan phase) ✅ 2026-04-14
	  - Epic: EPIC-SETTINGS-001
	  - Parent: EPIC-SETTINGS-001
	  - State: archived
- [ ] TKT-HOOKS-001 Implement core hook-runner service ✅ 2026-04-14
	  - Epic: EPIC-SETTINGS-001
	  - Parent: EPIC-SETTINGS-001
	  - State: archived
- [ ] BUG-WORKFLOW-INTEGRITY-004 Add transcript-level tests that require workflow-state integrity after shell fixes ✅ 2026-04-13
	  - Summary: Regression tests should fail if a shell fix changes behavior but leaves the operator-visible workflow state inconsistent, such as open bug tickets remaining the reported next work after verification.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-077 Handle imperative branch-and-start-work requests without status-query collapse ✅ 2026-04-13
	  - Summary: Imperative requests like 'on a new branch, start working on the Telegram epic and tickets in the right order' should become a staged execution plan, not a bogus epic status lookup; correction retries must not repeat the same failed action or leak concatenated raw errors.
	  - State: archived
- [ ] BUG-WORKFLOW-INTEGRITY-006 Require shell finalization to reconcile implementation results with workflow state ✅ 2026-04-13
	  - Summary: A shell fix loop should not be considered complete until tests, dogfood, audit, and ticket/board reconciliation all agree; the shell needs an explicit finalization step or policy for that.
	  - State: archived
- [ ] BUG-WORKFLOW-INTEGRITY-002 Teach the shell to mark verified bug tickets done after a successful fix loop ✅ 2026-04-13
	  - Summary: When shell-led work ends with passing tests and successful dogfood/audit, the shell should be able to propose or execute ticket closure instead of leaving verified bug tickets active.
	  - State: archived
- [ ] BUG-WORKFLOW-INTEGRITY-001 Add a verified-fix workflow that closes tickets and projects board state ✅ 2026-04-13
	  - Summary: When a shell or CLI fix is implemented and verified, the tool should support a first-class close/resolve flow so operator-facing status no longer reports fixed bugs as open.
	  - State: archived
- [ ] BUG-WORKFLOW-RUNTIME-001 Fix nested Node capture for workflow-audit wrapper output ✅ 2026-04-13
	  - Summary: The workflow-audit CLI emits correct JSON via direct shell invocation, but nested Node child-process capture still returns empty stdout; now that shell finalization uses a shared audit service this is no longer blocking, but the wrapper contract should still be made reliable for tool callers.
	  - State: archived
- [ ] BUG-WORKFLOW-INTEGRITY-007 Fix misleading next-step synthesis when no ticket is actually in progress ✅ 2026-04-13
	  - Summary: Ask/shell summaries should not say Inspect the leading in-progress ticket when the active work is Bugs or Todo only; the next-step synthesis must reflect real lane and state semantics.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-076 Handle evaluative and workplan prompts without wrong-surface fallback ✅ 2026-04-13
	  - State: archived
- [ ] BUG-WORKFLOW-INTEGRITY-005 Add first-class ticket resolve/close commands to the project CLI ✅ 2026-04-13
	  - Summary: The workflow CLI exposes ticket creation but not an equally direct resolve/close path, which makes it too easy to leave verified work active and operator-facing summaries wrong.
	  - State: archived
- [ ] TKT-SHELL-JS-001 Spike: Evaluate Function constructor and vm scoping for JS Orchestrator ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Investigate the best way to scope LLM-generated JS (Function constructor vs vm module), how to review it with comments, and basic state-machine support.
	  - Epic: EPIC-SHELL-JS-ORCHESTRATOR
	  - Parent: EPIC-SHELL-JS-ORCHESTRATOR
	  - State: archived
- [ ] TKT-SHELL-CANONICAL-005 Add live comparative benchmark and transcript gate for shell superiority ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Turn shell quality into a hard benchmark using live shell transcripts, workflow-state invariants, and AI-judged comparison against routed Gemini and OpenAI baselines.
	  - Epic: EPIC-SHELL-CANONICAL-001
	  - Parent: EPIC-SHELL-CANONICAL-001
	  - State: archived
- [ ] TKT-SHELL-CANONICAL-003 Migrate shell planning, fallback, and recovery onto the shared operator backend ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Collapse shell-specific heuristic, AI-planner, fallback, and recovery drift into the shared backend while keeping only a tiny deterministic shell-local fast path.
	  - Epic: EPIC-SHELL-CANONICAL-001
	  - Parent: EPIC-SHELL-CANONICAL-001
	  - State: archived
- [ ] TKT-SHELL-CANONICAL-002 Migrate ask and host surfaces onto the shared operator backend ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Replace host-resolver and ask-specific routing with thin adapters over the shared operator backend so workflow-state, current-work, and readiness answers stay consistent.
	  - Epic: EPIC-SHELL-CANONICAL-001
	  - Parent: EPIC-SHELL-CANONICAL-001
	  - State: archived
- [ ] TKT-SHELL-CANONICAL-001 Build a shared operator-brain backend for natural-language workflow handling ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Create one canonical intent-ground-execute-synthesize backend that all operator surfaces can call, instead of maintaining separate natural-language brains.
	  - Epic: EPIC-SHELL-CANONICAL-001
	  - Parent: EPIC-SHELL-CANONICAL-001
	  - State: archived
- [ ] TKT-SHELL-CANONICAL-004 Add verified-fix finalization with ticket resolve/reopen lifecycle ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Add first-class resolve/reopen commands plus a finalize-verified-fix flow that closes tickets, rewrites projections, and keeps operator-facing state truthful after passing tests, dogfood, and workflow audit.
	  - Epic: EPIC-SHELL-CANONICAL-001
	  - Parent: EPIC-SHELL-CANONICAL-001
	  - State: archived
- [ ] BUG-SHELL-HUMAN-001 Handle conversational project-status phrasing ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "what's the status of this project?" The shell should answer with project-grounded status instead of a generic planner fallback.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-004 Handle shell-quality questions ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "how good is the shell?" The shell should resolve the shell surface and answer directly.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-005 Handle shell-assessment paraphrases ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "what's up with the shell lately?" The shell should inspect the shell surface rather than fail generically.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-002 Handle repo-state phrasing ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "can you give me the state of the repo right now?" The shell should map it to project status.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-007 Handle named-shell existence questions ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "is there anything here named shell?" The shell should resolve shell-related status or search results.
	  - State: archived
- [ ] TKT-DOCS-002 Generate semantic HTML from the canonical manual ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Add a Node generator and npm script that deterministically convert docs/MANUAL.md into docs/manual.html with semantic HTML and stable anchors.
	  - Epic: EPIC-DOCS-001
	  - Parent: EPIC-DOCS-001
	  - State: archived
- [ ] BUG-EPIC-PROJECTION-01 Preserve manual epic edits before projection rewrite ✅ 2026-04-09 ✅ 2026-04-09 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Projection rewrites can still delete manually edited epics if the DB has not imported the narrative yet; always reconcile epics.md and kanban.md drift before any projection write.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-003 Handle codebase-health phrasing ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "how is the codebase doing?" The shell should answer with project-grounded status.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-006 Handle quoted shell feature existence questions ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "do we have a feature called \"shell\"?" The shell should resolve the shell surface or matching module.
	  - State: archived
- [ ] TKT-DOCS-001 Rewrite the canonical manual into a complete operator and developer reference ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Restructure docs/MANUAL.md into a complete, retrieval-friendly manual covering setup, shell use, command reference, patterns, examples, and configuration.
	  - Epic: EPIC-DOCS-001
	  - Parent: EPIC-DOCS-001
	  - State: archived
- [ ] BUG-SHELL-AI-LATENCY-01 Bound local shell planner latency and fallback ✅ 2026-04-07 ✅ 2026-04-07 ✅ 2026-04-09 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Live Ollama shell-planning can stall for 25-45s+ on bounded JSON planning prompts even after prompt trimming; add a reliable planner timeout/abort path, lighter planner protocol, or fallback strategy so heavy local prompts complete or fail over quickly.
	  - State: archived
- [ ] TKT-DOCS-003 Make shell guidance consume the manual as a first-class source ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Load and summarize docs/MANUAL.md in shell context, guidance-summary, and context-pack without outranking live workflow state or core guidance docs.
	  - Epic: EPIC-DOCS-001
	  - Parent: EPIC-DOCS-001
	  - State: archived
- [ ] TKT-METRICS-001 Add help-vs-baseline metrics command ✅ 2026-04-09 ✅ 2026-04-09 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Expose high-level cost and quality metrics that estimate how much ai-workflow helped versus not using it, sliced by session, last 4 real work hours, and trailing week.
	  - State: archived
- [ ] BUG-METRICS-001 Separate mock traffic and surface failing real-model metrics ✅ 2026-04-09 ✅ 2026-04-09 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: The metrics view currently reports strong help-vs-baseline savings even when the latest real shell-planning runs are 0% success and ~20s latency, because mock-model traffic and zero-token local calls dominate the aggregate. Split mock versus real-provider traffic, call out failing real-model windows, and make the quality/help score reflect degraded results instead of optimistic blended averages.
	  - State: archived
- [ ] TKT-DOCS-004 Enforce manual and HTML freshness in audit and tests ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Add tests and workflow-audit expectations so the manual, generated HTML, README links, and shell integration remain in sync.
	  - Epic: EPIC-DOCS-001
	  - Parent: EPIC-DOCS-001
	  - State: archived
- [ ] TOOL-DF-002 Harden full AI shell dogfooding and progress reporting ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-07 ✅ 2026-04-07 ✅ 2026-04-07 ✅ 2026-04-09 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Add a full-profile shell dogfood scenario that exercises live AI planning without hanging silently, and expose provider/model progress while non-interactive shell work is in flight.
	  - State: archived
- [ ] TKT-RAG-004 Add regression coverage for retrieval, context packing, and working sets ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Add targeted tests that lock implementation-first retrieval, weak-evidence handling, and context/working-set behavior for shell-facing tickets.
	  - Epic: EPIC-RAG-001
	  - Parent: EPIC-RAG-001
	  - State: archived
- [ ] TOOL-DF-001 Implement tool-first dogfooding enforcement ✅ 2026-04-07 ✅ 2026-04-07 ✅ 2026-04-07 ✅ 2026-04-07 ✅ 2026-04-09 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Add dogfood command/report, enforce operator-surface dogfooding in audits and project templates, and prove the shell/tool paths through ai-workflow itself.
	  - State: archived
- [ ] BUG-SHELL-FASTPATH-01 Make smart-status shell reads truly fast-path ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-06 ✅ 2026-04-07 ✅ 2026-04-07 ✅ 2026-04-07 ✅ 2026-04-09 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Read-only prompts like  still pay refresh/sync/context overhead in no-AI mode because they depend on smart status; move these lookups onto a lightweight deterministic path without planner refresh.
	  - State: archived
- [ ] BUG-SHELL-INTELLIGENCE-01 Ground AI shell answers in retrieved repo evidence ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: The interactive AI shell advertises a planner but fails basic explainer/help questions like projections or how to use the shell. Fix the AI path by grounding planner prompts and replies in retrieved repo evidence, improving action selection for explainer questions, and removing generic fallback answers when evidence exists.
	  - State: archived
- [ ] BUG-SHELL-CONCURRENCY-01 Prevent concurrent shell/db lock failures ✅ 2026-04-07 ✅ 2026-04-07 ✅ 2026-04-07 ✅ 2026-04-09 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Concurrent shell and dogfood runs can still hit SQLite ; add serialization, retry/backoff, or a read-only fast path so parallel shell starts do not fail under normal operator use.
	  - State: archived
- [ ] TKT-RAG-001 Make workflow retrieval more efficient, robust, and smart ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Improve retrieval and context selection so ai-workflow returns higher-signal evidence with lower token cost, better ranking, and safer fallback behavior when indexed or semantic evidence is weak.
	  - Epic: EPIC-RAG-001
	  - Parent: EPIC-RAG-001
	  - State: archived
- [ ] TKT-RAG-003 Make retrieval fallback and confidence honest under weak evidence ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Lower confidence for weak lexical-only matches, classify fallback stages more accurately, and cap low-value tests/docs when implementation evidence is thin.
	  - Epic: EPIC-RAG-001
	  - Parent: EPIC-RAG-001
	  - State: archived
- [ ] BUG-SHELL-HUMAN-048 Handle long-form routing/debug paragraphs ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "I have a long, messy request: the shell should read a paragraph about broken provider routing, propose a debugging angle, and point me at the most relevant files. How would you handle that?" The shell should classify bug-hunting work and preserve provider-routing context.
	  - State: archived
- [ ] TKT-RAG-002 Rebalance retrieval ranking toward implementation evidence ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prefer graph-linked implementation files, exact path hints, and high-signal exported symbols over generic lexical hits and broad test matches.
	  - Epic: EPIC-RAG-001
	  - Parent: EPIC-RAG-001
	  - State: archived
- [ ] BUG-SHELL-HUMAN-044 Handle operator-update summarization prompts ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "Please summarize the current shell work into a short operator update." The shell should classify summarization work.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-045 Handle bug-hunting shipping paragraphs ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "I need you to hunt bugs around projections and shell explainers before I ship this." The shell should classify bug-hunting work and preserve the projections/shell subject.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-046 Handle architecture-audit paragraphs ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "Audit the architecture around projections, routing, and shell fallback, then suggest the cleanest design direction." The shell should treat this as architecture/design work.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-038 Handle task-decomposition paragraphs ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "Break down the work to make the shell understand long natural-language paragraphs about coding tasks." The shell should classify decomposition work.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-042 Handle design-token paragraphs ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "I need design tokens for shell/operator surfaces so colors and spacing stay coherent." The shell should classify design-token work.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-047 Handle review-plan paragraphs before refactors ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "I'm about to refactor the modal dialog stack. Before I code, I want a review-oriented plan with likely hotspots and guardrails." The shell should classify review work and preserve modal/dialog context.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-036 Handle architecture-design paragraphs ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "Design the safest architecture for Telegram remote control before we implement it." The shell should classify architecture/design work from a natural request.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-037 Handle risky-rollout prompts ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "Help me plan a rollout for a risky shell mutation feature with guards and fallback." The shell should classify risky-planning work.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-043 Handle prose-composition prompts ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "Write a concise migration note for changing shell planner fallback behavior." The shell should classify prose-composition work.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-034 Handle review-oriented regression prompts ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "Please review the shell changes and tell me where the riskiest regressions probably are before I touch anything." The shell should classify this as review work from natural language.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-040 Handle UI-layout paragraphs ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "The UI layout around the dialog feels cramped on mobile. How would you approach the layout work?" The shell should classify UI layout work.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-041 Handle UI-styling paragraphs ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "The styling of the shell demo looks rough. I want a better typography and color direction." The shell should classify styling work.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-028 Handle compound project-and-next-step prompts ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "tell me about this project and what I should tackle next" The shell should ground the project and suggest next work.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-035 Handle refactor-plan paragraphs ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "I need a refactor plan for provider routing so we can simplify fallbacks without breaking local-first behavior." The shell should classify refactoring work and search relevant areas.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-039 Handle implementation-path prompts ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "I need to implement a new overlay focus trap; what model path and repo areas would you use?" The shell should classify code-generation work from a conversational paragraph.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-027 Handle missing-topic epic creation prompts ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "can you write an epic?" The shell should ask for the topic instead of failing generically.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-031 Handle projections existence questions ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "do we have anything called projections?" The shell should resolve projections by status or search.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-032 Handle workflow-status prompts ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "what's the status of workflow?" The shell should resolve the workflow surface.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-023 Handle natural search phrasing ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "search for router" The shell should map naturally to project search.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-029 Handle repo-assessment prompts ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "what do you think about this repo?" The shell should return a repo assessment grounded in current metadata.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-030 Handle workflow-health prompts ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "is the workflow healthy?" The shell should resolve workflow state rather than emitting a parser fallback.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-033 Handle paragraph debugging requests ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "I'm debugging a modal overlay issue. Escape no longer closes the dialog and I want the safest investigation plan. Figure out what files are likely involved." The shell should classify bug-hunting work from a paragraph and point to relevant repo targets.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-020 Handle provider-health phrasing ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "how are the AI providers looking?" The shell should route to provider status.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-024 Handle conversational search requests ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "can you find router for me?" The shell should not fail on conversational search phrasing.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-026 Handle epic shorthand ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "epic?" The shell should answer the current epic state.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-017 Handle next-step phrasing ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "what should I do next?" The shell should suggest the next ticket or current focus.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-021 Handle connected-provider phrasing ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "show me the connected providers" The shell should return provider status.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-025 Handle doctor-help phrasing ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "doctor help" The shell should explain the doctor command locally.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-014 Handle request-for-examples prompts ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "show me a few example prompts" The shell should return example shell usage.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-018 Handle active-ticket phrasing ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "which tickets are active right now?" The shell should list active tickets.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-022 Handle shell-planning route phrasing ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "pick a model for shell planning" The shell should route the shell-planning task.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-012 Handle workflow-surface explainers ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "teach me about the workflow surface" The shell should inspect workflow instead of replying generically.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-016 Handle current-work phrasing ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "what are we working on right now?" The shell should resolve current work from workflow state.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-015 Handle capability prompts for repo work ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "what can I ask you to do in this repo?" The shell should explain capabilities instead of failing to route.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-019 Handle in-progress phrasing ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "what's currently in progress?" The shell should surface in-progress tickets or say none exist.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-064 Produce staged follow-up preservation plans ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "plan the work to make shell follow-ups preserve prior context step by step." The shell should return a staged follow-up preservation plan.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-009 Handle projections service explainers ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "what is the projections service?" The shell should mention projections directly and ground the answer in repo evidence.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-013 Handle shell-usage tutorial requests ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "how do I use you here?" The shell should return usage guidance.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-067 Explain prior graph failures without a blessed trigger phrase ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "why did the second step fail, exactly?" The shell should explain the prior failed node/result from stored turn context instead of treating this as a fresh request.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-010 Handle projections module paraphrases ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "can you explain the projections module?" The shell should explain projections instead of failing to parse.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-011 Handle terminology explainers for claims ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "what are claims?" The shell should answer with the built-in terminology explanation.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-070 Preserve prior file targets when the user says use those same files ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "use those same files, but focus on correctness now." The shell should preserve prior file referents instead of resetting the subject.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-008 Handle direct shell explainer questions ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "tell me about the shell" The shell should explain the shell surface without generic fallback.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-065 Prefer answer-format redesign over token-only design classification ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "design tokens are fine, but I need the shell answer format itself redesigned." The shell should treat this as answer-format redesign work, not token-only work.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-074 Explain why the prior answer was grounded that way ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "why do you think that, exactly?" The shell should explain the prior reasoning/result using stored turn evidence.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-066 Continue prior coding work from a bare imperative follow-up ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "do it now, but keep the change surgical." The shell should continue the prior bounded coding flow without needing a blessed continuation phrase.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-068 Compress prior answers down to a single sentence ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "make that answer one sentence." The shell should revise the prior answer format without losing the original subject.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-071 Answer safety questions about prior shell plans ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "is that safe to auto-execute?" The shell should answer against the prior plan and workflow gate state rather than asking for rephrasing.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-060 Review follow-up handling with absolute file paths ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "review the follow-up handling and give me the top 3 risks with absolute file paths." The shell should synthesize review risks with absolute file paths.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-069 Revise prior answers into bullets with absolute paths ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "same answer, but give me bullet points and absolute paths." The shell should preserve prior references and reformat the answer as requested.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-073 Rewrite a prior answer as bullets with next steps ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "rewrite that as bullets with next steps." The shell should revise the prior answer format and keep the next-step guidance.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-062 Reduce shell summaries to one sentence when requested ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "summarize the shell work in one sentence." The shell should keep the answer to one sentence.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-063 Start continuity debugging at the real continuation helpers ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "if I wanted to debug shell continuity bugs, where would you start?" The shell should point at continuation-specific helpers, not generic shell status.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-072 Make the next step smaller while preserving the same goal ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "keep the same goal, but make the next step smaller and grounded in the exact files." The shell should return a smaller grounded continuation plan.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-075 Apply prior bounded work without restating the subject ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "apply that now, but keep it bounded." The shell should continue the prior bounded work plan instead of resetting context.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-057 Honor bullet-style shell work summaries ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "give me bullet points on the shell work and the next step." The shell should render bullets, not paragraph status output.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-061 Draft migration notes for the intent envelope ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "write a migration note for the new shell intent envelope." The shell should produce a usable migration note instead of generic routing guidance.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-054 Emit concise operator updates for shell work ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "write a concise operator update about the shell work." The shell should synthesize a short operator update instead of returning routing chatter.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-056 Summarize recent shell changes instead of raw module status ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "what changed from the last shell work, briefly?" The shell should summarize the active shell work instead of dumping module status.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-058 Honor detailed shell work change requests ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "explain in detail what changed in the shell work recently." The shell should expand into a detailed shell-work summary.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-059 Ground bounded coding prompts in the requested file ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "implement a small bounded patch in cli/lib/shell.mjs to improve follow-up handling." The shell should keep the requested file and bounded coding focus in view.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-051 Preserve subject-loss debugging prompts ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "debug why long shell prompts sometimes lose their subject, and point me at the likely functions." The shell should preserve the subject-loss diagnosis and point at continuity-related helpers.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-055 Turn Codex-parity requests into staged shell work ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "make the shell not inferior to codex for review, debugging, and design requests." The shell should turn this into a parity program, not generic bug-hunting.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-050 Honor top-3 review prompts with file references ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "review the shell and tell me the top 3 risks with file references." The shell should synthesize a ranked review answer with real file targets.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-053 Handle shell response-format design prompts ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "design a better shell response format for terse operator briefs versus deep investigations." The shell should treat this as design-direction work, not a status query.
	  - State: archived
- [ ] TKT-SHELL-NL-008 Expand AI-judged shell dogfood coverage across human-language corpora ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Human-language shell regressions now include two new bug batches plus shell-transcript judge coverage for the resulting transcripts.
	  - Epic: EPIC-SHELL-NL-001
	  - Parent: EPIC-SHELL-NL-001
	  - State: archived
- [ ] BUG-SHELL-HUMAN-049 Handle deep-dive parity planning prompts ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "deep dive: explain how you would support coding, debugging, and design paragraphs in the shell end to end." The shell should return a staged parity plan instead of collapsing into a generic summary or the wrong work mode.
	  - State: archived
- [ ] BUG-SHELL-HUMAN-052 Continue bounded-patch follow-ups instead of resetting context ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Prompt: "follow up on that and make it a small bounded patch." The shell should continue the previous coding graph and keep the bounded patch focus.
	  - State: archived
- [ ] TKT-SHELL-NL-007 Strengthen conversational continuity and follow-up handling in shell sessions ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Follow-up prompts now preserve prior coding focus, continue the previous graph intent, and stop resetting to unrelated status/search paths.
	  - Epic: EPIC-SHELL-NL-001
	  - Parent: EPIC-SHELL-NL-001
	  - State: archived
- [ ] TKT-SHELL-NL-004 Support debugging, review, and refactor paragraphs with grounded hotspots ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Debugging and review prompts now preserve likely hotspots, real file targets, and grounded next steps instead of generic shell status chatter.
	  - Epic: EPIC-SHELL-NL-001
	  - Parent: EPIC-SHELL-NL-001
	  - State: archived
- [ ] TKT-SHELL-NL-006 Adapt shell answer verbosity and format to user intent ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: The shell now honors brief, bullet, one-sentence, and detailed operator prompts across summaries and capability replies.
	  - Epic: EPIC-SHELL-NL-001
	  - Parent: EPIC-SHELL-NL-001
	  - State: archived
- [ ] TKT-SHELL-NL-002 Add multi-step execution graphs and final synthesis for paragraph requests ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Paragraph requests now route through richer multi-step plans and synthesize one operator-facing answer instead of leaking intermediate routing.
	  - Epic: EPIC-SHELL-NL-001
	  - Parent: EPIC-SHELL-NL-001
	  - State: archived
- [ ] TKT-SHELL-NL-005 Support design and UI-direction requests in natural language ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Design-direction prompts now distinguish answer-format redesign, UI styling, and token work with grounded design guidance.
	  - Epic: EPIC-SHELL-NL-001
	  - Parent: EPIC-SHELL-NL-001
	  - State: archived
- [ ] TKT-SHELL-NL-001 Enforce a mandatory structured intent envelope for every shell prompt ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: The shell now normalizes every request into a typed intent envelope, including shell-local replies and continuation-aware follow-ups.
	  - Epic: EPIC-SHELL-NL-001
	  - Parent: EPIC-SHELL-NL-001
	  - State: archived
- [ ] TKT-SHELL-NL-003 Support coding-task paragraphs end to end through the shell ✅ 2026-04-11 ✅ 2026-04-10 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-11 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: Coding prompts now preserve capability classification, target discovery, bounded follow-up continuation, and coding-oriented synthesized replies.
	  - Epic: EPIC-SHELL-NL-001
	  - Parent: EPIC-SHELL-NL-001
	  - State: archived
- [ ] BUG-WORKFLOW-INTEGRITY-003 Add workflow checks that fail when fixed tickets remain active in operator-facing status ✅ 2026-04-13 ✅ 2026-04-13 ✅ 2026-04-13
	  - Summary: The toolkit should detect integrity drift where implementation/tests pass but project summary and shell answers still surface the same bug tickets as open due to missing closure/projection steps.
	  - State: archived




%% kanban:settings
```
{"kanban-plugin":"board"}
```
%%