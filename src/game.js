 /**

 * src/game.js — lives on GitHub, fetched at runtime by the Apps Script dialog.

 * REPO_BASE is set as a global by Index.html before this file loads.

 */


function initPlatformerGame() {

  const REPO_BASE = window.REPO_BASE || '';


  const canvas = document.getElementById('gameCanvas');

  if (!canvas) {

    console.error("Game canvas element not found!");

    return;

  }

  const ctx = canvas.getContext('2d');

  ctx.imageSmoothingEnabled = false;

  const hint = document.getElementById('hint');


  // ---- Tunable physics constants ----

  const GRAVITY = 1400;

  const JUMP_VELOCITY = -520;

  const MOVE_SPEED = 280;

  const FRICTION_GROUND = 0.85;

  const TILE_SIZE = 32;

  const SCROLL_SPEED = 400; // px/s, editor camera pan


  // ---- Tile categories ----

  const SOLID_TYPES = ['ground', 'rock', 'wood', 'dirt'];

  const HAZARD_TYPES = ['spike'];

  const WIN_TYPES = ['trophy'];

  const PALETTE_TYPES = [...SOLID_TYPES, ...HAZARD_TYPES, 'trophy'];


  // ---- Asset manifest ----

  const assetSources = {

    player:     `${REPO_BASE}/assets/Sprites/player.png`,

    ground:     `${REPO_BASE}/assets/Sprites/ground.png`,

    rock:       `${REPO_BASE}/assets/Sprites/rock.png`,

    wood:       `${REPO_BASE}/assets/Sprites/wood.png`,

    dirt:       `${REPO_BASE}/assets/Sprites/dirt.png`,

    spike:      `${REPO_BASE}/assets/Sprites/spike.png`,

    trophy:     `${REPO_BASE}/assets/Sprites/trophy.png`,

    jumpSound:  `${REPO_BASE}/assets/audio/jump.mp3`,

    deathSound: `${REPO_BASE}/assets/audio/death.mp3`,

    music:      `${REPO_BASE}/assets/audio/music.mp3`

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

        audio.onerror = () => { assets[key] = null; settle(); };

        audio.src = src;

        if (key === 'music') {

          audio.loop = true;

          audio.volume = 0.9;

        }

        assets[key] = audio;

      } else {

        const img = new Image();

        img.onload = settle;

        img.onerror = () => { assets[key] = null; settle(); };

        img.src = src;

        assets[key] = img;

      }

    });

    function settle() { remaining--; if (remaining <= 0) onDone(); }

  }


  function startMusic() {

    if (assets.music && assets.music.paused) {

      assets.music.play().catch(() => {});

    }

  }


  // ---- Default level ----

  const DEFAULT_LEVEL = {

    width: 800, height: 450,

    playerStart: { x: 60, y: 260 },

    tiles: [

      { x: 0,   y: 416, w: 800, h: 34, type: 'ground' },

      { x: 160, y: 320, w: 128, h: 32, type: 'ground' },

      { x: 352, y: 256, w: 128, h: 32, type: 'wood' },

      { x: 544, y: 192, w: 160, h: 32, type: 'rock' },

      { x: 32,  y: 192, w: 96,  h: 32, type: 'dirt' },

      { x: 256, y: 384, w: 32,  h: 32, type: 'spike' },

      { x: 704, y: 384, w: 32,  h: 32, type: 'trophy' }

    ]

  };


  // ---- Level sanitation ----

  function sanitizeLevel(raw) {

    const lvl = {

      width: Number(raw.width) || 800,

      height: Number(raw.height) || 450,

      playerStart: {

        x: (raw.playerStart && Number(raw.playerStart.x)) || 60,

        y: (raw.playerStart && Number(raw.playerStart.y)) || 260

      },

      tiles: Array.isArray(raw.tiles) ? raw.tiles

        .filter(t => t && typeof t.x === 'number' && typeof t.y === 'number' && t.w && t.h && t.type)

        .map(t => ({ x: t.x, y: t.y, w: t.w, h: t.h, type: t.type }))

        : []

    };


    const maxRight = lvl.tiles.reduce((m, t) => Math.max(m, t.x + t.w), 0);

    const maxBottom = lvl.tiles.reduce((m, t) => Math.max(m, t.y + t.h), 0);


    lvl.width = Math.max(lvl.width, maxRight + 200, canvas.width);

    if (raw.height && Number(raw.height) > 0) {

      lvl.height = Math.max(Number(raw.height), canvas.height);

    } else {

      lvl.height = Math.max(lvl.height, maxBottom + 200, canvas.height);

    }


    lvl.playerStart.x = Math.max(0, Math.min(lvl.width - TILE_SIZE, lvl.playerStart.x));

    lvl.playerStart.y = Math.max(0, Math.min(lvl.height - TILE_SIZE, lvl.playerStart.y));


    return lvl;

  }


  let currentLevel = sanitizeLevel(DEFAULT_LEVEL);


  // ---- Playlist State ----

  let levelPlaylist = [];

  let playlistIndex = 0;

  let levelComplete = false;


  function playPlaylistLevel(index) {

    if (index < 0 || index >= levelPlaylist.length) return;

    playlistIndex = index;

    currentLevel = sanitizeLevel(levelPlaylist[index].level);

    resetPlayer('playlist-level');

    camera.x = 0;

    camera.y = 0;

    levelComplete = false;

  }


  function levelFloorY(level) {

    if (!level.tiles || level.tiles.length === 0) return level.height;

    const maxBottom = level.tiles.reduce((m, t) => Math.max(m, t.y + t.h), 0);

    return Math.max(level.height, maxBottom);

  }


  // ---- Player (Matched to ground tile size: 32x32 px) ----

  const player = { x: 60, y: 260, w: TILE_SIZE, h: TILE_SIZE, vx: 0, vy: 0, onGround: false };

  function resetPlayer(reason) {

    if (reason === 'hazard' && assets.deathSound) {

      assets.deathSound.currentTime = 0;

      assets.deathSound.play().catch(() => {});

    }

    player.x = currentLevel.playerStart.x;

    player.y = currentLevel.playerStart.y;

    player.vx = 0; player.vy = 0; player.onGround = false;

  }


  // ---- Camera ----

  const camera = { x: 0, y: 0 };


  // ---- App state ----

  let state = 'menu'; // 'menu' | 'editor' | 'play' | 'levelSelect'


  // ---- Preset Levels State ----

  let presetLevels = [];

  let isFetchingPresets = false;


  function fetchPresetManifest() {

    if (isFetchingPresets || presetLevels.length > 0) return;

    isFetchingPresets = true;

    fetch(`${REPO_BASE}/levels/manifest.json`)

      .then(res => {

        if (!res.ok) throw new Error('Manifest not found');

        return res.json();

      })

      .then(data => {

        presetLevels = Array.isArray(data) ? data : (data.levels || []);

        isFetchingPresets = false;

      })

      .catch(err => {

        console.warn('Could not load levels manifest, using fallback:', err);

        presetLevels = ['level1.json', 'level2.json', 'level3.json'];

        isFetchingPresets = false;

      });

  }


  function loadPresetPlaylist(startIndex) {

    Promise.all(presetLevels.map(filename =>

      fetch(`${REPO_BASE}/levels/${filename}`)

        .then(res => {

          if (!res.ok) throw new Error(`Failed to load ${filename}`);

          return res.json();

        })

        .then(raw => ({

          name: filename.replace(/\.json$/i, ''),

          level: sanitizeLevel(raw)

        }))

    ))

      .then(loadedLevels => {

        levelPlaylist = loadedLevels;

        playPlaylistLevel(startIndex);

        state = 'play';

      })

      .catch(err => {

        alert(`Could not load preset pack: ${err.message}`);

      });

  }


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

    catch (e) { return {}; }

  }

  function saveLibrary(lib) {

    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib)); }

    catch (e) {}

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

    editorPlayerStart = { x: 60, y: 260 };

    editorWidthTiles.value = 25; editorHeightTiles.value = 14;

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

  let EDITOR_LEVEL_WIDTH = 800;

  let EDITOR_LEVEL_HEIGHT = 448;

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


  function readZipFile(file, onLevelsLoaded) {

    if (!window.JSZip) {

      const script = document.createElement('script');

      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

      script.onload = () => processZip(file, onLevelsLoaded);

      script.onerror = () => alert('Failed to load JSZip library for reading zip archives.');

      document.head.appendChild(script);

    } else {

      processZip(file, onLevelsLoaded);

    }

  }


  function processZip(file, onLevelsLoaded) {

    const reader = new FileReader();

    reader.onload = async () => {

      try {

        const zip = new JSZip();

        const contents = await zip.loadAsync(reader.result);

        const extractedLevels = [];


        for (const [relativePath, zipEntry] of Object.entries(contents.files)) {

          if (zipEntry.dir || !/\.json$/i.test(relativePath)) continue;

          const text = await zipEntry.async('text');

          try {

            const raw = JSON.parse(text);

            const sanitized = sanitizeLevel(raw);

            const filename = relativePath.split('/').pop();

            const numMatch = filename.match(/\d+/);

            const levelNum = numMatch ? parseInt(numMatch[0], 10) : 999999;

            extractedLevels.push({

              number: levelNum,

              name: filename.replace(/\.json$/i, ''),

              level: sanitized

            });

          } catch (e) {}

        }


        extractedLevels.sort((a, b) => a.number - b.number);

        if (extractedLevels.length > 0) {

          onLevelsLoaded(extractedLevels);

        } else {

          alert('No valid level JSON files found in the ZIP archive.');

        }

      } catch (err) {

        alert('Could not read ZIP archive: ' + err.message);

      }

    };

    reader.readAsArrayBuffer(file);

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


  // --- Main menu's Import (.zip or .json) ---

  const menuImportInput = document.createElement('input');

  menuImportInput.type = 'file';

  menuImportInput.accept = '.zip,application/zip,application/json,.json';

  menuImportInput.style.display = 'none';

  document.body.appendChild(menuImportInput);

  menuImportInput.addEventListener('change', () => {

    const file = menuImportInput.files[0];

    if (!file) return;

    if (/\.zip$/i.test(file.name) || file.type === 'application/zip') {

      readZipFile(file, levels => {

        levelPlaylist = levels;

        playlistIndex = 0;

        playPlaylistLevel(0);

        state = 'play';

      });

    } else {

      readJSONFile(file, sanitized => {

        levelPlaylist = [];

        currentLevel = sanitized;

        resetPlayer('import');

        camera.x = 0; camera.y = 0;

        state = 'play';

      });

    }

    menuImportInput.value = '';

  });


  // ---- Menu button geometry ----

  const menuButtons = [

    { id: 'create', label: 'Create', x: 250, y: 110, w: 300, h: 60 },

    { id: 'import', label: 'Import Pack/JSON', x: 250, y: 190, w: 300, h: 60 },

    { id: 'presets', label: 'Preset Levels', x: 250, y: 270, w: 300, h: 60 }

  ];


  // ---- Editor working state ----

  const editorTiles = new Map(); // "gx,gy" -> type

  let editorTool = 'ground';

  let editorPlayerStart = { x: 60, y: 260 };

  let isPainting = false;

  let isPanning = false;

  let panStart = { x: 0, y: 0 };

  let panStartCamera = { x: 0, y: 0 };


  let dragStartGX = null;

  let dragStartGY = null;


  const editorToolbar = (() => {

    const defs = [...PALETTE_TYPES.map(t => ({ id: t, label: t[0].toUpperCase() + t.slice(1) })),

                  { id: 'start', label: 'Spawn' },

                  { id: 'erase', label: 'Erase' }];

    let x = 10;

    const buttons = defs.map(d => {

      const btn = { ...d, x, y: 5, w: 72, h: 28 };

      x += 78;

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

    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {

      e.preventDefault();

    }

    if (e.code === 'Escape' && (state === 'editor' || state === 'play' || state === 'levelSelect')) {

      state = 'menu';

    }

  }, { passive: false });

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

          } else if (b.id === 'presets') {

            fetchPresetManifest();

            state = 'levelSelect';

          }

        }

      }

      return;

    }


    if (state === 'levelSelect') {

      const backBtn = { x: canvas.width / 2 - 100, y: 380, w: 200, h: 40, label: 'Menu' };

      if (pointInRect(pos.x, pos.y, backBtn)) {

        state = 'menu';

        return;

      }


      let startY = 120;

      const btnW = 400, btnH = 40, spacing = 10;

      const startX = (canvas.width - btnW) / 2;


      for (let i = 0; i < presetLevels.length; i++) {

        const itemRect = { x: startX, y: startY + i * (btnH + spacing), w: btnW, h: btnH };

        if (pointInRect(pos.x, pos.y, itemRect)) {

          loadPresetPlaylist(i);

          return;

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

      if (HAZARD_TYPES.includes(t.type) || WIN_TYPES.includes(t.type)) continue;

      if (!rectsOverlap(player, t)) continue;

      if (axis === 'y') {

        if (player.vy >= 0) {

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

      if (HAZARD_TYPES.includes(t.type)) {

        const hazardHitbox = {

          x: t.x + (t.w * 0.2),

          y: t.y + (t.h * 0.5),

          w: t.w * 0.6,

          h: t.h * 0.5

        };

        if (rectsOverlap(player, hazardHitbox)) {

          resetPlayer('hazard');

          return true;

        }

      }

    }

    return false;

  }


  function checkWinCondition() {

    for (const t of currentLevel.tiles) {

      if (WIN_TYPES.includes(t.type)) {

        if (rectsOverlap(player, t)) {

          return true;

        }

      }

    }

    return false;

  }


  // ---- Update: play ----

  function updatePlay(dt) {

    if (levelComplete) return;


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


    player.vy = Math.min(player.vy + (GRAVITY * dt), 800);


    player.x += player.vx * dt;

    resolveCollisions('x');


    player.onGround = false;


    player.y += player.vy * dt;

    resolveCollisions('y');


    player.x = Math.max(0, Math.min(currentLevel.width - player.w, player.x));


    if (checkHazards()) return;


    if (checkWinCondition()) {

      if (levelPlaylist.length > 0 && playlistIndex < levelPlaylist.length - 1) {

        playPlaylistLevel(playlistIndex + 1);

      } else {

        levelComplete = true;

      }

      return;

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


  // ---- High-detail crisp pixel fallback drawing for tiles ----

  function drawTile(sx, sy, w, h, type) {

    if (assets[type]) {

      ctx.drawImage(assets[type], sx, sy, w, h);

      return;

    }


    ctx.save();

    ctx.imageSmoothingEnabled = false;


    if (type === 'ground') {

      // Lush pixel grass top + rich dirt body

      ctx.fillStyle = '#4a7c3b';

      ctx.fillRect(sx, sy, w, h * 0.3);

      ctx.fillStyle = '#325426';

      ctx.fillRect(sx, sy + h * 0.3, w, h * 0.1);

      ctx.fillStyle = '#8b5a2b';

      ctx.fillRect(sx, sy + h * 0.4, w, h * 0.6);

      // Pixel speckles for texture

      ctx.fillStyle = '#6d431c';

      ctx.fillRect(sx + 4, sy + h * 0.5, 4, 4);

      ctx.fillRect(sx + w - 12, sy + h * 0.7, 4, 4);

      ctx.fillRect(sx + w / 2 - 2, sy + h * 0.8, 4, 4);

    } else if (type === 'rock') {

      ctx.fillStyle = '#7a8288';

      ctx.fillRect(sx, sy, w, h);

      ctx.fillStyle = '#5c6368';

      ctx.fillRect(sx + 4, sy + 4, w - 8, h - 8);

      ctx.fillStyle = '#9da4ab';

      ctx.fillRect(sx + 6, sy + 6, w - 16, 4);

      ctx.fillStyle = '#43484d';

      ctx.fillRect(sx + w - 10, sy + h - 12, 6, 6);

    } else if (type === 'wood') {

      ctx.fillStyle = '#8b5a2b';

      ctx.fillRect(sx, sy, w, h);

      ctx.fillStyle = '#6b4420';

      ctx.fillRect(sx, sy + 6, w, 4);

      ctx.fillRect(sx, sy + h - 10, w, 4);

      ctx.fillStyle = '#a8733e';

      ctx.fillRect(sx + 8, sy, 4, h);

      ctx.fillRect(sx + w - 12, sy, 4, h);

    } else if (type === 'dirt') {

      ctx.fillStyle = '#784212';

      ctx.fillRect(sx, sy, w, h);

      ctx.fillStyle = '#5c310b';

      ctx.fillRect(sx + 4, sy + 4, 6, 6);

      ctx.fillRect(sx + w - 10, sy + h - 10, 6, 6);

      ctx.fillRect(sx + w / 2 - 4, sy + h / 2 - 4, 8, 6);

    } else if (type === 'spike') {

      ctx.fillStyle = '#c0392b';

      ctx.beginPath();

      ctx.moveTo(sx, sy + h);

      ctx.lineTo(sx + w / 2, sy + 2);

      ctx.lineTo(sx + w, sy + h);

      ctx.closePath();

      ctx.fill();

      ctx.fillStyle = '#e74c3c';

      ctx.beginPath();

      ctx.moveTo(sx + 4, sy + h);

      ctx.lineTo(sx + w / 2, sy + 6);

      ctx.lineTo(sx + w / 2, sy + h);

      ctx.closePath();

      ctx.fill();

    } else if (type === 'trophy') {

      ctx.fillStyle = '#f1c40f';

      ctx.fillRect(sx + w * 0.3, sy + h * 0.2, w * 0.4, h * 0.5);

      ctx.fillStyle = '#d4ac0d';

      ctx.fillRect(sx + w * 0.2, sy + h * 0.65, w * 0.6, h * 0.15);

      ctx.fillRect(sx + w * 0.4, sy + h * 0.8, w * 0.2, h * 0.1);

      ctx.fillStyle = '#fef5d1';

      ctx.fillRect(sx + w * 0.35, sy + h * 0.25, 4, 8);

    } else {

      ctx.fillStyle = '#555';

      ctx.fillRect(sx, sy, w, h);

    }

    ctx.restore();

  }


  function drawButton(b, active) {

    ctx.fillStyle = active ? '#4a6fa5' : '#2c2f3a';

    ctx.fillRect(b.x, b.y, b.w, b.h);

    ctx.strokeStyle = '#cfd3dc';

    ctx.strokeRect(b.x, b.y, b.w, b.h);

    ctx.fillStyle = '#f0f2f5';

    ctx.font = '14px sans-serif';

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

    ctx.fillText('Platformer', canvas.width / 2, 60);


    for (const b of menuButtons) {

      ctx.strokeStyle = '#f0f2f5';

      ctx.lineWidth = 2;

      ctx.strokeRect(b.x, b.y, b.w, b.h);

      ctx.font = '16px sans-serif';

      ctx.textAlign = 'center';

      ctx.textBaseline = 'middle';

      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);

    }

    ctx.lineWidth = 1;

  }


  function drawLevelSelect() {

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#1b1f2a';

    ctx.fillRect(0, 0, canvas.width, canvas.height);


    ctx.fillStyle = '#f0f2f5';

    ctx.font = '24px sans-serif';

    ctx.textAlign = 'center';

    ctx.fillText('Select Preset Level', canvas.width / 2, 50);


    if (isFetchingPresets) {

      ctx.font = '16px sans-serif';

      ctx.fillText('Loading levels from GitHub...', canvas.width / 2, canvas.height / 2);

    } else if (presetLevels.length === 0) {

      ctx.font = '16px sans-serif';

      ctx.fillText('No levels found in levels folder.', canvas.width / 2, canvas.height / 2);

    } else {

      let startY = 100;

      const btnW = 400, btnH = 40, spacing = 10;

      const startX = (canvas.width - btnW) / 2;


      for (let i = 0; i < presetLevels.length; i++) {

        const filename = presetLevels[i];

        const displayName = fil 
