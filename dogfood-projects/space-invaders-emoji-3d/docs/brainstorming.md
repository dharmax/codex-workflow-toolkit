# Brainstorm

## Why this shape

- Use a single full-bleed canvas so the game starts immediately.
- Fake 3D through perspective projection and depth-layered enemy rows instead of taking a hard dependency on WebGL.
- Keep logic modules DOM-free so Node tests can validate movement, collisions, wave progression, and restart.
- Use emoji glyphs as real game assets: player `🚀`, enemies `👾`, shots `✨`, explosions `💥`.

## Expansion hooks

- Enemy wave definitions can be swapped for boss or formation packs.
- Rendering is isolated from update logic, so later upgrades can move to Three.js without rewriting rules.
- Project docs already describe future module additions like modifiers, bosses, and co-op input.
