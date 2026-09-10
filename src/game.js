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
  
  // Custom Trophy Size (Assumed 64x64 - adjust as needed)
  const TROPHY_WIDTH = 64;
  const TROPHY_HEIGHT = 64;

  // Audio volume states 
  let musicVolume = 0.5; 
  let sfxVolume = 0.5; 

  // Game State Manager
  let gameState = 'MENU'; // 'MENU' or 'PLAYING'

  // Create UI Container over the canvas
  const uiContainer = document.createElement('div');
  uiContainer.style.position = 'absolute';
  uiContainer.style.top = canvas.offsetTop + 'px';
  uiContainer.style.left = canvas.offsetLeft + 'px';
  uiContainer.style.width = canvas.width + 'px';
  uiContainer.style.height = canvas.height + 'px';
  uiContainer.style.overflow = 'hidden';
  uiContainer.style.pointerEvents = 'none'; // Let clicks pass to canvas if needed
  document.body.appendChild(uiContainer);

  // Main Menu UI
  const mainMenu = document.createElement('div');
  mainMenu.style.position = 'absolute';
  mainMenu.style.top = '0';
  mainMenu.style.left = '0';
  mainMenu.style.width = '100%';
  mainMenu.style.height = '100%';
  mainMenu.style.background = 'rgba(27, 31, 42, 0.85)';
  mainMenu.style.display = 'flex';
  mainMenu.style.flexDirection = 'column';
  mainMenu.style.alignItems = 'center';
  mainMenu.style.justifyContent = 'center';
  mainMenu.style.pointerEvents = 'auto'; // Catch clicks for menu
  mainMenu.style.color = '#cfd3dc';
  mainMenu.style.fontFamily = 'sans-serif';
  mainMenu.style.zIndex = '5';
  
  mainMenu.innerHTML = `
    <h1 style="font-size: 36px; margin-bottom: 30px;">Platformer Game</h1>
    <button id="playBtn" style="padding: 12px 30px; font-size: 18px; margin-bottom: 15px; cursor: pointer; background: #2ecc71; border: none; border-radius: 4px; color: white; font-weight: bold;">Play Game</button>
    <button id="openSettingsBtn" style="padding: 10px 20px; font-size: 16px; cursor: pointer; background: #2c2f3a; border: 1px solid #4e5568; border-radius: 4px; color: #cfd3dc;">⚙️ Settings</button>
  `;
  uiContainer.appendChild(mainMenu);

  // Settings Modal UI
  const settingsModal = document.createElement('div'); 
  settingsModal.style.position = 'absolute'; 
  settingsModal.style.top = '50%'; 
  settingsModal.style.left = '50%'; 
  settingsModal.style.transform = 'translate(-50%, -50%)';
  settingsModal.style.zIndex = '10'; 
  settingsModal.style.background = '#1b1f2a'; 
  settingsModal.style.border = '2px solid #2c2f3a'; 
  settingsModal.style.borderRadius = '6px'; 
  settingsModal.style.padding = '20px'; 
  settingsModal.style.color = '#cfd3dc'; 
  settingsModal.style.display = 'none'; 
  settingsModal.style.pointerEvents = 'auto';
  settingsModal.style.fontFamily = 'sans-serif'; 
  settingsModal.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)'; 
  settingsModal.innerHTML = ` 
    <h3 style="margin: 0 0 15px 0; font-size: 18px; text-align: center;">Audio Settings</h3> 
    <div style="margin-bottom: 15px;"> 
      <label style="display: block; font-size: 14px; margin-bottom: 6px;">Music Volume: <span id="musicVal">50%</span></label> 
      <input type="range" id="musicSlider" min="0" max="100" value="50" style="width: 200px; cursor: pointer;"> 
    </div> 
    <div style="margin-bottom: 20px;"> 
      <label style="display: block; font-size: 14px; margin-bottom: 6px;">SFX Volume: <span id="sfxVal">50%</span></label> 
      <input type="range" id="sfxSlider" min="0" max="100" value="50" style="width: 200px; cursor: pointer;"> 
    </div> 
    <button id="closeSettings" style="width: 100%; padding: 8px; background: #2c2f3a; color: #cfd3dc; border: 1px solid #4e5568; border-radius: 4px; cursor: pointer;">Back to Menu</button> 
  `; 
  uiContainer.appendChild(settingsModal); 

  // UI Event Listeners
  document.getElementById('playBtn').addEventListener('click', () => {
    mainMenu.style.display = 'none';
    gameState = 'PLAYING';
    
    // Resume music if it was ready
    if (assets.music && assets.music.paused) {
      assets.music.play().catch(() => {});
    }
  });

  document.getElementById('openSettingsBtn').addEventListener('click', () => { 
    settingsModal.style.display = 'block'; 
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
    // Adjusted the Y position so the taller trophy sits flush on the rock platform (220 - TROPHY_HEIGHT)
    { x: 450, y: 220 - TROPHY_HEIGHT, width: TROPHY_WIDTH, height: TROPHY_HEIGHT, type: 'trophy', collected: false } 
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
    y = 250; 
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
          // Uses the specific width and height assigned to the item
          ctx.drawImage(sprite, item.x, item.y, item.width, item.height); 
        } else { 
          ctx.fillStyle = '#f1c40f'; 
          ctx.fillRect(item.x, item.y, item.width, item.height); 
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
    // Only update gameplay logic if we are actively playing
    if (gameState === 'PLAYING') {
      update(); 
    }
    
    // Always render so the menu has the game level visible in the background
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
