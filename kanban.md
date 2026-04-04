---
kanban-plugin: board
---

# Kanban

_Generated from the workflow DB. Edit through `ai-workflow project ...` or `ai-workflow sync`._

## Deep Backlog

- [ ] No items

## Backlog

- [ ] No items

## ToDo

- [ ] EXE-001 Implement Self-Correction Loop in shell executor
  - Summary: TODO: Auto-retry failed actions with adjusted parameters.
  - State: open
- [ ] DYN-002 Support Contextual Notes (imperative language discovery)
  - Summary: TODO: Detect 'Must fix...' style comments without prefixes.
  - State: open
- [ ] DYN-003 Upgrade scoreNote with semantic density analysis
  - Summary: TODO: Move beyond simple keyword counting for scoring.
  - State: open
- [ ] RAG-002 Add Relationship Inference between tickets and symbols
  - Summary: TODO: Link TKT-XXX mentions in code to DB entities.
  - State: open
- [ ] SHL-004 Implement Proactive Clarification for ambiguous IDs
  - Summary: TODO: AI should ask 'Which TKT?' instead of guessing.
  - State: open
- [ ] BUG-001 Fix typo in shell help
  - State: open
- [ ] TKT-CTX-LIMIT Context packer should enforce line limits to protect token budget
  - State: open
- [ ] TKT-DOGFOOD-TEST Develop a mini mock project using the tool to validate the Eat Your Own Food goal
  - State: open
- [ ] RAG-003 Implement Shadow Sync for partial manual changes
  - Summary: TODO: Detect manual code changes that satisfy a ticket.
  - State: open
- [ ] TKT-ASYNC-PATCH Upgrade patch engine with AI ambiguity auto-resolution and async deferral
  - State: open
- [ ] TST-003 Add Multi-User Simulation tests for concurrent edits
  - Summary: TODO: Test race conditions between manual and AI edits.
  - State: open
- [ ] TKT-INGESTION Build Artifact Digestor pipeline (Assess, Decompose, Handle) for PRDs and design docs
  - State: open
- [ ] TKT-PATCH-FILE Patch engine must extract file paths to avoid hardcoded fallbacks
  - State: open
- [ ] TKT-SMART-INPUT Implement smart paste detection for long texts and images in the interactive shell
  - State: open
- [ ] TKT-SUPERGIT Implement 'supergit' codelet with AI-enhanced operations and auto-revert safety net
  - State: open
- [ ] TST-001 Create High-Friction test scenarios (large scale)
  - Summary: TODO: Test with 100MB files and circular symlinks.
  - State: open
- [ ] TST-004 Implement Longevity Tests for high-scale RAG
  - Summary: TODO: Performance verify with 10k files.
  - State: open
- [ ] SHL-002 Implement ContextBudgeter for dynamic prompt pruning
  - Summary: TODO: Limit context based on relevance and token budget.
  - State: open
- [ ] TKT-TEST-ORCH Add profound test suite for orchestrator and context packer
  - State: open
- [ ] EXE-002 Add Side-Effect Analysis for dynamic codelets
  - Summary: TODO: AI should warn about files a codelet will modify.
  - State: open
- [ ] LAY-003 Implement SmartIgnore for auto-detecting build artifacts
  - Summary: TODO: Detect dist/target/build folders dynamically.
  - State: open

## Bugs P1

- [ ] No items

## Bugs P2/P3

- [ ] No items

## In Progress

- [ ] No items

## Human Testing

- [ ] No items

## Suggestions

- [ ] No items

## Done

- [ ] SHL-001 Upgrade ShellInputProcessor for multi-intent parsing
  - Summary: DONE: Implemented 'then/and' splitting in shell.mjs.
  - State: archived
- [ ] SHL-003 Add Strategic Foresight step-prediction to Planner
  - Summary: DONE: Upgraded AI system prompt for strategic reasoning.
  - State: archived
- [ ] RAG-001 Implement Fuzzy-Proof Markdown parsing for malformed files
  - Summary: DONE: Updated importLegacyProjections to handle missing checkboxes.
  - State: archived
- [ ] REF-001 Move hard-coded model data to model-reference.json
  - Summary: DONE: Centralized model capabilities.
  - State: archived
- [ ] TST-002 Implement Adversarial Sync Tests for broken Markdown
  - Summary: DONE: Created tests/adversarial-sync.test.mjs.
  - State: archived
- [ ] EXE-003 Implement Integrity Guardians for post-mutation verify
  - Summary: DONE: Mandatory sync/projection after every turn.
  - State: archived
- [ ] LAY-001 Implement ProjectLayout abstraction for functional discovery
  - Summary: DONE: Created core/lib/layout.mjs to find STATE/CONFIG folders.
  - State: archived
- [ ] LAY-002 Add marker-based directory detection (Similar Function)
  - Summary: DONE: Detection based on workflow.db presence.
  - State: archived
- [ ] DYN-001 Implement FuzzyFinder utility for sophisticated regex note discovery
  - Summary: DONE: Created core/lib/fuzzy.mjs with registry-driven regex.
  - State: archived
- [ ] REF-002 Implement Semantic Registry for engineering concepts
  - Summary: DONE: Created core/lib/registry.mjs.
  - State: archived

## AI Candidates

- [ ] No items

## Risk Watch

- [ ] No items

## Doubtful Relevancy

- [ ] No items

## Ideas

- [ ] No items

## Archived

- [ ] No items

%% kanban:settings
```
{"kanban-plugin":"board"}
```
%%
