import { CONFIG } from "./config.js";

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
        id: `enemy-${level}-${row}-${col}`,
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
