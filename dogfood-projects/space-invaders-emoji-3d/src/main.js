import { createInitialState } from "./game/model.js";
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
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
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
