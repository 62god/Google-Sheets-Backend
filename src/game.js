// ---- Update: play ----
function updatePlay(dt) {
  if (isDown('ArrowLeft', 'KeyA')) {
    player.vx = -MOVE_SPEED;
  } else if (isDown('ArrowRight', 'KeyD')) {
    player.vx = MOVE_SPEED;
  } else {
    player.vx *= FRICTION_GROUND;
    if (Math.abs(player.vx) < 5) player.vx = 0;
  }

  // Handle jump input: only allow jumping if on the ground
  if (isDown('Space', 'ArrowUp', 'KeyW') && player.onGround) {
    player.vy = JUMP_VELOCITY;
    player.onGround = false;
    if (assets.jumpSound) {
      assets.jumpSound.currentTime = 0;
      assets.jumpSound.play().catch(() => {});
    }
  }

  player.vy += GRAVITY * dt;

  // Move and resolve horizontal collisions first
  player.x += player.vx * dt;
  resolveCollisions('x');

  // Reset onGround to false before vertical movement/collision checks.
  // This ensures player.onGround is only true if a vertical collision 
  // with a solid floor occurs during this frame's resolution.
  player.onGround = false;

  player.y += player.vy * dt;
  resolveCollisions('y');

  player.x = Math.max(0, Math.min(currentLevel.width - player.w, player.x));

  checkHazards();

  if (player.y > levelFloorY(currentLevel) + 150) {
    resetPlayer('fell-off');
  }

  const viewW = canvas.width, viewH = canvas.height;
  camera.x = currentLevel.width <= viewW ? 0 :
    Math.max(0, Math.min(currentLevel.width - viewW, player.x - viewW / 2));
  camera.y = currentLevel.height <= viewH ? 0 :
    Math.max(0, Math.min(currentLevel.height - viewH, player.y - viewH / 2));
}
