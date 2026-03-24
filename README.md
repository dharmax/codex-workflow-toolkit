# codex-workflow-toolkit

Reusable workflow system for JS/TS repositories. It provides a shared `ai-workflow` CLI, toolkit codelets, thin agent-specific skill adapters, project-local codelet overrides, and optional wrapper-friendly session hygiene.

## Contents

- `SKILL.md`: local development copy of the Codex-facing orchestration skill
- `cli/`: `ai-workflow` command surface and project-local codelet routing
- `core/`: DB-first store, deterministic parsers, sync/index/query services, lifecycle, routing, and integration helpers
- `shared/codelets/`: toolkit-owned reusable codelets
- `shared/templates/`: long-term shared template location
- `shared/scripts/`: long-term shared script location
- `skills/`: thin agent adapters for Codex, Claude, and Gemini
- `scripts/init-project.mjs`: safe installer for a target repository
- `templates/`: workflow, execution, and engineering guidance files
- `runtime/scripts/codex-workflow/`: helper scripts copied into target projects
- `docs/`: design and token-efficiency plan

## Install

Clone the repository wherever you keep shared tooling:

```bash
git clone <repo-url> codex-workflow-toolkit
cd codex-workflow-toolkit
```

Local install is the preferred long-term usage mode for projects because it gives stable repeatable helper behavior. `npx` remains useful for ad hoc use.

Bootstrap a target JS/TS project:

```bash
node scripts/init-project.mjs --target /path/to/project
```

Run the local CLI from this repository:

```bash
node cli/ai-workflow.mjs list
node cli/ai-workflow.mjs doctor
```

Package direction:

```bash
pnpm add -D @dharmax/ai-workflow
# or
npx @dharmax/ai-workflow doctor
```

## Layout

```text
.
├── SKILL.md
├── cli/
│   ├── ai-workflow.mjs
│   └── lib/
├── shared/
│   ├── codelets/
│   ├── templates/
│   └── scripts/
├── skills/
│   ├── codex/
│   ├── claude/
│   └── gemini/
├── docs/
│   └── token-efficiency-plan.md
├── runtime/
│   └── scripts/codex-workflow/
├── scripts/
│   └── init-project.mjs
├── templates/
├── core/
│   ├── db/
│   ├── lib/
│   ├── parsers/
│   └── services/
└── tests/
```

## Architecture

- The shared toolkit is the source of truth. It owns the CLI, toolkit codelets, templates, and thin agent adapters.
- The workflow DB under `.ai-workflow/state/workflow.db` is the project-local source of truth for indexed facts, notes, candidates, entities, and projections.
- The agent skills stay thin. They route into `ai-workflow` instead of embedding heavyweight logic in `SKILL.md`.
- Project-local codelets live under `.ai-workflow/codelets` and override toolkit codelets with the same id.
- The copied runtime scripts remain the project-local substrate for initialized repos and compatibility.
- An optional wrapper may add session control, remoting, or rate limiting, but the core system must remain usable without it.

## Installation Model

Link agent adapters into a project from the central toolkit:

```bash
ai-workflow install codex
ai-workflow install all
```

This creates project-local agent folders such as `.codex/skills` that symlink back to the central toolkit and initializes `.ai-workflow/config.json` without overwriting unrelated existing content.
It also prepares `.ai-workflow/cache`, `.ai-workflow/generated`, `.ai-workflow/notes`, and `.ai-workflow/state`.

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

Prefer the CLI for bounded helper work:

```bash
ai-workflow extract ticket TKT-001
ai-workflow extract guidelines --ticket TKT-001 --changed
ai-workflow run review
ai-workflow verify --cmd "pnpm test"
ai-workflow run context-pack --ticket TKT-001 --changed
ai-workflow install codex
ai-workflow sync --write-projections
ai-workflow project summary --json
ai-workflow project note add --type BUG --body "shared router can break candidate review" --file src/core/router.js
ai-workflow route review --json
ai-workflow telegram preview
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

Deepen the parser/query layer with stronger AST-backed symbol and dependency extraction while keeping the SQLite schema, projection model, and routing interfaces stable.

The DB-first architecture and phased rollout are documented in [docs/db-first-architecture.md](docs/db-first-architecture.md).

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

`context-pack.mjs`
- builds a compact handoff bundle from the active ticket, changed files, extracted guidance, review focus, and session-hygiene recommendation
- is the deterministic local precursor for recommending `/compact` or `/new`

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
- deterministic scripts and codelets over repeated prompt reasoning when practical
- guideline extraction and ticket extraction are first-class hot-path operations
- session hygiene is explicit: recommend `/compact` or `/new` truthfully, but do not pretend the skill controls chat history
- shared toolkit codelets are reusable across agents; project codelets override toolkit codelets by id
- skills stay thin and agent-specific; real logic lives in the CLI and codelets
- no completion without evidence
- guidance files stay short, durable, and meaningfully opinionated
- enforcement should be extensible from project docs rather than frozen in toolkit code
- installation is safe by default
