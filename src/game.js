/**
 * src/game.js — lives on GitHub, fetched at runtime by the Apps Script dialog.
 * REPO_BASE is set as a global by Index.html before this file loads.
 *
 * States: 'menu' -> 'editor' (Create) or 'play' (after Import/default)
 *
 * Level JSON format:
 * {
 *   "width": 2400, "height": 450,
 *   "playerStart": { "x": 60, "y": 300 },
 *   "tiles": [ { "x": 0, "y": 410, "w": 800, "h": 40, "type": "ground" }, ... ]
 * }
 *
 * Export/Import both go through a plain textarea (copy/paste), not file
 * downloads — Apps Script's HtmlService sandbox has repeatedly proven
 * unreliable for anything download/base-href related, so this sticks to
 * the approach we know actually works here.
 */

const REPO_BASE = window.REPO_BASE || '';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const hint = document.getElementById('hint');

// ---- Tunable physics constants ----
const GRAVITY = 1400;
const JUMP_VELOCITY = -520;
const MOVE_SPEED = 260;
const FRICTION_GROUND = 0.85;
const TILE_SIZE = 40;
const SCROLL_SPEED = 400; // px/s, editor camera pan

// ---- Tile visuals ----
const TILE_FALLBACK_COLORS = { ground: '#3a5f3a', rock: '#7a7a7a', wood: '#8b5a2b' };
const TILE_TYPES = ['ground', 'rock', 'wood'];

// ---- Asset manifest ----
const assetSources = {
  player:    `${REPO_BASE}/assets/Sprites/player.png`,
  ground:    `${REPO_BASE}/assets/Sprites/ground.png`,
  rock:      `${REPO_BASE}/assets/Sprites/rock.png`,
  wood:      `${REPO_BASE}/assets/Sprites/wood.png`,
  jumpSound: `${REPO_BASE}/assets/audio/jump.mp3`
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
      audio.oncanplaythrough = settle;
      audio.onerror = () => { console.warn(`Missing audio asset: ${key}`); assets[key] = null; settle(); };
      audio.src = src;
      assets[key] = audio;
    } else {
      const img = new Image();
      img.onload = settle;
      img.onerror = () => { console.warn(`Missing image asset: ${key}, using fallback color`); assets[key] = null; settle(); };
      img.src = src;
      assets[key] = img;
    }
  });
  function settle() { remaining--; if (remaining <= 0) onDone(); }
}

// ---- Default level ----
const DEFAULT_LEVEL = {
  width: 800, height: 450,
  playerStart: { x: 60, y: 300 },
  tiles: [
    { x: 0,   y: 410, w: 800, h: 40, type: 'ground' },
    { x: 150, y: 320, w: 120, h: 20, type: 'ground' },
    { x: 340, y: 250, w: 120, h: 20, type: 'wood' },
    { x: 540, y: 180, w: 140, h: 20, type: 'rock' },
    { x: 20,  y: 200, w: 90,  h: 20, type: 'ground' }
  ]
};

let currentLevel = JSON.parse(JSON.stringify(DEFAULT_LEVEL));

// ---- Player ----
const player = { x: 60, y: 300, w: 32, h: 32, vx: 0, vy: 0, onGround: false };
function resetPlayer() {
  player.x = currentLevel.playerStart.x;
  player.y = currentLevel.playerStart.y;
  player.vx = 0; player.vy = 0; player.onGround = false;
}

// ---- Camera ----
const camera = { x: 0 };

// ---- App state ----
let state = 'menu'; // 'menu' | 'editor' | 'play'

// ---- Overlay DOM (created once, shown/hidden as needed) ----
const overlay = document.createElement('div');
overlay.style.display = 'none';
overlay.style.maxWidth = '760px';
overlay.style.margin = '10px auto';
overlay.style.textAlign = 'center';

const overlayLabel = document.createElement('p');
overlayLabel.style.color = '#cfd3dc';
overlayLabel.style.fontSize = '13px';
overlayLabel.style.margin = '4px 0';

const overlayTextarea = document.createElement('textarea');
overlayTextarea.style.width = '100%';
overlayTextarea.style.height = '140px';
overlayTextarea.style.fontFamily = 'monospace';
overlayTextarea.style.fontSize = '11px';
overlayTextarea.style.boxSizing = 'border-box';

const overlayButtons = document.createElement('div');
overlayButtons.style.marginTop = '6px';

function makeButton(text, onClick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.style.margin = '0 6px';
  b.style.padding = '6px 14px';
  b.style.cursor = 'pointer';
  b.addEventListener('click', onClick);
  return b;
}

overlay.appendChild(overlayLabel);
overlay.appendChild(overlayTextarea);
overlay.appendChild(overlayButtons);
document.body.appendChild(overlay);

function hideOverlay() {
  overlay.style.display = 'none';
  overlayButtons.innerHTML = '';
}

function showExportOverlay(levelData) {
  overlayLabel.textContent = 'Your level as JSON — copy this and save it as a .json file:';
  overlayTextarea.readOnly = true;
  overlayTextarea.value = JSON.stringify(levelData, null, 2);
  overlayButtons.innerHTML = '';
  overlayButtons.appendChild(makeButton('Copy', () => {
    overlayTextarea.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(overlayTextarea.value).catch(() => {});
    }
    overlayLabel.textContent = "Copied (or press Ctrl+C / Cmd+C if it didn't work automatically):";
  }));
  overlayButtons.appendChild(makeButton('Close', hideOverlay));
  overlay.style.display = 'block';
}

function showImportOverlay() {
  overlayLabel.textContent = 'Paste level JSON here:';
  overlayTextarea.readOnly = false;
  overlayTextarea.value = '';
  overlayButtons.innerHTML = '';
  overlayButtons.appendChild(makeButton('Load', () => {
    try {
      const parsed = JSON.parse(overlayTextarea.value);
      if (!parsed.tiles || !Array.isArray(parsed.tiles) || !parsed.playerStart) {
        throw new Error('Missing tiles[] or playerStart');
      }
      currentLevel = parsed;
      resetPlayer();
      camera.x = 0;
      hideOverlay();
      state = 'play';
    } catch (err) {
      overlayLabel.textContent = 'Invalid JSON: ' + err.message;
    }
  }));
  overlayButtons.appendChild(makeButton('Cancel', () => { hideOverlay(); }));
  overlay.style.display = 'block';
}

// ---- Menu button geometry (mirrors the mockup layout) ----
const menuButtons = [
  { id: 'create', label: 'Create', x: 100, y: 160, w: 220, h: 140 },
  { id: 'import', label: 'Import', x: 460, y: 160, w: 220, h: 140 }
];

// ---- Editor state ----
const editorTiles = new Map(); // "gx,gy" -> type
let editorTool = 'ground';     // one of TILE_TYPES, or 'start', or 'erase'
let editorPlayerStart = { x: 60, y: 300 };
const EDITOR_LEVEL_WIDTH = 2400;
const EDITOR_LEVEL_HEIGHT = 450;

const editorToolbar = (() => {
  const defs = [...TILE_TYPES.map(t => ({ id: t, label: t[0].toUpperCase() + t.slice(1) })),
                { id: 'start', label: 'Spawn' },
                { id: 'erase', label: 'Erase' }];
  let x = 10;
  const buttons = defs.map(d => {
    const btn = { ...d, x, y: 5, w: 90, h: 28 };
    x += 96;
    return btn;
  });
  buttons.push({ id: 'export', label: 'Export', x: canvas.width - 190, y: 5, w: 85, h: 28 });
  buttons.push({ id: 'menu', label: 'Menu', x: canvas.width - 95, y: 5, w: 85, h: 28 });
  return buttons;
})();

function loadCurrentLevelIntoEditor() {
  editorTiles.clear();
  for (const t of currentLevel.tiles) {
    if (t.w === TILE_SIZE && t.h === TILE_SIZE) {
      editorTiles.set(`${Math.round(t.x / TILE_SIZE)},${Math.round(t.y / TILE_SIZE)}`, t.type);
    }
  }
  editorPlayerStart = { x: currentLevel.playerStart.x, y: currentLevel.playerStart.y };
}

function exportEditorLevel() {
  const tiles = [];
  for (const [key, type] of editorTiles.entries()) {
    const [gx, gy] = key.split(',').map(Number);
    tiles.push({ x: gx * TILE_SIZE, y: gy * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE, type });
  }
  return {
    width: EDITOR_LEVEL_WIDTH,
    height: EDITOR_LEVEL_HEIGHT,
    playerStart: editorPlayerStart,
    tiles
  };
}

// ---- Input ----
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Escape' && (state === 'editor' || state === 'play')) {
    hideOverlay();
    state = 'menu';
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
function isDown(...codes) { return codes.some(c => keys[c]); }

function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}

function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

canvas.addEventListener('click', e => {
  const pos = getCanvasPos(e);

  if (state === 'menu') {
    for (const b of menuButtons) {
      if (pointInRect(pos.x, pos.y, b)) {
        if (b.id === 'create') {
          loadCurrentLevelIntoEditor();
          camera.x = 0;
          state = 'editor';
        } else if (b.id === 'import') {
          showImportOverlay();
        }
      }
    }
    return;
  }

  if (state === 'editor') {
    if (overlay.style.display !== 'none') return;

    for (const b of editorToolbar) {
      if (pointInRect(pos.x, pos.y, b)) {
        if (b.id === 'export') {
          showExportOverlay(exportEditorLevel());
        } else if (b.id === 'menu') {
          state = 'menu';
        } else {
          editorTool = b.id;
        }
        return;
      }
    }

    if (pos.y < 40) return;

    const worldX = pos.x + camera.x;
    const gx = Math.floor(worldX / TILE_SIZE);
    const gy = Math.floor(pos.y / TILE_SIZE);
    const key = `${gx},${gy}`;

    if (editorTool === 'erase') {
      editorTiles.delete(key);
    } else if (editorTool === 'start') {
      editorPlayerStart = { x: gx * TILE_SIZE, y: gy * TILE_SIZE };
    } else {
      editorTiles.set(key, editorTool);
    }
  }
});

// ---- Collision helpers ----
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

function resolveCollisions(axis) {
  for (const t of currentLevel.tiles) {
    if (!rectsOverlap(player, t)) continue;
    if (axis === 'y') {
      if (player.vy > 0) {
        player.y = t.y - player.h;
        player.vy = 0;
        player.onGround = true;
      } else if (player.vy < 0) {
        player.y = t.y + t.h;
        player.vy = 0;
      }
    } else {
      if (player.vx > 0) player.x = t.x - player.w;
      else if (player.vx < 0) player.x = t.x + t.w;
      player.vx = 0;
    }
  }
}

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

  if (isDown('Space', 'ArrowUp', 'KeyW') && player.onGround) {
    player.vy = JUMP_VELOCITY;
    player.onGround = false;
    if (assets.jumpSound) {
      assets.jumpSound.currentTime = 0;
      assets.jumpSound.play().catch(() => {});
    }
  }

  player.vy += GRAVITY * dt;

  player.x += player.vx * dt;
  resolveCollisions('x');

  player.y += player.vy * dt;
  player.onGround = false;
  resolveCollisions('y');

  player.x = Math.max(0, Math.min(currentLevel.width - player.w, player.x));

  if (player.y > currentLevel.height + 100) {
    resetPlayer();
  }

  const halfView = canvas.width / 2;
  camera.x = Math.max(0, Math.min(currentLevel.width - canvas.width, player.x - halfView));
  if (currentLevel.width <= canvas.width) camera.x = 0;
}

// ---- Update: editor (camera scroll only) ----
function updateEditor(dt) {
  if (overlay.style.display !== 'none') return;
  if (isDown('ArrowLeft', 'KeyA')) camera.x -= SCROLL_SPEED * dt;
  if (isDown('ArrowRight', 'KeyD')) camera.x += SCROLL_SPEED * dt;
  camera.x = Math.max(0, Math.min(EDITOR_LEVEL_WIDTH - canvas.width, camera.x));
}

// ---- Draw helpers ----
function drawTile(screenX, screenY, w, h, type) {
  if (assets[type]) {
    ctx.drawImage(assets[type], screenX, screenY, w, h);
  } else {
    ctx.fillStyle = TILE_FALLBACK_COLORS[type] || '#555';
    ctx.fillRect(screenX, screenY, w, h);
  }
}

function drawButton(b, active) {
  ctx.fillStyle = active ? '#4a6fa5' : '#2c2f3a';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeStyle = '#cfd3dc';
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = '#f0f2f5';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
}

function drawMenu() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#1b1f2a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f0f2f5';
  ctx.font = '24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Platformer', canvas.width / 2, 90);

  for (const b of menuButtons) {
    ctx.strokeStyle = '#f0f2f5';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
  }
  ctx.lineWidth = 1;
}

function drawEditor() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#87ceeb';
  ctx.fillRect(0, 40, canvas.width, canvas.height - 40);

  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  const startGX = Math.floor(camera.x / TILE_SIZE);
  for (let gx = startGX; gx * TILE_SIZE - camera.x < canvas.width; gx++) {
    const sx = gx * TILE_SIZE - camera.x;
    ctx.beginPath(); ctx.moveTo(sx, 40); ctx.lineTo(sx, canvas.height); ctx.stroke();
  }
  for (let gy = 1; gy * TILE_SIZE < canvas.height; gy++) {
    const sy = gy * TILE_SIZE;
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(canvas.width, sy); ctx.stroke();
  }

  for (const [key, type] of editorTiles.entries()) {
    const [gx, gy] = key.split(',').map(Number);
    const sx = gx * TILE_SIZE - camera.x;
    if (sx + TILE_SIZE < 0 || sx > canvas.width) continue;
    drawTile(sx, gy * TILE_SIZE, TILE_SIZE, TILE_SIZE, type);
  }

  const spawnSX = editorPlayerStart.x - camera.x;
  ctx.fillStyle = '#f2c744';
  ctx.beginPath();
  ctx.arc(spawnSX + TILE_SIZE / 2, editorPlayerStart.y + TILE_SIZE / 2, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#12141c';
  ctx.fillRect(0, 0, canvas.width, 40);
  for (const b of editorToolbar) {
    drawButton(b, b.id === editorTool);
  }
}

function drawPlay() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#87ceeb';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const t of currentLevel.tiles) {
    const sx = t.x - camera.x;
    if (sx + t.w < 0 || sx > canvas.width) continue;
    drawTile(sx, t.y, t.w, t.h, t.type);
  }

  const psx = player.x - camera.x;
  if (assets.player) {
    ctx.drawImage(assets.player, psx, player.y, player.w, player.h);
  } else {
    ctx.fillStyle = '#e94f37';
    ctx.fillRect(psx, player.y, player.w, player.h);
  }
}

// ---- Hint text per state ----
function updateHint() {
  if (state === 'menu') {
    hint.textContent = 'Click Create to build a level, or Import to load one from JSON';
  } else if (state === 'editor') {
    hint.textContent = 'Click a tool, click grid to place/erase • ← → or A/D to scroll • Esc: menu';
  } else if (state === 'play') {
    hint.textContent = 'Move: ← → or A/D • Jump: Space/↑/W • Esc: menu';
  }
}

// ---- Main loop ----
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;

  updateHint();

  if (state === 'play') updatePlay(dt);
  else if (state === 'editor') updateEditor(dt);

  if (state === 'menu') drawMenu();
  else if (state === 'editor') drawEditor();
  else if (state === 'play') drawPlay();

  requestAnimationFrame(loop);
}

loadAssets(() => {
  resetPlayer();
  lastTime = performance.now();
  requestAnimationFrame(loop);
});
