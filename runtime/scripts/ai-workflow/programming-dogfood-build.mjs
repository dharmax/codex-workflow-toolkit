#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs, printAndExit } from "./lib/cli.mjs";
import { judgeArtifacts } from "../../../core/services/artifact-verification.mjs";
import { getProjectMetrics } from "../../../core/services/sync.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const DEFAULT_TARGET = path.resolve(REPO_ROOT, "dogfood-projects", "space-invaders-emoji-3d");

const PLAN_MARKDOWN = `# Plan

Original prompt: Build a modular, expandable emoji Space Invaders-like game as a real programming dogfood project.

## Objective

- Generate a dedicated-folder project that is immediately runnable.
- Keep the implementation deterministic enough for automated browser checks.
- Preserve workflow artifacts that describe long-term vision, epics, features, and modules.

## Delivery slices

1. Create the game foundation and workflow docs.
2. Implement a playable canvas game with perspective depth, emoji entities, and restart flow.
3. Add deterministic game-state hooks for browser automation.
4. Verify logic with Node tests and verify gameplay visually in a browser.
`;

const BRAINSTORM_MARKDOWN = `# Brainstorm

## Why this shape

- Use a single full-bleed canvas so the game starts immediately.
- Fake 3D through perspective projection and depth-layered enemy rows instead of taking a hard dependency on WebGL.
- Keep logic modules DOM-free so Node tests can validate movement, collisions, wave progression, and restart.
- Use emoji glyphs as real game assets: player \`🚀\`, enemies \`👾\`, shots \`✨\`, explosions \`💥\`.

## Expansion hooks

- Enemy wave definitions can be swapped for boss or formation packs.
- Rendering is isolated from update logic, so later upgrades can move to Three.js without rewriting rules.
- Project docs already describe future module additions like modifiers, bosses, and co-op input.
`;

const README_MD = `# Emoji Star Lanes

A modular canvas game built as an ai-workflow programming dogfood target.

## Run

\`\`\`bash
npm test
npm run dev
\`\`\`

The dev server prefers port \`4173\` and falls back to a free port if that port is already busy.

## Controls

- \`Enter\` or \`Space\`: start / restart
- \`Arrow keys\` or \`A D\`: move
- \`Space\`: shoot
- \`F\`: fullscreen

## Files

- \`src/game/model.js\`: state creation and wave generation
- \`src/game/update.js\`: gameplay rules
- \`src/game/render.js\`: canvas rendering and perspective projection
- \`src/game/text-state.js\`: deterministic automation surface
- \`tests/game-logic.test.mjs\`: core rules regression coverage
`;

const PROJECT_BRIEF_MD = `# Project Brief

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
- Deterministic \`window.advanceTime(ms)\` and \`window.render_game_to_text()\`
- Workflow-facing docs and a clear verification report

### Modules

- \`model\`: state bootstrapping, wave generation, progression metadata
- \`update\`: motion, cooldowns, collisions, win/lose flow
- \`render\`: perspective projection, scene drawing, HUD
- \`text-state\`: concise automation payload
- \`main\`: browser loop, input wiring, fullscreen handling

## Non-Goals

- Networked multiplayer
- Monetization
- Asset pipelines beyond browser-native emoji rendering
`;

const EPICS_MD = `# Epics

## EPIC-GAME-001 Star Lane Defense

- Long-term vision: turn the first playable wave-defense loop into a reusable arcade framework with alternate formations, boss encounters, and drop-in renderers.
- Outcome: a polished first-play experience with deterministic automation and modular game rules.
- Features:
  - Playable emoji wave defense
  - Browser automation hooks
  - Readable workflow report
- Modules:
  - src/game/model.js
  - src/game/update.js
  - src/game/render.js
  - src/game/text-state.js
  - src/main.js

## EPIC-GAME-002 Expansion Packs

- Long-term vision: add bosses, modifiers, and optional co-op input without rewriting the core simulation.
- Outcome: content packs plug into the existing wave, render, and scoring surfaces.
`;

const KANBAN_MD = `# Kanban

## Done

- [x] **GAME-PLAN-001**: Define the modular arcade scope and long-term vision.
- [x] **GAME-CORE-001**: Implement the playable canvas game loop.
- [x] **GAME-TEST-001**: Add deterministic simulation hooks and logic tests.
- [x] **GAME-REPORT-001**: Summarize build, verification, and next extensions.

## Backlog

- [ ] **GAME-EXPAND-001**: Add boss waves and shield mechanics.
- [ ] **GAME-EXPAND-002**: Introduce difficulty presets and alternate enemy formations.
`;

const PROGRESS_MD = `Original prompt: Build a modular, expandable 3d canvas Space Invaders-like game using emoji ships, with workflow docs and verification.

- Planned scope and architecture.
- Added a deterministic simulation loop with browser hooks.
- Added logic tests for start, scoring, and wave progression.
- Next suggested work: boss wave pack, shield objects, audio, and touch controls.
`;

const PACKAGE_JSON = `{
  "name": "space-invaders-emoji-3d",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node scripts/dev-server.mjs",
    "serve": "node scripts/dev-server.mjs",
    "test": "node --test tests/game-logic.test.mjs"
  }
}
`;

const DEV_SERVER_MJS = `#!/usr/bin/env node

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preferredPort = Number.parseInt(String(process.env.PORT ?? "4173"), 10) || 4173;
const host = process.env.HOST || "127.0.0.1";

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".ico", "image/x-icon"]
]);

function resolveRequestPath(urlPath) {
  const pathname = decodeURIComponent(String(urlPath || "/").split("?")[0]);
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(root, "." + normalized);
  if (!filePath.startsWith(root)) {
    return null;
  }
  return filePath;
}

const server = http.createServer(async (request, response) => {
  const filePath = resolveRequestPath(request.url);
  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES.get(path.extname(filePath)) || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    response.end(body);
  } catch (error) {
    if (error?.code === "ENOENT") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(500);
    response.end(String(error?.message ?? error));
  }
});

function start(port) {
  server.listen(port, host, () => {
    const address = server.address();
    const finalPort = typeof address === "object" && address ? address.port : port;
    process.stdout.write("Serving Emoji Star Lanes at http://" + host + ":" + finalPort + "\\n");
  });
}

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    process.stderr.write("Port " + preferredPort + " is busy; falling back to a free port.\\n");
    start(0);
    return;
  }
  throw error;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

start(preferredPort);
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Emoji Star Lanes</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <canvas id="game" aria-label="Emoji Star Lanes"></canvas>
    <script type="module" src="./src/main.js"></script>
  </body>
  </html>
`;

const STYLES_CSS = `:root {
  color-scheme: dark;
}

html,
body {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #08111b;
  font-family: Inter, "Segoe UI Emoji", "Apple Color Emoji", sans-serif;
}

body {
  display: block;
}

canvas {
  display: block;
  width: 100vw;
  height: 100vh;
}
`;

const CONFIG_JS = `export const CONFIG = {
  playerSpeed: 0.95,
  playerY: -0.34,
  playerZ: 0.16,
  playerCooldown: 0.26,
  bulletSpeed: 1.75,
  enemyShotSpeed: 0.92,
  enemyShiftSpeed: 0.18,
  enemyDropStep: 0.055,
  waveRows: 4,
  waveCols: 7,
  enemyBaseY: 0.62,
  enemyRowStep: 0.12,
  enemyColStep: 0.24,
  enemyBaseZ: 1.3,
  enemyRowZStep: 0.22,
  worldMinX: -0.92,
  worldMaxX: 0.92,
  restartDelay: 0.35
};
`;

const MODEL_JS = `import { CONFIG } from "./config.js";

function buildStars() {
  const stars = [];
  for (let index = 0; index < 64; index += 1) {
    const spread = (index * 73) % 97;
    stars.push({
      x: ((spread % 17) / 8) - 1,
      y: ((spread % 29) / 14) - 1,
      z: 0.6 + ((spread % 23) / 20)
    });
  }
  return stars;
}

export function createEnemyWave(level = 1) {
  const enemies = [];
  const horizontalOffset = ((CONFIG.waveCols - 1) * CONFIG.enemyColStep) / 2;
  for (let row = 0; row < CONFIG.waveRows; row += 1) {
    for (let col = 0; col < CONFIG.waveCols; col += 1) {
      enemies.push({
        id: \`enemy-\${level}-\${row}-\${col}\`,
        row,
        col,
        x: (col * CONFIG.enemyColStep) - horizontalOffset,
        y: CONFIG.enemyBaseY - (row * CONFIG.enemyRowStep),
        z: CONFIG.enemyBaseZ - (row * CONFIG.enemyRowZStep),
        alive: true
      });
    }
  }
  return enemies;
}

export function createInitialState() {
  return {
    mode: "start",
    score: 0,
    level: 1,
    lives: 3,
    restartTimer: 0,
    waveTimer: 0,
    enemyFireTimer: 0,
    tick: 0,
    formation: {
      offsetX: 0,
      direction: 1
    },
    player: {
      x: 0,
      y: CONFIG.playerY,
      z: CONFIG.playerZ,
      cooldown: 0,
      invulnerable: 0
    },
    bullets: [],
    enemyShots: [],
    explosions: [],
    enemies: createEnemyWave(1),
    stars: buildStars()
  };
}

export function cloneState(state) {
  return {
    ...state,
    formation: { ...state.formation },
    player: { ...state.player },
    bullets: state.bullets.map((item) => ({ ...item })),
    enemyShots: state.enemyShots.map((item) => ({ ...item })),
    explosions: state.explosions.map((item) => ({ ...item })),
    enemies: state.enemies.map((item) => ({ ...item })),
    stars: state.stars.map((item) => ({ ...item }))
  };
}
`;

const UPDATE_JS = `import { CONFIG } from "./config.js";
import { cloneState, createEnemyWave, createInitialState } from "./model.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function collision(a, b, radius = 0.1) {
  return Math.abs(a.x - b.x) < radius && Math.abs(a.y - b.y) < radius;
}

function activeEnemies(state) {
  return state.enemies.filter((enemy) => enemy.alive !== false);
}

function currentEnemyX(state, enemy) {
  return enemy.x + state.formation.offsetX;
}

function fireEnemyShot(state) {
  const enemies = activeEnemies(state);
  if (!enemies.length) {
    return;
  }
  const targetColumn = Math.floor((state.tick * 10) % CONFIG.waveCols);
  const candidates = enemies
    .filter((enemy) => enemy.col === targetColumn)
    .sort((left, right) => left.row - right.row);
  const shooter = candidates[0] ?? enemies[0];
  state.enemyShots.push({
    x: currentEnemyX(state, shooter),
    y: shooter.y - 0.06,
    z: shooter.z,
    vy: -CONFIG.enemyShotSpeed
  });
}

function startNextWave(state) {
  state.level += 1;
  state.waveTimer = 0;
  state.enemyFireTimer = 0;
  state.formation.offsetX = 0;
  state.formation.direction = state.level % 2 === 0 ? -1 : 1;
  state.enemies = createEnemyWave(state.level);
  state.bullets = [];
  state.enemyShots = [];
}

export function updateGame(previousState, input = {}, dt = 1 / 60) {
  const state = cloneState(previousState);
  state.tick += dt;

  if (state.mode === "start") {
    if (input.start || input.shoot) {
      state.mode = "playing";
    }
    return state;
  }

  if (state.mode === "gameover") {
    state.restartTimer -= dt;
    if ((input.restart || input.start) && state.restartTimer <= 0) {
      return {
        ...createInitialState(),
        mode: "playing"
      };
    }
    return state;
  }

  if (state.waveTimer > 0) {
    state.waveTimer -= dt;
    if (state.waveTimer <= 0) {
      startNextWave(state);
    }
  }

  const moveX = (input.left ? -1 : 0) + (input.right ? 1 : 0);
  state.player.x = clamp(
    state.player.x + (moveX * CONFIG.playerSpeed * dt),
    CONFIG.worldMinX,
    CONFIG.worldMaxX
  );
  state.player.cooldown = Math.max(0, state.player.cooldown - dt);
  state.player.invulnerable = Math.max(0, state.player.invulnerable - dt);

  if ((input.shoot || input.start) && state.player.cooldown <= 0 && state.waveTimer <= 0) {
    state.player.cooldown = CONFIG.playerCooldown;
    state.bullets.push({
      x: state.player.x,
      y: state.player.y + 0.08,
      z: state.player.z + 0.02,
      vy: CONFIG.bulletSpeed
    });
  }

  const formationLimit = 0.42 + (state.level * 0.015);
  state.formation.offsetX += state.formation.direction * (CONFIG.enemyShiftSpeed + (state.level * 0.03)) * dt;
  if (Math.abs(state.formation.offsetX) > formationLimit) {
    state.formation.offsetX = clamp(state.formation.offsetX, -formationLimit, formationLimit);
    state.formation.direction *= -1;
    for (const enemy of state.enemies) {
      enemy.y -= CONFIG.enemyDropStep;
    }
  }

  for (const bullet of state.bullets) {
    bullet.y += bullet.vy * dt;
  }
  state.bullets = state.bullets.filter((bullet) => bullet.y < 1.2);

  state.enemyFireTimer += dt;
  const enemyFireInterval = Math.max(0.42, 1.05 - (state.level * 0.06));
  if (state.enemyFireTimer >= enemyFireInterval && state.waveTimer <= 0) {
    state.enemyFireTimer = 0;
    fireEnemyShot(state);
  }

  for (const shot of state.enemyShots) {
    shot.y += shot.vy * dt;
  }
  state.enemyShots = state.enemyShots.filter((shot) => shot.y > -1.1);

  for (const bullet of [...state.bullets]) {
    const hit = activeEnemies(state).find((enemy) => collision(bullet, { x: currentEnemyX(state, enemy), y: enemy.y }, 0.09));
    if (!hit) {
      continue;
    }
    hit.alive = false;
    state.score += 100;
    state.explosions.push({
      x: currentEnemyX(state, hit),
      y: hit.y,
      z: hit.z,
      ttl: 0.24
    });
    bullet.y = 2;
  }
  state.enemies = state.enemies.filter((enemy) => enemy.alive !== false);
  state.bullets = state.bullets.filter((bullet) => bullet.y < 1.2);

  if (state.player.invulnerable <= 0) {
    for (const shot of [...state.enemyShots]) {
      if (!collision(shot, state.player, 0.085)) {
        continue;
      }
      state.enemyShots = state.enemyShots.filter((item) => item !== shot);
      state.player.invulnerable = 1.1;
      state.lives -= 1;
      if (state.lives <= 0) {
        state.mode = "gameover";
        state.restartTimer = CONFIG.restartDelay;
      }
      break;
    }
  }

  if (activeEnemies(state).some((enemy) => enemy.y <= state.player.y + 0.08)) {
    state.mode = "gameover";
    state.restartTimer = CONFIG.restartDelay;
  }

  if (!activeEnemies(state).length && state.mode === "playing" && state.waveTimer <= 0) {
    state.waveTimer = 0.8;
  }

  for (const explosion of state.explosions) {
    explosion.ttl -= dt;
  }
  state.explosions = state.explosions.filter((explosion) => explosion.ttl > 0);

  return state;
}
`;

const RENDER_JS = `function projectPoint(entity, width, height) {
  const depth = 1 / (1 + (entity.z * 0.8));
  return {
    x: width / 2 + (entity.x * width * 0.36 * depth),
    y: (height * 0.82) - (entity.y * height * 0.4 * depth) - (entity.z * 34),
    scale: Math.max(0.42, depth * 1.8)
  };
}

function drawEmoji(ctx, emoji, entity, width, height) {
  const projected = projectPoint(entity, width, height);
  ctx.save();
  ctx.font = \`\${Math.round(44 * projected.scale)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif\`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, projected.x, projected.y);
  ctx.restore();
}

function drawStarfield(ctx, state, width, height) {
  for (const star of state.stars) {
    const projected = projectPoint(star, width, height);
    ctx.fillStyle = "rgba(201, 242, 255, 0.7)";
    ctx.beginPath();
    ctx.arc(projected.x, projected.y, Math.max(1, projected.scale * 1.6), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFloorGrid(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = "rgba(84, 205, 255, 0.16)";
  ctx.lineWidth = 1;
  for (let index = -5; index <= 5; index += 1) {
    ctx.beginPath();
    ctx.moveTo(width / 2, height * 0.82);
    ctx.lineTo(width / 2 + (index * width * 0.12), height);
    ctx.stroke();
  }
  for (let row = 0; row < 7; row += 1) {
    const y = height * (0.82 + (row * 0.035));
    ctx.beginPath();
    ctx.moveTo(width * 0.18, y);
    ctx.lineTo(width * 0.82, y);
    ctx.stroke();
  }
  ctx.restore();
}

export function renderScene(ctx, state, canvas) {
  const width = canvas.width;
  const height = canvas.height;
  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#09111b");
  background.addColorStop(0.5, "#11233a");
  background.addColorStop(1, "#1f5f5b");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  drawStarfield(ctx, state, width, height);
  drawFloorGrid(ctx, width, height);

  for (const enemy of state.enemies) {
    drawEmoji(ctx, "👾", { x: enemy.x + state.formation.offsetX, y: enemy.y, z: enemy.z }, width, height);
  }
  for (const bullet of state.bullets) {
    drawEmoji(ctx, "✨", bullet, width, height);
  }
  for (const shot of state.enemyShots) {
    drawEmoji(ctx, "💥", shot, width, height);
  }
  for (const explosion of state.explosions) {
    drawEmoji(ctx, "💥", explosion, width, height);
  }

  drawEmoji(ctx, "🚀", state.player, width, height);

  ctx.save();
  ctx.fillStyle = "rgba(236, 247, 255, 0.92)";
  ctx.font = '600 18px Inter, sans-serif';
  ctx.textAlign = "left";
  ctx.fillText(\`Score \${state.score}\`, 22, 32);
  ctx.fillText(\`Lives \${state.lives}\`, 22, 58);
  ctx.fillText(\`Wave \${state.level}\`, 22, 84);
  ctx.restore();

  if (state.mode === "start" || state.mode === "gameover") {
    ctx.save();
    ctx.fillStyle = "rgba(4, 10, 18, 0.62)";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#ecf7ff";
    ctx.textAlign = "center";
    ctx.font = '700 42px Inter, sans-serif';
    ctx.fillText(state.mode === "start" ? "Emoji Star Lanes" : "Restart the Run", width / 2, height * 0.32);
    ctx.font = '500 20px Inter, sans-serif';
    ctx.fillText("Move with arrows or A / D. Shoot with Space. Fullscreen with F.", width / 2, height * 0.39);
    ctx.fillText(state.mode === "start" ? "Press Enter or Space to launch." : "Press Enter or Space to restart.", width / 2, height * 0.45);
    ctx.restore();
  }
}
`;

const TEXT_STATE_JS = `export function renderGameToText(state) {
  return JSON.stringify({
    mode: state.mode,
    score: state.score,
    lives: state.lives,
    level: state.level,
    axes: "x increases right, y increases upward, z increases away from the player",
    player: {
      x: Number(state.player.x.toFixed(3)),
      y: Number(state.player.y.toFixed(3)),
      z: Number(state.player.z.toFixed(3)),
      cooldown: Number(state.player.cooldown.toFixed(3)),
      invulnerable: Number(state.player.invulnerable.toFixed(3))
    },
    enemies: state.enemies.slice(0, 6).map((enemy) => ({
      x: Number((enemy.x + state.formation.offsetX).toFixed(3)),
      y: Number(enemy.y.toFixed(3)),
      z: Number(enemy.z.toFixed(3)),
      row: enemy.row,
      col: enemy.col
    })),
    enemyCount: state.enemies.length,
    bullets: state.bullets.map((bullet) => ({
      x: Number(bullet.x.toFixed(3)),
      y: Number(bullet.y.toFixed(3))
    })),
    enemyShots: state.enemyShots.map((shot) => ({
      x: Number(shot.x.toFixed(3)),
      y: Number(shot.y.toFixed(3))
    }))
  });
}
`;

const MAIN_JS = `import { createInitialState } from "./game/model.js";
import { updateGame } from "./game/update.js";
import { renderScene } from "./game/render.js";
import { renderGameToText } from "./game/text-state.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
let state = createInitialState();
const input = {
  left: false,
  right: false,
  shoot: false,
  start: false,
  restart: false
};

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = \`\${window.innerWidth}px\`;
  canvas.style.height = \`\${window.innerHeight}px\`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function applyInput(flag, value) {
  input[flag] = value;
}

function handleKey(event, pressed) {
  switch (event.key.toLowerCase()) {
    case "arrowleft":
    case "a":
      applyInput("left", pressed);
      break;
    case "arrowright":
    case "d":
      applyInput("right", pressed);
      break;
    case " ":
      applyInput("shoot", pressed);
      if (pressed) {
        applyInput("start", true);
      }
      event.preventDefault();
      break;
    case "enter":
      applyInput("start", pressed);
      applyInput("restart", pressed);
      break;
    case "f":
      if (pressed) {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      }
      break;
    default:
      break;
  }
}

function step(dt) {
  state = updateGame(state, input, dt);
  renderScene(ctx, state, canvas);
  input.start = false;
  input.restart = false;
}

let lastTime = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  step(dt);
  requestAnimationFrame(frame);
}

window.addEventListener("resize", resize);
window.addEventListener("keydown", (event) => handleKey(event, true));
window.addEventListener("keyup", (event) => handleKey(event, false));

window.render_game_to_text = () => renderGameToText(state);
window.advanceTime = (ms) => {
  const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  const dt = ms / 1000 / steps;
  for (let index = 0; index < steps; index += 1) {
    step(dt);
  }
  return window.render_game_to_text();
};

resize();
renderScene(ctx, state, canvas);
requestAnimationFrame(frame);
`;

const TEST_JS = `import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState } from "../src/game/model.js";
import { updateGame } from "../src/game/update.js";

test("start input enters the playing mode", () => {
  const state = createInitialState();
  const next = updateGame(state, { start: true }, 1 / 60);
  assert.equal(next.mode, "playing");
});

test("player bullets remove enemies and increase score", () => {
  let state = createInitialState();
  state.mode = "playing";
  state.enemies = [{ id: "enemy", row: 0, col: 0, x: 0, y: -0.1, z: 1, alive: true }];
  state.bullets = [{ x: 0, y: -0.18, z: 0.2, vy: 1.75 }];

  state = updateGame(state, {}, 0.08);
  assert.equal(state.enemies.length, 0);
  assert.equal(state.score, 100);
});

test("clearing a wave schedules the next level", () => {
  let state = createInitialState();
  state.mode = "playing";
  state.enemies = [];
  state.waveTimer = 0;

  state = updateGame(state, {}, 0.01);
  assert.equal(state.waveTimer > 0, true);

  state = updateGame(state, {}, 1);
  assert.equal(state.level, 2);
  assert.equal(state.enemies.length > 0, true);
});
`;

const TEMPLATE_FILES = {
  "README.md": README_MD,
  "project-brief.md": PROJECT_BRIEF_MD,
  "epics.md": EPICS_MD,
  "kanban.md": KANBAN_MD,
  "progress.md": PROGRESS_MD,
  "package.json": PACKAGE_JSON,
  "scripts/dev-server.mjs": DEV_SERVER_MJS,
  "index.html": INDEX_HTML,
  "styles.css": STYLES_CSS,
  "src/game/config.js": CONFIG_JS,
  "src/game/model.js": MODEL_JS,
  "src/game/update.js": UPDATE_JS,
  "src/game/render.js": RENDER_JS,
  "src/game/text-state.js": TEXT_STATE_JS,
  "src/main.js": MAIN_JS,
  "tests/game-logic.test.mjs": TEST_JS,
  "docs/planning.md": PLAN_MARKDOWN,
  "docs/brainstorming.md": BRAINSTORM_MARKDOWN
};

async function writeTemplateFiles(targetRoot) {
  for (const [relativePath, content] of Object.entries(TEMPLATE_FILES)) {
    const fullPath = path.join(targetRoot, relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf8");
  }
}

async function mergePackageJson(targetRoot) {
  const templatePackage = JSON.parse(PACKAGE_JSON);
  const existingPath = path.join(targetRoot, "package.json");
  const existing = JSON.parse(await readFile(existingPath, "utf8").catch(() => "{}"));
  const merged = {
    ...existing,
    ...templatePackage,
    scripts: {
      ...(existing.scripts ?? {}),
      ...(templatePackage.scripts ?? {})
    }
  };
  await writeFile(existingPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

async function runNode(args, cwd) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, { cwd, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, code: 0, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      code: error.code ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? error.message
    };
  }
}

function summarizeCodeletObserver(payload) {
  if (!payload?.result) {
    return "observer unavailable";
  }
  return payload.result.summary || "observer produced no summary";
}

function summarizeArtifactJudge(payload) {
  if (!payload?.result) {
    return "judge unavailable";
  }
  return `${payload.result.status} (${Math.round((payload.result.score ?? 0) * 100) / 100}) ${payload.result.summary ?? ""}`.trim();
}

async function writeReport({ targetRoot, testResult, artifactJudge, observer, repoMetrics }) {
  const latestWindow = repoMetrics.windows?.latestSession ?? {};
  const latestDiagnostics = latestWindow.diagnostics ?? {};
  const latestQuality = latestWindow.quality ?? {};
  const latestTopFailure = Array.isArray(latestDiagnostics.topFailures) ? latestDiagnostics.topFailures[0] : null;
  const latestStage = Array.isArray(latestDiagnostics.byStage) ? latestDiagnostics.byStage[0] : null;
  const latestAlert = Array.isArray(latestWindow.alerts) ? latestWindow.alerts[0] : null;
  const report = `# Programming Dogfood Report

## Status

- Project: ${path.basename(targetRoot)}
- Logic tests: ${testResult.ok ? "pass" : "fail"}
- Artifact judge: ${summarizeArtifactJudge(artifactJudge)}
- Smart observer: ${summarizeCodeletObserver(observer)}

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
- Added \`window.advanceTime(ms)\` and \`window.render_game_to_text()\`.

### Testing

- Command: \`npm test\`
- Exit code: ${testResult.code}

\`\`\`
${(testResult.stdout || testResult.stderr || "No output").trim()}
\`\`\`

### Metrics Snapshot

- Repo total calls: ${repoMetrics.totalCalls}
- Latest-session quality score: ${latestQuality.qualityScore ?? 0}
- Latest-session success rate: ${latestQuality.successRate ?? 0}%
- Latest-session fallback runs: ${latestDiagnostics.fallbackRuns ?? 0}
- Latest-session failed attempts before recovery: ${latestDiagnostics.failedAttempts ?? 0}
- Latest-session stage summary: ${latestStage ? `${latestStage.stage} ${latestStage.successRate}% success over ${latestStage.calls} call(s)` : "n/a"}
- Latest-session failure hotspot: ${latestTopFailure ? `${latestTopFailure.label} (${latestTopFailure.count})` : "none"}
- Latest-session alert: ${latestAlert ?? "none"}

## Next Extensions

- Boss encounters that occupy the front lane and force dodge timing.
- Shield entities that absorb enemy fire.
- Touch controls and audio cues for mobile-friendly play.
`;
  await writeFile(path.join(targetRoot, "BUILD-REPORT.md"), report, "utf8");
}

export async function runProgrammingDogfood(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const targetRoot = path.resolve(String(args.target ?? DEFAULT_TARGET));
  const force = Boolean(args.force);
  const json = Boolean(args.json);
  const skipInit = Boolean(args["skip-init"]);

  if (force) {
    await rm(targetRoot, { recursive: true, force: true });
  }

  await mkdir(path.dirname(targetRoot), { recursive: true });

  if (!skipInit) {
    await runNode([path.join(REPO_ROOT, "scripts", "init-project.mjs"), "--target", targetRoot], REPO_ROOT);
  }

  await writeTemplateFiles(targetRoot);
  await mergePackageJson(targetRoot);

  const testResult = await runNode(["--test", "tests/game-logic.test.mjs"], targetRoot);
  const artifactJudge = await judgeArtifacts({
    projectRoot: targetRoot,
    artifactPaths: ["project-brief.md", "README.md"],
    rubric: "The artifacts must clearly describe the long-term vision, epic scope, features, modules, controls, and verification posture for the generated game."
  }).catch((error) => ({ result: { status: "needs_human_review", score: 0, summary: String(error?.message ?? error) } }));
  const observer = null;
  const repoMetrics = await getProjectMetrics({ projectRoot: REPO_ROOT }).catch(() => ({ totalCalls: 0, windows: { latestSession: { quality: { qualityScore: 0, successRate: 0 }, diagnostics: { fallbackRuns: 0, failedAttempts: 0, byStage: [], topFailures: [] }, alerts: [] } } }));

  await writeReport({ targetRoot, testResult, artifactJudge, observer, repoMetrics });

  const payload = {
    targetRoot,
    planPath: path.join(targetRoot, "docs", "planning.md"),
    brainstormPath: path.join(targetRoot, "docs", "brainstorming.md"),
    reportPath: path.join(targetRoot, "BUILD-REPORT.md"),
    logicTest: testResult,
    artifactJudge: artifactJudge?.result ?? null,
    observer: observer?.result ?? null
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write([
      `Generated: ${targetRoot}`,
      `Report: ${payload.reportPath}`,
      `Logic tests: ${testResult.ok ? "pass" : "fail"}`,
      `Artifact judge: ${summarizeArtifactJudge(artifactJudge)}`,
      `Smart observer: ${summarizeCodeletObserver(observer)}`
    ].join("\n") + "\n");
  }

  return testResult.ok ? 0 : 1;
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  const exitCode = await runProgrammingDogfood();
  process.exitCode = typeof exitCode === "number" ? exitCode : 0;
}
