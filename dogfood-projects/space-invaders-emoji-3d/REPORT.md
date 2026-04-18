# Programming Dogfood Report

## Executive Summary

- The shell-generated project exists at `/home/dharmax/work/ai-workflow/dogfood-projects/space-invaders-emoji-3d` and its browser/game checks passed.
- The shell transcript is at `/home/dharmax/work/ai-workflow/dogfood-projects/space-invaders-emoji-3d/artifacts/shell/dialog.md` and the raw turn log is at `/home/dharmax/work/ai-workflow/dogfood-projects/space-invaders-emoji-3d/artifacts/shell/turns.jsonl`.
- Natural-language human prompts: 4/4 (100%).
- Builder output report: `/home/dharmax/work/ai-workflow/dogfood-projects/space-invaders-emoji-3d/BUILD-REPORT.md`.
- Logic tests: pass.
- Artifact judge: pass.
- Transcript judge: needs_human_review.

## What The Human Asked For

- A modular, expandable 3d canvas Space Invaders-style game that uses emoji ships.
- Long-term vision, epics, features, modules, planning notes, tests, and debugging expectations.
- A dedicated dogfood project folder that works through the real `ai-workflow shell` flow rather than a hidden direct write.
- A project that still runs with `npm run dev` and `npm run serve` even if port `4173` is already busy.

## What The Shell Actually Did

### Turn 1
- Human prompt: Please create a new feature for a modular, expandable 3d canvas Space Invaders-style game that uses emoji ships. I want the long-term vision, epics, features, modules, planning notes, tests, and debugging expectations to be part of the work.
- Shell mode: auto -> feature (inferred)
- Execution stance: plan-only
- Plan summary: status_query
- Executed actions: status_query

### Turn 2
- Human prompt: Please build that into a dedicated programming dogfood project in "/home/dharmax/work/ai-workflow/dogfood-projects/space-invaders-emoji-3d" from scratch, and reply in JSON so I can inspect the result.
- Shell mode: auto -> feature (inferred)
- Execution stance: plan-only
- Plan summary: run_codelet
- Executed actions: run_codelet

### Turn 3
- Human prompt: Can you find Emoji Star Lanes in the generated project and show me where the title and main game files ended up?
- Shell mode: auto -> feature (inferred)
- Execution stance: plan-only
- Plan summary: search
- Executed actions: search

### Turn 4
- Human prompt: Can you look up EPIC-GAME-001 in the generated project and show me whether the long-term vision and module split are there?
- Shell mode: auto -> feature (inferred)
- Execution stance: plan-only
- Plan summary: search
- Executed actions: search

## Evidence

- Game title found through shell search: `Emoji Star Lanes`.
- Main epic found through shell search: `EPIC-GAME-001`.
- Raw shell transcript: `/home/dharmax/work/ai-workflow/dogfood-projects/space-invaders-emoji-3d/artifacts/shell/raw-transcript.md`.
- Per-turn raw logs: `/home/dharmax/work/ai-workflow/dogfood-projects/space-invaders-emoji-3d/artifacts/shell/raw`.
- Playwright screenshot: `/home/dharmax/work/ai-workflow/output/playwright/space-invaders-dogfood.png`.
- Shell governance log: `/home/dharmax/work/ai-workflow/dogfood-projects/space-invaders-emoji-3d/artifacts/goe/governance.json`.

## Run Validation

- `npm run dev`: pass (http://127.0.0.1:45549)
- `npm run serve`: pass (http://127.0.0.1:40333)
- Port 4173 occupancy during validation: external

## Metrics Snapshot

- Repo total calls: 11
- Latest-session quality score: 86
- Latest-session success rate: 86%
- Latest-session fallback runs: 6
- Latest-session failed attempts before recovery: 12
- Latest-session top stage: operator-planning (100% over 3 call(s))
- Latest failure hotspot: google:gemini-2.0-flash Gemini API key is blocked for Generative Language API. Please ensure 'Generative Language API' is enabled in your Google Cloud Projec... (3)

## Bugs Found While Dogfooding

- Fixed: natural-language build requests were being swallowed by broader staged-planning heuristics instead of routing to the intended dogfood builder.
- Fixed: the generated project used a hard-coded Python server and failed whenever `4173` was already in use.
- Fixed: the builder emitted multiple JSON blobs to stdout, which made shell-side result parsing brittle.
- Still open: the shell transcript judge returned malformed output ([0.38, 0.73, 0.5, 0.82]) instead of a structured verdict.

## Remaining Gaps

- This run records shell interpretation and artifact governance, but it does not claim the broader repo-wide GoE triad is fully implemented.
- The transcript judge is still unreliable and should be treated as a workflow bug until it consistently returns structured output.
- The project docs are good enough to pass artifact review, but the artifact judge still recommends richer user stories and ticket batches in the epic docs.
