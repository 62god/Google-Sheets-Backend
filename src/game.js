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
      assets.music.volume = gameSettings.musicVolume;
      assets.music.play().catch(() => {});
    }
  }

  // ---- Settings State with Sliders ----
  const gameSettings = {
    musicVolume: 0.9,
    sfxVolume: 1.0
  };

  // ---- Default level ----
  const DEFAULT_LEVEL = {
    width: 800, height: 450,
    backgroundColor: '#4a6fa5',
    playerStart: { x: 60, y: 260 },
    tiles: [
      { x: 0,   y: 416, w: 800, h: 34, type: 'ground', rotation: 0 },
      { x: 160, y: 320, w: 128, h: 32, type: 'ground', rotation: 0 },
      { x: 352, y: 256, w: 128, h: 32, type: 'wood', rotation: 0 },
      { x: 544, y: 192, w: 160, h: 32, type: 'rock', rotation: 0 },
      { x: 32,  y: 192, w: 96,  h: 32, type: 'dirt', rotation: 0 },
      { x: 256, y: 384, w: 32,  h: 32, type: 'spike', rotation: 0 },
      { x: 704, y: 384, w: 32,  h: 32, type: 'trophy', rotation: 0 }
    ]
  };

  // ---- Level sanitation ----
  function sanitizeLevel(raw) {
    const lvl = {
      width: Number(raw.width) || 800,
      height: Number(raw.height) || 450,
      backgroundColor: raw.backgroundColor || '#4a6fa5',
      playerStart: {
        x: (raw.playerStart && Number(raw.playerStart.x)) || 60,
        y: (raw.playerStart && Number(raw.playerStart.y)) || 260
      },
      tiles: Array.isArray(raw.tiles) ? raw.tiles
        .filter(t => t && typeof t.x === 'number' && typeof t.y === 'number' && t.w && t.h && t.type)
        .map(t => ({
          x: t.x,
          y: t.y,
          w: t.w,
          h: t.h,
          type: t.type,
          rotation: (Number(t.rotation) || 0) % 360
        }))
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

  // ---- Player ----
  const player = { x: 60, y: 260, w: TILE_SIZE, h: TILE_SIZE, vx: 0, vy: 0, onGround: false };
  function resetPlayer(reason) {
    if (reason === 'hazard' && assets.deathSound && gameSettings.sfxVolume > 0) {
      assets.deathSound.currentTime = 0;
      assets.deathSound.volume = gameSettings.sfxVolume;
      assets.deathSound.play().catch(() => {});
    }
    player.x = currentLevel.playerStart.x;
    player.y = currentLevel.playerStart.y;
    player.vx = 0; player.vy = 0; player.onGround = false;
  }

  // ---- Camera ----
  const camera = { x: 0, y: 0 };

  // ---- App state ----
  let state = 'menu'; // 'menu' | 'editor' | 'play' | 'levelSelect' | 'settings'
  let isDraggingSlider = null; // 'music' | 'sfx'

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

  const bgColorPicker = document.createElement('input');
  bgColorPicker.type = 'color';
  bgColorPicker.value = '#4a6fa5';
  bgColorPicker.style.width = '35px';
  bgColorPicker.style.height = '24px';
  bgColorPicker.style.border = 'none';
  bgColorPicker.style.cursor = 'pointer';
  bgColorPicker.addEventListener('input', () => {
    currentLevel.backgroundColor = bgColorPicker.value;
  });

  const row2 = document.createElement('div');
  row2.style.display = 'flex'; row2.style.gap = '6px'; row2.style.alignItems = 'center';
  row2.appendChild(panelLabel('Width:'));
  row2.appendChild(editorWidthTiles);
  row2.appendChild(panelLabel('Height:'));
  row2.appendChild(editorHeightTiles);
  row2.appendChild(panelButton('Resize', applyEditorSize));
  row2.appendChild(panelLabel('BG:'));
  row2.appendChild(bgColorPicker);
  editorPanel.appendChild(row2);

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
    { id: 'create',   label: 'Create',         x: 250, y: 80,  w: 300, h: 50 },
    { id: 'import',   label: 'Import Pack/JSON', x: 250, y: 140, w: 300, h: 50 },
    { id: 'presets',  label: 'Preset Levels',  x: 250, y: 200, w: 300, h: 50 },
    { id: 'settings', label: 'Settings',       x: 250, y: 260, w: 300, h: 50 }
  ];

  // ---- Editor working state ----
  const editorTiles = new Map();
  let editorTool = 'blocks';
  let selectedBlockType = 'ground';
  let editorRotation = 0; // strictly 0, 90, 180, 270
  let editorPlayerStart = { x: 60, y: 260 };
  let isPainting = false;
  let isPanning = false;
  let panStart = { x: 0, y: 0 };
  let panStartCamera = { x: 0, y: 0 };

  let dragStartGX = null;
  let dragStartGY = null;

  const editorToolbar = (() => {
    const defs = [
      { id: 'blocks', label: 'Ground' },
      { id: 'spike', label: 'Spike' },
      { id: 'trophy', label: 'Trophy' },
      { id: 'start', label: 'Spawn' },
      { id: 'rotLeft', label: '↺' },
      { id: 'rotRight', label: '↻' },
      { id: 'erase', label: 'Erase' }
    ];
    let x = 10;
    const buttons = defs.map(d => {
      let w = 64;
      if (d.id === 'blocks') w = 85;
      if (d.id === 'rotLeft' || d.id === 'rotRight') w = 36;
      const btn = { ...d, x, y: 5, w, h: 28 };
      x += w + 6;
      return btn;
    });
    buttons.push({ id: 'pan', label: '✋ Pan', x: canvas.width - 180, y: 5, w: 80, h: 28 });
    buttons.push({ id: 'menu', label: 'Menu', x: canvas.width - 90, y: 5, w: 80, h: 28 });
    return buttons;
  })();
  let lastPaintTool = 'blocks';

  // ---- In-canvas Blocks Dropdown Menu ----
  const blockDropdown = document.createElement('div');
  blockDropdown.style.display = 'none';
  blockDropdown.style.position = 'absolute';
  blockDropdown.style.background = '#1c1f2b';
  blockDropdown.style.border = '1px solid #cfd3dc';
  blockDropdown.style.borderRadius = '4px';
  blockDropdown.style.zIndex = '1000';
  blockDropdown.style.fontFamily = 'sans-serif';
  blockDropdown.style.fontSize = '12px';
  blockDropdown.style.color = '#cfd3dc';
  blockDropdown.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';

  const blockTypes = [
    { id: 'ground', name: 'Ground' },
    { id: 'rock', name: 'Rock' },
    { id: 'wood', name: 'Wood' },
    { id: 'dirt', name: 'Dirt' }
  ];

  blockTypes.forEach(bt => {
    const item = document.createElement('div');
    item.textContent = bt.name;
    item.style.padding = '6px 14px';
    item.style.cursor = 'pointer';
    item.addEventListener('mouseenter', () => item.style.background = '#2c2f3a');
    item.addEventListener('mouseleave', () => item.style.background = 'transparent');
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedBlockType = bt.id;
      editorTool = 'blocks';
      lastPaintTool = 'blocks';
      const blocksBtn = editorToolbar.find(b => b.id === 'blocks');
      if (blocksBtn) blocksBtn.label = bt.name;
      blockDropdown.style.display = 'none';
    });
    blockDropdown.appendChild(item);
  });
  document.body.appendChild(blockDropdown);

  window.addEventListener('click', (e) => {
    if (!blockDropdown.contains(e.target) && e.target !== canvas) {
      blockDropdown.style.display = 'none';
    }
  });

  function getTileData(t) {
    if (!t) return { type: 'ground', rotation: 0 };
    if (typeof t === 'string') return { type: t, rotation: 0 };
    return { type: t.type || 'ground', rotation: (Number(t.rotation) || 0) % 360 };
  }

  function loadLevelIntoEditor(lvl) {
    editorTiles.clear();
    for (const t of lvl.tiles) {
      if (t.w === TILE_SIZE && t.h === TILE_SIZE) {
        editorTiles.set(`${Math.round(t.x / TILE_SIZE)},${Math.round(t.y / TILE_SIZE)}`, {
          type: t.type,
          rotation: (Number(t.rotation) || 0) % 360
        });
      }
    }
    editorPlayerStart = { x: lvl.playerStart.x, y: lvl.playerStart.y };
    EDITOR_LEVEL_WIDTH = lvl.width;
    EDITOR_LEVEL_HEIGHT = lvl.height;
    editorWidthTiles.value = Math.round(EDITOR_LEVEL_WIDTH / TILE_SIZE);
    editorHeightTiles.value = Math.round(EDITOR_LEVEL_HEIGHT / TILE_SIZE);
    bgColorPicker.value = lvl.backgroundColor || '#4a6fa5';
    camera.x = 0; camera.y = 0;
  }

  function exportEditorLevel() {
    const tiles = [];
    for (const [key, val] of editorTiles.entries()) {
      const [gx, gy] = key.split(',').map(Number);
      const tData = getTileData(val);
      tiles.push({ x: gx * TILE_SIZE, y: gy * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE, type: tData.type, rotation: (Number(tData.rotation) || 0) % 360 });
    }
    return sanitizeLevel({
      width: EDITOR_LEVEL_WIDTH,
      height: EDITOR_LEVEL_HEIGHT,
      backgroundColor: bgColorPicker.value,
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
    if (e.code === 'Escape' && (state === 'editor' || state === 'play' || state === 'levelSelect' || state === 'settings')) {
      state = 'menu';
      blockDropdown.style.display = 'none';
    }
  }, { passive: false });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  function isDown(...codes) { return codes.some(c => keys[c]); }

  // ---- Input: mouse ----
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
    else if (editorTool === 'blocks') editorTiles.set(key, { type: selectedBlockType, rotation: editorRotation % 360 });
    else editorTiles.set(key, { type: editorTool, rotation: editorRotation % 360 });
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

  function handleSliderDrag(pos) {
    const trackX = canvas.width / 2 - 120;
    const trackW = 240;

    if (isDraggingSlider === 'music') {
      const musicBarX = trackX;
      const val = Math.max(0, Math.min(1, (pos.x - musicBarX) / trackW));
      gameSettings.musicVolume = val;
      if (assets.music) assets.music.volume = val;
    } else if (isDraggingSlider === 'sfx') {
      const sfxBarX = trackX;
      const val = Math.max(0, Math.min(1, (pos.x - sfxBarX) / trackW));
      gameSettings.sfxVolume = val;
    }
  }

  canvas.addEventListener('mousedown', e => {
    const pos = getCanvasPos(e);

    if (state === 'menu') {
      blockDropdown.style.display = 'none';
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
          } else if (b.id === 'settings') {
            state = 'settings';
          }
        }
      }
      return;
    }

    if (state === 'settings') {
      blockDropdown.style.display = 'none';
      const trackX = canvas.width / 2 - 120;
      const trackW = 240;
      const musicBar = { x: trackX, y: 130, w: trackW, h: 30 };
      const sfxBar = { x: trackX, y: 220, w: trackW, h: 30 };
      const backBtn = { x: canvas.width / 2 - 100, y: 320, w: 200, h: 40 };

      if (pointInRect(pos.x, pos.y, musicBar)) {
        isDraggingSlider = 'music';
        handleSliderDrag(pos);
      } else if (pointInRect(pos.x, pos.y, sfxBar)) {
        isDraggingSlider = 'sfx';
        handleSliderDrag(pos);
      } else if (pointInRect(pos.x, pos.y, backBtn)) {
        state = 'menu';
      }
      return;
    }

    if (state === 'levelSelect') {
      blockDropdown.style.display = 'none';
      const backBtn = { x: canvas.width / 2 - 100, y: 380, w: 200, h: 40, label: 'Menu' };
      if (pointInRect(pos.x, pos.y, backBtn)) {
        state = 'menu';
        return;
      }

      let startY = 100;
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
            blockDropdown.style.display = 'none';
            state = 'menu';
          } else if (b.id === 'pan') {
            blockDropdown.style.display = 'none';
            if (editorTool === 'pan') editorTool = lastPaintTool;
            else { lastPaintTool = editorTool; editorTool = 'pan'; }
          } else if (b.id === 'rotLeft') {
            blockDropdown.style.display = 'none';
            editorRotation = (editorRotation - 90 + 360) % 360;
            return;
          } else if (b.id === 'rotRight') {
            blockDropdown.style.display = 'none';
            editorRotation = (editorRotation + 90) % 360;
            return;
          } else if (b.id === 'blocks') {
            if (editorTool === 'blocks' && blockDropdown.style.display === 'block') {
              blockDropdown.style.display = 'none';
            } else {
              editorTool = 'blocks';
              lastPaintTool = 'blocks';
              const rect = canvas.getBoundingClientRect();
              const scaleX = rect.width / canvas.width;
              const scaleY = rect.height / canvas.height;
              blockDropdown.style.left = `${rect.left + (b.x * scaleX)}px`;
              blockDropdown.style.top = `${rect.top + ((b.y + b.h + 4) * scaleY)}px`;
              blockDropdown.style.display = 'block';
            }
          } else {
            blockDropdown.style.display = 'none';
            editorTool = b.id;
            lastPaintTool = b.id;
          }
          return;
        }
      }

      blockDropdown.style.display = 'none';

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
    const pos = getCanvasPos(e);
    if (state === 'settings' && isDraggingSlider) {
      handleSliderDrag(pos);
      return;
    }
    if (state !== 'editor') return;
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
    isDraggingSlider = null;
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
        const rot = (Number(t.rotation) || 0) % 360;
        let hazardHitbox;
        if (rot === 90) {
          hazardHitbox = { x: t.x, y: t.y + (t.h * 0.2), w: t.w * 0.5, h: t.h * 0.6 };
        } else if (rot === 180) {
          hazardHitbox = { x: t.x + (t.w * 0.2), y: t.y, w: t.w * 0.6, h: t.h * 0.5 };
        } else if (rot === 270) {
          hazardHitbox = { x: t.x + (t.w * 0.5), y: t.y + (t.h * 0.2), w: t.w * 0.5, h: t.h * 0.6 };
        } else {
          hazardHitbox = { x: t.x + (t.w * 0.2), y: t.y + (t.h * 0.5), w: t.w * 0.6, h: t.h * 0.5 };
        }

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
      if (assets.jumpSound && gameSettings.sfxVolume > 0) {
        assets.jumpSound.currentTime = 0;
        assets.jumpSound.volume = gameSettings.sfxVolume;
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

  // ---- Tile Renderer ----
  function drawTile(sx, sy, w, h, type, rotation = 0) {
    const exactRotation = (Number(rotation) || 0) % 360;
    ctx.save();
    ctx.translate(sx + w / 2, sy + h / 2);
    if (exactRotation !== 0) {
      ctx.rotate((exactRotation * Math.PI) / 180);
    }
    const drawW = w;
    const drawH = h;
    const drawX = -drawW / 2;
    const drawY = -drawH / 2;

    if (assets[type]) {
      ctx.drawImage(assets[type], drawX, drawY, drawW, drawH);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    if (type === 'ground') {
      ctx.fillStyle = '#4a7c3b';
      ctx.fillRect(drawX, drawY, drawW, drawH * 0.3);
      ctx.fillStyle = '#325426';
      ctx.fillRect(drawX, drawY + drawH * 0.3, drawW, drawH * 0.1);
      ctx.fillStyle = '#8b5a2b';
      ctx.fillRect(drawX, drawY + drawH * 0.4, drawW, drawH * 0.6);
    } else if (type === 'rock') {
      ctx.fillStyle = '#7a8288';
      ctx.fillRect(drawX, drawY, drawW, drawH);
    } else if (type === 'wood') {
      ctx.fillStyle = '#8b5a2b';
      ctx.fillRect(drawX, drawY, drawW, drawH);
    } else if (type === 'dirt') {
      ctx.fillStyle = '#784212';
      ctx.fillRect(drawX, drawY, drawW, drawH);
    } else if (type === 'spike') {
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.moveTo(drawX, drawY + drawH);
      ctx.lineTo(drawX + drawW / 2, drawY);
      ctx.lineTo(drawX + drawW, drawY + drawH);
      ctx.closePath();
      ctx.fill();
    } else if (type === 'trophy') {
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(drawX + drawW * 0.3, drawY + drawH * 0.2, drawW * 0.4, drawH * 0.5);
    } else {
      ctx.fillStyle = '#555';
      ctx.fillRect(drawX, drawY, drawW, drawH);
    }
    ctx.restore();
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
    ctx.fillText('Platformer', canvas.width / 2, 40);

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

  function drawSlider(label, value, x, y, w, h) {
    ctx.fillStyle = '#f0f2f5';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${label}: ${Math.round(value * 100)}%`, x, y - 6);

    ctx.fillStyle = '#2c2f3a';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#cfd3dc';
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = '#4a6fa5';
    ctx.fillRect(x, y, w * value, h);

    const thumbX = x + (w * value);
    ctx.fillStyle = '#f0f2f5';
    ctx.fillRect(thumbX - 6, y - 4, 12, h + 8);
    ctx.strokeRect(thumbX - 6, y - 4, 12, h + 8);
  }

  function drawSettings() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1b1f2a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#f0f2f5';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Settings', canvas.width / 2, 50);

    const trackX = canvas.width / 2 - 120;
    const trackW = 240;

    drawSlider('Music Volume', gameSettings.musicVolume, trackX, 130, trackW, 20);
    drawSlider('SFX Volume', gameSettings.sfxVolume, trackX, 220, trackW, 20);

    const backBtn = { x: canvas.width / 2 - 100, y: 320, w: 200, h: 40 };
    ctx.fillStyle = '#2c2f3a';
    ctx.fillRect(backBtn.x, backBtn.y, backBtn.w, backBtn.h);
    ctx.strokeStyle = '#cfd3dc';
    ctx.strokeRect(backBtn.x, backBtn.y, backBtn.w, backBtn.h);
    ctx.fillStyle = '#f0f2f5';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Back to Menu', backBtn.x + backBtn.w / 2, backBtn.y + backBtn.h / 2);
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
        const displayName = filename.replace(/\.json$/i, '');
        const itemRect = { x: startX, y: startY + i * (btnH + spacing), w: btnW, h: btnH };
        
        ctx.fillStyle = '#2c2f3a';
        ctx.fillRect(itemRect.x, itemRect.y, itemRect.w, itemRect.h);
        ctx.strokeStyle = '#cfd3dc';
        ctx.strokeRect(itemRect.x, itemRect.y, itemRect.w, itemRect.h);
        ctx.fillStyle = '#f0f2f5';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Play ${displayName}`, itemRect.x + itemRect.w / 2, itemRect.y + itemRect.h / 2);
      }
    }

    const backBtn = { x: canvas.width / 2 - 100, y: 380, w: 200, h: 40, label: 'Menu' };
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(backBtn.x, backBtn.y, backBtn.w, backBtn.h);
    ctx.strokeStyle = '#cfd3dc';
    ctx.strokeRect(backBtn.x, backBtn.y, backBtn.w, backBtn.h);
    ctx.fillStyle = '#f0f2f5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(backBtn.label, backBtn.x + backBtn.w / 2, backBtn.y + backBtn.h / 2);
  }

  function drawPlay() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = currentLevel.backgroundColor || '#4a6fa5';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    for (const t of currentLevel.tiles) {
      drawTile(t.x, t.y, t.w, t.h, t.type, t.rotation || 0);
    }

    if (assets.player) {
      ctx.drawImage(assets.player, player.x, player.y, player.w, player.h);
    } else {
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(player.x, player.y, player.w, player.h);
    }
    ctx.restore();

    if (levelComplete) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#f1c40f';
      ctx.font = '32px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Level Complete!', canvas.width / 2, canvas.height / 2);
    }
  }

  function drawEditor() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1b1f2a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    ctx.strokeStyle = '#e74c3c';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, EDITOR_LEVEL_WIDTH, EDITOR_LEVEL_HEIGHT);
    ctx.lineWidth = 1;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    for (let x = 0; x <= EDITOR_LEVEL_WIDTH; x += TILE_SIZE) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, EDITOR_LEVEL_HEIGHT); ctx.stroke();
    }
    for (let y = 0; y <= EDITOR_LEVEL_HEIGHT; y += TILE_SIZE) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(EDITOR_LEVEL_WIDTH, y); ctx.stroke();
    }

    for (const [key, val] of editorTiles.entries()) {
      const [gx, gy] = key.split(',').map(Number);
      const tData = getTileData(val);
      drawTile(gx * TILE_SIZE, gy * TILE_SIZE, TILE_SIZE, TILE_SIZE, tData.type, tData.rotation);
    }

    ctx.fillStyle = 'rgba(46, 204, 113, 0.6)';
    ctx.fillRect(editorPlayerStart.x, editorPlayerStart.y, TILE_SIZE, TILE_SIZE);
    
    ctx.restore();

    ctx.fillStyle = '#12141c';
    ctx.fillRect(0, 0, canvas.width, canvas.height < 40 ? canvas.height : 40);

    for (const b of editorToolbar) {
      const active = (b.id === editorTool) || (b.id === 'pan' && editorTool === 'pan');
      drawButton(b, active);
    }
  }

  // ---- Main Game Loop ----
  let lastTime = performance.now();
  function loop(time) {
    const dt = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;

    if (state === 'menu') {
      drawMenu();
      editorPanel.style.display = 'none';
      blockDropdown.style.display = 'none';
    } else if (state === 'levelSelect') {
      drawLevelSelect();
      editorPanel.style.display = 'none';
      blockDropdown.style.display = 'none';
    } else if (state === 'settings') {
      drawSettings();
      editorPanel.style.display = 'none';
      blockDropdown.style.display = 'none';
    } else if (state === 'editor') {
      updateEditor(dt);
      drawEditor();
      editorPanel.style.display = 'flex';
    } else if (state === 'play') {
      updatePlay(dt);
      drawPlay();
      editorPanel.style.display = 'none';
      blockDropdown.style.display = 'none';
    }

    requestAnimationFrame(loop);
  }

  loadAssets(() => {
    startMusic();
    requestAnimationFrame(loop);
  });
}

initPlatformerGame();
