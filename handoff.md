# Gemini CLI Handoff

## Current State

- Branch: `step4`
- Local `master` includes the shell / Ollama hardware / robustness work at commit `d805f67` (`Add shell mode and Ollama hardware setup`).
- Local legacy branches `step2` and `step3` were deleted after merging their work forward.
- Remote cleanup is not complete from this machine:
  - `git push origin master` failed with GitHub auth error: `Invalid username or token`.
  - `origin/step2` and `origin/step3` likely still exist until someone with working auth deletes them.

## What Was Just Finished

- `init` now performs the initial sync by default, with opt-out support.
- The SQLite sync path no longer crashes on duplicate claim IDs from repeated facts in one file.
- Ollama discovery supports a configured remote host.
- `ai-workflow shell` was added:
  - interactive mode
  - one-shot mode
  - heuristic fallback planning
  - bounded AI recovery attempt on failed actions
  - safer help handling
  - `set-ollama-hw` works as an in-shell command
- `ai-workflow set-ollama-hw` was added and simplified:
  - prompts line-by-line for `GPU model`, `CPU cores`, `GPU VRAM in GB`, `System RAM in GB`
  - can still accept probe or flags
- Key runtime paths now tolerate malformed project config more gracefully and surface warnings instead of crashing immediately.

## Run These First

```bash
git status --short --branch
node --test tests/providers.test.mjs tests/shell.test.mjs tests/ollama-hw.test.mjs tests/workflow-db.test.mjs
pnpm exec ai-workflow doctor
pnpm exec ai-workflow shell
```

## Commands Gemini Should Know

```bash
pnpm exec ai-workflow shell
pnpm exec ai-workflow shell "what can you do?"
pnpm exec ai-workflow shell "set-ollama-hw --global"
pnpm exec ai-workflow set-ollama-hw --global
pnpm exec ai-workflow doctor
pnpm exec ai-workflow sync
```

Useful shell prompts:

```text
summary
sync and show review hotspots
search router race condition
ticket TKT-001
set-ollama-hw --global
```

## Files To Read First

- `cli/lib/shell.mjs`
- `cli/lib/ollama-hw.mjs`
- `core/services/providers.mjs`
- `cli/lib/config-store.mjs`
- `cli/lib/doctor.mjs`
- `scripts/init-project.mjs`

## Known Rough Edges

- The focused regression tests above pass. Full-suite status is not guaranteed by this handoff.
- Shell behavior is materially better, but real-world intent routing and recovery likely still need refinement.
- Config tolerance was improved in key paths, but not every CLI path has been audited to the same standard.
- Remote git cleanup was blocked by auth, so publishing `master` and deleting `origin/step2` / `origin/step3` still needs a machine/session with valid GitHub credentials.

## Recommended Next Tasks

1. Push local `master` to `origin`.
2. Delete `origin/step2` and `origin/step3`.
3. Push `step4`.
4. Keep polishing shell UX:
   - help output
   - intent classification
   - recovery after failed actions
5. Improve provider setup UX beyond raw config editing.
6. Expand integration coverage around shell + provider execution paths.

## Exact Git Commands To Finish Remote Cleanup

```bash
git checkout master
git push origin master
git push origin --delete step2 step3
git checkout step4
git push -u origin step4
```

## Sanity Notes

- If the shell feels slow, set the Ollama hardware explicitly before further tuning:

```bash
pnpm exec ai-workflow set-ollama-hw --global
```

- If project config is malformed, `doctor` and `shell` should now warn rather than die, but fixing the JSON is still the right long-term move.
