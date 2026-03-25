# Tactical KANBAN

## 🚀 Active Tasks
- [ ] **TKT-SUPERGIT:** Implement `supergit` codelet with strict Auto-Stash -> Temp Branch -> Test -> Merge -> Auto-Pop pipeline to prevent working tree corruption.
- [ ] **TKT-ASYNC-PATCH:** Upgrade patch engine to feed parsing errors back to the *original* model for a retry, rather than guessing. Add async deferral to a "Blocked" lane if retry fails.
- [ ] **TKT-SMART-INPUT:** Implement `ai-workflow ingest <file>` command to safely handle PRDs and avoid TTY paste buffer overflows.
- [ ] **TKT-INGESTION:** Build Artifact Digestor pipeline that forces a human approval gate on the high-level outline before generating DB entities.
- [ ] **TKT-DOGFOOD-TEST:** Develop a mini mock project using the tool. ALL new features must be tested using the local HTTP mock server pattern.

## 🐛 Bugs
- [ ] None yet.

## ✅ Done
- [x] **TKT-PATCH-FILE:** Unified Patch Engine: parse and apply SEARCH/REPLACE blocks with `File:` extraction to prevent hardcoded files.
- [x] **TKT-CTX-LIMIT:** Graph-Powered Context Packer: Implement `core/services/context-packer.mjs` with strict line limits.
- [x] **TKT-TEST-ORCH:** Add profound test suite for patch engine, context packer, and orchestrator using mock HTTP providers.
- [x] Initial Mission Roadmap created (`MISSION.md`).
- [x] Domain-aware 2D Competency Matrix implemented in Router.
- [x] Knowledge Base service added for dynamic "Source of Truth."
- [x] Shell upgraded to Agentic multi-planner with blacklist recovery.
