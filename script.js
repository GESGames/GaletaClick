// ─── CONFIGURACIÓ DE SUPABASE ───────────────────────────────────────
const SUPABASE_URL = "https://wbmfymbyvctjttclgbyo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndibWZ5bWJ5dmN0anR0Y2xnYnlvIiwicm9sZSI6ImFub25fMTIwNyIsImlhdCI6MTczNzQ3MTE5MiwiZXhwIjoyMDUzMDQ3MTkyfQ.89-63r3i_N_W6Y9e-eP26_96283y662232-232-232";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let gameState = {
  cookies: 0,
  totalCookies: 0,
  weeklyCookies: 0,
  cookiesPerClick: 1,
  cookiesPerSecond: 0,
  username: "Jugador Anònim",
  prestigeLevel: 0,
  prestigeMultiplier: 1.0,
  buildings: {
    cursor: { count: 0, baseCost: 15, currentCost: 15, cps: 0.1 },
    avi: { count: 0, baseCost: 100, currentCost: 100, cps: 1 },
    granja: { count: 0, baseCost: 1100, currentCost: 1100, cps: 8 },
    mina: { count: 0, baseCost: 12000, currentCost: 12000, cps: 47 },
    fabrica: { count: 0, baseCost: 130000, currentCost: 130000, cps: 260 }
  },
  upgrades: {},
  lastSave: Date.now()
};

const LEAGUES = [
  { name: "Bronze", min: 0, icon: "🥉", color: "#cd7f32" },
  { name: "Plata", min: 10000, icon: "🥈", color: "#c0c0c0" },
  { name: "Or", min: 100000, icon: "🥇", color: "#ffd700" },
  { name: "Platí", min: 1000000, icon: "💎", color: "#e5e4e2" },
  { name: "Mestre", min: 10000000, icon: "👑", color: "#a855f7" }
];

function getCurrentLeague(total) {
  for (let i = LEAGUES.length - 1; i >= 0; i--) {
    if (total >= LEAGUES[i].min) return LEAGUES[i];
  }
  return LEAGUES[0];
}

function saveGame() {
  gameState.lastSave = Date.now();
  localStorage.setItem('galeta_clicker_save', JSON.stringify(gameState));
}

function loadGame() {
  const saved = localStorage.getItem('galeta_clicker_save');
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved);
    gameState = { ...gameState, ...parsed };
    recalculateCosts();
    recalculateCps();
  } catch (e) {
    console.error("Error carregant partida guardada", e);
  }
}

function recalculateCosts() {
  for (const key in gameState.buildings) {
    const b = gameState.buildings[key];
    b.currentCost = Math.floor(b.baseCost * Math.pow(1.15, b.count));
  }
}

function recalculateCps() {
  let cps = 0;
  for (const key in gameState.buildings) {
    const b = gameState.buildings[key];
    cps += b.count * b.cps;
  }
  cps *= gameState.prestigeMultiplier;
  gameState.cookiesPerSecond = cps;
}

function buyBuilding(id) {
  const b = gameState.buildings[id];
  if (!b) return;

  if (gameState.cookies >= b.currentCost) {
    gameState.cookies -= b.currentCost;
    b.count++;
    b.currentCost = Math.floor(b.baseCost * Math.pow(1.15, b.count));
    recalculateCps();
    saveGame();
    updateUI();
    showToast(`🏢 Comprat: ${id}!`);
    spawnParticle(`-${formatNum(b.currentCost)} 🍪`, window.innerWidth / 2, window.innerHeight / 2, '#ef4444');
  } else {
    showToast("❌ No tens prou galetes!");
  }
}

function updateShopCosts() {
  for (const key in gameState.buildings) {
    const b = gameState.buildings[key];
    const costEl = document.getElementById(`cost-${key}`);
    const countEl = document.getElementById(`count-${key}`);
    if (costEl) costEl.textContent = formatNum(b.currentCost);
    if (countEl) countEl.textContent = b.count;

    const btn = document.getElementById(`btn-${key}`);
    if (btn) {
      if (gameState.cookies < b.currentCost) {
        btn.classList.add('opacity-50', 'cursor-not-allowed');
      } else {
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
      }
    }
  }
}

function cookieClick(e) {
  const gain = gameState.cookiesPerClick * gameState.prestigeMultiplier;
  gameState.cookies += gain;
  gameState.totalCookies += gain;
  gameState.weeklyCookies += gain;

  updateUI();
  
  const cookieImg = document.getElementById('cookie-trigger');
  cookieImg.style.transform = 'scale(0.95)';
  setTimeout(() => cookieImg.style.transform = 'scale(1)', 50);

  if (e) {
    spawnParticle(`+${formatNum(gain)}`, e.clientX, e.clientY, '#fbbf24');
  }
}

async function saveScoreToSupabase() {
  if (!gameState.username || gameState.username === "Jugador Anònim") return;
  const league = getCurrentLeague(gameState.totalCookies);
  
  try {
    const { error } = await supabaseClient
      .from('leaderboard')
      .upsert({
        username: gameState.username,
        score: Math.floor(gameState.totalCookies),
        weekly_cookies: Math.floor(gameState.weeklyCookies),
        prestige_level: gameState.prestigeLevel,
        league: league.name,
        updated_at: new Date().toISOString()
      }, { onConflict: 'username' });

    if (error) console.error("Error a Supabase upsert:", error);
  } catch (err) {
    console.error("Error de connexió a Supabase:", err);
  }
}

async function loadLeaderboard() {
  try {
    const { data, error } = await supabaseClient
      .from('leaderboard')
      .select('*')
      .order('score', { ascending: false })
      .limit(10);

    if (error) {
      console.error("Error carregant rànquing:", error);
      return;
    }

    const tbody = document.getElementById('leaderboard-body');
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-gray-400">No hi ha dades disponibles</td></tr>`;
      return;
    }

    data.forEach((row, index) => {
      const tr = document.createElement('tr');
      tr.className = "border-b border-pink-950/20 hover:bg-pink-950/10 transition-colors";
      
      let medal = `${index + 1}`;
      if (index === 0) medal = "🥇";
      if (index === 1) medal = "🥈";
      if (index === 2) medal = "🥉";

      const rLeague = LEAGUES.find(l => l.name === row.league) || LEAGUES[0];

      tr.innerHTML = `
        <td class="p-3 font-bold text-pink-400 text-center">${medal}</td>
        <td class="p-3 font-medium text-white">${escapeHTML(row.username)}</td>
        <td class="p-3 text-right font-mono text-amber-300 font-bold">${formatNum(row.score)}</td>
        <td class="p-3 text-center"><span class="px-2 py-0.5 rounded text-xs font-bold" style="background:${rLeague.color}22; color:${rLeague.color}">${rLeague.icon} ${rLeague.name}</span></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Error general del rànquing:", err);
  }
}

function updateUI() {
  document.getElementById('score').textContent = formatNum(Math.floor(gameState.cookies));

  document.getElementById('stat-total').textContent = formatNum(Math.floor(gameState.totalCookies));
  document.getElementById('stat-cps').textContent = formatNum(gameState.cookiesPerSecond.toFixed(1));
  document.getElementById('stat-cpc').textContent = formatNum(gameState.cookiesPerClick);

  document.getElementById('prestige-level').textContent = gameState.prestigeLevel;
  document.getElementById('prestige-mult').textContent = `×${gameState.prestigeMultiplier.toFixed(2)}`;

  updateShopCosts();
}

function formatNum(num) {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + " B";
  if (num >= 1e6) return (num / 1e6).toFixed(2) + " M";
  if (num >= 1e3) return (num / 1e3).toFixed(1) + " K";
  return num.toString();
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

function showToast(msg) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = "bg-pink-950/90 text-white border border-pink-500/30 px-4 py-2 rounded-xl shadow-2xl backdrop-blur-sm animate-fade-in text-sm font-medium";
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function spawnParticle(text, x, y, color = '#fbbf24') {
  const p = document.createElement('div');
  p.className = "absolute pointer-events-none font-mono font-black text-xl select-none z-50 animate-float-up";
  p.style.left = `${x}px`;
  p.style.top = `${y}px`;
  p.style.color = color;
  p.style.textShadow = '0 2px 4px rgba(0,0,0,0.5)';
  p.textContent = text;
  document.body.appendChild(p);
  setTimeout(() => p.remove(), 1000);
}

function init() {
  loadGame();
  updateUI();
  loadLeaderboard();

  document.getElementById('cookie-trigger').addEventListener('click', cookieClick);

  for (const key in gameState.buildings) {
    const btn = document.getElementById(`btn-${key}`);
    if (btn) {
      btn.addEventListener('click', () => buyBuilding(key));
    }
  }

  const usernameInput = document.getElementById('username-input');
  usernameInput.value = gameState.username;
  
  document.getElementById('btn-save-username').addEventListener('click', async () => {
    const val = usernameInput.value.trim();
    if (!val) { showToast('❌ Introdueix un nom vàlid'); return; }
    
    gameState.username = val;
    saveGame();
    
    await saveScoreToSupabase();
    await loadLeaderboard();
    
    showToast(`✅ Nom desat: ${val}`);
  });

  setInterval(() => {
    if (gameState.cookiesPerSecond > 0) {
      const added = gameState.cookiesPerSecond / 10;
      gameState.cookies += added;
      gameState.totalCookies += added;
      gameState.weeklyCookies += added;
      updateUI();
    }
  }, 100);

  setInterval(() => {
    saveGame();
    saveScoreToSupabase();
  }, 30000);

  setInterval(() => {
    loadLeaderboard();
  }, 60000);
}

window.addEventListener('DOMContentLoaded', init);