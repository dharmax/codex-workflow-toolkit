# ai-workflow Manual

## What It Is

`ai-workflow` is the repo-local operating layer for workflow, tickets, kanban, epics, codelets, provider routing, guarded execution, and shell-based planning.

The canonical operational state lives in the workflow DB. Files such as `kanban.md` and `epics.md` are controlled projections of that DB, not the source of truth.

This Markdown file is the canonical manual. `docs/manual.html` is generated from this file by code and is committed for human browsing and static consumption.

Shell guidance should treat this manual as a first-class operational reference for commands, patterns, and configuration, but it must still prioritize live workflow state, ticket state, `AGENTS.md`, `execution-protocol.md`, `project-guidelines.md`, and `knowledge.md`.

## Mental Model

- Use `ai-workflow` first for project status, ticket lookup, projections, and guideline extraction; fall back to raw shell search/read only when the workflow tool cannot answer.
- Use `ai-workflow` first for project status, ticket lookup, projections, and guideline extraction.
- Prefer the cheapest capable model route when the tool can use it; if it is unavailable, say so instead of silently widening the fallback.
- Treat shell mode as a planning and orchestration surface, not as permission to skip workflow discipline.
- Treat the workflow DB as canonical state, and treat projections as readable outputs that must stay reconciled.
- Use `lean-ctx` whenever compact context matters.
- If `ai-workflow` fails, stop, identify root cause, and either fix it or report the blocker before continuing.

## Installation And Setup

### Toolkit Install

- One-off setup into the current project:

```bash
npx @dharmax/ai-workflow setup --project .
```

- Global install:

```bash
pnpm add -g @dharmax/ai-workflow
# or
npm install -g @dharmax/ai-workflow
```

### Repo Bootstrap

- Install workflow files into the current repo:

```bash
ai-workflow install --project .
```

- Initialize from a brief:

```bash
ai-workflow init --brief ./project-brief.md
```

- Refresh the DB and projections:

```bash
ai-workflow sync --write-projections
```

### First-Day Checks

- Check local tooling and providers:

```bash
ai-workflow doctor
```

- See the current operating mode:

```bash
ai-workflow mode status --json
```

- Show current project summary:

```bash
ai-workflow project summary --json
```

## Core Workflow

### Standard Operator Loop

1. Sync the project when you need fresh graph state.
2. Read the active ticket or current status through `ai-workflow`.
3. Use shell mode or direct commands to plan and execute.
4. Verify with targeted tests first, then broader gates when risk is higher.
5. Refresh projections and close the ticket truthfully.

### Canonical Workflow Commands

- Sync:

```bash
ai-workflow sync --write-projections
```

- Read the active state:

```bash
ai-workflow project summary
ai-workflow project status project
ai-workflow project search routing
```

- Extract ticket-specific context:

```bash
ai-workflow extract ticket TKT-001
ai-workflow extract guidelines --ticket TKT-001
```

- Run shell mode:

```bash
ai-workflow shell
ai-workflow shell "what are we working on right now?"
ai-workflow shell "extract ticket TKT-001"
```

- Verify operator surfaces:

```bash
ai-workflow dogfood --profile full --json
node runtime/scripts/ai-workflow/workflow-audit.mjs
```

## Shell Mode

### What Shell Mode Does

- Reads live workflow state before acting.
- Chooses between shell-local replies, heuristic planning, and AI planning.
- Uses the live model-fit matrix and current provider discovery for planner selection.
- Enforces mutation discipline around ticket state and shell mode.
- The canonical operator-visible work-mode model is defined in [docs/shell-work-mode-model.md](./shell-work-mode-model.md).

### High-Value Shell Patterns

- Ask for current work:

```bash
ai-workflow shell "what are we working on right now?"
```

- Ask for ticket context:

```bash
ai-workflow shell "explain TKT-DOCS-001 with related files"
```

- Preview a plan without execution:

```bash
ai-workflow shell "sweep bugs" --plan-only
```

- Force heuristic-only planning:

```bash
ai-workflow shell "doctor" --no-ai
```

- Allow immediate execution confirmation prompts:

```bash
ai-workflow shell "execute TKT-001" --yes
```

### Shell Operating Rules

- If the request is only about shell usage or capabilities, shell may answer directly.
- If the request depends on project state, shell should discover state before answering.
- Mutating shell work must be blocked until the board has exactly one ticket in `In Progress`.
- State-changing actions that already have a dedicated CLI command should use that command surface instead of improvised shell behavior.
- Shell guidance should use this manual for commands, patterns, and configuration, but it must not override live DB state.

### Shell Examples

- Current-work read:

```bash
ai-workflow shell "tell me what we're working on and which files matter"
```

- Readiness path:

```bash
ai-workflow shell "is this ready for beta testing?"
ai-workflow shell "make it ready"
```

- Guidance extraction:

```bash
ai-workflow shell "extract guidelines for TKT-DOCS-001"
```

- Provider diagnostics:

```bash
ai-workflow shell "doctor"
ai-workflow shell "show provider status"
```

## Command Reference

### Setup And Bootstrap

- `ai-workflow setup [--project <path>]`
- `ai-workflow install [--project <path>]`
- `ai-workflow init [options]`
- `ai-workflow onboard <brief-file> [--json]`

### Core Diagnostics And Status

- `ai-workflow doctor [--json] [--refresh-models]`
- `ai-workflow version [--json]`
- `ai-workflow --version`
- `ai-workflow metrics [--json]`

### Shell And Question Surfaces

- `ai-workflow shell [request...] [--yes] [--plan-only] [--no-ai] [--json]`
- `ai-workflow ask [request...] [--mode <default|tool-dev>] [--root <path>] [--evidence-root <path>] [--json]`
- `ai-workflow consult`

### Workflow DB And Projection Surfaces

- `ai-workflow sync [--write-projections] [--json]`
- `ai-workflow project summary [--json]`
- `ai-workflow project status <selector> [--type <type>] [--json]`
- `ai-workflow project status related <selector> [--type <type>] [--json]`
- `ai-workflow project status types`
- `ai-workflow project search <text> [--json]`
- `ai-workflow project readiness --goal <goal-type> --question <text> [--mode <default|tool-dev>] [--root <path>] [--evidence-root <path>] [--json]`
- `ai-workflow project epic <list|show|search> [...]`
- `ai-workflow project story <list|search> [...]`
- `ai-workflow project codelet <list|show|search> [...]`
- `ai-workflow project ticket create --id <id> --title <title> [--lane <lane>] [--epic <epic-id>] [--summary <text>] [--json]`
- `ai-workflow project note add --type <NOTE|TODO|FIXME|HACK|BUG|RISK> --body <text> [--file <path>] [--line <n>] [--symbol <name>] [--json]`
- `ai-workflow project review-candidates [--json]`

### Extraction And Verification

- `ai-workflow extract ticket <id> [options]`
- `ai-workflow extract guidelines [options]`
- `ai-workflow verify <workflow|guidelines> [options]`
- `ai-workflow audit architecture [--json]`
- `ai-workflow dogfood [--surface <id[,id...]>] [--profile <bootstrap|full>] [--json]`
- `ai-workflow reprofile [--json]`
- `ai-workflow route <task-class> [--json]`

### Codelets And Dynamic Behavior

- `ai-workflow list [--json]`
- `ai-workflow info <codelet>`
- `ai-workflow run <codelet> [args]`
- `ai-workflow add <codelet> <file>`
- `ai-workflow update <codelet> <file>`
- `ai-workflow remove <codelet>`
- `ai-workflow forge codelet <name>`

### Provider And Runtime Configuration

- `ai-workflow provider connect <provider-id>`
- `ai-workflow provider setup [--global]`
- `ai-workflow provider quota refresh [provider-id|all] [--global] [--json]`
- `ai-workflow provider refresh [models|all] [--global] [--json]`
- `ai-workflow set-provider-key <provider-id> [--global]`
- `ai-workflow set-ollama-hw [options]`

### Mode, Config, And Observation

- `ai-workflow mode set <default|tool-dev> [--global]`
- `ai-workflow mode status [--json]`
- `ai-workflow config get [key]`
- `ai-workflow config set <key> <value>`
- `ai-workflow config unset <key> [--global]`
- `ai-workflow config clear [--global]`
- `ai-workflow knowledge update-remote [--url <remote-url>] [--json]`
- `ai-workflow tool observe [--complaint <text>] [--json]`

### Special Surfaces

- `ai-workflow ingest <file> [--json]`
- `ai-workflow kanban <new|move|next|archive|migrate> [...]`
- `ai-workflow telegram preview [--json]`
- `ai-workflow web tutorial [--port <n>] [--host <host>] [--json]`

## Configuration Reference

### Config File Model

- Project config path: `.ai-workflow/config.json`
- Global config path: `~/.ai-workflow/config.json`
- Project config overrides global config where both define the same key
- `ai-workflow config set` accepts dot-path keys and JSON-like values

### Top-Level Keys

#### `mode`

- Meaning: default operating mode for the current scope
- Allowed values: `default`, `tool-dev`
- Typical command:

```bash
ai-workflow mode set tool-dev
```

#### `providers`

- Meaning: provider-specific connection, quota, model, and routing hints
- Shape: object keyed by provider id

#### `routing`

- Meaning: advanced routing-policy overrides merged into discovered routing policy
- Use only when the default route policy is wrong for your environment

### Remote Provider Keys

These keys apply to configured remote providers such as `openai`, `anthropic`, and `google`.

#### `providers.<provider>.apiKey`

- Meaning: API key used for completions and discovery
- Typical command:

```bash
ai-workflow config set providers.openai.apiKey sk-...
```

#### `providers.<provider>.baseUrl`

- Meaning: alternate API base URL
- Use when targeting a compatible gateway or proxy

#### `providers.<provider>.enabled`

- Meaning: explicit provider enable or disable switch
- Default behavior: enabled unless set to `false`

#### `providers.<provider>.quota.freeUsdRemaining`

- Meaning: remaining free quota in USD
- Used by routing when `quotaStrategy` prefers free remote usage

#### `providers.<provider>.quota.monthlyFreeUsd`

- Meaning: monthly free quota budget in USD

#### `providers.<provider>.quota.resetAt`

- Meaning: quota reset date in `YYYY-MM-DD`

#### `providers.<provider>.paidAllowed`

- Meaning: whether routing may continue onto paid usage after free quota is exhausted
- Default behavior: `true`

#### `providers.<provider>.models`

- Meaning: configured model registry overrides or supplements builtin knowledge
- Use when a provider exposes custom or newly available model ids

### Session Provider Keys

#### `providers.session.token`

- Meaning: browser-login session token for the session provider surface

### Ollama Keys

#### `providers.ollama.enabled`

- Meaning: explicit Ollama enable or disable switch
- Default behavior: enabled unless set to `false`

#### `providers.ollama.host`

- Meaning: primary Ollama host URL
- Example:

```bash
ai-workflow config set providers.ollama.host http://127.0.0.1:11434
```

#### `providers.ollama.endpoints`

- Meaning: additional Ollama hosts to merge into discovery
- Shape: JSON array of URLs

#### `providers.ollama.models`

- Meaning: configured model registry fallback when live probing is unavailable

#### `providers.ollama.hardwareClass`

- Meaning: coarse local hardware hint
- Allowed values: `tiny`, `small`, `medium`, `large`
- Used by shell planner selection and default local size limits

#### `providers.ollama.maxModelSizeB`

- Meaning: maximum local model size in billions of parameters for non-shell-planning routing

#### `providers.ollama.plannerModel`

- Meaning: explicit shell planner override model id
- Important: manual override only, not the normal default routing path

#### `providers.ollama.plannerMaxQuality`

- Meaning: quality cap for shell planner selection
- Typical values: `low`, `medium`, `high`

### Routing Keys

#### `routing.preferLocalFor`

- Meaning: array of task classes or capabilities that should prefer local models
- Example values: `["shell-planning", "data", "summarization"]`

#### `routing.quotaStrategy`

- Meaning: remote quota policy
- Current meaningful value: `prefer-free-remote`

#### `routing.contextCompression`

- Meaning: context compression policy override
- Normal value: `lean-ctx`

#### `routing.minimumQuality`

- Meaning: per-task minimum quality overrides
- Shape: object keyed by task class

#### `routing.capabilityMapping`

- Meaning: per-task capability remapping
- Shape: object keyed by task class
- Use only for advanced routing correction

## Usage Examples And Patterns

### Read The Current State

```bash
ai-workflow project summary
ai-workflow project status project
ai-workflow project status related TKT-DOCS-001
```

### Create A Ticket

```bash
ai-workflow project ticket create \
  --id TKT-123 \
  --title "Document the shell planner" \
  --lane "Todo" \
  --epic EPIC-DOCS-001 \
  --summary "Add a clear operator-facing planner section."
```

### Extract Guidance For A Ticket

```bash
ai-workflow extract guidelines --ticket TKT-DOCS-001
```

### Route A Task Before Spending Tokens

```bash
ai-workflow route shell-planning --json
ai-workflow route review --json
```

### Use Tool-Dev Mode

```bash
ai-workflow mode set tool-dev
ai-workflow ask "is this project ready?" --mode tool-dev --evidence-root /path/to/project --json
```

### Refresh Provider Discovery

```bash
ai-workflow doctor --refresh-models
ai-workflow provider refresh models --json
```

### Configure Ollama Hardware

```bash
ai-workflow set-ollama-hw --hardware-class medium --max-model-size-b 14
```

### Run Verification

```bash
node --test tests/*.test.mjs
ai-workflow dogfood --profile full --json
node runtime/scripts/ai-workflow/workflow-audit.mjs
```

## Troubleshooting And Failure Modes

### `ai-workflow sync` Reports Zero Indexed Files

- First check whether the project snapshot is unchanged and the DB already has state.
- Use `ai-workflow project summary --json` to confirm real DB contents before assuming the graph is empty.
- If both sync and summary are empty, investigate ignore rules, path resolution, or DB initialization.

### Shell Answers Feel Weak

- Run `ai-workflow doctor --refresh-models`
- Check `ai-workflow route shell-planning --json`
- Check `ai-workflow config get providers`
- Check whether the active ticket and `kanban.md` are truthful
- Re-run sync if the graph is stale

### Provider Looks Configured But Unavailable

- Run `ai-workflow doctor`
- Check host reachability for Ollama
- Check `apiKey`, `enabled`, quota values, and `paidAllowed` for remote providers
- For malformed config files, read the doctor warning and fix the JSON first

### Dogfood Or Audit Fails

- Re-run `ai-workflow dogfood --profile full --json`
- Re-run `node runtime/scripts/ai-workflow/workflow-audit.mjs`
- If dogfood is stale, regenerate it instead of editing the report manually
- If the manual HTML is stale, run the manual generator instead of editing HTML manually

## Manual Maintenance

- Canonical source: `docs/MANUAL.md`
- Generated output: `docs/manual.html`
- Generator script: `pnpm docs:manual` or `npm run docs:manual`
- Do not hand-edit `docs/manual.html`
