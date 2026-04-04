---
name: "ai-workflow"
description: "Use when the user wants project or game status, beta or release readiness, shipping blockers, current work, or guarded execution against a repo. Prefer this for requests like 'is this ready for beta?', 'help me ship this game', 'what blockers remain?', and 'use the workflow tools safely'."
---

# AI Workflow Skill

Use this skill when you want the shared `ai-workflow` toolkit to guide repo work instead of reconstructing workflow logic in the prompt.

Trigger this skill for:
- game beta release preparation
- project or game status checks
- beta, release, or handoff readiness questions
- blocker discovery and blocker-driven execution planning
- guarded use of the workflow toolkit against a real repo
- requests to use workflow tools safely or with low risk

This skill is designed for low-risk operation:
- default to read-only questions through `ask`
- use `--mode tool-dev --evidence-root <project>` when operating from the toolkit repo against an external project
- only use mutating shell flows when the user explicitly asks for them
- treat readiness, status, and current-work checks as safe by default

## Resolve the CLI

Use the wrapper script:

```bash
export AI_WORKFLOW_HOME="${AI_WORKFLOW_HOME:-$HOME/.ai-workflow}"
export AIWF="$AI_WORKFLOW_HOME/skills/ai-workflow/scripts/ai_workflow.sh"
```

The wrapper will use `ai-workflow` from `PATH` when available. If it is not on `PATH`, it will fall back to the toolkit root recorded at install time.

## Safe default workflow

For a real project:

```bash
"$AIWF" ask --mode tool-dev --evidence-root /abs/path/to/project "what's the project status? how ready is it for beta test?"
```

Readiness only:

```bash
"$AIWF" ask --mode tool-dev --evidence-root /abs/path/to/project "Is this project ready for beta testing?"
```

Current work:

```bash
"$AIWF" ask --mode tool-dev --evidence-root /abs/path/to/project "What are we working on right now?"
```

## Mutating workflow

Only use these when the user clearly wants execution:

```bash
"$AIWF" shell --no-ai
```

Then ask concrete follow-ups such as:

```text
is this project ready for beta testing?
can you resolve those blockers?
fix BUG-OVERLAY-01
```

## Guardrails

- Prefer `ask` before `shell`.
- Prefer `--mode tool-dev --evidence-root <project>` when the toolkit lives outside the target repo.
- Do not invent readiness logic in the prompt when the toolkit can answer it directly.
- Do not run mutating actions without explicit user intent.
