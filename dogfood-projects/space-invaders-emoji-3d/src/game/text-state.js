export function renderGameToText(state) {
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
