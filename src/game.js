/**
 * src/game.js — lives on GitHub, fetched at runtime by the Apps Script dialog.
 * REPO_BASE is set as a global by Index.html before this file loads.
 *
 * Level JSON format:
 * {
 *   "width": 2400, "height": 440,
 *   "playerStart": { "x": 60, "y": 300 },
 *   "tiles": [
 *     { "x": 0, "y": 400, "w": 40, "h": 40, "type": "ground" },
 *     { "x": 200, "y": 360, "w": 40, "h": 40, "type": "spike" },
 *     ...
 *   ]
 * }
 * type is one of: 'ground' | 'rock' | 'wood' (solid) or 'spike' (hazard,
 * non-solid — touching it resets the player instead of standing on it).
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

// ---- Tile categories ----
const SOLID_TYPES = ['ground', 'rock', 'wood'];
const HAZARD_TYPES = ['spike'];
const PALETTE_TYPES = [...SOLID_TYPES, ...HAZARD_TYPES];
const TILE_FALLBACK_COLORS = {
  ground: '#3a5f3a', rock: '#7a7a7a', wood: '#8b5a2b', spike: '#c0392b'
};

// ---- Asset manifest ----
const assetSources = {
  player:    `${REPO_BASE}/assets/Sprites/player.png`,
  ground:    `${REPO_BASE}/assets/Sprites/ground.png`,
  rock:      `${REPO_BASE}/assets/Sprites/rock.png`,
  wood:      `${REPO_BASE}/assets/Sprites/wood.png`,
  spike:     `${REPO_BASE}/assets/Sprites/spike.png`,
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
      img.onerror = () => { console.warn(`Missing image asset: ${key}, using fallback`); assets[key] = null; settle(); };
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
    { x: 20,  y: 200, w: 90,  h: 20, type: 'ground' },
    { x: 260, y: 410, w: 40,  h: 40, type: 'spike' }
  ]
};

// ---- Level sanitation ----
function sanitizeLevel(raw) {
  const lvl = {
    width: Number(raw.width) || 800,
    height: Number(raw.height) || 450,
    playerStart: {
      x: (raw.playerStart && Number(raw.playerStart.x)) || 60,
      y: (raw.playerStart && Number(raw.playerStart.y)) || 300
    },
    tiles: Array.isArray(raw.tiles) ? raw.tiles
      .filter(t => t && typeof t.x === 'number' && typeof t.y === 'number' && t.w && t.h && t.type)
      .map(t => ({ x: t.x, y: t.y, w: t.w, h: t.h, type: t.type }))
      : []
  };

  const maxRight = lvl.tiles.reduce((m, t) => Math.max(m, t.x + t.w), 0);
  const maxBottom = lvl.tiles.reduce((m, t) => Math.max(m, t.y + t.h), 0);

  // Preserve declared height if valid to allow intentional gaps/pits below platforms without shifting the floor threshold incorrectly on jump.
  lvl.width = Math.max(lvl.width, maxRight + 200, canvas.width);
  if (raw.height && Number(raw.height) > 0) {
    lvl.height = Math.max(Number(raw.height), canvas.height);
  } else {
    lvl.height = Math.max(lvl.height, maxBottom + 200, canvas.height);
  }

  lvl.playerStart.x = Math.max(0, Math.min(lvl.width - 32, lvl.playerStart.x));
  lvl.playerStart.y = Math.max(0, Math.min(lvl.height - 32, lvl.playerStart.y));

  return lvl;
}

let currentLevel = sanitizeLevel(DEFAULT_LEVEL);

function levelFloorY(level) {
  if (!level.tiles || level.tiles.length === 0) return level.height;
  const maxBottom = level.tiles.reduce((m, t) => Math.max(m, t.y + t.h), 0);
  return Math.max(level.height, maxBottom);
}

// ---- Player ----
const player = { x: 60, y: 300, w: 32, h: 32, vx: 0, vy: 0, onGround: false };
function resetPlayer(reason) {
  console.log(
    `[reset] reason=${reason || 'unspecified'} player.y=${player.y.toFixed(1)} ` +
    `floorY=${levelFloorY(currentLevel).toFixed(1)} onGround=${player.onGround}`
  );
  player.x = currentLevel.playerStart.x;
  player.y = currentLevel.playerStart.y;
  player.vx = 0; player.vy = 0; player.onGround = false;
}

// ---- Camera ----
const camera = { x: 0, y: 0 };

// ---- App state ----
let state = 'menu'; // 'menu' | 'editor' | 'play'

// ============================================================
// DOM controls (editor panel + hidden file inputs)
// ============================================================

const editorPanel = document.createElement('div');
editorPanel.style.display = 'none';
editorPanel.style.flexWrap = 'wrap';
editorPanel.style.gap = '6px';
editorPanel.style.alignItems = 'center';
editorPanel.style.justifyContent = 'center';
editorPanel.style.maxWidth = '820px';
editorPanel.style.margin = '8px auto';
editorPanel.style.padding = '8px';
editorPanel.style.background = '#12141c';
editorPanel.style.borderRadius = '6px';
editorPanel.style.fontFamily = 'sans-serif';
editorPanel.style.fontSize = '12px';
editorPanel.style.color = '#cfd3dc';
document.body.appendChild(editorPanel);

function panelLabel(text) {
  const s = document.createElement('span');
  s.textContent = text;
  return s;
}
function panelButton(text, onClick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.style.padding = '4px 10px';
  b.style.cursor = 'pointer';
  b.addEventListener('click', onClick);
  return b;
}
function panelNumberInput(value, width) {
  const i = document.createElement('input');
  i.type = 'number';
  i.value = value;
  i.min = 1;
  i.style.width = width || '55px';
  return i;
}

// --- Row 1: named level library (localStorage) ---
const LIBRARY_KEY = 'platformer_levels_v1';
function loadLibrary() {
  try { return JSON.parse(localStorage.getItem(LIBRARY_KEY) || '{}'); }
  catch (e) { console.warn('Level library unavailable:', e); return {}; }
}
function saveLibrary(lib) {
  try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib)); }
  catch (e) { console.warn('Could not save level library:', e); }
}

const levelSelect = document.createElement('select');
const NEW_LEVEL_OPTION = '-- unsaved / new --';
function refreshLevelSelect(selectName) {
  const lib = loadLibrary();
  levelSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = NEW_LEVEL_OPTION;
  levelSelect.appendChild(placeholder);
  Object.keys(lib).sort().forEach(name => {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    levelSelect.appendChild(opt);
  });
  levelSelect.value = selectName || '';
}
refreshLevelSelect();

const levelNameInput = document.createElement('input');
levelNameInput.type = 'text';
levelNameInput.placeholder = 'level name';
levelNameInput.style.width = '110px';

levelSelect.addEventListener('change', () => {
  const name = levelSelect.value;
  if (!name) return;
  const lib = loadLibrary();
  if (lib[name]) {
    loadLevelIntoEditor(sanitizeLevel(lib[name]));
    levelNameInput.value = name;
  }
});

const row1 = document.createElement('div');
row1.style.display = 'flex'; row1.style.gap = '6px'; row1.style.alignItems = 'center';
row1.appendChild(panelLabel('Level:'));
row1.appendChild(levelSelect);
row1.appendChild(levelNameInput);
row1.appendChild(panelButton('Save', () => {
  const name = levelNameInput.value.trim();
  if (!name) { alert('Type a level name first.'); return; }
  const lib = loadLibrary();
  lib[name] = exportEditorLevel();
  saveLibrary(lib);
  refreshLevelSelect(name);
}));
row1.appendChild(panelButton('New', () => {
  editorTiles.clear();
  editorPlayerStart = { x: 60, y: 300 };
  editorWidthTiles.value = 20; editorHeightTiles.value = 11;
  applyEditorSize();
  camera.x = 0; camera.y = 0;
  levelNameInput.value = '';
  refreshLevelSelect('');
}));
row1.appendChild(panelButton('Delete', () => {
  const name = levelSelect.value;
  if (!name) return;
  const lib = loadLibrary();
  delete lib[name];
  saveLibrary(lib);
  refreshLevelSelect('');
}));
editorPanel.appendChild(row1);

// --- Row 2: resize ---
let EDITOR_LEVEL_WIDTH = 2400;
let EDITOR_LEVEL_HEIGHT = 440;
const editorWidthTiles = panelNumberInput(EDITOR_LEVEL_WIDTH / TILE_SIZE);
const editorHeightTiles = panelNumberInput(EDITOR_LEVEL_HEIGHT / TILE_SIZE);

function applyEditorSize() {
  const w = Math.max(20, parseInt(editorWidthTiles.value, 10) || 20);
  const h = Math.max(10, parseInt(editorHeightTiles.value, 10) || 10);
  EDITOR_LEVEL_WIDTH = w * TILE_SIZE;
  EDITOR_LEVEL_HEIGHT = h * TILE_SIZE;
  camera.x = Math.max(0, Math.min(EDITOR_LEVEL_WIDTH - canvas.width, camera.x));
  camera.y = Math.max(0, Math.min(Math.max(0, EDITOR_LEVEL_HEIGHT - (canvas.height - 40)), camera.y));
}

const row2 = document.createElement('div');
row2.style.display = 'flex'; row2.style.gap = '6px'; row2.style.alignItems = 'center';
row2.appendChild(panelLabel('Width (tiles):'));
row2.appendChild(editorWidthTiles);
row2.appendChild(panelLabel('Height (tiles):'));
row2.appendChild(editorHeightTiles);
row2.appendChild(panelButton('Resize', applyEditorSize));
editorPanel.appendChild(row2);

// --- Row 3: file download/upload ---
const uploadInput = document.createElement('input');
uploadInput.type = 'file';
uploadInput.accept = 'application/json,.json';
uploadInput.style.display = 'none';
document.body.appendChild(uploadInput);

function downloadJSON(levelData, filename) {
  const blob = new Blob([JSON.stringify(levelData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function readJSONFile(file, onLoaded) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      onLoaded(sanitizeLevel(parsed));
    } catch (err) {
      alert('That file is not valid level JSON: ' + err.message);
    }
  };
  reader.onerror = () => alert('Could not read that file.');
  reader.readAsText(file);
}

const row3 = document.createElement('div');
row3.style.display = 'flex'; row3.style.gap = '6px'; row3.style.alignItems = 'center';
row3.appendChild(panelButton('Download JSON', () => {
  const name = (levelNameInput.value.trim() || 'level') + '.json';
  downloadJSON(exportEditorLevel(), name);
}));
row3.appendChild(panelButton('Upload JSON into editor', () => uploadInput.click()));
editorPanel.appendChild(row3);

uploadInput.addEventListener('change', () => {
  const file = uploadInput.files[0];
  if (!file) return;
  readJSONFile(file, sanitized => {
    loadLevelIntoEditor(sanitized);
    levelNameInput.value = file.name.replace(/\.json$/i, '');
    refreshLevelSelect('');
  });
  uploadInput.value = '';
});

// --- Main menu's Import ---
const menuImportInput = document.createElement('input');
menuImportInput.type = 'file';
menuImportInput.accept = 'application/json,.json';
menuImportInput.style.display = 'none';
document.body.appendChild(menuImportInput);
menuImportInput.addEventListener('change', () => {
  const file = menuImportInput.files[0];
  if (!file) return;
  readJSONFile(file, sanitized => {
    currentLevel = sanitized;
    resetPlayer('import');
    camera.x = 0; camera.y = 0;
    state = 'play';
  });
  menuImportInput.value = '';
});

// ---- Menu button geometry ----
const menuButtons = [
  { id: 'create', label: 'Create', x: 100, y: 160, w: 220, h: 140 },
  { id: 'import', label: 'Import', x: 460, y: 160, w: 220, h: 140 }
];

// ---- Editor working state ----
const editorTiles = new Map(); // "gx,gy" -> type
let editorTool = 'ground';
let editorPlayerStart = { x: 60, y: 300 };
let isPainting = false;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let panStartCamera = { x: 0, y: 0 };

// Multi-tile drag tracking variables
let dragStartGX = null;
let dragStartGY = null;

const editorToolbar = (() => {
  const defs = [...PALETTE_TYPES.map(t => ({ id: t, label: t[0].toUpperCase() + t.slice(1) })),
                { id: 'start', label: 'Spawn' },
                { id: 'erase', label: 'Erase' }];
  let x = 10;
  const buttons = defs.map(d => {
    const btn = { ...d, x, y: 5, w: 80, h: 28 };
    x += 86;
    return btn;
  });
  buttons.push({ id: 'pan', label: '✋ Pan', x: canvas.width - 180, y: 5, w: 80, h: 28 });
  buttons.push({ id: 'menu', label: 'Menu', x: canvas.width - 90, y: 5, w: 80, h: 28 });
  return buttons;
})();
let lastPaintTool = 'ground';

function loadLevelIntoEditor(lvl) {
  editorTiles.clear();
  for (const t of lvl.tiles) {
    if (t.w === TILE_SIZE && t.h === TILE_SIZE) {
      editorTiles.set(`${Math.round(t.x / TILE_SIZE)},${Math.round(t.y / TILE_SIZE)}`, t.type);
    }
  }
  editorPlayerStart = { x: lvl.playerStart.x, y: lvl.playerStart.y };
  EDITOR_LEVEL_WIDTH = lvl.width;
  EDITOR_LEVEL_HEIGHT = lvl.height;
  editorWidthTiles.value = Math.round(EDITOR_LEVEL_WIDTH / TILE_SIZE);
  editorHeightTiles.value = Math.round(EDITOR_LEVEL_HEIGHT / TILE_SIZE);
  camera.x = 0; camera.y = 0;
}

function exportEditorLevel() {
  const tiles = [];
  for (const [key, type] of editorTiles.entries()) {
    const [gx, gy] = key.split(',').map(Number);
    tiles.push({ x: gx * TILE_SIZE, y: gy * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE, type });
  }
  return sanitizeLevel({
    width: EDITOR_LEVEL_WIDTH,
    height: EDITOR_LEVEL_HEIGHT,
    playerStart: editorPlayerStart,
    tiles
  });
}

// ---- Input: keyboard ----
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Escape' && (state === 'editor' || state === 'play')) {
    state = 'menu';
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
function isDown(...codes) { return codes.some(c => keys[c]); }

// ---- Input: mouse / drag-painting ----
function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}
function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

function getGridPos(pos) {
  const worldX = pos.x + camera.x;
  const worldY = pos.y + camera.y;
  return {
    gx: Math.floor(worldX / TILE_SIZE),
    gy: Math.floor(worldY / TILE_SIZE)
  };
}

function applyBrush(gx, gy) {
  const key = `${gx},${gy}`;
  if (editorTool === 'erase') editorTiles.delete(key);
  else if (editorTool === 'start') editorPlayerStart = { x: gx * TILE_SIZE, y: gy * TILE_SIZE };
  else editorTiles.set(key, editorTool);
}

function paintAt(pos) {
  if (pos.y < 40) return;
  const { gx, gy } = getGridPos(pos);
  
  if (dragStartGX === null || dragStartGY === null) {
    dragStartGX = gx;
    dragStartGY = gy;
    applyBrush(gx, gy);
  } else {
    let x0 = dragStartGX, y0 = dragStartGY;
    const x1 = gx, y1 = gy;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      applyBrush(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
    dragStartGX = gx;
    dragStartGY = gy;
  }
}

canvas.addEventListener('mousedown', e => {
  const pos = getCanvasPos(e);

  if (state === 'menu') {
    for (const b of menuButtons) {
      if (pointInRect(pos.x, pos.y, b)) {
        if (b.id === 'create') {
          loadLevelIntoEditor(currentLevel);
          levelNameInput.value = '';
          refreshLevelSelect('');
          state = 'editor';
        } else if (b.id === 'import') {
          menuImportInput.click();
        }
      }
    }
    return;
  }

  if (state === 'editor') {
    for (const b of editorToolbar) {
      if (pointInRect(pos.x, pos.y, b)) {
        if (b.id === 'menu') {
          state = 'menu';
        } else if (b.id === 'pan') {
          if (editorTool === 'pan') editorTool = lastPaintTool;
          else { lastPaintTool = editorTool; editorTool = 'pan'; }
        } else {
          editorTool = b.id;
          lastPaintTool = b.id;
        }
        return;
      }
    }

    if (editorTool === 'pan') {
      isPanning = true;
      panStart = pos;
      panStartCamera = { x: camera.x, y: camera.y };
    } else {
      isPainting = true;
      dragStartGX = null;
      dragStartGY = null;
      paintAt(pos);
    }
  }
});

canvas.addEventListener('mousemove', e => {
  if (state !== 'editor') return;
  const pos = getCanvasPos(e);
  if (isPanning) {
    const viewH = canvas.height - 40;
    camera.x = Math.max(0, Math.min(Math.max(0, EDITOR_LEVEL_WIDTH - canvas.width),
      panStartCamera.x - (pos.x - panStart.x)));
    camera.y = Math.max(0, Math.min(Math.max(0, EDITOR_LEVEL_HEIGHT - viewH),
      panStartCamera.y - (pos.y - panStart.y)));
  } else if (isPainting) {
    paintAt(pos);
  }
});

window.addEventListener('mouseup', () => { 
  isPainting = false; 
  isPanning = false; 
  dragStartGX = null;
  dragStartGY = null;
});

// ---- Collision helpers ----
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

function resolveCollisions(axis) {
  for (const t of currentLevel.tiles) {
    if (HAZARD_TYPES.includes(t.type)) continue;
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

function checkHazards() {
  for (const t of currentLevel.tiles) {
    if (HAZARD_TYPES.includes(t.type) && rectsOverlap(player, t)) {
      resetPlayer('hazard');
      return;
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

// ---- Update: editor ----
function updateEditor(dt) {
  const viewH = canvas.height - 40;
  if (isDown('ArrowLeft')) camera.x -= SCROLL_SPEED * dt;
  if (isDown('ArrowRight')) camera.x += SCROLL_SPEED * dt;
  if (isDown('ArrowUp')) camera.y -= SCROLL_SPEED * dt;
  if (isDown('ArrowDown')) camera.y += SCROLL_SPEED * dt;
  camera.x = Math.max(0, Math.min(Math.max(0, EDITOR_LEVEL_WIDTH - canvas.width), camera.x));
  camera.y = Math.max(0, Math.min(Math.max(0, EDITOR_LEVEL_HEIGHT - viewH), camera.y));
}

// ---- Draw helpers ----
function drawTile(sx, sy, w, h, type) {
  if (assets[type]) {
    ctx.drawImage(assets[type], sx, sy, w, h);
  } else if (type === 'spike') {
    ctx.fillStyle = TILE_FALLBACK_COLORS.spike;
    ctx.beginPath();
    ctx.moveTo(sx, sy + h);
    ctx.lineTo(sx + w / 2, sy);
    ctx.lineTo(sx + w, sy + h);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = TILE_FALLBACK_COLORS[type] || '#555';
    ctx.fillRect(sx, sy, w, h);
  }
}

function drawButton(b, active) {
  ctx.fillStyle = active ? '#4a6fa5' : '#2c2f3a';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeStyle = '#cfd3dc';
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = '#f0f2f5';
  ctx.font = '12px sans-serif';
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
  const startGY = Math.floor(camera.y / TILE_SIZE);
  for (let gy = startGY; gy * TILE_SIZE - camera.y < canvas.height; gy++) {
    const sy = Math.max(40, gy * TILE_SIZE - camera.y);
   ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(canvas.width, sy); ctx.stroke();
  }

  for (const [key, type] of editorTiles.entries()) {
    const [gx, gy] = key.split(',').map(Number);
    const sx = gx * TILE_SIZE - camera.x;
    const sy = gy * TILE_SIZE - camera.y;
    if (sx + TILE_SIZE < 0 || sx > canvas.width || sy + TILE_SIZE < 40 || sy > canvas.height) continue;
    drawTile(sx, sy, TILE_SIZE, TILE_SIZE, type);
  }

  const spawnSX = editorPlayerStart.x - camera.x;
  const spawnSY = editorPlayerStart.y - camera.y;
  ctx.fillStyle = '#f2c744';
  ctx.beginPath();
  ctx.arc(spawnSX + TILE_SIZE / 2, spawnSY + TILE_SIZE / 2, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#12141c';
  ctx.fillRect(0, 0, canvas.width, 40);
  for (const b of editorToolbar) drawButton(b, b.id === editorTool);
}

function drawPlay() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#87ceeb';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const t of currentLevel.tiles) {
    const sx = t.x - camera.x, sy = t.y - camera.y;
    if (sx + t.w < 0 || sx > canvas.width || sy + t.h < 0 || sy > canvas.height) continue;
    drawTile(sx, sy, t.w, t.h, t.type);
  }

  const psx = player.x - camera.x, psy = player.y - camera.y;
  if (assets.player) {
    ctx.drawImage(assets.player, psx, psy, player.w, player.h);
  } else {
    ctx.fillStyle = '#e94f37';
    ctx.fillRect(psx, psy, player.w, player.h);
  }
}

// ---- UI visibility + hint text per state ----
function updateUI() {
  editorPanel.style.display = state === 'editor' ? 'flex' : 'none';
  if (state === 'menu') {
    hint.textContent = 'Click Create to build a level, or Import to load a .json file';
    canvas.style.cursor = 'default';
  } else if (state === 'editor') {
    hint.textContent = editorTool === 'pan'
      ? 'Pan mode: drag to scroll the view • Click ✋ Pan again to resume editing • Esc: menu'
      : 'Click/drag to paint tiles • Arrow keys scroll • Esc: menu';
    canvas.style.cursor = editorTool === 'pan' ? (isPanning ? 'grabbing' : 'grab') : 'crosshair';
  } else if (state === 'play') {
    hint.textContent = 'Move: ← → or A/D • Jump: Space/↑/W • Esc: menu';
    canvas.style.cursor = 'default';
  }
}

// ---- Main loop ----
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;

  updateUI();

  if (state === 'play') updatePlay(dt);
  else if (state === 'editor') updateEditor(dt);

  if (state === 'menu') drawMenu();
  else if (state === 'editor') drawEditor();
  else if (state === 'play') drawPlay();

  requestAnimationFrame(loop);
}

loadAssets(() => {
  resetPlayer('init');
  lastTime = performance.now();
  requestAnimationFrame(loop);
});
