import test from "node:test";
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
