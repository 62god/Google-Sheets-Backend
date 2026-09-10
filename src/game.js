function initPlatformerGame() {
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const REPO_BASE = window.REPO_BASE || 'https://raw.githubusercontent.com/62god/Google-Sheets-Backend/main';

  const assetSources = {
    player:     `${REPO_BASE}/assets/sprites/player.png`,
    ground:     `${REPO_BASE}/assets/sprites/ground.png`,
    rock:       `${REPO_BASE}/assets/sprites/rock.png`,
    wood:       `${REPO_BASE}/assets/sprites/wood.png`,
    dirt:       `${REPO_BASE}/assets/sprites/dirt.png`,
    spike:      `${REPO_BASE}/assets/sprites/spike.png`,
    trophy:     `${REPO_BASE}/assets/sprites/trophy.png`,
    jumpSound:  `${REPO_BASE}/assets/audio/jump.mp3`,
    deathSound: `${REPO_BASE}/assets/audio/death.mp3`,
    music:      `${REPO_BASE}/assets/audio/music.mp3`
  };

  const assets = {};
  let assetsLoaded = false;
  const TILE_SIZE = 32;

  // Audio volume states
  let musicVolume = 0.5;
  let sfxVolume = 0.5;

  // Create Settings UI Dynamically
  const settingsBtn = document.createElement('button');
  settingsBtn.textContent = '⚙️ Settings';
  settingsBtn.style.position = 'absolute';
  settingsBtn.style.top = '10px';
  settingsBtn.style.right = '10px';
  settingsBtn.style.zIndex = '10';
  settingsBtn.style.padding = '6px 12px';
  settingsBtn.style.background = '#2c2f3a';
  settingsBtn.style.color = '#cfd3dc';
  settingsBtn.style.border = '1px solid #4e5568';
  settingsBtn.style.borderRadius = '4px';
  settingsBtn.style.cursor = 'pointer';
  document.body.appendChild(settingsBtn);

  const settingsModal = document.createElement('div');
  settingsModal.style.position = 'absolute';
  settingsModal.style.top = '50px';
  settingsModal.style.right = '10px';
  settingsModal.style.zIndex = '10';
  settingsModal.style.background = '#1b1f2a';
  settingsModal.style.border = '2px solid #2c2f3a';
  settingsModal.style.borderRadius = '6px';
  settingsModal.style.padding = '15px';
  settingsModal.style.color = '#cfd3dc';
  settingsModal.style.display = 'none';
  settingsModal.style.fontFamily = 'sans-serif';
  settingsModal.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
  settingsModal.innerHTML = `
    <h3 style="margin: 0 0 10px 0; font-size: 15px;">Audio Settings</h3>
    <div style="margin-bottom: 10px;">
      <label style="display: block; font-size: 12px; margin-bottom: 4px;">Music Volume: <span id="musicVal">50%</span></label>
      <input type="range" id="musicSlider" min="0" max="100" value="50" style="width: 150px; cursor: pointer;">
    </div>
    <div style="margin-bottom: 12px;">
      <label style="display: block; font-size: 12px; margin-bottom: 4px;">SFX Volume: <span id="sfxVal">50%</span></label>
      <input type="range" id="sfxSlider" min="0" max="100" value="50" style="width: 150px; cursor: pointer;">
    </div>
    <button id="closeSettings" style="width: 100%; padding: 6px; background: #2c2f3a; color: #cfd3dc; border: 1px solid #4e5568; border-radius: 4px; cursor: pointer;">Close</button>
  `;
  document.body.appendChild(settingsModal);

  settingsBtn.addEventListener('click', () => {
    settingsModal.style.display = settingsModal.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('closeSettings').addEventListener('click', () => {
    settingsModal.style.display = 'none';
  });

  const musicSlider = document.getElementById('musicSlider');
  const sfxSlider = document.getElementById('sfxSlider');
  const musicVal = document.getElementById('musicVal');
  const sfxVal = document.getElementById('sfxVal');

  musicSlider.addEventListener('input', (e) => {
    musicVolume = e.target.value / 100;
    musicVal.textContent = `${e.target.value}%`;
    if (assets.music) assets.music.volume = musicVolume;
  });

  sfxSlider.addEventListener('input', (e) => {
    sfxVolume = e.target.value / 100;
    sfxVal.textContent = `${e.target.value}%`;
    if (assets.jumpSound) assets.jumpSound.volume = sfxVolume;
    if (assets.deathSound) assets.deathSound.volume = sfxVolume;
  });

  // Load assets with crossOrigin support for Google Apps Script sandbox
  function loadAssets(callback) {
    const keys = Object.keys(assetSources);
    let loadedCount = 0;

    if (keys.length === 0) {
      assetsLoaded = true;
      callback();
      return;
    }

    keys.forEach(key => {
      const src = assetSources[key];
      if (src.endsWith('.mp3') || src.endsWith('.wav')) {
        const audio = new Audio();
        audio.crossOrigin = 'anonymous';
        audio.src = src;
        audio.oncanplaythrough = () => {
          assets[key] = audio;
          checkDone();
        };
        audio.onerror = () => {
          console.warn(`Failed to load audio: ${src}`);
          assets[key] = null;
          checkDone();
        };
      } else {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          assets[key] = img;
          checkDone();
        };
        img.onerror = () => {
          console.warn(`Failed to load sprite: ${src} (Falling back to placeholder)`);
          assets[key] = null;
          checkDone();
        };
        img.src = src;
      }
    });

    function checkDone() {
      loadedCount++;
      if (loadedCount === keys.length) {
        assetsLoaded = true;
        
        // Initialize volume and start looping music
        if (assets.music) {
          assets.music.loop = true;
          assets.music.volume = musicVolume;
          assets.music.play().catch(() => {});
        }
        if (assets.jumpSound) assets.jumpSound.volume = sfxVolume;
        if (assets.deathSound) assets.deathSound.volume = sfxVolume;

        callback();
      }
    }
  }

  // Input tracking
  const keys = {};
  window.addEventListener('keydown', e => { keys[e.code] = true; });
  window.addEventListener('keyup', e => { keys[e.code] = false; });

  // Player state
  const player = {
    x: 100,
    y: 250,
    width: TILE_SIZE,
    height: TILE_SIZE,
    vx: 0,
    vy: 0,
    speed: 4,
    jumpForce: -10,
    gravity: 0.5,
    grounded: false
  };

  // Sample level platforms and items
  const platforms = [
    { x: 0, y: 400, width: 800, height: 50, type: 'ground' },
    { x: 200, y: 300, width: 128, height: TILE_SIZE, type: 'wood' },
    { x: 400, y: 220, width: 128, height: TILE_SIZE, type: 'rock' }
  ];

  const hazards = [
    { x: 328, y: 368, width: TILE_SIZE, height: TILE_SIZE, type: 'spike' }
  ];

  const items = [
    { x: 450, y: 180, width: TILE_SIZE, height: TILE_SIZE, type: 'trophy', collected: false }
  ];

  function update() {
    // Horizontal movement
    player.vx = 0;
    if (keys['ArrowLeft'] || keys['KeyA']) player.vx = -player.speed;
    if (keys['ArrowRight'] || keys['KeyD']) player.vx = player.speed;

    player.x += player.vx;

    // Vertical movement & gravity
    player.vy += player.gravity;
    player.y += player.vy;
    player.grounded = false;

    // Platform collisions
    platforms.forEach(p => {
      if (
        player.x < p.x + p.width &&
        player.x + player.width > p.x &&
        player.y < p.y + p.height &&
        player.y + player.height > p.y
      ) {
        if (player.vy > 0 && player.y + player.height - player.vy <= p.y) {
          player.y = p.y - player.height;
          player.vy = 0;
          player.grounded = true;
        }
      }
    });

    // Jump trigger
    if ((keys['Space'] || keys['ArrowUp'] || keys['KeyW']) && player.grounded) {
      player.vy = player.jumpForce;
      player.grounded = false;
      if (assets.jumpSound) {
        assets.jumpSound.currentTime = 0;
        assets.jumpSound.volume = sfxVolume;
        assets.jumpSound.play().catch(() => {});
      }
    }

    // Hazard checks
    hazards.forEach(h => {
      if (
        player.x < h.x + h.width &&
        player.x + player.width > h.x &&
        player.y < h.y + h.height &&
        player.y + player.height > h.y
      ) {
        resetPlayer();
      }
    });

    // Item/Trophy collection checks
    items.forEach(item => {
      if (!item.collected &&
        player.x < item.x + item.width &&
        player.x + player.width > item.x &&
        player.y < item.y + item.height &&
        player.y + player.height > item.y
      ) {
        item.collected = true;
      }
    });

    // Screen boundaries
    if (player.x < 0) player.x = 0;
    if (player.x > canvas.width - player.width) player.x = canvas.width - player.width;
    if (player.y > canvas.height) resetPlayer();
  }

  function resetPlayer() {
    player.x = 100;
    player.y = 250;
    player.vy = 0;
    if (assets.deathSound) {
      assets.deathSound.currentTime = 0;
      assets.deathSound.volume = sfxVolume;
      assets.deathSound.play().catch(() => {});
    }
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw platforms
    platforms.forEach(p => {
      const sprite = assets[p.type];
      if (sprite) {
        ctx.drawImage(sprite, p.x, p.y, p.width, p.height);
      } else {
        ctx.fillStyle = p.type === 'ground' ? '#4e3629' : '#7f8c8d';
        ctx.fillRect(p.x, p.y, p.width, p.height);
      }
    });

    // Draw hazards
    hazards.forEach(h => {
      const sprite = assets[h.type];
      if (sprite) {
        ctx.drawImage(sprite, h.x, h.y, h.width, h.height);
      } else {
        ctx.fillStyle = '#e74c3c';
        ctx.fillRect(h.x, h.y, h.width, h.height);
      }
    });

    // Draw items (Trophy)
    items.forEach(item => {
      if (!item.collected) {
        const sprite = assets[item.type];
        if (sprite) {
          ctx.drawImage(sprite, item.x, item.y, TILE_SIZE, TILE_SIZE);
        } else {
          ctx.fillStyle = '#f1c40f';
          ctx.fillRect(item.x, item.y, TILE_SIZE, TILE_SIZE);
        }
      }
    });

    // Draw player
    if (assets.player) {
      ctx.drawImage(assets.player, player.x, player.y, player.width, player.height);
    } else {
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(player.x, player.y, player.width, player.height);
    }
  }

  function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
  }

  loadAssets(() => {
    gameLoop();
  });
}

window.initPlatformerGame = initPlatformerGame;
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initPlatformerGame();
} else {
  window.addEventListener('DOMContentLoaded', initPlatformerGame);
}
