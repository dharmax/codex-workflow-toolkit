# Token Efficiency and Provider Routing Plan

## Revised File Tree

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
└── tests/
```

## Summary

This document is the source of truth for improving token efficiency in projects that use `codex-workflow-toolkit`.

The design has four layers:

- Shared workflow system: CLI plus reusable toolkit codelets.
- Thin agent adapters: Codex, Claude, and Gemini skills that route into the CLI.
- Optional wrapper layer: session control, remoting, rate limiting, provider-aware delegation.
- Project-local extension layer: config plus codelet overrides in `.ai-workflow/`.

The default operating rule is:

1. compact first
2. delegate second
3. restart with a handoff when needed

## Goals

- Minimize prompt and context spend without weakening correctness, review quality, or verification truthfulness.
- Avoid paying large-model reasoning cost for deterministic or low-complexity helper tasks.
- Keep durable state in repo artifacts instead of in bloated live chat history.
- Support optional local Ollama use when present, but degrade cleanly when it is absent.
- Make model and provider selection task-aware and hardware-aware.

## Non-Goals

- Do not assume access to direct live-session history deletion or in-place compaction inside Codex.
- Do not depend on Ollama being installed on every machine.
- Do not weaken proof standards just to save tokens.
- Do not introduce opaque background automation that hides execution state from the user.

## Capability Matrix

### Possible in the toolkit

- Narrow repo reads to the active ticket, changed files, and owning guidance surfaces.
- Generate compact summaries of guidance, review surface, and verification evidence.
- Archive or prune stale repo-local workflow history.
- Emit compact handoff artifacts for fresh-session continuation.
- Route helper-class work to deterministic scripts and shell commands.

### Possible with an outer wrapper

- Discover providers and models at startup and on demand.
- Detect local hardware shape and use it to choose suitable local models.
- Apply threshold-based context checkpoints.
- Generate a fresh-session handoff automatically when thresholds are exceeded.
- Route helper codelets across deterministic tools, local models, external providers, and Codex itself.

### Not reliably possible without upstream support

- Direct deletion or shrinking of live Codex chat history.
- Exact token accounting when the active model/provider does not expose usable metrics.
- Control over internal Codex session behavior that is not surfaced through supported interfaces.

## Current Machine Fact

On the current machine used during planning, `ollama` was not installed. The implementation must therefore treat local-model support as discoverable and optional, not assumed.

## Architecture

### Skill layer

The skill is the top-level orchestrator. It decides when to:

- extract guidelines
- extract ticket context
- run local verification
- delegate to local codelets
- recommend compaction or a fresh session

It should stay smooth and serious. It should not expose the user to a pile of internal moving parts.

### CLI and codelet layer

The `ai-workflow` CLI is the deterministic helper-tooling layer. It provides a stable verb-first command surface, toolkit codelets, and project-local staged extension codelets.

Toolkit codelets should stay stable. AI-forged additions should stay staged until reviewed or promoted.

### Toolkit runtime layer

The toolkit remains responsible for repo-shaped compaction and durable workflow state. It should provide JSON-first commands for:

- context scanning
- context packing
- history pruning
- delegation planning
- existing guidance/review/verification summarization

### Optional wrapper layer

The wrapper is responsible for:

- provider discovery
- hardware profiling
- checkpoint decisions
- task routing
- fresh-session handoff generation

The wrapper should stay semi-automatic:

- it may detect thresholds and prepare the next step automatically
- it should not pretend to have compacted live chat state when it has only prepared a restart artifact

## Tooling Boundaries

### Belongs in the skill

- workflow orchestration
- use-when and do-not-use-when routing
- decision rules for extraction, verification, and compaction recommendations
- final synthesis for the user

### Belongs in the CLI/codelet layer

- ticket extraction
- guideline extraction
- changed-file summarization
- deterministic verification helpers
- context-pack generation
- project-local staged codelet registration
- toolkit vs project codelet resolution
- agent skill installation and symlink management

### Belongs in the optional wrapper

- provider discovery
- hardware-aware local-model routing
- repeated checkpoint enforcement
- automated fresh-session handoff preparation
- remote control surfaces such as Telegram or other operator channels
- rate limiting and cross-agent coordination

### Belongs to the human operator

- deciding whether to actually use `/clear`
- reviewing and promoting staged codelets
- approving any policy change that broadens what low-risk delegation is allowed to do

## Provider and Model Registry

Use a hybrid registry:

- User-global base registry: `~/.codex-workflow/providers.json`
- Repo-local override: `.codex-workflow/providers.json`

Repo-local values override user-global values for the same provider or model identifiers.

### Registry responsibilities

The merged registry should define:

- provider ids
- model ids
- whether a model is local or external
- routing priority
- latency tier
- cost tier
- reasoning tier
- context-window hint
- hardware fit hints when known
- preferred task classes
- banned task classes
- availability probe instructions when needed
- fallback order

### Registry policy

- The registry is advisory for discovered capabilities and authoritative for routing preferences.
- If a provider is configured but unavailable, the router must skip it cleanly and record the fallback.
- Repo-local config may explicitly ban providers or models for a project.

## Discovery and Inventory

At initiation and on an explicit refresh command, collect:

- available providers
- installed Ollama models, if `ollama` exists
- reachability of configured local hosts
- OS and architecture
- CPU core count
- system memory
- GPU presence and vendor when detectable
- merged registry view

Add a `provider-inventory` command that emits:

- hardware profile
- discovered providers
- available models
- merged registry
- routing readiness
- fallback notes

## Task Classes

The router should classify helper work into explicit task classes, including:

- deterministic extraction
- repo search and diff bucketing
- log summarization
- ticket history compression
- guidance compression
- review hotspot classification
- verification command suggestion
- resume-prompt drafting

This list is for helper codelets only, not for end-to-end product work.

## Routing Logic

The default routing order is:

1. deterministic local script
2. shell utility
3. local Ollama model
4. configured external provider
5. Codex reasoning only when the above are insufficient

The router should choose the cheapest acceptable option using:

- task class
- current availability
- registry priority
- latency tier
- reasoning tier
- local hardware fit
- project bans or preferences

### Routing rules

- Prefer deterministic execution whenever correctness does not require model reasoning.
- Prefer local models for bounded summarization and classification when hardware fit is acceptable.
- Prefer external providers only when local options are absent or below the task quality floor.
- Keep Codex as the fallback for tasks that require broader reasoning, repository integration, or user-facing synthesis.

## Context Compaction Strategy

### Context checkpoints

The wrapper should monitor heuristic thresholds such as:

- number of turns
- breadth of changed files
- size of loaded artifacts
- repeated large outputs
- number of guidance surfaces pulled into context

These are heuristics, not exact token counts.

### Standard fallback when context gets too large

When a checkpoint says the session is too heavy:

1. run `context-pack`
2. generate a compact resume artifact
3. continue in a fresh Codex session

This is the standard fallback for unsupported live-history compaction.

## Planned Commands

### Toolkit runtime

- `node scripts/codex-workflow/provider-inventory.mjs`
- `node scripts/codex-workflow/context-scan.mjs`
- `node scripts/codex-workflow/context-pack.mjs`
- `node scripts/codex-workflow/history-prune.mjs`
- `node scripts/codex-workflow/delegate-plan.mjs`

### Optional wrapper

- `codex-workflow-session`
- or `codex-workflow-run`

The exact wrapper name may be chosen during implementation, but the behavior described here is the contract.

## Output Contracts

New JSON outputs should consistently expose the fields needed by wrappers and scripts. The minimum shape across the new commands should include the relevant subset of:

- `hardwareProfile`
- `providerInventory`
- `availableModels`
- `taskRoutes`
- `workingSet`
- `guidanceSlices`
- `verificationHints`
- `resumePrompt`
- `openQuestions`
- `risks`
- `freshSessionRecommended`

## Skill Contract Updates

The skill and toolkit docs should be updated to instruct projects to:

- prefer compact summaries over broad rereads
- inventory providers and models at session start and on refresh
- use delegation for helper-class jobs by default
- keep durable state in repo artifacts rather than in long chat history
- treat local Ollama as optional
- use fresh-session handoff when live context becomes too heavy

## Implementation Phases

### Phase 1: document and contracts

- Land this plan file.
- Finalize the JSON contracts and config paths.
- Update the skill and top-level docs to reference the new direction.

### Phase 2: toolkit compaction commands

- Implement `context-scan`.
- Implement `context-pack`.
- Implement `history-prune`.
- Implement `delegate-plan`.

### Phase 3: provider discovery

- Implement `provider-inventory`.
- Add registry merge logic for global and repo-local config.
- Add hardware profiling and graceful fallback behavior.

### Phase 4: wrapper orchestration

- Add the wrapper entrypoint.
- Add checkpoint logic.
- Add fresh-session handoff generation.
- Add provider routing for helper codelets.

### Phase 5: hardening

- Add tests for malformed registry input, unavailable providers, and absent Ollama.
- Add fixture coverage for compact output stability.
- Add documentation examples.

## Test Strategy

- Registry merge tests for global-only, repo-only, hybrid, and malformed input.
- Discovery tests with Ollama absent, unreachable, and available.
- Hardware-profile tests on supported OS paths, starting with Linux-first behavior.
- Routing tests that verify provider/model selection changes correctly by task class and hardware fit.
- Compaction tests that verify `context-pack` remains small and stable on wide diffs.
- Wrapper tests for checkpoint behavior and fresh-session recommendation.
- Regression tests ensuring no verification summary claims a command was run when it was not.

## Open Items

- Whether the wrapper should surface routing decisions only as logs or also persist them for later audit.
- How much GPU probing to support in v1 across non-Linux systems.
- Whether provider-inventory should cache discovery results briefly to avoid repeated probing in a single burst.

## Defaults Chosen

- First version stays focused on JS/TS repos using this toolkit.
- The architecture is toolkit plus wrapper.
- Compaction is semi-automatic, not fully opaque.
- Provider routing is hybrid local plus external.
- Registry ownership is hybrid global plus repo-local override.
- Fresh-session handoff is the default fallback when true live-history compaction is unavailable.
