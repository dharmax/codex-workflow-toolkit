# codex-workflow-toolkit

Reusable Codex CLI workflow kit for JS/TS repositories. It provides one orchestration skill, a safe project bootstrap script, durable workflow and engineering guidance, and helper scripts for kanban, review, verification, and strict enforceable audits.

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
- `enforcement.md`
- `kanban.md`
- `kanban-archive.md`
- `epics.md`
- `project-guidelines.md`
- `knowledge.md`
- `.github/workflows/codex-workflow-audit.yml`
- `scripts/codex-workflow/*`

If `package.json` exists, the installer also adds namespaced workflow scripts:

- `workflow:ticket`
- `workflow:new-ticket`
- `workflow:next-ticket`
- `workflow:move-ticket`
- `workflow:archive-done`
- `workflow:migrate-kanban`
- `workflow:guidance`
- `workflow:review`
- `workflow:verify`
- `workflow:guideline-audit`
- `workflow:audit`

Existing non-empty files and conflicting package scripts are not overwritten unless `--force` is passed.
The default install is strict: `enforcement.md` ships with an active baseline `codex-workflow-audit` block, and the CI scaffold runs the workflow audit automatically on GitHub.

## Usage

Prefer explicit skill invocation in Codex:

```text
Use codex-workflow-toolkit for TKT-042.
```

In an initialized target project, the common commands are:

```bash
pnpm -s workflow:ticket --id TKT-001
pnpm -s workflow:new-ticket --id TKT-002 --title "Follow-up polish" --to Suggestions
pnpm -s workflow:next-ticket
pnpm -s workflow:move-ticket --id TKT-001 --to "In Progress"
pnpm -s workflow:move-ticket --id TKT-001 --to Done
pnpm -s workflow:archive-done
pnpm -s workflow:migrate-kanban
pnpm -s workflow:guidance --ticket TKT-001 --changed
pnpm -s workflow:review
pnpm -s workflow:verify --cmd "pnpm test" --cmd "pnpm build"
pnpm -s workflow:audit
```

## Next Planned Step

Add tests/fixtures-based end-to-end fixture repo matrix coverage for initialized target repos, including strict-default pass cases and project-specific audit-extension allowlist pass/fail scenarios with workflow script and CI workflow validation.

## Command Notes

`kanban-ticket.mjs`
- extracts a ticket by id, or the first ticket in a section

`kanban-new.mjs`
- creates a normalized Obsidian kanban card in the requested lane
- supports the common structured fields directly from flags

`kanban-next.mjs`
- returns the next ticket using lane-priority order
- defaults to `Bugs P1 -> ToDo -> Bugs P2/P3 -> In Progress -> Human Inspection -> Backlog -> Deep Backlog -> Suggestions -> Done`

`kanban-move.mjs`
- moves a ticket between kanban lanes reliably
- auto-adds or updates `- Done: YYYY-MM-DD` when moving to `Done`
- removes `Done` metadata when moving a ticket back out of `Done`

`kanban-archive.mjs`
- moves stale dated `Done` tickets into `kanban-archive.md`
- groups archived tickets by `YYYY-MM`

`kanban-migrate-obsidian.mjs`
- migrates the older `###`-ticket kanban shape into the Obsidian task-card board format
- remaps legacy lanes to the newer board where needed

`guidance-summary.mjs`
- condenses `AGENTS.md`, `CONTRIBUTING.md`, `execution-protocol.md`, `enforcement.md`, `project-guidelines.md`, and `knowledge.md`
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
- enforces file-header requirements, required/forbidden regex rules, forbidden import boundaries, and path-scoped allowlists
- is designed to grow with project-specific guidance instead of hardcoding one repo’s UI rules
- `--json` emits structured findings with file, line, rule kind, rule id, and rule source

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
  "requiredPatterns": [],
  "forbiddenImports": [],
  "allowlists": [
    {
      "include": ["src/legacy"],
      "extensions": [".ts"],
      "ruleIds": ["no-source-todo"]
    }
  ]
}
```

Default initialized repos also get an active baseline in `enforcement.md` covering:
- Responsibility/Scope headers in `src`, `tests`, and `docs`
- no fake underscore privacy markers in app code
- no `TODO` / `FIXME` in production source
- no native `title=` tooltips under `src/ui`
- no UI imports from `src/engine`

## Design Constraints

- single skill entry point
- scripts over repeated prompt reasoning when practical
- no completion without evidence
- guidance files stay short, durable, and meaningfully opinionated
- enforcement should be extensible from project docs rather than frozen in toolkit code
- installation is safe by default
