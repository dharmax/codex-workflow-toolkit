import { CONFIG } from "./config.js";
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
