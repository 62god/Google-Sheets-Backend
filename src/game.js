/**
 * src/game.js — lives on GitHub, fetched at runtime by the Apps Script dialog.
 * REPO_BASE is set as a global by Index.html before this file loads.
 *
 * Expected asset locations in this repo (adjust paths below if yours differ):
 *   /assets/sprites/player.png
 *   /assets/sprites/ground.png
 *   /assets/audio/jump.mp3
 *
 * If an asset is missing, the game falls back to solid-color rectangles /
 * silent jumps rather than breaking — so you can test immediately and
 * drop real art in later.
 */

const REPO_BASE = window.REPO_BASE || '';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ---- Tunable physics constants ----
const GRAVITY = 1400;
const JUMP_VELOCITY = -520;
const MOVE_SPEED = 260;
const FRICTION_GROUND = 0.85;

// ---- Player state ----
const player = {
  x: 60, y: 300, w: 32, h: 32,
  vx: 0, vy: 0,
  onGround: false
};

// ---- Level ----
const platforms = [
  { x: 0,   y: 410, w: 800, h: 40 },
  { x: 150, y: 320, w: 120, h: 20 },
  { x: 340, y: 250, w: 120, h: 20 },
  { x: 540, y: 180, w: 140, h: 20 },
  { x: 20,  y: 200, w: 90,  h: 20 }
];

// ---- Asset manifest: paths relative to REPO_BASE ----
const assetSources = {
  player:    `${REPO_BASE}/assets/Sprites/player.png`,
  ground:    `${REPO_BASE}/assets/Sprites/ground.png`,
  jumpSound: `${REPO_BASE}/assets/Audio/jump.mp3`
};

const assets = {};

function loadAssets(onDone) {
  const keys = Object.keys(assetSources);
  let remaining = keys.length;
  if (remaining === 0) { onDone(); return; }

  keys.forEach(key => {
    const src = assetSources[key];
    if (/\.(mp3|wav|ogg)$/i.test(src)) {
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.oncanplaythrough = settle;
      audio.onerror = () => { console.warn(`Missing audio asset: ${key}`); assets[key] = null; settle(); };
      audio.src = src;
      assets[key] = audio;
    } else {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = settle;
      img.onerror = () => { console.warn(`Missing image asset: ${key}, using fallback color`); assets[key] = null; settle(); };
      img.src = src;
      assets[key] = img;
    }
  });

  function settle() {
    remaining--;
    if (remaining <= 0) onDone();
  }
}

// ---- Input ----
const keys = {};
window.addEventListener('keydown', e => { keys[e.code] = true; });
window.addEventListener('keyup',   e => { keys[e.code] = false; });
function isDown(...codes) { return codes.some(c => keys[c]); }

// ---- Collision ----
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

function resolveCollisions(axis) {
  for (const p of platforms) {
    if (!rectsOverlap(player, p)) continue;
    if (axis === 'y') {
      if (player.vy > 0) {
        player.y = p.y - player.h;
        player.vy = 0;
        player.onGround = true;
      } else if (player.vy < 0) {
        player.y = p.y + p.h;
        player.vy = 0;
      }
    } else {
      if (player.vx > 0) player.x = p.x - player.w;
      else if (player.vx < 0) player.x = p.x + p.w;
      player.vx = 0;
    }
  }
}

// ---- Update ----
function update(dt) {
  if (isDown('ArrowLeft', 'KeyA')) {
    player.vx = -MOVE_SPEED;
  } else if (isDown('ArrowRight', 'KeyD')) {
    player.vx = MOVE_SPEED;
  } else {
    player.vx *= FRICTION_GROUND;
    if (Math.abs(player.vx) < 5) player.vx = 0;
  }

  if (isDown('Space', 'ArrowUp', 'KeyW') && player.onGround) {
    player.vy = JUMP_VELOCITY;
    player.onGround = false;
    if (assets.jumpSound) {
      assets.jumpSound.currentTime = 0;
      assets.jumpSound.play().catch(() => {}); // ignore autoplay-block errors
    }
  }

  player.vy += GRAVITY * dt;

  player.x += player.vx * dt;
  resolveCollisions('x');

  player.y += player.vy * dt;
  player.onGround = false;
  resolveCollisions('y');

  player.x = Math.max(0, Math.min(canvas.width - player.w, player.x));

  if (player.y > canvas.height) {
    player.x = 60; player.y = 300; player.vx = 0; player.vy = 0;
  }
}

// ---- Draw ----
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const p of platforms) {
    if (assets.ground) {
      ctx.drawImage(assets.ground, p.x, p.y, p.w, p.h);
    } else {
      ctx.fillStyle = '#3a5f3a';
      ctx.fillRect(p.x, p.y, p.w, p.h);
    }
  }

  if (assets.player) {
    ctx.drawImage(assets.player, player.x, player.y, player.w, player.h);
  } else {
    ctx.fillStyle = '#e94f37';
    ctx.fillRect(player.x, player.y, player.w, player.h);
  }
}

// ---- Loop ----
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

loadAssets(() => {
  lastTime = performance.now();
  requestAnimationFrame(loop);
});
