# 🎯 MISSION: Autonomous Engineering OS

## 🗺️ Roadmap

### Phase 1: The "Surgical Strike" Foundation 🛠️
**Goal:** Eliminate file rewrites, reduce token cost by 80%, and prevent regressions via strict patching.
- [x] **Unified Patch Engine:** Implement `SEARCH/REPLACE` block parser and applicator.
- [x] **Graph-Powered Context Packer:** Use SQLite graph to build surgical prompts (symbol-only context).
- [x] **AST Verification:** Run syntax checks/linting on patched files before saving.
- [x] **Patch Fallback:** Cheap AI fuzzy-matching for failed patch applications.

### Phase 2: The PM/Architect Flow 📝
**Goal:** Transform vague intent into structured Epics/Tickets without writing code.
- [x] **Ideation State Machine:** Q&A loop for feature scoping.
- [x] **Epic Scaffolding:** Generate Epic + Ticket hierarchy in SQLite.
- [x] **Domain Tagging:** Auto-assign `visual`, `logic`, etc., to tickets.
- [x] **Markdown Projection:** Sync DB entities to `kanban.md` and `epics.md`.

### Phase 3: Architectural Intelligence & Mapping 🏛️
**Goal:** Modularize the codebase and automate technical debt management.
- [x] **Module/Feature Mapping:** First-class DB entities for architectural boundaries and user features.
- [x] **Heuristic Initializer:** Free, directory-based baseline mapping during sync.
- [x] **Architectural Critic:** SQL-powered audit for circular dependencies and leaky abstractions.
- [x] **Progressive Refinement:** AI learns and corrects the architectural map as it works.
- [x] **Consultation Loop:** Asynchronous Q&A for complex architectural decisions.

### Phase 4: The Orchestrator & Dispatcher ⚡
**Goal:** Concurrent execution of sub-tasks using the cheapest specialized models.
- [ ] **Parallel Dispatcher:** Run multiple sub-task models simultaneously.
- [ ] **Semantic Stitching:** Conflict detection and resolution for concurrent patches.
- [ ] **State Tracking:** Live progress updates in the shell.

### Phase 4: Autonomous Loop & Learning 🔄
**Goal:** Self-healing codebase and automatic knowledge extraction.
- [ ] **The Fixer Loop:** `sweep bugs` -> execute -> test -> retry on failure.
- [ ] **Insight Extraction:** Generate new `Knowledge` nodes from solved hurdles.
- [ ] **Automated Retros:** Update project guidelines based on model performance.

---

## 🛠️ Special Coordination Comments
We use these tags in code to anchor AI tasks and coordinate surgical strikes:
- `// [ai-task: TKT-001]`: Anchors a specific ticket to a line of code.
- `// [ai-knowledge: tag]`: Marks a block as a vital context node for specific domains.
- `// [ai-guard: rule]`: Hard enforcement rule for the auditor.
