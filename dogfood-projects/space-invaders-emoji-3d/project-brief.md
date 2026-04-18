# Project Brief

## Overview

Emoji Star Lanes is a fast arcade defense game where the player steers a rocket through layered enemy formations rendered with a light 3D perspective.

## Long-Term Vision

Build a reusable arcade framework where each wave pack, enemy behavior, and rendering style is swappable. The first release proves the gameplay loop and the workflow around planning, implementation, testing, debugging, and reporting.

## EPIC-GAME-001 Star Lane Defense

### Vision

Ship a polished first-play experience with a modular code layout, deterministic automation hooks, and enough architecture headroom for bosses, powerups, and alternate formations.

### Features

- Immediate play start with readable controls
- Perspective-staged emoji enemy waves
- Player movement, shooting, enemy fire, scoring, lives, and restart
- Deterministic `window.advanceTime(ms)` and `window.render_game_to_text()`
- Workflow-facing docs and a clear verification report

### Modules

- `model`: state bootstrapping, wave generation, progression metadata
- `update`: motion, cooldowns, collisions, win/lose flow
- `render`: perspective projection, scene drawing, HUD
- `text-state`: concise automation payload
- `main`: browser loop, input wiring, fullscreen handling

## Non-Goals

- Networked multiplayer
- Monetization
- Asset pipelines beyond browser-native emoji rendering
