# Emoji Star Lanes

A modular canvas game built as an ai-workflow programming dogfood target.

## Run

```bash
npm test
npm run dev
```

The dev server prefers port `4173` and falls back to a free port if that port is already busy.

## Controls

- `Enter` or `Space`: start / restart
- `Arrow keys` or `A D`: move
- `Space`: shoot
- `F`: fullscreen

## Files

- `src/game/model.js`: state creation and wave generation
- `src/game/update.js`: gameplay rules
- `src/game/render.js`: canvas rendering and perspective projection
- `src/game/text-state.js`: deterministic automation surface
- `tests/game-logic.test.mjs`: core rules regression coverage
