function projectPoint(entity, width, height) {
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
  ctx.font = `${Math.round(44 * projected.scale)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
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
  ctx.fillText(`Score ${state.score}`, 22, 32);
  ctx.fillText(`Lives ${state.lives}`, 22, 58);
  ctx.fillText(`Wave ${state.level}`, 22, 84);
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
