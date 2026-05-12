/* ================================================================
   GaletaClic - Lògica del Joc
   ================================================================
   ESTRUCTURA DE VARIABLES:
   ─────────────────────────
   gameState: Objecte central que conté TOTES les dades del joc.

   • cookies          → Galetes actuals del jugador
   • totalCookies     → Galetes totals acumulades (mai decreixen)
   • weeklyC ookies   → Galetes guanyades aquesta setmana (per lliga)
   • cookiesPerClick  → Galetes per clic (base)
   • cookiesPerSecond → CPS calculat automàticament
   • prestigeLevel    → Nivell de prestigi (0, 1, 2...)
   • prestigeMultiplier → Bonificació del prestigi (1 + niveau*0.1)
   • buildings[]      → Edificis comprats (generen CPS passiu)
   • upgrades[]       → Millores comprades (multipliquen CPS/CPC)
   • lastSave         → Timestamp de l'últim guardament

   SISTEMA DE LLIGUES (setmanal):
   ─────────────────────────────
   • Bronze   < 1.000 galetes/setmana
   • Plata    1.000 – 9.999
   • Or       10.000 – 99.999
   • Diamant  100.000 – 999.999
   • Llegenda ≥ 1.000.000

   SISTEMA DE PRESTIGI:
   ──────────────────
   Requereix 1.000.000 galetes totals.
   En activar, es reinicia el joc però s'obté:
   +10% multiplicador permanent per cada nivell de prestigi.
   ================================================================ */

// ─── CONFIGURACIÓ SUPABASE ────────────────────────────────────────────
// Taula necessària a Supabase (executa això al SQL Editor):
//   CREATE TABLE IF NOT EXISTS leaderboard (
//     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
//     username TEXT UNIQUE NOT NULL,
//     score BIGINT DEFAULT 0,
//     weekly_cookies BIGINT DEFAULT 0,
//     prestige_level INT DEFAULT 0,
//     league TEXT DEFAULT 'Bronze',
//     updated_at TIMESTAMP DEFAULT NOW()
//   );

const SUPABASE_URL = 'https://orbbidmhbgiluidmkamw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9yYmJpZG1oYmdpbHVpZG1rYW13Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MDIzNjIsImV4cCI6MjA5NDE3ODM2Mn0.gNOML7xb7_tS2O64HOpbxTE5w3UbXiX9eWiCgKE7UC8';
const SUPABASE_ENABLED = true;

// Client Supabase (inicialitzat després de carregar l'SDK)
let db = null;

// ─── DEFINICIONS: EDIFICIS (generen CPS) ────────────────────────────
const BUILDINGS_DEF = [
  {
    id: 'cursor',
    name: 'Cursor Automàtic',
    emoji: '🖱️',
    desc: 'Auto-clica la galeta cada segon',
    baseCost: 15,
    baseCps: 0.1,
    count: 0
  },
  {
    id: 'granny',
    name: 'Àvia Galetes',
    emoji: '👵',
    desc: 'Una àvia que fa galetes a mà, molt lentament',
    baseCost: 100,
    baseCps: 0.5,
    count: 0
  },
  {
    id: 'farm',
    name: 'Granja de Galetes',
    emoji: '🌾',
    desc: 'Cultiva galetes directament del camp',
    baseCost: 500,
    baseCps: 4,
    count: 0
  },
  {
    id: 'factory',
    name: 'Fàbrica Industrial',
    emoji: '🏭',
    desc: 'Producció massiva de galetes automatitzada',
    baseCost: 3000,
    baseCps: 20,
    count: 0
  },
  {
    id: 'lab',
    name: 'Laboratori Quàntic',
    emoji: '⚗️',
    desc: 'Sintetitza galetes a escala molecular',
    baseCost: 20000,
    baseCps: 150,
    count: 0
  },
  {
    id: 'portal',
    name: 'Portal de Galetes',
    emoji: '🌀',
    desc: 'Importa galetes d\'una dimensió paral·lela',
    baseCost: 100000,
    baseCps: 1000,
    count: 0
  }
];

// ─── DEFINICIONS: MILLORES ────────────────────────────────────────────
const UPGRADES_DEF = [
  {
    id: 'better_fingers',
    name: 'Dits més Forts',
    emoji: '💪',
    desc: 'Dobla les galetes per clic',
    cost: 100,
    effect: () => { gameState.cookiesPerClick *= 2; },
    unlock: () => gameState.totalCookies >= 100,
    bought: false
  },
  {
    id: 'grandma_recipe',
    name: 'Recepta Secreta',
    emoji: '📜',
    desc: 'Les àvies produeixen 2× més',
    cost: 500,
    effect: () => { /* s'aplica al càlcul CPS */ },
    unlock: () => (BUILDINGS_DEF.find(b => b.id === 'granny')?.count || 0) >= 1,
    bought: false,
    multiplierTarget: 'granny',
    multiplierValue: 2
  },
  {
    id: 'solar_farm',
    name: 'Granja Solar',
    emoji: '☀️',
    desc: 'Les granges produeixen 3× més',
    cost: 2000,
    effect: () => {},
    unlock: () => (BUILDINGS_DEF.find(b => b.id === 'farm')?.count || 0) >= 3,
    bought: false,
    multiplierTarget: 'farm',
    multiplierValue: 3
  },
  {
    id: 'quantum_oven',
    name: 'Forn Quàntic',
    emoji: '🔬',
    desc: 'Tot el CPS +10%',
    cost: 10000,
    effect: () => {},
    unlock: () => gameState.totalCookies >= 5000,
    bought: false,
    globalCpsMultiplier: 1.1
  },
  {
    id: 'time_warp',
    name: 'Distorsió Temporal',
    emoji: '⏰',
    desc: 'Tot el CPS ×2',
    cost: 50000,
    effect: () => {},
    unlock: () => gameState.totalCookies >= 25000,
    bought: false,
    globalCpsMultiplier: 2
  },
  {
    id: 'cookie_singularity',
    name: 'Singularitat Galetes',
    emoji: '🌌',
    desc: 'CPC = 1% del teu CPS',
    cost: 500000,
    effect: () => {},
    unlock: () => gameState.totalCookies >= 100000,
    bought: false,
    cpcFromCps: 0.01
  }
];

// ─── ESTAT DEL JOC ───────────────────────────────────────────────────
let gameState = {
  cookies: 0,
  totalCookies: 0,
  weeklyC: 0,
  cookiesPerClick: 1,
  cookiesPerSecond: 0,
  prestigeLevel: 0,
  prestigeMultiplier: 1.0,
  buildings: BUILDINGS_DEF.map(b => ({ ...b })),
  upgrades: UPGRADES_DEF.map(u => ({
    id: u.id,
    bought: false
  })),
  lastSave: Date.now(),
  weeklyReset: Date.now() + 7 * 24 * 60 * 60 * 1000,
  username: 'Jugador' + Math.floor(Math.random() * 9999)
};

// ─── SISTEMA DE LLIGUES ───────────────────────────────────────────────
const LEAGUES = [
  { id: 'bronze',  name: 'Bronze',   icon: '🥉', min: 0,       max: 1000,    color: '#cd7f32' },
  { id: 'silver',  name: 'Plata',    icon: '🥈', min: 1000,    max: 10000,   color: '#c0c0c0' },
  { id: 'gold',    name: 'Or',       icon: '🥇', min: 10000,   max: 100000,  color: '#ffd700' },
  { id: 'diamond', name: 'Diamant',  icon: '💎', min: 100000,  max: 1000000, color: '#b9f2ff' },
  { id: 'legend',  name: 'Llegenda', icon: '👑', min: 1000000, max: Infinity, color: '#ff85c0' }
];

function getCurrentLeague() {
  for (let i = LEAGUES.length - 1; i >= 0; i--) {
    if (gameState.weeklyC >= LEAGUES[i].min) return LEAGUES[i];
  }
  return LEAGUES[0];
}

function getLeagueProgress() {
  const league = getCurrentLeague();
  if (league.id === 'legend') return 100;
  const progress = (gameState.weeklyC - league.min) / (league.max - league.min);
  return Math.min(100, Math.max(0, progress * 100));
}

// ─── CÀLCUL DE COSTOS ─────────────────────────────────────────────────
// Fórmula: cost = baseCost * 1.15^count
function getBuildingCost(building) {
  return Math.floor(building.baseCost * Math.pow(1.15, building.count));
}

// ─── CÀLCUL CPS ──────────────────────────────────────────────────────
function recalculateCPS() {
  let totalCps = 0;

  for (const building of gameState.buildings) {
    if (building.count === 0) continue;

    let buildingCps = building.baseCps * building.count;

    // Aplicar multiplicadors d'upgrades específics
    for (const upDef of UPGRADES_DEF) {
      const up = gameState.upgrades.find(u => u.id === upDef.id);
      if (up?.bought && upDef.multiplierTarget === building.id) {
        buildingCps *= upDef.multiplierValue;
      }
    }

    totalCps += buildingCps;
  }

  // Multiplicadors globals
  for (const upDef of UPGRADES_DEF) {
    const up = gameState.upgrades.find(u => u.id === upDef.id);
    if (up?.bought && upDef.globalCpsMultiplier) {
      totalCps *= upDef.globalCpsMultiplier;
    }
  }

  // Multiplicador prestigi
  totalCps *= gameState.prestigeMultiplier;

  gameState.cookiesPerSecond = totalCps;

  // CPC basat en CPS (singularitat)
  const singular = UPGRADES_DEF.find(u => u.id === 'cookie_singularity');
  const singUp = gameState.upgrades.find(u => u.id === 'cookie_singularity');
  if (singUp?.bought && singular?.cpcFromCps) {
    const extra = totalCps * singular.cpcFromCps;
    // Es suma al base, no el substitueix
  }
}

// ─── COMPRA D'EDIFICI ─────────────────────────────────────────────────
function buyBuilding(id) {
  const building = gameState.buildings.find(b => b.id === id);
  if (!building) return;

  const cost = getBuildingCost(building);
  if (gameState.cookies < cost) {
    showToast('❌ No tens prou galetes!');
    return;
  }

  gameState.cookies -= cost;
  building.count++;
  recalculateCPS();
  renderShop();
  updateUI();
  showToast(`✅ ${building.emoji} ${building.name} comprat! (×${building.count})`);
}

// ─── COMPRA DE MILLORA ────────────────────────────────────────────────
function buyUpgrade(id) {
  const upDef = UPGRADES_DEF.find(u => u.id === id);
  const upState = gameState.upgrades.find(u => u.id === id);
  if (!upDef || !upState || upState.bought) return;
  if (!upDef.unlock()) { showToast('🔒 No compleixos les condicions!'); return; }
  if (gameState.cookies < upDef.cost) { showToast('❌ No tens prou galetes!'); return; }

  gameState.cookies -= upDef.cost;
  upState.bought = true;
  upDef.effect();

  // Recalcular CPC base si la millora afecta el clic
  if (id === 'better_fingers') {
    // ja s'aplica a effect()
  }

  recalculateCPS();
  renderUpgrades();
  renderShop();
  updateUI();
  showToast(`⬆️ ${upDef.name} desblocat!`);
}

// ─── CLIC PRINCIPAL ──────────────────────────────────────────────────
function handleCookieClick(event) {
  // CPC = base * prestigi + (cpcFromCps si s'ha comprat)
  let earned = gameState.cookiesPerClick * gameState.prestigeMultiplier;

  const singUp = gameState.upgrades.find(u => u.id === 'cookie_singularity');
  const singDef = UPGRADES_DEF.find(u => u.id === 'cookie_singularity');
  if (singUp?.bought && singDef?.cpcFromCps) {
    earned += gameState.cookiesPerSecond * singDef.cpcFromCps;
  }

  earned = Math.max(1, Math.floor(earned));

  gameState.cookies += earned;
  gameState.totalCookies += earned;
  gameState.weeklyC += earned;

  updateUI();
  spawnFloatingNumber(event, `+${formatNum(earned)}`);
}

// ─── LOOP DE JOC (passiu) ────────────────────────────────────────────
let lastTick = Date.now();

function gameTick() {
  const now = Date.now();
  const delta = (now - lastTick) / 1000; // en segons
  lastTick = now;

  if (gameState.cookiesPerSecond > 0) {
    const gained = gameState.cookiesPerSecond * delta;
    gameState.cookies += gained;
    gameState.totalCookies += gained;
    gameState.weeklyC += gained;
  }

  // Comprovar reset setmanal
  if (now >= gameState.weeklyReset) {
    gameState.weeklyC = 0;
    gameState.weeklyReset = now + 7 * 24 * 60 * 60 * 1000;
    showToast('📅 S\'ha reiniciat el comptador setmanal!');
  }

  // Auto-guardar cada 30 s
  if (now - gameState.lastSave > 30000) {
    saveGame();
  }

  updateUI();
  updateLeagueUI();
  checkPrestige();
}

// ─── SISTEMA DE PRESTIGI ─────────────────────────────────────────────
const PRESTIGE_COST = 1_000_000;

function checkPrestige() {
  const btn = document.getElementById('btn-prestige');
  if (gameState.totalCookies >= PRESTIGE_COST) {
    btn.disabled = false;
    btn.querySelector('small').textContent = `(${formatNum(gameState.totalCookies)} / ${formatNum(PRESTIGE_COST)})`;
  } else {
    btn.disabled = true;
    btn.querySelector('small').textContent = `(Cal ${formatNum(PRESTIGE_COST)} galetes)`;
  }
}

function activatePrestige() {
  if (gameState.totalCookies < PRESTIGE_COST) return;

  if (!confirm(`Segur que vols activar el Prestigi ${gameState.prestigeLevel + 1}?\n\nEs reiniciaran les teves galetes i edificis, però guanyaràs un +10% de producció permanent!`)) return;

  gameState.prestigeLevel++;
  gameState.prestigeMultiplier = 1 + gameState.prestigeLevel * 0.1;

  // Reiniciar però conservar prestigi
  gameState.cookies = 0;
  gameState.totalCookies = 0;
  gameState.cookiesPerClick = 1;
  gameState.cookiesPerSecond = 0;
  gameState.buildings = BUILDINGS_DEF.map(b => ({ ...b }));
  gameState.upgrades = UPGRADES_DEF.map(u => ({ id: u.id, bought: false }));

  recalculateCPS();
  renderShop();
  renderUpgrades();
  updateUI();
  showToast(`✨ Prestigi ${gameState.prestigeLevel} activat! Multiplicador: ×${gameState.prestigeMultiplier.toFixed(1)}`);
}

// ─── UPDATE UI ───────────────────────────────────────────────────────
function updateUI() {
  // Puntuació
  document.getElementById('score').textContent = formatNum(Math.floor(gameState.cookies));

  // Stats
  document.getElementById('stat-total').textContent = formatNum(Math.floor(gameState.totalCookies));
  document.getElementById('stat-cps').textContent = formatNum(gameState.cookiesPerSecond.toFixed(1));
  document.getElementById('stat-cpc').textContent = formatNum(gameState.cookiesPerClick);

  // Prestigi
  document.getElementById('prestige-level').textContent = gameState.prestigeLevel;
  document.getElementById('prestige-mult').textContent = `×${gameState.prestigeMultiplier.toFixed(2)}`;

  // Leaderboard local
  document.getElementById('lb-score').textContent = formatNum(Math.floor(gameState.totalCookies));
  const league = getCurrentLeague();
  document.getElementById('lb-league').textContent = `${league.icon} ${league.name}`;

  // Actualitzar costos botiga
  updateShopCosts();
}

function updateLeagueUI() {
  const league = getCurrentLeague();
  document.getElementById('league-icon').textContent = league.icon;
  document.getElementById('league-name').textContent = league.name;
  document.getElementById('league-name').style.color = league.color;
  document.getElementById('league-fill').style.width = getLeagueProgress() + '%';

  const nextLeague = LEAGUES[LEAGUES.indexOf(league) + 1];
  if (nextLeague) {
    document.getElementById('league-info').textContent =
      `${formatNum(Math.floor(gameState.weeklyC))} / ${formatNum(nextLeague.min)} galetes setmanals`;
  } else {
    document.getElementById('league-info').textContent = '👑 Ets el millor!';
  }

  // Destacar lliga activa
  LEAGUES.forEach(l => {
    const el = document.getElementById(`tier-${l.id}`);
    if (el) el.className = 'league-tier' + (l.id === league.id ? ' active' : '');
  });
}

function updateShopCosts() {
  gameState.buildings.forEach(building => {
    const costEl = document.getElementById(`cost-${building.id}`);
    if (costEl) {
      const cost = getBuildingCost(building);
      costEl.textContent = `🍪 ${formatNum(cost)}`;
      const item = costEl.closest('.shop-item');
      if (item) {
        item.classList.toggle('locked', gameState.cookies < cost);
      }
    }
  });
}

// ─── RENDERITZAR BOTIGA ──────────────────────────────────────────────
function renderShop() {
  const container = document.getElementById('shop-items');
  container.innerHTML = '';

  gameState.buildings.forEach(building => {
    const cost = getBuildingCost(building);
    const canAfford = gameState.cookies >= cost;
    const cpsContrib = (building.baseCps * (building.count + 1)).toFixed(1);

    const item = document.createElement('div');
    item.className = `shop-item${canAfford ? '' : ' locked'}`;
    item.innerHTML = `
      <div class="shop-item-header">
        <div class="shop-item-name">
          ${building.emoji} ${building.name}
          <span class="shop-item-count">${building.count}</span>
        </div>
      </div>
      <div class="shop-item-desc">${building.desc}</div>
      <div class="shop-item-footer">
        <span class="shop-item-cps">+${cpsContrib} CPS</span>
        <span class="shop-item-cost" id="cost-${building.id}">🍪 ${formatNum(cost)}</span>
      </div>
    `;
    item.addEventListener('click', () => buyBuilding(building.id));
    container.appendChild(item);
  });
}

// ─── RENDERITZAR MILLORES ─────────────────────────────────────────────
function renderUpgrades() {
  const container = document.getElementById('upgrades-list');
  container.innerHTML = '';

  UPGRADES_DEF.forEach(upDef => {
    const upState = gameState.upgrades.find(u => u.id === upDef.id);
    const unlocked = upDef.unlock();
    const bought = upState?.bought;
    const canAfford = gameState.cookies >= upDef.cost;

    const item = document.createElement('div');
    item.className = `upgrade-item${bought ? ' bought' : (unlocked ? '' : ' locked')}`;
    item.innerHTML = `
      <span class="upgrade-icon">${bought ? '✅' : upDef.emoji}</span>
      <div class="upgrade-info">
        <div class="upgrade-name">${upDef.name}</div>
        <div class="upgrade-desc">${upDef.desc}</div>
      </div>
      <span class="upgrade-cost">${bought ? 'Comprat' : `🍪 ${formatNum(upDef.cost)}`}</span>
    `;
    if (!bought) {
      item.addEventListener('click', () => buyUpgrade(upDef.id));
    }
    container.appendChild(item);
  });
}

// ─── NUMBERS FLOTANTS ─────────────────────────────────────────────────
function spawnFloatingNumber(event, text) {
  const el = document.createElement('div');
  el.className = 'float-number';
  el.textContent = text;
  el.style.left = (event.clientX - 20) + 'px';
  el.style.top = (event.clientY - 20) + 'px';
  document.getElementById('floating-container').appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

// ─── TOAST NOTIFICACIÓ ────────────────────────────────────────────────
let toastTimeout;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ─── FORMAT NÚMEROS ───────────────────────────────────────────────────
function formatNum(n) {
  n = parseFloat(n);
  if (isNaN(n)) return '0';
  if (n >= 1e15) return (n / 1e15).toFixed(2) + ' Q';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + ' B';
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + ' M';
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + ' m';
  if (n >= 1e3)  return (n / 1e3).toFixed(1) + ' k';
  return Math.floor(n).toString();
}

// ─── GUARDAR / CARREGAR ──────────────────────────────────────────────
function saveGame() {
  const save = {
    cookies: gameState.cookies,
    totalCookies: gameState.totalCookies,
    weeklyC: gameState.weeklyC,
    cookiesPerClick: gameState.cookiesPerClick,
    prestigeLevel: gameState.prestigeLevel,
    prestigeMultiplier: gameState.prestigeMultiplier,
    buildings: gameState.buildings.map(b => ({ id: b.id, count: b.count })),
    upgrades: gameState.upgrades,
    weeklyReset: gameState.weeklyReset,
    username: gameState.username,
    lastSave: Date.now()
  };
  localStorage.setItem('galetaclic_save', JSON.stringify(save));
}

function loadGame() {
  const raw = localStorage.getItem('galetaclic_save');
  if (!raw) return;
  try {
    const save = JSON.parse(raw);
    gameState.cookies = save.cookies || 0;
    gameState.totalCookies = save.totalCookies || 0;
    gameState.weeklyC = save.weeklyC || 0;
    gameState.cookiesPerClick = save.cookiesPerClick || 1;
    gameState.prestigeLevel = save.prestigeLevel || 0;
    gameState.prestigeMultiplier = save.prestigeMultiplier || 1;
    gameState.weeklyReset = save.weeklyReset || Date.now() + 7 * 24 * 60 * 60 * 1000;
    gameState.username = save.username || gameState.username;

    if (save.buildings) {
      save.buildings.forEach(sb => {
        const b = gameState.buildings.find(b => b.id === sb.id);
        if (b) b.count = sb.count;
      });
    }
    if (save.upgrades) {
      gameState.upgrades = save.upgrades;
      // Reaplicar efectes d'upgrades comprats
      save.upgrades.forEach(su => {
        if (su.bought) {
          const def = UPGRADES_DEF.find(u => u.id === su.id);
          if (def && def.effect) def.effect();
        }
      });
    }

    // Offline earnings
    const offlineSeconds = Math.min((Date.now() - save.lastSave) / 1000, 3600); // màx 1h
    if (offlineSeconds > 10 && gameState.cookiesPerSecond > 0) {
      recalculateCPS();
      const earned = Math.floor(gameState.cookiesPerSecond * offlineSeconds * 0.5); // 50% offline
      if (earned > 0) {
        gameState.cookies += earned;
        gameState.totalCookies += earned;
        gameState.weeklyC += earned;
        setTimeout(() => showToast(`💤 Mentre no hi eres: +${formatNum(earned)} galetes!`), 1000);
      }
    }

    recalculateCPS();
    showToast('💾 Partida carregada!');
  } catch(e) {
    console.warn('No s\'ha pogut carregar la partida', e);
  }
}

// ─── SUPABASE: INICIALITZAR CLIENT ───────────────────────────────────
function initSupabase() {
  if (!SUPABASE_ENABLED) return;
  try {
    const { createClient } = window.supabase;
    db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('✅ Supabase connectat!');
  } catch(e) {
    console.error('❌ Error inicialitzant Supabase:', e);
  }
}

// ─── SUPABASE: GUARDAR PUNTUACIÓ ─────────────────────────────────────
async function saveScoreToSupabase() {
  if (!db) return;
  const league = getCurrentLeague();
  try {
    const { error } = await db
      .from('leaderboard')
      .upsert({
        username: gameState.username,
        score: Math.floor(gameState.totalCookies),
        weekly_cookies: Math.floor(gameState.weeklyC),
        prestige_level: gameState.prestigeLevel,
        league: league.name,
        updated_at: new Date().toISOString()
      }, { onConflict: 'username' });

    if (error) console.error('Supabase upsert error:', error);
    else console.log('💾 Puntuació guardada a Supabase');
  } catch(e) {
    console.error('Supabase save error:', e);
  }
}

// ─── SUPABASE: CARREGAR LEADERBOARD ──────────────────────────────────
async function loadLeaderboard() {
  if (!db) return;
  try {
    const { data, error } = await db
      .from('leaderboard')
      .select('username, score, league, prestige_level')
      .order('score', { ascending: false })
      .limit(10);

    if (error || !data) { console.error('Supabase fetch error:', error); return; }

    const tbody = document.getElementById('leaderboard-body');
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-dim)">Encara no hi ha jugadors</td></tr>';
      return;
    }

    tbody.innerHTML = data.map((row, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
      const isMe = row.username === gameState.username;
      return `
        <tr style="${isMe ? 'background:rgba(255,107,53,0.12);' : ''}">
          <td>${medal}</td>
          <td>${isMe ? '⭐ ' : ''}${row.username}${isMe ? ' (tu)' : ''}</td>
          <td>${getLeagueIcon(row.league)} ${row.league}</td>
          <td>${formatNum(row.score)}</td>
        </tr>
      `;
    }).join('');
  } catch(e) {
    console.error('Supabase load error:', e);
  }
}

function getLeagueIcon(name) {
  const icons = { Bronze: '🥉', Plata: '🥈', Or: '🥇', Diamant: '💎', Llegenda: '👑' };
  return icons[name] || '🎮';
}

// ─── INICIALITZACIÓ ───────────────────────────────────────────────────
function init() {
  // Inicialitzar Supabase primer
  initSupabase();

  loadGame();
  recalculateCPS();
  renderShop();
  renderUpgrades();
  updateUI();
  updateLeagueUI();

  // Carregar leaderboard inicial
  loadLeaderboard();

  // Event clic galeta
  document.getElementById('cookie-btn').addEventListener('click', handleCookieClick);

  // Event prestigi
  document.getElementById('btn-prestige').addEventListener('click', activatePrestige);

  // Loop de joc: 20 FPS
  setInterval(gameTick, 50);

  // Renderitzar millores periòdicament
  setInterval(renderUpgrades, 3000);

  // Guardar cada 30 s + sincronitzar Supabase
  setInterval(() => {
    saveGame();
    saveScoreToSupabase();
  }, 30000);

  // Actualitzar leaderboard cada 60 s
  setInterval(loadLeaderboard, 60000);

  // Nom d'usuari
  const usernameInput = document.getElementById('username-input');
  usernameInput.value = gameState.username;
  document.getElementById('btn-save-username').addEventListener('click', () => {
    const val = usernameInput.value.trim();
    if (!val) { showToast('❌ Introdueix un nom vàlid'); return; }
    gameState.username = val;
    saveGame();
    saveScoreToSupabase();
    showToast(`✅ Nom desat: ${val}`);
  });
  usernameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-save-username').click();
  });

  // Guardar en sortir
  window.addEventListener('beforeunload', () => {
    saveGame();
    saveScoreToSupabase();
  });

  console.log(`
  🍪 GaletaClic iniciat!
  ─────────────────────
  Estat: ${JSON.stringify({
    cookies: gameState.cookies,
    cps: gameState.cookiesPerSecond,
    prestige: gameState.prestigeLevel
  }, null, 2)}
  `);
}

// Arrencar quan el DOM estigui llest
document.addEventListener('DOMContentLoaded', init);
