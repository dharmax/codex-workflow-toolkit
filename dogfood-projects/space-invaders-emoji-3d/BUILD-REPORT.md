# Programming Dogfood Report

## Status

- Project: space-invaders-emoji-3d
- Logic tests: pass
- Artifact judge: pass (5) The artifacts provide a comprehensive description of the game's long-term vision, epic scope, features, modules, controls, and verification posture.
- Smart observer: observer unavailable

## Phases

### Planning

- Defined a dedicated arcade target with deterministic verification hooks.
- Committed the long-term vision, epic, features, and modules to workflow-facing docs.

### Brainstorming

- Chose emoji-rendered entities and perspective projection instead of a heavier runtime dependency.
- Kept simulation logic separate from rendering so browser tests and Node tests can share rules.

### Implementation

- Added a playable full-screen canvas loop.
- Added player movement, shooting, enemy waves, lives, scoring, and restart.
- Added `window.advanceTime(ms)` and `window.render_game_to_text()`.

### Testing

- Command: `npm test`
- Exit code: 0

```
✔ start input enters the playing mode (1.391314ms)
✔ player bullets remove enemies and increase score (4.062241ms)
✔ clearing a wave schedules the next level (0.39083ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 61.468221
```

### Metrics Snapshot

- Repo total calls: 11
- Latest-session quality score: 86
- Latest-session success rate: 86%
- Latest-session fallback runs: 6
- Latest-session failed attempts before recovery: 12
- Latest-session stage summary: operator-planning 100% success over 3 call(s)
- Latest-session failure hotspot: google:gemini-2.0-flash Gemini API key is blocked for Generative Language API. Please ensure 'Generative Language API' is enabled in your Google Cloud Projec... (3)
- Latest-session alert: Fallback used in 6 run(s), with 12 failed attempt(s) and 1s lost before recovery.

## Next Extensions

- Boss encounters that occupy the front lane and force dodge timing.
- Shield entities that absorb enemy fire.
- Touch controls and audio cues for mobile-friendly play.
