# codex-workflow-toolkit

Reusable Codex CLI workflow kit for JS/TS repositories. It provides one orchestration skill, a safe project bootstrap script, durable workflow and engineering guidance, and helper scripts for kanban, review, verification, and enforceable audits.

## Contents

- `SKILL.md`: single top-level workflow skill
- `scripts/init-project.mjs`: safe installer for a target repository
- `templates/`: workflow, execution, and engineering guidance files
- `runtime/scripts/codex-workflow/`: helper scripts copied into target projects

## Install

Clone the repository wherever you keep shared tooling:

```bash
git clone <repo-url> codex-workflow-toolkit
cd codex-workflow-toolkit
```

Bootstrap a target JS/TS project:

```bash
node scripts/init-project.mjs --target /path/to/project
```

The installer copies:

- `AGENTS.md`
- `CONTRIBUTING.md`
- `execution-protocol.md`
- `kanban.md`
- `project-guidelines.md`
- `knowledge.md`
- `scripts/codex-workflow/*`

Existing non-empty files are not overwritten unless `--force` is passed.

## Usage

Prefer explicit skill invocation in Codex:

```text
Use codex-workflow-toolkit for TKT-042.
```

In an initialized target project, the common commands are:

```bash
node scripts/codex-workflow/kanban-ticket.mjs --id TKT-001
node scripts/codex-workflow/guidance-summary.mjs --ticket TKT-001 --changed
node scripts/codex-workflow/review-summary.mjs
node scripts/codex-workflow/verification-summary.mjs --cmd "pnpm test" --cmd "pnpm build"
node scripts/codex-workflow/workflow-audit.mjs
```

## Command Notes

`kanban-ticket.mjs`
- extracts a ticket by id, or the first ticket in a section

`guidance-summary.mjs`
- condenses `AGENTS.md`, `CONTRIBUTING.md`, `execution-protocol.md`, `project-guidelines.md`, and `knowledge.md`
- can focus on a ticket and current changed files

`review-summary.mjs`
- summarizes the changed-file surface
- flags likely review hotspots such as config edits, deleted files, and source changes without test changes

`verification-summary.mjs`
- runs supplied verification commands
- reports pass/fail with evidence snippets
- never reports verified without at least one passing command and no failures

`workflow-audit.mjs`
- enforces workflow-doc presence, required policy sections, local doc refs, documented `pnpm -s` script references, and kanban invariants
- runs `guideline-audit.mjs` and fails the audit if project-specific machine-readable rules fail

`guideline-audit.mjs`
- reads fenced `codex-workflow-audit` JSON blocks from project markdown docs
- enforces file-header requirements plus required/forbidden regex rules scoped by path prefixes and extensions
- is designed to grow with project-specific guidance instead of hardcoding one repo’s UI rules

## Audit Extensions

Project-specific enforcement rules live inside markdown docs as fenced `codex-workflow-audit` blocks. `workflow-audit.mjs` merges all of them across the repo.

Example schema:

```json
{
  "headers": [
    {
      "include": ["src", "tests"],
      "extensions": [".ts", ".tsx", ".js", ".jsx"],
      "requiredNearTop": ["Responsibility:", "Scope:"],
      "maxLines": 16
    }
  ],
  "forbiddenPatterns": [
    {
      "include": ["src/ui"],
      "extensions": [".riot", ".ts", ".tsx", ".js", ".jsx"],
      "pattern": "\\btitle\\s*=",
      "message": "Use explicit tooltip contracts, not native title."
    }
  ],
  "requiredPatterns": []
}
```

## Design Constraints

- single skill entry point
- scripts over repeated prompt reasoning when practical
- no completion without evidence
- guidance files stay short, durable, and meaningfully opinionated
- enforcement should be extensible from project docs rather than frozen in toolkit code
- installation is safe by default
