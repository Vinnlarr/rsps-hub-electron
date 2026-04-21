// ── SPLASH SCREEN ─────────────────────────────────────────────────────────────

(function initSplash() {
  const MESSAGES = [
    'Connecting to authentication server...',
    'Loading game assets...',
    'Fetching server listings...',
    'Checking your account...',
    'Synchronising world data...',
    'Almost there...',
  ];

  let progress = 0;
  let msgIdx   = 0;
  let interval = null;

  const fill    = document.getElementById('splash-bar-fill');
  const status  = document.getElementById('splash-status');
  const pct     = document.getElementById('splash-pct');

  function setProgress(p) {
    progress = Math.min(p, 100);
    if (fill)   fill.style.width = progress + '%';
    if (pct)    pct.textContent  = Math.round(progress) + '%';
  }

  // Slowly auto-advance to 90% while real init runs
  interval = setInterval(() => {
    if (progress < 90) {
      const step = progress < 30 ? 4 : progress < 60 ? 2.5 : progress < 80 ? 1.2 : 0.4;
      setProgress(progress + step);
    }
    if (status && msgIdx < MESSAGES.length - 1 && progress > (msgIdx + 1) * 14) {
      msgIdx++;
      status.textContent = MESSAGES[msgIdx];
    }
  }, 140);

  // Canvas particle system
  const canvas = document.getElementById('splash-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    const particles = [];

    function resizeCanvas() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    class Particle {
      constructor() { this.reset(true); }
      reset(initial) {
        this.x    = Math.random() * canvas.width;
        this.y    = initial ? Math.random() * canvas.height : canvas.height + 10;
        this.size = Math.random() * 1.8 + 0.4;
        this.vy   = -(Math.random() * 0.6 + 0.2);
        this.vx   = (Math.random() - 0.5) * 0.3;
        this.life = 0;
        this.maxLife = Math.random() * 180 + 120;
        this.hue  = 38 + Math.random() * 16;
        this.sat  = 60 + Math.random() * 30;
      }
      update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life++;
        if (this.life > this.maxLife || this.y < -10) this.reset(false);
      }
      draw() {
        const alpha = Math.sin((this.life / this.maxLife) * Math.PI) * 0.7;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = `hsl(${this.hue},${this.sat}%,62%)`;
        ctx.shadowColor = `hsl(${this.hue},80%,70%)`;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    for (let i = 0; i < 120; i++) particles.push(new Particle());

    let animId;
    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => { p.update(); p.draw(); });
      animId = requestAnimationFrame(animate);
    }
    animate();

    // Store cancel fn
    window._splashCancelAnim = () => cancelAnimationFrame(animId);
  }

  // Called by app init when ready
  window.splashDone = function() {
    clearInterval(interval);
    if (status) status.textContent = 'Welcome to RSPS Hub';
    setProgress(100);
    setTimeout(() => {
      const splash = document.getElementById('splash-screen');
      if (splash) splash.classList.add('hidden');
      if (window._splashCancelAnim) window._splashCancelAnim();
      setTimeout(() => { if (splash) splash.remove(); }, 900);
    }, 500);
  };
})();

// ── API HELPERS ───────────────────────────────────────────────────────────────

const api = {
  getServers:       ()              => window.hub.get('/api/servers'),
  getUser:          ()              => window.hub.get('/api/user'),
  login:            (u, p)          => window.hub.post('/api/auth/login', { username: u, password: p }),
  logout:           ()              => window.hub.post('/api/auth/logout'),
  play:             (name)          => window.hub.post(`/api/servers/${encodeURIComponent(name)}/play`),
  install:          (name, jarUrl)  => window.hub.post(`/api/servers/${encodeURIComponent(name)}/install`, { jarUrl }),
  uninstall:        (name)          => window.hub.post(`/api/servers/${encodeURIComponent(name)}/uninstall`),
  toggleFavourite:  (name)          => window.hub.post(`/api/servers/${encodeURIComponent(name)}/favourite`),
  getPlaytime:      ()              => window.hub.get('/api/playtime'),
  // Friends
  getFriends:       ()              => window.hub.get('/api/friends'),
  getFriendRequests:()              => window.hub.get('/api/friends/requests'),
  addFriend:        (username)      => window.hub.post('/api/friends', { username }),
  acceptFriend:     (username)      => window.hub.post('/api/friends/accept', { username }),
  declineFriend:    (username)      => window.hub.post('/api/friends/decline', { username }),
  removeFriend:     (username)      => window.hub.del(`/api/friends/${encodeURIComponent(username)}`),
  // Messages
  getConversations: ()              => window.hub.get('/api/messages'),
  getMessages:      (username)      => window.hub.get(`/api/messages/${encodeURIComponent(username)}`),
  sendMessage:      (to, content)   => window.hub.post(`/api/messages/${encodeURIComponent(to)}`, { content }),
  // Leaderboard
  getLeaderboard:   ()              => window.hub.get('/api/leaderboard'),
  // Settings
  getSettings:      ()              => window.hub.get('/api/settings'),
  saveSettings:     (data)          => window.hub.post('/api/settings', data),
  // Announcements — call VPS directly (public endpoint, no Java proxy needed)
  getAnnouncements: ()              => fetch('https://api.therspshub.com/api/announcements/list.php').then(r => r.json()),
  postAnnouncement: (title, message)=> window.hub.post('/api/announcements', { title, message }),
  deleteAnnouncement:(id)           => window.hub.post('/api/announcements/delete', { id }),
};


// ── LOCAL DM STORE ────────────────────────────────────────────────────────────
// Loaded from ~/.rsps_hub/messages.json on boot, saved on every send.
// Also survives panel close/reopen within the same session.
const DM_STORE = {}; // { username: [{ sender, content, timestamp, isOwn }] }
let _dmStoreDirty = false;

async function dmStoreLoad() {
  try {
    const saved = await window.hub.getMessages();
    if (saved && typeof saved === 'object') {
      Object.assign(DM_STORE, saved);
    }
  } catch (_) {}
}

async function dmStoreSave() {
  try { await window.hub.saveMessages(DM_STORE); } catch (_) {}
  _dmStoreDirty = false;
}

function dmStoreGet(username) {
  if (!DM_STORE[username]) DM_STORE[username] = [];
  return DM_STORE[username];
}

function dmStoreMerge(username, serverMsgs) {
  const local = dmStoreGet(username);
  let changed = false;
  for (const sm of serverMsgs) {
    // Exact match — already synced
    if (local.some(m => m.content === sm.content && m.timestamp === sm.timestamp)) continue;
    // Own pending message — timestamp formats differ, match by content and replace
    if (sm.isOwn) {
      const pendingIdx = local.findIndex(m => m.pending && m.isOwn && m.content === sm.content);
      if (pendingIdx !== -1) {
        local[pendingIdx] = { ...sm, pending: false };
        changed = true;
        continue;
      }
    }
    local.push(sm);
    changed = true;
  }
  if (changed) dmStoreSave();
  return local;
}

function dmStorePush(username, msg) {
  dmStoreGet(username).push(msg);
  dmStoreSave(); // write to disk immediately on every sent message
}

// ── TAB DATA CACHE ─────────────────────────────────────────────────────────
// Stale-while-revalidate cache. Each entry holds the last-fetched payload +
// timestamp. Tab render functions look here first (instant paint), then
// kick off a background refresh if the entry is stale, and re-render when
// fresh data arrives. Entries are cleared on logout.
window.DATA_CACHE = {
  stats:         { data: null, at: 0, ttl: 60_000 },
  friends:       { data: null, at: 0, ttl: 30_000 },
  friendReqs:    { data: null, at: 0, ttl: 30_000 },
  conversations: { data: null, at: 0, ttl: 30_000 },
};

/**
 * Get cached data (possibly stale) and optionally trigger a background
 * refresh. Returns { data, isStale }. If no cache exists yet, returns
 * { data: null, isStale: true } and caller must fetch fresh.
 */
window.getCached = function getCached(key) {
  const e = window.DATA_CACHE[key];
  if (!e) return { data: null, isStale: true };
  const isStale = !e.data || (Date.now() - e.at) > e.ttl;
  return { data: e.data, isStale };
};
window.setCache = function setCache(key, data) {
  const e = window.DATA_CACHE[key];
  if (!e) window.DATA_CACHE[key] = { data, at: Date.now(), ttl: 30_000 };
  else { e.data = data; e.at = Date.now(); }
};
window.clearCaches = function clearCaches() {
  for (const k of Object.keys(window.DATA_CACHE)) {
    window.DATA_CACHE[k].data = null;
    window.DATA_CACHE[k].at = 0;
  }
};

/** Fire off all the expensive tab fetches in parallel right after login so
 *  switching to those tabs is instant. Ignore failures silently — the tab
 *  render functions will fall back to a fresh fetch on first view. */
async function prefetchTabs() {
  window.hub.get('/api/stats/me').then(d => {
    if (d && !d.error && 'totalMinutes' in d) window.setCache('stats', d);
  }).catch(() => {});
  Promise.all([
    window.hub.get('/api/friends').catch(() => null),
    window.hub.get('/api/friends/requests').catch(() => null),
  ]).then(([f, r]) => {
    if (f) window.setCache('friends', f);
    if (r) window.setCache('friendReqs', r);
  });
  window.hub.get('/api/messages').then(d => {
    if (d) window.setCache('conversations', d);
  }).catch(() => {});
}

// Shared logout teardown. Wipes per-user in-memory caches and un-scopes the
// file paths in main.js so a subsequent login can't accidentally read/write
// the previous user's folder. Call from every logout path.
async function logoutCleanup() {
  state.user = null;
  state.profile = null;
  // Clear DM cache (private messages must not leak to the next login)
  for (const k of Object.keys(DM_STORE)) delete DM_STORE[k];
  // Clear server favourites (will be re-fetched from server on next login)
  state.favourites.clear();
  // Clear tab data cache so the next login doesn't see the previous user's cached data
  window.clearCaches();
  // Tell music module to drop its prefs (favs, last track, etc.)
  if (window.clearMusicPrefs) try { window.clearMusicPrefs(); } catch {}
  // Un-scope main.js file paths
  try { await window.hub.setActiveUser(null); } catch {}
  renderUser();
}

// ── STATE ─────────────────────────────────────────────────────────────────────

let state = {
  servers:    [],
  user:       null,
  activeTab:  'store',
  activeTag:  'All',
  search:     '',
  sortOrder:  'players',
  favourites: new Set(),
  profile:    { displayName: 'Player', bio: '', visibility: 'online', avatarPath: null },
  playtime:   {},   // { serverName: minutesPlayed }
  friends:    [],   // cached from /api/friends, used by group chat picker
  activeDM:   null, // username of currently open DM (persists across panel close/reopen)
  settings:   {},   // cached launcher settings (minimizeOnLaunch etc.)
};

// ── BOOT ─────────────────────────────────────────────────────────────────────

// ── AUTO UPDATE NOTIFICATIONS ────────────────────────────────────────────────

if (window.hub?.onUpdateAvailable) {
  window.hub.onUpdateAvailable(() => {
    showToast('Update available — downloading in background…', 'info');
  });
  window.hub.onUpdateDownloaded(() => {
    const banner = document.createElement('div');
    banner.id = 'update-banner';
    banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#1a1d24;border-top:1px solid #2a2e39;color:#c8a840;font-family:Cinzel,serif;font-size:0.8rem;padding:10px 20px;display:flex;align-items:center;gap:12px;z-index:999999';
    banner.innerHTML = `<span>✦ Update ready to install</span><button onclick="window.hub.installUpdate()" style="background:#ff981f;color:#0f1115;border:none;padding:5px 14px;border-radius:3px;font-family:Cinzel,serif;font-size:0.75rem;cursor:pointer;font-weight:700">RESTART & UPDATE</button><button onclick="this.parentElement.remove()" style="background:none;border:none;color:#666;cursor:pointer;margin-left:auto;font-size:1rem">✕</button>`;
    document.body.appendChild(banner);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  setupWindowControls();
  setupAuthForms();
  renderUser();
  setupNavTabs();
  setupSidebarTabs();
  setupSearch();
  setupTagFilters();
  setupSort();
  initBgParticles();
  initLevelTooltip();

  // Load profile from disk (per-user, loaded after session restore)
  try {
    const username = state.user?.username;
    state.profile = await window.hub.getProfile(username);
    updateNavbarAvatar();
  } catch {}

  // Load launcher settings (needed for minimizeOnLaunch etc. before settings tab opens)
  try { state.settings = await api.getSettings(); } catch {}

  // Set version label in status bar
  try {
    const v = await window.hub.getVersion();
    const el = document.getElementById('app-version-label');
    if (el) el.textContent = 'v' + v;
  } catch {}

  // If "remember me" was disabled on last login, clear the saved session before loading
  if (localStorage.getItem('rsps_hub_remember') === 'false') {
    await window.hub.post('/api/auth/logout', {}).catch(() => {});
  }

  // Try to load user session. We need the username BEFORE loading any
  // per-user caches (DMs, music prefs) so the right user's folder is read.
  try {
    const userData = await api.getUser();
    if (userData?.username) {
      state.user = userData;
      await window.hub.setActiveUser(userData.username);
      // Now safe to load the caller's private DM history from disk.
      await dmStoreLoad();
      // Reload music prefs scoped to this user (favs, last track, etc.).
      if (window.reloadMusicPrefs) await window.reloadMusicPrefs();
      renderUser();
      startHeartbeat();
      startMessagePolling();
      startFriendRequestPolling();
      startFriendOnlinePolling();
      startAnnouncementPolling();
      // Prefetch tab data so Stats/Friends/Chat open instantly from cache.
      prefetchTabs();
    }
  } catch {}


  // Load per-server playtime from Java backend
  try {
    const pt = await api.getPlaytime();
    if (pt && pt.perServer) {
      state.playtime = pt.perServer; // { "ServerName": minutesPlayed }
      // Sync local playtime map up to the server so the leaderboard has accurate
      // per-server history (session_log only started recording recently).
      if (state.user?.username) {
        window.hub.post('/api/users/sync-playtime', { per_server: pt.perServer }).catch(() => {});
      }
    }
  } catch {}
  updatePlaytimeStatus();

  // Session timer — counts up from launcher open
  startSessionTimer();

  const [_] = await Promise.all([loadServers(), new Promise(r => setTimeout(r, 3500))]);
  if (window.splashDone) window.splashDone();
  // Show auth screen if not logged in after splash
  if (!state.user) showAuthScreen();
});

// ── WINDOW CONTROLS ───────────────────────────────────────────────────────────

function setupWindowControls() {
  document.getElementById('btn-minimize')?.addEventListener('click', () => window.hub.minimize());
  document.getElementById('btn-maximize')?.addEventListener('click', () => window.hub.maximize());
  document.getElementById('btn-close')?.addEventListener('click',    () => window.hub.close());

  // Notifications dropdown
  const notifBtn      = document.getElementById('btn-notifications');
  const notifDropdown = document.getElementById('notif-dropdown');
  const acctBtn       = document.getElementById('btn-account');
  const acctDropdown  = document.getElementById('account-dropdown');

  notifBtn?.addEventListener('click', e => {
    e.stopPropagation();
    const open = notifDropdown.style.display !== 'none';
    closeAllDropdowns();
    if (!open) {
      renderNotifDropdown();
      notifDropdown.style.display = '';
      markNotifsRead();
    }
  });

  acctBtn?.addEventListener('click', e => {
    e.stopPropagation();
    const open = acctDropdown.style.display !== 'none';
    closeAllDropdowns();
    if (!open) {
      populateAccountDropdown();
      acctDropdown.style.display = '';
    }
  });

  // Clicks inside either dropdown must not bubble up to the document listener
  notifDropdown?.addEventListener('click', e => e.stopPropagation());
  acctDropdown?.addEventListener('click',  e => e.stopPropagation());

  document.addEventListener('click', closeAllDropdowns);

  // Logout
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    try { await api.logout(); } catch {}
    await logoutCleanup();
    closeAllDropdowns();
  });
}

function closeAllDropdowns() {
  document.getElementById('notif-dropdown').style.display  = 'none';
  document.getElementById('account-dropdown').style.display = 'none';
}

function updateNavbarAvatar() {
  const p         = state.profile || {};
  const navImg    = document.getElementById('nav-avatar-img');
  const navInitial = document.getElementById('user-initial');
  if (!navImg || !navInitial) return;

  if (p.avatarPath) {
    navImg.src = 'file:///' + p.avatarPath.replace(/\\/g, '/') + '?t=' + Date.now();
    navImg.style.display = '';
    navInitial.style.display = 'none';
  } else {
    navImg.style.display = 'none';
    navInitial.style.display = '';
    navInitial.textContent = (p.displayName || state.user?.username || 'P')[0].toUpperCase();
  }
}

function populateAccountDropdown() {
  const p = state.profile || {};
  const displayName = p.displayName || state.user?.username || 'Player';
  const accountUsername = state.user?.username || '';

  // Avatar — update BOTH the dropdown avatar (account-avatar-img) AND the
  // always-visible top-right nav chip avatar (nav-avatar-img). Before this
  // fix the nav chip only ever showed the user's initial letter.
  const avatarImg  = document.getElementById('account-avatar-img');
  const initial    = document.getElementById('account-initial');
  const navImg     = document.getElementById('nav-avatar-img');
  const navInitial = document.getElementById('user-initial');
  if (p.avatarPath) {
    const src = 'file:///' + p.avatarPath.replace(/\\/g, '/') + '?t=' + Date.now();
    if (avatarImg) { avatarImg.src = src; avatarImg.style.display = ''; }
    if (navImg)    { navImg.src    = src; navImg.style.display    = ''; }
    if (initial)    initial.style.display    = 'none';
    if (navInitial) navInitial.style.display = 'none';
  } else {
    if (avatarImg) avatarImg.style.display = 'none';
    if (navImg)    navImg.style.display    = 'none';
    const ch = (displayName[0] || '?').toUpperCase();
    if (initial)    { initial.style.display    = ''; initial.textContent    = ch; }
    if (navInitial) { navInitial.style.display = ''; navInitial.textContent = ch; }
  }

  const displaynameEl = document.getElementById('account-displayname');
  const username = document.getElementById('account-username');
  const bio      = document.getElementById('account-bio');
  const status   = document.getElementById('account-status');
  const playtime = document.getElementById('acct-playtime');
  const favs     = document.getElementById('acct-favs');
  const visLabel = document.getElementById('visibility-current-label');

  if (displaynameEl) displaynameEl.textContent = displayName;
  if (username) username.textContent = accountUsername ? '@' + accountUsername : '';
  if (bio)      bio.textContent      = p.bio || '';

  const visMap = {
    online:    { label: '● Online',    color: '#50cc50' },
    away:      { label: '● Away',      color: '#ccaa30' },
    invisible: { label: '● Invisible', color: '#666' },
  };
  const vis = visMap[p.visibility] || visMap.online;
  if (status) { status.textContent = vis.label; status.style.color = vis.color; }
  if (visLabel) visLabel.textContent = '— ' + (p.visibility || 'Online');

  // Total playtime
  const totalMins = Object.values(state.playtime).reduce((a, m) => a + m, 0);
  if (playtime) playtime.textContent = totalMins > 0 ? formatMinutes(Math.round(totalMins)) : '—';
  if (favs)     favs.textContent     = state.favourites.size;
}

// ── PROFILE ACTIONS ──────────────────────────────────────────────────────────

function openEditProfile() {
  closeAllDropdowns();
  let modal = document.getElementById('profile-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'profile-modal';
    modal.className = 'rs-modal-overlay';
    modal.innerHTML = `
      <div class="rs-modal" onclick="event.stopPropagation()">
        <div class="rs-modal-header">
          <span>EDIT PROFILE</span>
          <button class="rs-modal-close" onclick="closeEditProfile()">✕</button>
        </div>
        <div class="rs-modal-body">
          <label class="rs-label">Display Name</label>
          <input id="profile-name-input" class="rs-input" maxlength="24" placeholder="Your name...">
          <label class="rs-label" style="margin-top:12px">Bio</label>
          <textarea id="profile-bio-input" class="rs-input rs-textarea" maxlength="120" placeholder="A short tagline..."></textarea>
        </div>
        <div class="rs-modal-footer">
          <button class="action-btn play-btn" style="width:90px;height:34px;font-size:0.72rem" onclick="saveProfile()">SAVE</button>
          <button class="action-btn" style="width:90px;height:34px;font-size:0.72rem;background:linear-gradient(180deg,#2a2010,#1a1408);border-color:#4a3a18;color:#8a7a5a;" onclick="closeEditProfile()">CANCEL</button>
        </div>
      </div>
    `;
    modal.addEventListener('click', closeEditProfile);
    document.body.appendChild(modal);
  }
  document.getElementById('profile-name-input').value = state.profile.displayName || '';
  document.getElementById('profile-bio-input').value  = state.profile.bio || '';
  modal.style.display = 'flex';

  // ESC to close
  modal._escHandler = e => { if (e.key === 'Escape') closeEditProfile(); };
  document.addEventListener('keydown', modal._escHandler);
}

function closeEditProfile() {
  const modal = document.getElementById('profile-modal');
  if (modal) {
    modal.style.display = 'none';
    if (modal._escHandler) document.removeEventListener('keydown', modal._escHandler);
  }
}

async function saveProfile() {
  const name = document.getElementById('profile-name-input')?.value.trim();
  const bio  = document.getElementById('profile-bio-input')?.value.trim();
  if (!name) { showToast('Name cannot be empty.', 'error'); return; }
  state.profile.displayName = name;
  state.profile.bio = bio;
  state.profile.username = state.user?.username;
  await window.hub.saveProfile(state.profile);
  closeEditProfile();
  showToast('Profile saved!', 'success');
}

async function openChangeAvatar() {
  closeAllDropdowns();

  // Build modal if not already present
  let modal = document.getElementById('avatar-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'avatar-modal';
    modal.className = 'rs-modal-overlay';
    modal.innerHTML = `
      <div class="rs-modal" onclick="event.stopPropagation()" style="width:300px">
        <div class="rs-modal-header">
          <span>CHANGE AVATAR</span>
          <button class="rs-modal-close" onclick="closeAvatarModal()">✕</button>
        </div>
        <div class="rs-modal-body" style="text-align:center;padding:16px 18px">
          <div id="avatar-preview-circle" class="avatar-preview-circle">
            <img id="avatar-preview-img" src="" alt="" style="display:none;width:100%;height:100%;object-fit:cover;border-radius:50%;">
            <span id="avatar-preview-initial"></span>
          </div>
          <button class="action-btn" id="avatar-browse-btn"
            style="width:140px;height:34px;font-size:0.7rem;margin-top:16px;background:linear-gradient(180deg,#2a2010,#1a1408);border-color:#6b5228;color:#c8a840;"
            onclick="browseAvatar()">
            BROWSE...
          </button>
          <p id="avatar-chosen-name" style="font-family:'IM Fell English',serif;font-size:0.72rem;color:#6a5a3a;margin-top:8px;min-height:16px;font-style:italic;"></p>
        </div>
        <div class="rs-modal-footer">
          <button class="action-btn play-btn" id="avatar-save-btn" style="width:90px;height:34px;font-size:0.72rem" onclick="confirmAvatar()" disabled>SAVE</button>
          <button class="action-btn" style="width:90px;height:34px;font-size:0.72rem;background:linear-gradient(180deg,#2a2010,#1a1408);border-color:#4a3a18;color:#8a7a5a;" onclick="closeAvatarModal()">CANCEL</button>
        </div>
      </div>
    `;
    modal.addEventListener('click', closeAvatarModal);
    document.body.appendChild(modal);
  }

  // Reset state
  modal._pendingPath = null;
  const img     = document.getElementById('avatar-preview-img');
  const initial = document.getElementById('avatar-preview-initial');
  const name    = document.getElementById('avatar-chosen-name');
  const saveBtn = document.getElementById('avatar-save-btn');

  // Show current avatar or initial
  if (state.profile.avatarPath) {
    img.src = 'file:///' + state.profile.avatarPath.replace(/\\/g, '/') + '?t=' + Date.now();
    img.style.display = '';
    initial.style.display = 'none';
  } else {
    img.style.display = 'none';
    initial.style.display = '';
    initial.textContent = (state.profile.displayName || 'P')[0].toUpperCase();
  }
  name.textContent = '';
  saveBtn.disabled = true;
  saveBtn.textContent = 'SAVE';
  modal._pendingPath = null;

  modal.style.display = 'flex';
  modal._escHandler = e => { if (e.key === 'Escape') closeAvatarModal(); };
  document.addEventListener('keydown', modal._escHandler);
}

async function browseAvatar() {
  const filePath = await window.hub.pickAvatar();
  if (!filePath) return;

  const modal   = document.getElementById('avatar-modal');
  const img     = document.getElementById('avatar-preview-img');
  const initial = document.getElementById('avatar-preview-initial');
  const name    = document.getElementById('avatar-chosen-name');
  const saveBtn = document.getElementById('avatar-save-btn');

  modal._pendingPath = filePath;
  img.src = 'file:///' + filePath.replace(/\\/g, '/');
  img.style.display = '';
  initial.style.display = 'none';
  name.textContent = filePath.split(/[\\/]/).pop();
  saveBtn.disabled = false;
}

async function confirmAvatar() {
  const modal = document.getElementById('avatar-modal');
  if (!modal || !modal._pendingPath) return;

  const saveBtn = document.getElementById('avatar-save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'SAVING...';

  try {
    const finalPath = await window.hub.saveAvatar(modal._pendingPath);
    if (finalPath) {
      state.profile.avatarPath = finalPath;
      state.profile.username = state.user?.username;
      await window.hub.saveProfile(state.profile);
      updateNavbarAvatar();
      closeAvatarModal();
      showToast('Avatar updated!', 'success');
    } else {
      throw new Error('save-avatar returned null');
    }
  } catch (e) {
    console.error('[Avatar] save failed:', e);
    showToast('Failed to save avatar.', 'error');
    saveBtn.disabled = false;
    saveBtn.textContent = 'SAVE';
  }
}

function closeAvatarModal() {
  const modal = document.getElementById('avatar-modal');
  if (modal) {
    modal.style.display = 'none';
    if (modal._escHandler) document.removeEventListener('keydown', modal._escHandler);
  }
}

function toggleVisibilityMenu() {
  const sub = document.getElementById('visibility-submenu');
  if (sub) sub.style.display = sub.style.display === 'none' ? '' : 'none';
}

async function setVisibility(vis) {
  state.profile.visibility = vis;
  state.profile.username = state.user?.username;
  await window.hub.saveProfile(state.profile);
  document.getElementById('visibility-submenu').style.display = 'none';
  populateAccountDropdown();
}

// ── SERVERS ───────────────────────────────────────────────────────────────────

async function loadServers() {
  showLoading(true);
  try {
    const data = await api.getServers();
    const serversData = data.servers || data;
    state.servers = Array.isArray(serversData) ? serversData : [];
    state.favourites = new Set(data.favourites || []);
    checkServerUpdates(state.servers);
    const countEl = document.getElementById('status-server-count');
    if (countEl) countEl.innerHTML = '<span class="status-online">● Hub Online</span>';
  } catch (e) {
    console.error('Failed to load servers:', e);
    state.servers = [];
    const countEl = document.getElementById('status-server-count');
    if (countEl) countEl.textContent = '● Offline';
  }
  showLoading(false);
  renderServers();
}

function getFilteredServers() {
  let list = [...state.servers];

  // Search
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(s => s.name.toLowerCase().includes(q) ||
                            (s.description || '').toLowerCase().includes(q));
  }

  // Tag filter
  if (state.activeTag !== 'All') {
    list = list.filter(s => s.tags && s.tags.some(t =>
      t.toLowerCase() === state.activeTag.toLowerCase()
    ));
  }

  // Sort
  if (state.sortOrder === 'players')   list.sort((a, b) => (b.hubPlayers || 0) - (a.hubPlayers || 0));
  if (state.sortOrder === 'name-asc')  list.sort((a, b) => a.name.localeCompare(b.name));
  if (state.sortOrder === 'name-desc') list.sort((a, b) => b.name.localeCompare(a.name));

  // Favourites to top
  const pinned   = list.filter(s =>  state.favourites.has(s.name));
  const unpinned = list.filter(s => !state.favourites.has(s.name));
  return [...pinned, ...unpinned];
}

function renderServers() {
  const grid = document.getElementById('server-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const list = getFilteredServers();

  if (list.length === 0) {
    grid.innerHTML = '<p class="empty-msg">No servers found.</p>';
    return;
  }

  list.forEach(server => {
    grid.appendChild(buildServerCard(server));
  });

  renderFavSidebar();
}

function buildServerCard(server) {
  const isFav        = state.favourites.has(server.name);
  const isDownloaded = server.downloaded || false;
  const isOnline     = server.serverOnline === 1;
  const players      = server.hubPlayers || 0;
  const minutes      = state.playtime[server.name] || 0;
  const level        = calcLevel(minutes);
  const xpPct        = calcXpProgress(minutes);
  const rankName     = getRankName(level);
  const milestoneClr = getMilestoneColor(level);
  const tags         = (server.tags || []).slice(0, 4);

  const bannerGradient = bannerColor(server.name);
  const card = document.createElement('div');
  card.className = 'server-card';
  card.style.cssText = 'display:flex;align-items:stretch;min-height:115px;background:linear-gradient(135deg,#3a3020,#281e10);border:1px solid #6b5228;border-radius:4px;overflow:hidden;margin-bottom:0;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,0.8);';
  card.innerHTML = `
    <div class="card-banner" style="background:${bannerGradient};width:210px;min-width:210px;height:115px;position:relative;overflow:hidden;border-right:1px solid #3a2e14;">
      ${server.cardBannerUrl || server.bannerUrl
        ? `<img src="${escHtml(server.cardBannerUrl || server.bannerUrl)}" alt="${escHtml(server.name)}" onerror="this.style.display='none'">`
        : `<span class="banner-placeholder">${escHtml(server.name)}</span>`
      }
    </div>
    <div class="card-info">
      <div class="card-header">
        <span class="card-title">${escHtml(server.name)}</span>
        <span class="status-dot ${isOnline ? 'online' : 'offline'}" title="${isOnline ? 'Online' : 'Offline'}"></span>
        <span class="level-badge-wrap"
          data-lv="${level}"
          data-rank="${escHtml(rankName)}"
          data-mc="${milestoneClr}"
          data-orb="${escHtml(server.name[0].toUpperCase())}"
          data-xp="${Math.round(xpPct*100)}"
          data-time="${escHtml(calcTooltip(server.name, level, minutes).split('·')[1]?.trim() || 'Max level')}">
          <span class="level-badge" style="border-color:${milestoneClr};color:${milestoneClr}">Lv. ${level}</span>
        </span>
      </div>
      <p class="card-desc">${escHtml(truncate(server.description || '', 200))}</p>
      <div class="card-tags">
        ${tags.map(t => `<span class="tag-pill">${escHtml(String(t).toUpperCase())}</span>`).join('')}
      </div>
    </div>
    <div class="card-actions">
      <span class="player-count">▲ ${formatNumber(players)} Hub Players Online</span>
      <button class="action-btn ${isDownloaded ? 'play-btn' : 'install-btn'}"
              data-action="${isDownloaded ? 'play' : 'install'}"
              data-name="${server.name}">
        ${isDownloaded ? 'PLAY' : 'INSTALL'}
      </button>
      <button class="fav-btn ${isFav ? 'active' : ''}" data-name="${server.name}">
        ${isFav ? '★ Favourited' : '☆ Favourite'}
      </button>
    </div>
  `;

  // Open detail on card click (not on button clicks)
  card.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    showServerDetail(server);
  });

  // Play / Install
  card.querySelector('[data-action]').addEventListener('click', async e => {
    e.stopPropagation();
    const btn    = e.currentTarget;
    const action = btn.dataset.action;
    btn.disabled = true;
    btn.textContent = action === 'play' ? 'Launching...' : 'Downloading...';
    try {
      if (action === 'play') {
        await api.play(server.name);
        btn.disabled = false;
        btn.textContent = 'PLAY';
        startActiveSessionChip(server.name);
        if (state.settings?.minimizeOnLaunch) window.hub.minimize();
      }
      if (action === 'install') {
        const result = await api.install(server.name, server.jarUrl);
        if (result && result.error) {
          showToast('Install failed: ' + result.error, 'error');
          btn.disabled = false;
          btn.textContent = 'INSTALL';
        } else if (result && result.success) {
          await loadServers();
        } else {
          // Unexpected response — show raw
          showToast('Unexpected response: ' + JSON.stringify(result), 'error');
          btn.disabled = false;
          btn.textContent = 'INSTALL';
        }
      }
    } catch (err) {
      console.error('Install error:', err);
      showToast('Install failed: ' + (err.message || err), 'error');
      btn.disabled = false;
      btn.textContent = 'INSTALL';
    }
  });

  // Favourite toggle
  card.querySelector('.fav-btn').addEventListener('click', async e => {
    e.stopPropagation();
    try {
      await api.toggleFavourite(server.name);
      if (state.favourites.has(server.name)) state.favourites.delete(server.name);
      else state.favourites.add(server.name);
      renderServers();
    } catch (err) { console.error(err); }
  });

  return card;
}

// ── FAV SIDEBAR ───────────────────────────────────────────────────────────────

function renderFavSidebar() {
  const strip = document.getElementById('fav-strip');
  if (!strip) return;

  // Clear previous dynamic content
  strip.querySelectorAll('.fav-slot, .fav-hint').forEach(el => el.remove());

  if (state.favourites.size === 0) {
    const hint = document.createElement('span');
    hint.className = 'fav-hint';
    hint.textContent = 'No favs';
    strip.appendChild(hint);
    return;
  }

  state.favourites.forEach(name => {
    const server = state.servers.find(s => s.name === name);
    const slot   = document.createElement('div');
    slot.className = 'fav-slot';
    slot.title     = name;
    const safeInitial = escHtml(name[0].toUpperCase());
    const safeName = escHtml(name.length > 6 ? name.slice(0, 5) + '…' : name);
    slot.innerHTML = `
      ${server?.serverOnline === 1 ? '<span class="fav-online-dot"></span>' : ''}
      <button class="fav-remove-btn" title="Remove favourite">✕</button>
      <span class="fav-initial">${safeInitial}</span>
      <span class="fav-name">${safeName}</span>
    `;
    slot.addEventListener('click', e => {
      if (e.target.closest('.fav-remove-btn')) return;
      if (server) showServerDetail(server);
    });
    slot.querySelector('.fav-remove-btn').addEventListener('click', async e => {
      e.stopPropagation();
      try {
        await api.toggleFavourite(name);
        state.favourites.delete(name);
        renderServers();
      } catch (err) { console.error(err); }
    });
    strip.appendChild(slot);
  });
}

// ── NAV TABS ──────────────────────────────────────────────────────────────────

function setupNavTabs() {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      setActiveNavTab(btn.dataset.tab);
    });
  });
}

function setActiveNavTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.nav-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );

  const searchSection = document.getElementById('search-section');
  const serverGrid    = document.getElementById('server-grid');
  const altContent    = document.getElementById('alt-content');

  if (tab === 'store') {
    if (searchSection) searchSection.style.display = '';
    if (serverGrid)    serverGrid.style.display     = '';
    if (altContent)    altContent.style.display     = 'none';
    renderServers();
  } else {
    if (searchSection) searchSection.style.display = 'none';
    if (serverGrid)    serverGrid.style.display     = 'none';
    if (altContent) {
      altContent.style.display = '';
      renderAltContent(tab);
    }
  }
}

// ── SIDEBAR SLIDE-OUT PANELS ──────────────────────────────────────────────────

const PANEL_TITLES = { friends: 'Friends', chat: 'Friends Chat', groupchat: 'Group Chat', stats: 'Stats', leaderboard: 'Leaderboard', achievements: 'Achievements', music: 'Music', settings: 'Settings' };

function setupSidebarTabs() {
  const panel     = document.getElementById('slide-panel');
  const closeBtn  = document.getElementById('slide-panel-close');
  const titleEl   = document.getElementById('slide-panel-title');
  const bodyEl    = document.getElementById('slide-panel-body');

  document.querySelectorAll('.rs-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const panelId = btn.dataset.panel;
      const already = btn.classList.contains('active');

      // Toggle off if clicking same one
      document.querySelectorAll('.rs-tab').forEach(b => b.classList.remove('active'));
      if (already) {
        panel.classList.remove('open');
        return;
      }

      btn.classList.add('active');
      titleEl.textContent = PANEL_TITLES[panelId] || panelId;
      bodyEl.innerHTML = '<p class="loading-msg">Loading...</p>';
      panel.classList.add('open');
      clearUnread(panelId); // clear badge when panel is opened
      renderAltContent(panelId, bodyEl);
    });
  });

  closeBtn?.addEventListener('click', () => {
    panel.classList.remove('open');
    document.querySelectorAll('.rs-tab').forEach(b => b.classList.remove('active'));
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && panel.classList.contains('open')) {
      panel.classList.remove('open');
      document.querySelectorAll('.rs-tab').forEach(b => b.classList.remove('active'));
    }
  });
}

// ── ALT CONTENT (Library / News / panel content) ─────────────────────────────

async function renderAltContent(tab, el) {
  if (!el) el = document.getElementById('alt-content');
  if (!el) return;

  if (tab === 'stats') {
    if (window.renderStats) {
      window.renderStats(el);
    } else {
      // Fallback for the old basic stats view if the dashboard module hasn't loaded.
      el.innerHTML = '<p class="loading-msg">Loading stats...</p>';
      try {
        const data = await api.getPlaytime();
        el.innerHTML = buildStatsHTML(data);
      } catch { el.innerHTML = '<p class="empty-msg">Could not load stats.</p>'; }
    }
  }

  else if (tab === 'friends') {
    // Instant paint from cache + background refresh if stale.
    const drawFriends = (friendsData, reqData) => {
      const friends  = friendsData?.friends || [];
      const requests = reqData?.requests    || [];
      state.friends = friends;
      el.innerHTML = buildFriendsHTML({ friends, requests });
      bindFriendsEvents(el);
    };
    const cachedF = window.getCached?.('friends');
    const cachedR = window.getCached?.('friendReqs');
    const initialPanel = document.querySelector('.rs-tab.active')?.dataset?.panel;
    const stillOnFriends = () =>
      document.querySelector('.rs-tab.active')?.dataset?.panel === initialPanel
      && document.contains(el);
    if (cachedF?.data && cachedR?.data) {
      drawFriends(cachedF.data, cachedR.data);
      if (cachedF.isStale || cachedR.isStale) {
        Promise.all([
          api.getFriends().catch(() => null),
          api.getFriendRequests().catch(() => null),
        ]).then(([f, r]) => {
          if (f) window.setCache?.('friends', f);
          if (r) window.setCache?.('friendReqs', r);
          // Critical: don't draw friends into the wrong tab if the user
          // navigated away while the refresh was in flight.
          if (stillOnFriends() && f && r) drawFriends(f, r);
        });
      }
    } else {
      el.innerHTML = '<p class="loading-msg">Loading friends...</p>';
      try {
        const [friendsData, reqData] = await Promise.all([
          api.getFriends().catch(() => ({ friends: [] })),
          api.getFriendRequests().catch(() => ({ requests: [] })),
        ]);
        if (friendsData) window.setCache?.('friends', friendsData);
        if (reqData)     window.setCache?.('friendReqs', reqData);
        drawFriends(friendsData, reqData);
      } catch (e) { el.innerHTML = '<p class="empty-msg">Could not load friends.</p>'; }
    }
  }

  else if (tab === 'leaderboard') {
    if (window.renderLeaderboard) window.renderLeaderboard(el);
    else el.innerHTML = '<p class="loading-msg">Loading leaderboard…</p>';
  }

  else if (tab === 'library') {
    const installed = state.servers.filter(s => s.downloaded);
    el.innerHTML = `
      <div class="alt-header"><h2>LIBRARY</h2><p>Your installed servers</p></div>
      ${installed.length === 0
        ? '<p class="empty-msg">No servers installed yet. Head to the Store to install one!</p>'
        : installed.map(s => `
          <div class="library-row">
            <div class="library-banner" style="background:${bannerColor(s.name)}">
              ${s.cardBannerUrl || s.bannerUrl
                ? `<img src="${escHtml(s.cardBannerUrl || s.bannerUrl)}" alt="${escHtml(s.name)}" onerror="this.style.display='none'">`
                : `<span class="lib-initial">${escHtml(s.name[0].toUpperCase())}</span>`}
            </div>
            <div class="library-info">
              <span class="library-name">${escHtml(s.name)}</span>
              <span class="library-meta">${escHtml((s.tags || []).slice(0,3).map(t => String(t).toUpperCase()).join(' · '))}</span>
            </div>
            <div class="library-actions">
              <button class="action-btn play-btn" data-lib-action="play" data-lib-name="${escHtml(s.name)}">PLAY</button>
              <button class="action-btn uninstall-btn" data-lib-action="uninstall" data-lib-name="${escHtml(s.name)}">UNINSTALL</button>
            </div>
          </div>
        `).join('')
      }
    `;
    // Bind library button actions (replaces onclick=… to avoid string injection)
    el.querySelectorAll('[data-lib-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-lib-name') || '';
        const action = btn.getAttribute('data-lib-action');
        if (action === 'play')      handleLibraryPlay(name);
        else if (action === 'uninstall') handleLibraryUninstall(name);
      });
    });
  }

  else if (tab === 'chat') {
    // If a DM was open when panel was closed, reopen it straight away
    if (state.activeDM) {
      openDM(el, state.activeDM);
      return;
    }
    el.innerHTML = '<p class="loading-msg">Loading messages...</p>';
    try {
      const data = await api.getConversations().catch(() => ({ conversations: [] }));
      const convos = data.conversations || [];
      renderConversationList(el, convos);
    } catch { el.innerHTML = '<p class="empty-msg">Could not load messages.</p>'; }
  }

  else if (tab === 'groupchat') {
    renderGroupChat(el);
  }

  else if (tab === 'achievements') {
    if (window.renderAchievements) {
      window.renderAchievements(el);
    } else {
      el.innerHTML = `
        <div class="alt-header"><h2>ACHIEVEMENTS</h2><p>Track your milestones across all servers</p></div>
        <p class="loading-msg">Loading achievements…</p>
      `;
    }
  }

  else if (tab === 'music') {
    if (window.RH_MUSIC?.render) window.RH_MUSIC.render(el);
    else el.innerHTML = '<p class="loading-msg">Loading music...</p>';
  }

  else if (tab === 'settings') {
    el.innerHTML = '<p class="loading-msg">Loading settings…</p>';
    let s = {};
    try { s = await api.getSettings(); } catch (_) {}
    el.innerHTML = buildSettingsHTML(s);
    bindSettingsEvents(el, s);
    try {
      const v = await window.hub.getVersion();
      const av = el.querySelector('#about-version');
      if (av) av.textContent = 'v' + v;
    } catch {}
  }

  else if (tab === 'news') {
    const renderNews = async () => {
      el.innerHTML = `<div class="alt-header"><h2>NEWS</h2><p>Latest updates from RSPS Hub</p></div><p class="empty-msg" style="padding:24px 0">Loading…</p>`;
      let announcementsData = null;
      let fetchErr = null;
      try {
        announcementsData = await fetch('https://api.therspshub.com/api/announcements/list.php').then(r => r.json());
      } catch (e) { fetchErr = e?.message || String(e); }

      const announcements = announcementsData?.announcements || [];
      const serversWithChangelog = state.servers.filter(s => s.changelog && s.changelog.trim());

      const isStaff = !!state.user?.isStaff;
      const announcementCards = announcements.map(a => `
        <div class="news-card" data-ann-id="${a.id}">
          <div class="news-card-header">
            <div class="news-server-icon" style="background:linear-gradient(135deg,#c8a840,#8a6820);color:#fff;font-family:'Cinzel',serif;font-weight:700">H</div>
            <div class="news-server-meta">
              <span class="news-server-name">${escHtml(a.title)}</span>
              <span class="news-server-tag">HUB ANNOUNCEMENT</span>
            </div>
            ${isStaff ? `<button class="news-delete-btn" data-id="${a.id}" title="Delete announcement" style="margin-left:auto;background:none;border:none;color:#5a3a2a;font-size:0.8rem;cursor:pointer;padding:2px 6px;border-radius:3px;transition:color 0.12s" onmouseover="this.style.color='#e07070'" onmouseout="this.style.color='#5a3a2a'">✕</button>` : ''}
          </div>
          <div class="news-body" style="white-space:pre-wrap">${escHtml(a.message)}</div>
        </div>
      `).join('');

      const changelogCards = serversWithChangelog.map(s => `
        <div class="news-card">
          <div class="news-card-header">
            <div class="news-server-icon" style="background:${bannerColor(s.name)}">${escHtml(s.name[0].toUpperCase())}</div>
            <div class="news-server-meta">
              <span class="news-server-name">${escHtml(s.name)}</span>
              <span class="news-server-tag">CHANGELOG</span>
            </div>
          </div>
          <div class="news-body">${escHtml(s.changelog).replace(/\n/g, '<br>')}</div>
        </div>
      `).join('');

      const errBanner = fetchErr
        ? `<p style="color:#c84040;font-size:0.72rem;padding:6px 0">⚠ Failed to load announcements: ${escHtml(fetchErr)}</p>`
        : (announcementsData && !announcementsData.announcements
            ? `<p style="color:#c84040;font-size:0.72rem;padding:6px 0">⚠ Unexpected response: ${escHtml(JSON.stringify(announcementsData).slice(0,100))}</p>`
            : '');

      if (!announcementCards && !changelogCards) {
        el.innerHTML = `
          <div class="alt-header"><h2>NEWS</h2><p>Latest updates from RSPS Hub</p></div>
          ${errBanner}
          <p class="empty-msg">No news yet. Check back soon!</p>
        `;
      } else {
        el.innerHTML = `
          <div class="alt-header"><h2>NEWS</h2><p>Latest updates from RSPS Hub</p></div>
          ${errBanner}${announcementCards}${changelogCards}
        `;
      }
    };
    await renderNews();

    // Delete announcement buttons (staff only)
    el.addEventListener('click', async e => {
      const btn = e.target.closest('.news-delete-btn');
      if (!btn) return;
      btn.disabled = true;
      try {
        await window.hub.post('/api/announcements/delete', { id: parseInt(btn.dataset.id) });
        btn.closest('[data-ann-id]').remove();
        showToast('Announcement deleted.', 'info');
      } catch { btn.disabled = false; showToast('Failed to delete', 'error'); }
    });
  }
}

async function handleLibraryPlay(name) {
  try { await api.play(name); startActiveSessionChip(name); } catch (err) { console.error(err); }
}

async function handleLibraryUninstall(name) {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'REMOVING...';
  try {
    const result = await api.uninstall(name);
    if (result && result.success) {
      showToast(`${name} uninstalled.`, 'success');
      await loadServers();
      // Re-render library if still on library tab
      const panel = document.getElementById('slide-panel');
      if (panel && panel.classList.contains('open')) {
        const activeTab = document.querySelector('.rs-tab.active')?.dataset?.tab;
        if (activeTab === 'library') {
          const inner = document.getElementById('slide-inner');
          if (inner) renderAltContent('library', inner);
        }
      }
    } else {
      showToast('Uninstall failed.', 'error');
      btn.disabled = false;
      btn.textContent = 'UNINSTALL';
    }
  } catch (err) {
    showToast('Uninstall error: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'UNINSTALL';
  }
}

function buildStatsHTML(data) {
  const sessions = (data.recentSessions || []).slice(0, 10);
  const perServer = Object.entries(data.perServer || {})
    .sort((a, b) => b[1] - a[1]);
  const max = perServer[0]?.[1] || 1;

  return `
    <div class="alt-header"><h2>STATS</h2><p>Your playtime across all servers</p></div>
    <div class="stat-boxes">
      <div class="stat-box wide">
        <span class="stat-value">${formatMinutes(data.totalMinutes || 0)}</span>
        <span class="stat-label">Total Playtime</span>
      </div>
      <div class="stat-box">
        <span class="stat-value">${data.serversPlayed || perServer.length || 0}</span>
        <span class="stat-label">Servers Played</span>
      </div>
      <div class="stat-box">
        <span class="stat-value" style="font-size:${(data.mostPlayed||'—').length > 8 ? '0.85rem' : '1.1rem'}">${data.mostPlayed || (perServer[0]?.[0]) || '—'}</span>
        <span class="stat-label">Most Played</span>
      </div>
    </div>
    <h3 class="section-header">PER SERVER</h3>
    ${perServer.map(([name, mins]) => `
      <div class="stat-row">
        <span class="stat-server-name">${name}</span>
        <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(mins/max*100).toFixed(1)}%"></div></div>
        <span class="stat-time">${formatMinutes(mins)}</span>
      </div>
    `).join('')}
    <h3 class="section-header">RECENT SESSIONS</h3>
    ${sessions.map(s => `
      <div class="session-row">
        <span class="session-dot">▶</span>
        <span class="session-name">${s.serverName}</span>
        <span class="session-duration">${formatMinutes(s.minutes)}</span>
        <span class="session-date">${s.date}</span>
      </div>
    `).join('')}
  `;
}

// ── FRIENDS PANEL ─────────────────────────────────────────────────────────────

function buildFriendsHTML({ friends = [], requests = [] }) {
  const online  = friends.filter(f =>  f.online);
  const offline = friends.filter(f => !f.online);

  const requestsHTML = requests.length ? `
    <div class="section-header friend-req-header">FRIEND REQUESTS — ${requests.length}</div>
    ${requests.map(r => `
      <div class="friend-row friend-req-row" data-username="${r.username}">
        <div class="friend-avatar req">${r.username[0].toUpperCase()}</div>
        <div class="friend-info">
          <span class="friend-name">${r.username}</span>
          <span class="friend-status">Wants to be your friend</span>
        </div>
        <div class="friend-actions">
          <button class="friend-btn friend-accept-btn" data-username="${r.username}" title="Accept">✓</button>
          <button class="friend-btn friend-decline-btn" data-username="${r.username}" title="Decline">✕</button>
        </div>
      </div>
    `).join('')}
  ` : '';

  return `
    <div class="alt-header"><h2>FRIENDS</h2><p>${friends.length} friend${friends.length !== 1 ? 's' : ''}</p></div>
    <div class="add-friend-row">
      <input id="add-friend-input" class="search-input" type="text" placeholder="Add friend by username...">
      <button class="action-btn play-btn" id="send-req-btn" style="min-width:120px;height:34px;font-size:0.72rem">SEND REQUEST</button>
    </div>
    ${requestsHTML}
    ${online.length  ? `<div class="section-header">ONLINE — ${online.length}</div>`  + online.map(friendRowHTML).join('') : ''}
    ${offline.length ? `<div class="section-header">OFFLINE — ${offline.length}</div>` + offline.map(friendRowHTML).join('') : ''}
    ${friends.length === 0 && !requestsHTML ? '<p class="empty-msg">No friends yet. Send someone a request!</p>' : ''}
  `;
}

function friendRowHTML(f) {
  const statusText = f.online
    ? (f.playingServer ? `Playing ${f.playingServer}` : 'Online')
    : (f.statusMessage ? f.statusMessage : 'Offline');
  return `
    <div class="friend-row" data-username="${f.username}">
      <div class="friend-avatar ${f.online ? 'online' : ''}">${f.username[0].toUpperCase()}</div>
      <div class="friend-info">
        <span class="friend-name">${f.username}</span>
        <span class="friend-status">${statusText}</span>
      </div>
      <div class="friend-actions">
        <button class="friend-btn friend-msg-btn" data-username="${f.username}" title="Message">💬</button>
        <button class="friend-btn friend-remove-btn" data-username="${f.username}" title="Remove friend">✕</button>
      </div>
    </div>
  `;
}

function bindFriendsEvents(el) {
  // Send friend request
  el.querySelector('#send-req-btn')?.addEventListener('click', async () => {
    const input = el.querySelector('#add-friend-input');
    const username = input?.value.trim();
    if (!username) return;
    const btn = el.querySelector('#send-req-btn');
    btn.disabled = true; btn.textContent = 'SENDING...';
    try {
      const res = await api.addFriend(username);
      input.value = '';
      showToast(res.result === 'ok' ? `Request sent to ${username}!` : (res.result || 'Request sent!'), 'success');
    } catch { showToast('Failed to send request.', 'error'); }
    btn.disabled = false; btn.textContent = 'SEND REQUEST';
  });

  el.querySelector('#add-friend-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') el.querySelector('#send-req-btn')?.click();
  });

  // Accept/decline friend requests
  el.querySelectorAll('.friend-accept-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const username = btn.dataset.username;
      try {
        await api.acceptFriend(username);
        showToast(`${username} added as a friend!`, 'success');
        renderAltContent('friends', el);
      } catch { showToast('Failed to accept request.', 'error'); }
    });
  });

  el.querySelectorAll('.friend-decline-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const username = btn.dataset.username;
      try {
        await api.declineFriend(username);
        btn.closest('.friend-row')?.remove();
      } catch { showToast('Failed to decline request.', 'error'); }
    });
  });

  // Message button → open DM
  el.querySelectorAll('.friend-msg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const username = btn.dataset.username;
      // Pre-set activeDM so chat panel opens straight into the conversation
      state.activeDM = username;
      const chatTab = document.querySelector('.rs-tab[data-panel="chat"]');
      if (chatTab) {
        chatTab.click();
      } else {
        // Panel might already be open on a different tab — render directly
        const panelBody = document.getElementById('slide-panel-body');
        if (panelBody) openDM(panelBody, username);
      }
    });
  });

  // Remove friend
  el.querySelectorAll('.friend-remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const username = btn.dataset.username;
      const ok = await rhConfirm(`Remove ${username} from your friends?`, {
        title: 'Remove friend',
        confirmText: 'Remove',
        cancelText: 'Cancel',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.removeFriend(username);
        btn.closest('.friend-row')?.remove();
        showToast(`${username} removed.`, 'success');
      } catch { showToast('Failed to remove friend.', 'error'); }
    });
  });
}

// ── DM CHAT ───────────────────────────────────────────────────────────────────

function renderConversationList(el, convos) {
  // Always read from DM_STORE so the last message shown is always current.
  // Seed any store-missing usernames from server convos or MOCK_MESSAGES.
  const me = (state.user?.username || '').toLowerCase();
  const storeUsernames = new Set(Object.keys(DM_STORE));
  // Filter yourself out — a conversation-with-yourself shouldn't be a thing,
  // and if it ever got created (old bug, bad server response, etc.) it
  // clutters the list with a "Vinnlarr — No messages yet" row.
  for (const u of Array.from(storeUsernames)) {
    if (u && u.toLowerCase() === me) {
      storeUsernames.delete(u);
      delete DM_STORE[u];
    }
  }
  for (const c of convos) {
    const u = c.username || c.with_user || c.other_user;
    if (!u || u.toLowerCase() === me) continue;
    if (!storeUsernames.has(u)) storeUsernames.add(u);
  }

  const list = [...storeUsernames].map(username => {
    const msgs = dmStoreGet(username);
    const last = msgs.at(-1);
    return { username, lastMsg: last?.content || '', lastTs: last?.timestamp || '' };
  });

  el.innerHTML = `
    <div class="alt-header"><h2>FRIENDS CHAT</h2><p>Direct messages</p></div>
    ${list.length === 0 ? '<p class="empty-msg">No conversations yet.</p>' : list.map(c => `
      <div class="convo-row" data-username="${escHtml(c.username)}">
        <div class="friend-avatar">${c.username[0].toUpperCase()}</div>
        <div class="friend-info">
          <span class="friend-name">${escHtml(c.username)}</span>
          <span class="friend-status convo-preview">${escHtml(c.lastMsg || 'No messages yet')}</span>
        </div>
        ${c.lastTs ? `<span class="convo-ts">${escHtml(c.lastTs)}</span>` : ''}
        <button class="convo-delete-btn" data-username="${escHtml(c.username)}" title="Delete conversation">×</button>
      </div>
    `).join('')}
  `;

  el.querySelectorAll('.convo-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.convo-delete-btn')) return;
      state.activeDM = row.dataset.username;
      openDM(el, row.dataset.username);
    });
  });

  el.querySelectorAll('.convo-delete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const username = btn.dataset.username;
      delete DM_STORE[username];
      dmStoreSave();
      btn.closest('.convo-row').remove();
      if (el.querySelectorAll('.convo-row').length === 0) {
        const listEl = el.querySelector('.alt-header');
        if (listEl) listEl.insertAdjacentHTML('afterend', '<p class="empty-msg">No conversations yet.</p>');
      }
    });
  });
}

async function openDM(el, username) {
  // Never open a DM with yourself — caller may pass own username by mistake
  // (leaderboard self-click, stale click handler, etc.). Ignore and stay
  // on the conversation list.
  if (!username || username.toLowerCase() === (state.user?.username || '').toLowerCase()) {
    state.activeDM = null;
    renderAltContent('chat', el);
    return;
  }
  state.activeDM = username;
  // Reset any padding the host container may have (alt-panel has 24/28,
  // slide-panel-body has 14/14). The DM wrapper itself manages its own
  // internal padding, and if we leave the outer padding intact the DM's
  // header and input row sit inside a second gutter that visibly jumps
  // the panel wider/narrower when the user toggles between list and DM.
  el.classList.add('dm-host');
  el.innerHTML = `
    <div class="dm-wrap">
      <div class="dm-header" style="padding:10px 14px 10px">
        <button class="dm-back-btn" id="dm-back">← Back</button>
        <div class="friend-avatar" style="width:28px;height:28px;font-size:0.7rem">${username[0].toUpperCase()}</div>
        <span class="dm-title">${username}</span>
      </div>
      <div class="dm-messages" id="dm-messages"><p class="loading-msg">Loading...</p></div>
      <div class="dm-input-row" style="padding:10px 14px">
        <input class="dm-input" id="dm-input" type="text" placeholder="Message ${username}..." maxlength="500">
        <button class="action-btn play-btn dm-send-btn" id="dm-send" style="min-width:64px;height:34px;font-size:0.72rem">SEND</button>
      </div>
    </div>
  `;

  el.querySelector('#dm-back').addEventListener('click', () => {
    state.activeDM = null;
    el.classList.remove('dm-host');
    renderAltContent('chat', el);
  });

  const msgEl  = el.querySelector('#dm-messages');
  const input  = el.querySelector('#dm-input');
  const sendBtn = el.querySelector('#dm-send');

  function renderMessages() {
    const msgs = dmStoreGet(username);
    if (msgs.length === 0) {
      msgEl.innerHTML = '<p class="empty-msg" style="padding:16px">No messages yet. Say hi!</p>';
    } else {
      msgEl.innerHTML = msgs.map(m => `
        <div class="dm-msg ${m.isOwn ? 'own' : 'other'}">
          ${!m.isOwn ? `<span class="dm-sender">${escHtml(m.sender)}</span>` : ''}
          <div class="dm-bubble">${escHtml(m.content)}</div>
          ${m.timestamp ? `<span class="dm-ts">${escHtml(m.timestamp)}</span>` : ''}
        </div>
      `).join('');
    }
    msgEl.scrollTop = msgEl.scrollHeight;
  }

  // Render from local store immediately (no flicker), then replace with
  // the server's authoritative message list. We keep optimistic pending
  // sends (not yet confirmed by the server) so they don't disappear.
  renderMessages();
  api.getMessages(username)
    .then(data => {
      if (!data || !data.messages) return;
      const pending = dmStoreGet(username).filter(m => m.pending);
      DM_STORE[username] = [...data.messages, ...pending];
      dmStoreSave();
      renderMessages();
    })
    .catch(() => {});

  // In-flight guard — prevents Enter-spam from queuing multiple sends of the
  // same message before the first one has fully left the renderer. Separate
  // from sendBtn.disabled so keyboard users are covered even if the button
  // is invisible / missing.
  let _sending = false;
  async function doSend() {
    if (_sending) return;
    const content = input.value.trim();
    if (!content) return;
    _sending = true;
    sendBtn.disabled = true;
    input.disabled = true;
    input.value = '';
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msg = { sender: state.profile?.displayName || 'You', content, timestamp: now, isOwn: true, pending: true };
    dmStorePush(username, msg);
    if (msgEl.querySelector('.empty-msg')) msgEl.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'dm-msg own';
    div.innerHTML = `<div class="dm-bubble">${escHtml(content)}</div><span class="dm-ts">${escHtml(now)}</span>`;
    msgEl.appendChild(div);
    msgEl.scrollTop = msgEl.scrollHeight;
    // Await the send so the re-enable happens only AFTER the message is
    // confirmed on the server. This is the actual fix for the duplicate-
    // send bug: the previous code re-enabled the button in the next tick
    // (before the network round-trip), letting a second Enter press queue
    // an identical send while the first was still in flight.
    try { await api.sendMessage(username, content); } catch {}
    _sending = false;
    sendBtn.disabled = false;
    input.disabled = false;
    input.focus();
  }

  sendBtn.addEventListener('click', doSend);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !_sending) { e.preventDefault(); doSend(); }
  });
  input.focus();
}

// ── GROUP CHAT ────────────────────────────────────────────────────────────────

// Persistent group state (survives re-renders, resets on app restart)
const GC = {
  hubMsgs: [
    { sender: 'Hub', content: 'Welcome to Hub Chat! Chat with players across all RSPS servers.', ts: '', isSystem: true },
  ],
  groups: [], // { id, name, members:[], msgs:[] }
  nextId: 1,
};

function renderGroupChat(el) {
  el.style.overflow = '';
  el.style.padding  = '';

  el.innerHTML = `
    <div class="alt-header"><h2>GROUP CHAT</h2><p>Channels &amp; group conversations</p></div>

    <div class="gc-channel-list">
      <!-- Hub Chat — always pinned -->
      <div class="gc-channel-row pinned" id="gc-open-hub">
        <span class="gc-channel-icon">🌐</span>
        <div class="gc-channel-info">
          <span class="gc-channel-name">Hub Chat</span>
          <span class="gc-channel-sub">Global launcher chat</span>
        </div>
        <span class="gc-channel-arrow">›</span>
      </div>

      <!-- User-created groups -->
      ${GC.groups.length === 0 ? '' : GC.groups.map(g => `
        <div class="gc-channel-row" data-gcid="${g.id}">
          <span class="gc-channel-icon" style="font-size:1rem;background:none;border:none">#</span>
          <div class="gc-channel-info">
            <span class="gc-channel-name">${g.name}</span>
            <span class="gc-channel-sub">${g.members.length} member${g.members.length !== 1 ? 's' : ''}</span>
          </div>
          <button class="gc-delete-btn" data-gcid="${g.id}" title="Delete group">🗑</button>
        </div>
      `).join('')}
    </div>

    <div class="gc-create-section">
      <div class="section-header" style="margin-top:12px">CREATE GROUP</div>
      <div class="gc-create-row">
        <input class="dm-input" id="gc-new-name" type="text" placeholder="Group name..." maxlength="30" style="flex:1">
      </div>
      <div id="gc-friend-picker" class="gc-friend-picker">
        ${(state.friends || []).length === 0
        ? '<p style="font-size:0.72rem;color:#4a3a20;padding:4px 2px;font-style:italic">No friends yet — add some first.</p>'
        : (state.friends || []).map(f => `
          <label class="gc-friend-check">
            <input type="checkbox" value="${f.username}">
            <span class="gc-cb">✓</span>
            <span class="friend-avatar ${f.online ? 'online' : ''}" style="width:26px;height:26px;font-size:0.7rem;flex-shrink:0">${f.username[0].toUpperCase()}</span>
            <span>${f.username}</span>
          </label>
        `).join('')
      }
      </div>
      <button class="action-btn play-btn" id="gc-create-btn" style="width:100%;height:34px;font-size:0.72rem;margin-top:10px">CREATE GROUP</button>
    </div>
  `;

  // Hub Chat click
  el.querySelector('#gc-open-hub').addEventListener('click', () => openGCRoom(el, 'hub', 'Hub Chat'));

  // Group channel clicks
  el.querySelectorAll('.gc-channel-row[data-gcid]').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.gc-delete-btn')) return;
      const id   = parseInt(row.dataset.gcid);
      const grp  = GC.groups.find(g => g.id === id);
      if (grp) openGCRoom(el, id, grp.name);
    });
  });

  // Delete group buttons
  el.querySelectorAll('.gc-delete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.gcid);
      GC.groups = GC.groups.filter(g => g.id !== id);
      renderGroupChat(el);
    });
  });

  // Create group
  el.querySelector('#gc-create-btn').addEventListener('click', () => {
    const name    = el.querySelector('#gc-new-name').value.trim();
    const checked = [...el.querySelectorAll('#gc-friend-picker input:checked')].map(i => i.value);
    if (!name) { showToast('Enter a group name.', 'error'); return; }
    const grp = { id: GC.nextId++, name, members: checked, msgs: [
      { sender: 'System', content: `Group "${name}" created.`, ts: 'just now', isSystem: true }
    ]};
    GC.groups.push(grp);
    renderGroupChat(el);
    // Auto-open the new group
    openGCRoom(el, grp.id, grp.name);
  });
}

async function openGCRoom(el, roomId, roomName) {
  const myUsername = state.user?.username || '';
  let lastId = 0;
  let pollTimer = null;

  el.style.overflow = 'hidden';
  el.style.padding  = '0';
  el.innerHTML = `
    <div class="dm-wrap">
      <div class="dm-header" style="padding:10px 14px">
        <button class="dm-back-btn" id="gc-back">← Back</button>
        <span class="dm-title">${roomId === 'hub' ? '🌐' : '#'} ${roomName}</span>
      </div>
      <div class="dm-messages" id="gc-room-msgs"><p class="loading-msg">Loading...</p></div>
      <div class="dm-input-row" style="padding:10px 14px">
        <input class="dm-input" id="gc-room-input" type="text" placeholder="Message ${roomName}..." maxlength="300">
        <button class="action-btn play-btn" id="gc-room-send" style="min-width:64px;height:34px;font-size:0.72rem">SEND</button>
      </div>
    </div>
  `;

  const msgEl  = el.querySelector('#gc-room-msgs');
  const input  = el.querySelector('#gc-room-input');
  const sendBtn = el.querySelector('#gc-room-send');

  function appendMsg(m) {
    const isOwn = m.username === myUsername;
    const ts = m.created_at ? m.created_at.slice(11, 16) : '';
    const div = document.createElement('div');
    div.className = `dm-msg ${isOwn ? 'own' : 'other'}`;
    div.innerHTML = !isOwn
      ? `<span class="dm-sender">${escHtml(m.username)}</span><div class="dm-bubble">${escHtml(m.content)}</div><span class="dm-ts">${ts}</span>`
      : `<div class="dm-bubble">${escHtml(m.content)}</div><span class="dm-ts">${ts}</span>`;
    msgEl.appendChild(div);
  }

  async function poll() {
    try {
      const data = await window.hub.get(`/api/chat/hub?since=${lastId}`);
      const msgs = data?.messages || [];
      if (msgs.length) {
        if (lastId === 0) msgEl.innerHTML = '';
        const atBottom = msgEl.scrollHeight - msgEl.scrollTop - msgEl.clientHeight < 60;
        msgs.forEach(m => { appendMsg(m); lastId = Math.max(lastId, m.id); });
        if (atBottom) msgEl.scrollTop = msgEl.scrollHeight;
      } else if (lastId === 0) {
        msgEl.innerHTML = '<p class="empty-msg" style="padding:16px">No messages yet. Say something!</p>';
      }
    } catch {}
    pollTimer = setTimeout(poll, 3000);
  }
  poll();

  el.querySelector('#gc-back').addEventListener('click', () => {
    clearTimeout(pollTimer);
    el.style.overflow = '';
    el.style.padding  = '';
    renderGroupChat(el);
  });

  async function doSend() {
    const content = input.value.trim();
    if (!content) return;
    sendBtn.disabled = true;
    input.value = '';
    try {
      await window.hub.post('/api/chat/hub', { message: content });
    } catch {}
    sendBtn.disabled = false;
    input.focus();
  }

  sendBtn.addEventListener('click', doSend);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });
  input.focus();
}

function buildLeaderboardHTML(data) {
  const rows = data.entries || [];
  const rankColor = r => r === 1 ? '#ffd700' : r === 2 ? '#c0c0c0' : r === 3 ? '#cd7f32' : '#5a5a6a';
  const rankMedal = r => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : null;

  return `
    <div class="alt-header"><h2>LEADERBOARD</h2><p>Top players by total playtime</p></div>
    ${rows.length === 0 ? '<p class="empty-msg">No data yet. Play some servers to appear here!</p>' : ''}
    ${rows.map(e => {
      const rank  = e.rank || 0;
      const medal = rankMedal(rank);
      const clr   = rankColor(rank);
      const isYou = e.isYou || false;
      const top   = e.topServer && e.topServer !== '—' ? e.topServer : null;
      return `
        <div class="leaderboard-row ${isYou ? 'lb-you' : ''}">
          <span class="lb-rank" style="color:${clr}">
            ${medal ? `<span class="lb-medal">${medal}</span>` : `#${rank}`}
          </span>
          <span class="lb-avatar ${isYou ? 'you' : ''}" style="${isYou ? 'border-color:#c8a840;color:#c8a840' : ''}">
            ${(e.username || '?')[0].toUpperCase()}
          </span>
          <div class="lb-info">
            <span class="lb-name">${e.username || '—'}${isYou ? ' <span class="lb-you-tag">you</span>' : ''}</span>
            ${top ? `<span class="lb-top-server">Top: ${top}</span>` : ''}
          </div>
          <span class="lb-time">${formatMinutes(e.totalMinutes || 0)}</span>
        </div>
      `;
    }).join('')}
  `;
}

// ── SERVER DETAIL MODAL ────────────────────────────────────────────────────────

function showServerDetail(server) {
  // Remove any existing detail modal
  document.getElementById('server-detail-overlay')?.remove();

  const isFav       = state.favourites.has(server.name);
  const isInstalled = server.downloaded || false;
  const isOnline    = server.serverOnline === 1;
  const players     = server.hubPlayers || 0;
  const accent      = server.accentColor || '#c8a840';
  const tags        = (server.tags || []);
  const shots       = (server.screenshots || []).slice(0, 6);
  const stars       = server.avgRating ? '★'.repeat(Math.round(server.avgRating)) + '☆'.repeat(5 - Math.round(server.avgRating)) : null;

  const overlay = document.createElement('div');
  overlay.id = 'server-detail-overlay';
  overlay.className = 'sd-overlay';
  overlay.innerHTML = `
    <div class="sd-modal" onclick="event.stopPropagation()">

      <!-- BANNER -->
      <div class="sd-banner" style="background:${bannerColor(server.name)}">
        ${server.bannerUrl
          ? `<img src="${server.bannerUrl}" alt="${server.name}" onerror="this.style.display='none'">`
          : ''}
        <div class="sd-banner-gradient"></div>
        <button class="sd-close" id="sd-close-btn">✕</button>
      </div>

      <!-- HEADER ROW -->
      <div class="sd-header">
        <div class="sd-icon" style="background:${bannerColor(server.name)};border-color:${accent}">
          ${server.iconUrl
            ? `<img src="${escHtml(server.iconUrl)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
               <span style="display:none">${escHtml(server.name[0].toUpperCase())}</span>`
            : `<span>${escHtml(server.name[0].toUpperCase())}</span>`}
        </div>
        <div class="sd-title-block">
          <div class="sd-name-row">
            <h2 class="sd-name">${escHtml(server.name)}</h2>
            <span class="sd-status-dot ${isOnline ? 'online' : 'offline'}" title="${isOnline ? 'Online' : 'Offline'}"></span>
            ${server.isNew ? '<span class="sd-new-badge">NEW</span>' : ''}
          </div>
          <p class="sd-tagline">${escHtml(server.tagline || '')}</p>
          <div class="sd-tags">${tags.map(t => `<span class="tag-pill">${escHtml(String(t).toUpperCase())}</span>`).join('')}</div>
        </div>
      </div>

      <!-- STATS ROW -->
      <div class="sd-stats-row">
        <div class="sd-stat"><span class="sd-stat-val">${players.toLocaleString()}</span><span class="sd-stat-lbl">Hub Players Online</span></div>
        ${server.xpRate ? `<div class="sd-stat"><span class="sd-stat-val">${server.xpRate}</span><span class="sd-stat-lbl">XP Rate</span></div>` : ''}
        ${stars ? `<div class="sd-stat"><span class="sd-stat-val sd-stars" title="${(server.avgRating||0).toFixed(1)}/5">${stars}</span><span class="sd-stat-lbl">${server.reviewCount || 0} Reviews</span></div>` : ''}
      </div>

      <!-- BODY -->
      <div class="sd-body">

        ${server.description ? `
          <div class="sd-section">
            <h3 class="sd-section-title">ABOUT</h3>
            <p class="sd-description">${escHtml(server.description).replace(/\n/g, '<br>')}</p>
          </div>
        ` : ''}

        <div class="sd-section">
          <h3 class="sd-section-title">SCREENSHOTS</h3>
          ${shots.length
            ? `<div class="sd-screenshots">
                ${shots.map(s => `<img src="${escHtml(s)}" alt="Screenshot" class="sd-screenshot" onerror="this.remove()">`).join('')}
              </div>`
            : `<div class="sd-empty-section">No screenshots yet — the server owner hasn't uploaded any.</div>`}
        </div>

        <div class="sd-section">
          <h3 class="sd-section-title">CHANGELOG</h3>
          ${server.changelog
            ? `<div class="sd-changelog">${escHtml(server.changelog).replace(/\n/g, '<br>')}</div>`
            : `<div class="sd-empty-section">No changelog posted yet — check back later for patch notes.</div>`}
        </div>

      </div>

      <!-- FOOTER ACTIONS -->
      <div class="sd-footer">
        <div class="sd-footer-left">
          ${server.discordUrl ? `<button class="sd-link-btn" id="sd-discord-btn">Discord</button>` : ''}
          ${server.websiteUrl ? `<button class="sd-link-btn" id="sd-website-btn">Website</button>` : ''}
        </div>
        <div class="sd-footer-right">
          <button class="sd-link-btn ${isFav ? 'fav-active' : ''}" id="sd-fav-btn" style="min-width:120px">
            ${isFav ? '★ Favourited' : '☆ Favourite'}
          </button>
          <button class="action-btn ${isInstalled ? 'play-btn' : 'install-btn'}" id="sd-play-btn" style="height:36px;font-size:0.72rem;min-width:100px">
            ${isInstalled ? 'PLAY' : 'INSTALL'}
          </button>
        </div>
      </div>

    </div>
  `;

  // Close on overlay click or ESC
  overlay.addEventListener('click', closeServerDetail);
  const escHandler = e => { if (e.key === 'Escape') closeServerDetail(); };
  document.addEventListener('keydown', escHandler);
  overlay._escHandler = escHandler;

  overlay.querySelector('#sd-close-btn').addEventListener('click', e => {
    e.stopPropagation();
    closeServerDetail();
  });

  // External links
  overlay.querySelector('#sd-discord-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    window.hub?.openExternal(server.discordUrl);
  });
  overlay.querySelector('#sd-website-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    window.hub?.openExternal(server.websiteUrl);
  });

  // Favourite toggle
  overlay.querySelector('#sd-fav-btn').addEventListener('click', async e => {
    e.stopPropagation();
    const btn = overlay.querySelector('#sd-fav-btn');
    try {
      await api.toggleFavourite(server.name);
      if (state.favourites.has(server.name)) {
        state.favourites.delete(server.name);
        btn.textContent = '☆ Favourite';
        btn.classList.remove('fav-active');
      } else {
        state.favourites.add(server.name);
        btn.textContent = '★ Favourited';
        btn.classList.add('fav-active');
      }
      renderServers();
    } catch {}
  });

  // Play / Install
  overlay.querySelector('#sd-play-btn').addEventListener('click', async e => {
    e.stopPropagation();
    const btn = overlay.querySelector('#sd-play-btn');
    btn.disabled = true;
    if (isInstalled) {
      btn.textContent = 'Launching...';
      try {
        await api.play(server.name);
        startActiveSessionChip(server.name);
        closeServerDetail();
        if (state.settings?.minimizeOnLaunch) window.hub.minimize();
      } catch { showToast('Failed to launch ' + server.name, 'error'); }
      btn.disabled = false;
      btn.textContent = 'PLAY';
    } else {
      btn.textContent = 'Downloading...';
      btn.classList.remove('install-btn');
      try {
        const result = await api.install(server.name, server.jarUrl);
        if (result?.success) {
          await loadServers();
          closeServerDetail();
        } else {
          showToast('Install failed: ' + (result?.error || 'unknown error'), 'error');
          btn.disabled = false;
          btn.textContent = 'INSTALL';
          btn.classList.add('install-btn');
        }
      } catch (err) {
        showToast('Install failed: ' + (err.message || err), 'error');
        btn.disabled = false;
        btn.textContent = 'INSTALL';
        btn.classList.add('install-btn');
      }
    }
  });

  document.body.appendChild(overlay);
  // Animate in
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function closeServerDetail() {
  const overlay = document.getElementById('server-detail-overlay');
  if (!overlay) return;
  if (overlay._escHandler) document.removeEventListener('keydown', overlay._escHandler);
  overlay.classList.remove('open');
  setTimeout(() => overlay.remove(), 220);
}

// ── SEARCH / FILTER / SORT ────────────────────────────────────────────────────

function setupSearch() {
  const input = document.getElementById('search-input');
  if (!input) return;
  input.addEventListener('input', () => {
    state.search = input.value;
    renderServers();
  });
}

function setupTagFilters() {
  document.querySelectorAll('.tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeTag = btn.dataset.tag;
      renderServers();
    });
  });
}

function setupSort() {
  // Custom dropdown
  const wrap = document.getElementById('custom-sort-wrap');
  const btn  = document.getElementById('custom-sort-btn');
  if (!wrap || !btn) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    wrap.classList.toggle('open');
  });

  wrap.querySelectorAll('.custom-select-option').forEach(opt => {
    opt.addEventListener('click', () => {
      state.sortOrder = opt.dataset.value;
      btn.childNodes[0].textContent = opt.textContent;
      wrap.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      wrap.classList.remove('open');
      renderServers();
    });
  });

  document.addEventListener('click', () => wrap.classList.remove('open'));
}

// ── USER ──────────────────────────────────────────────────────────────────────

function renderUser() {
  const u = state.user;
  const nameEl        = document.getElementById('user-name');
  const initEl        = document.getElementById('user-initial');
  const displaynameEl = document.getElementById('account-displayname');
  const usernameEl    = document.getElementById('account-username');

  if (u) {
    const displayName = state.profile?.displayName || u.username || '';
    if (nameEl)        nameEl.textContent = displayName;
    if (initEl)        initEl.textContent = (displayName || u.username || '?')[0].toUpperCase();
    if (displaynameEl) displaynameEl.textContent = displayName;
    if (usernameEl)    usernameEl.textContent = u.username ? '@' + u.username : '';
    updateNavbarAvatar();
    hideAuthScreen();
  } else {
    if (nameEl) nameEl.textContent = 'Guest';
    if (initEl) initEl.textContent = (state.user?.username || '?')[0].toUpperCase();
    // Reset to login form view
    const loginForm = document.getElementById('auth-screen-login');
    const regForm   = document.getElementById('auth-screen-register');
    if (loginForm) loginForm.style.display = '';
    if (regForm)   regForm.style.display   = 'none';
    showAuthScreen();
  }
}

// Ensures both auth buttons are in their clean "ready to click" state and
// any error banners + password fields are cleared. Call this whenever the
// auth screen is about to become visible OR when toggling between login
// and register views — otherwise a prior in-progress state leaks through.
function resetAuthForms() {
  const loginBtn = document.getElementById('asl-btn');
  if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'LOGIN'; }
  const regBtn = document.getElementById('asr-btn');
  if (regBtn)   { regBtn.disabled   = false; regBtn.textContent   = 'CREATE ACCOUNT'; }
  const loginErr = document.getElementById('asl-err');
  if (loginErr) { loginErr.style.display = 'none'; loginErr.textContent = ''; }
  const regErr = document.getElementById('asr-err');
  if (regErr)   { regErr.style.display   = 'none'; regErr.textContent   = ''; }
  // Clear password fields (but leave username — users expect that to persist)
  const loginPass = document.getElementById('asl-pass');
  if (loginPass) loginPass.value = '';
  const regPass = document.getElementById('asr-pass');
  if (regPass)   regPass.value   = '';
}

function showAuthScreen() {
  const el = document.getElementById('auth-screen');
  if (!el) return;
  el.style.display = 'flex';
  el.classList.remove('hidden');
  resetAuthForms();
  // Reuse splash canvas particle system for auth screen
  const canvas = document.getElementById('auth-canvas');
  if (canvas && !canvas._animating) {
    canvas._animating = true;
    const ctx = canvas.getContext('2d');
    const particles = [];
    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    resize();
    window.addEventListener('resize', resize);
    class P {
      constructor() { this.reset(true); }
      reset(init) {
        this.x = Math.random() * canvas.width;
        this.y = init ? Math.random() * canvas.height : canvas.height + 10;
        this.size = Math.random() * 1.6 + 0.3;
        this.vy = -(Math.random() * 0.55 + 0.18);
        this.vx = (Math.random() - 0.5) * 0.25;
        this.life = 0; this.maxLife = Math.random() * 180 + 120;
        this.hue = 38 + Math.random() * 16;
      }
      update() { this.x += this.vx; this.y += this.vy; this.life++; if (this.life > this.maxLife || this.y < -10) this.reset(false); }
      draw() {
        const a = Math.sin((this.life / this.maxLife) * Math.PI) * 0.65;
        ctx.save(); ctx.globalAlpha = a;
        ctx.fillStyle = `hsl(${this.hue},70%,60%)`; ctx.shadowColor = `hsl(${this.hue},80%,65%)`; ctx.shadowBlur = 5;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    }
    for (let i = 0; i < 110; i++) particles.push(new P());
    (function loop() { ctx.clearRect(0,0,canvas.width,canvas.height); particles.forEach(p=>{p.update();p.draw();}); if(canvas._animating) requestAnimationFrame(loop); })();
  }
  // Focus username field
  setTimeout(() => document.getElementById('asl-user')?.focus(), 100);
}

function hideAuthScreen() {
  const el = document.getElementById('auth-screen');
  if (!el) return;
  el.classList.add('hidden');
  const canvas = document.getElementById('auth-canvas');
  if (canvas) canvas._animating = false;
  setTimeout(() => { el.style.display = 'none'; }, 520);
}

function setupAuthForms() {
  // Pre-fill remember me from saved preference, and save on change immediately
  const rememberEl = document.getElementById('asl-remember');
  if (rememberEl) {
    const saved = localStorage.getItem('rsps_hub_remember');
    rememberEl.checked = saved === null ? true : saved === 'true';
    rememberEl.addEventListener('change', () => {
      localStorage.setItem('rsps_hub_remember', rememberEl.checked);
    });
  }

  // Toggle login ↔ register. Also reset button + error state every flip so
  // a stale "SIGNING IN…" / "CREATING…" never leaks between the two views.
  document.getElementById('asl-to-reg')?.addEventListener('click', () => {
    resetAuthForms();
    document.getElementById('auth-screen-login').style.display    = 'none';
    document.getElementById('auth-screen-register').style.display = '';
    document.getElementById('asr-user')?.focus();
  });
  document.getElementById('asr-to-login')?.addEventListener('click', () => {
    resetAuthForms();
    document.getElementById('auth-screen-register').style.display = 'none';
    document.getElementById('auth-screen-login').style.display    = '';
    document.getElementById('asl-user')?.focus();
  });

  // Show/hide password toggles
  function togglePass(inputId, btnId) {
    const btn = document.getElementById(btnId);
    const inp = document.getElementById(inputId);
    if (!btn || !inp) return;
    btn.addEventListener('click', () => {
      const hidden = inp.type === 'password';
      inp.type = hidden ? 'text' : 'password';
      btn.textContent = hidden ? 'HIDE' : 'SHOW';
    });
  }
  togglePass('asl-pass', 'asl-show');
  togglePass('asr-pass', 'asr-show');

  // After successful auth: hide screen, start services.
  // Anything that talks to main/Java is best-effort — if the main process is
  // running older preload.js without a new IPC handler, we don't want to
  // deadlock the sign-in button. Wrap each call defensively.
  const onAuthSuccess = async (res, isNew) => {
    state.user = { username: res.username, token: res.token, isStaff: !!res.isStaff };
    // Scope per-user caches BEFORE loading them (best effort — old main.js
    // without this handler just silently returns undefined, which is fine).
    try { if (window.hub.setActiveUser) await window.hub.setActiveUser(res.username); } catch {}
    // Wipe in-memory caches that belonged to whoever was logged in last.
    for (const k of Object.keys(DM_STORE)) delete DM_STORE[k];
    state.favourites.clear();
    try { await dmStoreLoad(); } catch {}
    try { if (window.reloadMusicPrefs) await window.reloadMusicPrefs(); } catch {}
    try { state.profile = await window.hub.getProfile(res.username); } catch { state.profile = null; }
    renderUser();
    hideAuthScreen();
    closeAllDropdowns();
    startHeartbeat(); startMessagePolling(); startFriendRequestPolling();
    startFriendOnlinePolling(); startAnnouncementPolling();
    // Kick off background prefetch for expensive tab data so the first
    // click on Stats / Friends / Chat renders instantly from cache.
    prefetchTabs();
    showToast(isNew ? 'Welcome, ' + res.username + '!' : 'Welcome back, ' + res.username + '!', 'success');
  };

  // Login
  const doLogin = async () => {
    const btn      = document.getElementById('asl-btn');
    const user     = document.getElementById('asl-user')?.value.trim();
    const pass     = document.getElementById('asl-pass')?.value;
    const err      = document.getElementById('asl-err');
    const remember = document.getElementById('asl-remember')?.checked ?? true;
    localStorage.setItem('rsps_hub_remember', remember);
    err.style.display = 'none';
    if (!user || !pass) { err.textContent = 'Enter your username and password.'; err.style.display = ''; return; }
    btn.disabled = true; btn.textContent = 'SIGNING IN…';
    try {
      const res = await window.hub.post('/api/auth/login', { username: user, password: pass, remember });
      if (res?.error) throw new Error(res.error);
      // Await so any failure inside onAuthSuccess reaches the catch block
      // below and the button gets reset instead of stuck on "SIGNING IN…".
      await onAuthSuccess(res, false);
    } catch (e) {
      err.textContent = e.message || 'Login failed.';
      err.style.display = '';
      btn.disabled = false; btn.textContent = 'LOGIN';
    }
  };
  document.getElementById('asl-btn')?.addEventListener('click', doLogin);
  document.getElementById('asl-pass')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('asl-user')?.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('asl-pass')?.focus(); });

  // Register
  const doRegister = async () => {
    const btn   = document.getElementById('asr-btn');
    const user  = document.getElementById('asr-user')?.value.trim();
    const email = document.getElementById('asr-email')?.value.trim();
    const pass  = document.getElementById('asr-pass')?.value;
    const err   = document.getElementById('asr-err');
    err.style.display = 'none';
    if (!user || !pass) { err.textContent = 'Username and password are required.'; err.style.display = ''; return; }
    btn.disabled = true; btn.textContent = 'CREATING…';
    try {
      const res = await window.hub.post('/api/auth/register', { username: user, password: pass, email });
      if (res?.error) throw new Error(res.error);
      onAuthSuccess(res, true);
    } catch (e) {
      err.textContent = e.message || 'Registration failed.';
      err.style.display = '';
      btn.disabled = false; btn.textContent = 'CREATE ACCOUNT';
    }
  };
  document.getElementById('asr-btn')?.addEventListener('click', doRegister);
  document.getElementById('asr-pass')?.addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });
}

// ── LOADING ───────────────────────────────────────────────────────────────────

function showLoading(on) {
  const el = document.getElementById('loading-indicator');
  if (el) el.style.display = on ? '' : 'none';
}

// ── UTILS ─────────────────────────────────────────────────────────────────────

// ── TOAST ─────────────────────────────────────────────────────────────────────

function showToast(msg, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('toast-show'), 10);
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ── PLAYTIME STATUS BAR ───────────────────────────────────────────────────────

function updatePlaytimeStatus() {
  const el = document.getElementById('status-playtime');
  if (!el) return;
  const totalMins = Object.values(state.playtime).reduce((a, m) => a + m, 0);
  el.textContent = '⏱ Total: ' + (totalMins > 0 ? formatMinutes(Math.round(totalMins)) : '—');
}

let _activeSessionInterval = null;

function startActiveSessionChip(serverName) {
  const chip   = document.getElementById('active-session-chip');
  const nameEl = document.getElementById('active-session-name');
  const timeEl = document.getElementById('active-session-time');
  if (!chip) return;

  if (_activeSessionInterval) clearInterval(_activeSessionInterval);

  nameEl.textContent = serverName;
  timeEl.textContent = '0:00:00';
  chip.style.display = 'flex';

  // Give the VPS a few seconds to register our session_start, then refresh
  // the server list so our own card shows +1 Hub Player without waiting
  // for the next normal poll cycle.
  setTimeout(() => { loadServers().catch(() => {}); }, 4000);

  // Poll the Java backend — it tracks the real process tree and clears
  // activeSession only when ALL spawned processes (including child JARs) have exited.
  _activeSessionInterval = setInterval(async () => {
    try {
      const status = await window.hub.get('/api/session/status');
      if (!status.active) {
        // Game has fully closed — stop chip and refresh everything that
        // might have updated server-side (playtime, hub_players, stats).
        clearInterval(_activeSessionInterval);
        _activeSessionInterval = null;
        chip.style.display = 'none';
        try {
          const pt = await api.getPlaytime();
          if (pt && pt.perServer) state.playtime = pt.perServer;
          updatePlaytimeStatus();
          // Pull fresh server list from VPS (new hub_players, per-server totals)
          await loadServers();
          // If the Stats tab is currently the active panel, re-render it
          // so totals/heatmap/top-servers reflect the just-ended session.
          const activePanel = document.querySelector('.rs-tab.active')?.dataset?.panel;
          const altContent  = document.getElementById('alt-content');
          if (activePanel === 'stats' && altContent && window.renderStats) {
            window.renderStats(altContent);
          } else if (activePanel === 'achievements' && altContent && window.renderAchievements) {
            window.renderAchievements(altContent);
          }
        } catch {}
        return;
      }
      // Update timer from server-side elapsed time (not local clock)
      const secs = Math.floor(status.elapsedMs / 1000);
      const h    = Math.floor(secs / 3600);
      const m    = Math.floor((secs % 3600) / 60);
      const s    = secs % 60;
      const pad  = n => String(n).padStart(2, '0');
      timeEl.textContent = `${h}:${pad(m)}:${pad(s)}`;
    } catch {}
  }, 2000);
}

// ── TAB NOTIFICATION BADGES ───────────────────────────────────────────────────

const _unread = { chat: 0, groupchat: 0 };

function addUnread(panel, count = 1) {
  // Don't badge if that panel is already open
  const activePanel = document.querySelector('.rs-tab.active')?.dataset?.panel;
  if (activePanel === panel) return;
  _unread[panel] = (_unread[panel] || 0) + count;
  updateBadge(panel);
}

function clearUnread(panel) {
  _unread[panel] = 0;
  updateBadge(panel);
}

function updateBadge(panel) {
  const badge = document.getElementById(`badge-${panel}`);
  if (!badge) return;
  const n = _unread[panel] || 0;
  if (n > 0) {
    badge.textContent = n > 99 ? '99+' : n;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

// ── INCOMING MESSAGE POLLING ──────────────────────────────────────────────────
// ── NOTIFICATION SYSTEM ──────────────────────────────────────────────────────

const NOTIF_STORE = []; // { id, type, title, msg, ts, read }
let _notifNextId  = 1;

const NOTIF_ICONS = {
  'friend-request': '👤',
  'server-update':  '📢',
  'friend-online':  '🟢',
  'message':        '💬',
  'system':         '📣',
};

function pushNotif(type, title, msg) {
  NOTIF_STORE.unshift({ id: _notifNextId++, type, title, msg, ts: Date.now(), read: false });
  if (NOTIF_STORE.length > 50) NOTIF_STORE.length = 50;
  updateNotifBadge();
  renderNotifDropdown();
  showToast(`${NOTIF_ICONS[type] || '🔔'} ${msg}`, 'info');
}

function updateNotifBadge() {
  const badge  = document.getElementById('notif-badge');
  if (!badge) return;
  const unread = NOTIF_STORE.filter(n => !n.read).length;
  badge.textContent = unread > 99 ? '99+' : String(unread);
  badge.style.display = unread > 0 ? '' : 'none';
}

function markNotifsRead() {
  NOTIF_STORE.forEach(n => n.read = true);
  updateNotifBadge();
  renderNotifDropdown();
}

function clearAllNotifs() {
  NOTIF_STORE.length = 0;
  updateNotifBadge();
  renderNotifDropdown();
}

function notifTimeAgo(ts) {
  const d = Date.now() - ts;
  if (d < 60_000)       return 'Just now';
  if (d < 3_600_000)    return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000)   return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

function renderNotifDropdown() {
  const list = document.getElementById('notif-list');
  if (!list) return;
  if (!NOTIF_STORE.length) {
    list.innerHTML = `
      <div class="coming-soon-wrap" style="padding:24px 16px">
        <span class="coming-soon-icon" style="font-size:1.8rem">🔔</span>
        <span class="coming-soon-title" style="font-size:0.85rem">No notifications</span>
        <span class="coming-soon-sub">You're all caught up</span>
      </div>`;
    return;
  }
  list.innerHTML = NOTIF_STORE.map(n => `
    <div class="notif-item${n.read ? '' : ' notif-unread'}">
      <div class="notif-icon-wrap">${NOTIF_ICONS[n.type] || '🔔'}</div>
      <div class="notif-body">
        <div class="notif-title">${escHtml(n.title)}</div>
        <div class="notif-msg">${escHtml(n.msg)}</div>
        <div class="notif-time">${notifTimeAgo(n.ts)}</div>
      </div>
    </div>
  `).join('');
}

// Seed mock notifications for testing
function seedMockNotifications() {
  const mocks = [
    { type: 'system',         title: 'Welcome to RSPS Hub',      msg: 'v1.0.1 is live — enjoy the new launcher!',               ts: Date.now() - 2   * 60_000,    read: false },
    { type: 'friend-request', title: 'Friend Request',           msg: 'Zezima sent you a friend request',                       ts: Date.now() - 8   * 60_000,    read: false },
    { type: 'server-update',  title: 'Exora',                    msg: 'New update posted — check the changelog',                 ts: Date.now() - 25  * 60_000,    read: false },
    { type: 'message',        title: 'New Message',              msg: 'SlothUIM: hey are you online?',                           ts: Date.now() - 1   * 3_600_000, read: true  },
    { type: 'server-update',  title: 'Arios',                    msg: 'New update posted — check the changelog',                 ts: Date.now() - 3   * 3_600_000, read: true  },
    { type: 'system',         title: 'Scheduled Maintenance',    msg: 'Hub servers will be down briefly tonight at 2AM UTC',     ts: Date.now() - 5   * 3_600_000, read: true  },
  ];
  for (const m of mocks) {
    NOTIF_STORE.push({ id: _notifNextId++, ...m });
  }
  updateNotifBadge();
  renderNotifDropdown();
}

// ── FRIEND ONLINE POLLING ─────────────────────────────────────────────────────

const _knownFriendsOnline = new Set();
let   _friendOnlineInit   = false;

function startFriendOnlinePolling() {
  const poll = async () => {
    if (!state.user?.username) return;
    if (state.settings?.notifFriendOnline === false) return;
    try {
      const data = await api.getFriends().catch(() => null);
      const nowOnline = new Set(
        (data?.friends || []).filter(f => f.online).map(f => f.username)
      );
      if (_friendOnlineInit) {
        for (const username of nowOnline) {
          if (!_knownFriendsOnline.has(username)) {
            pushNotif('friend-online', 'Friend Online', `${username} is now online`);
          }
        }
      }
      _knownFriendsOnline.clear();
      nowOnline.forEach(u => _knownFriendsOnline.add(u));
      _friendOnlineInit = true;
    } catch {}
  };
  setTimeout(poll, 8_000);
  setInterval(poll, 60_000);
}

// ── ANNOUNCEMENT POLLING ──────────────────────────────────────────────────────

const _knownAnnouncementIds = new Set();
let   _announcementInit     = false;

function startAnnouncementPolling() {
  const poll = async () => {
    if (!state.user?.username) return;
    if (state.settings?.notifSystem === false) return;
    try {
      const data = await fetch('https://api.therspshub.com/api/announcements/list.php').then(r => r.json()).catch(() => null);
      for (const a of (data?.announcements || [])) {
        if (!a.id) continue;
        if (!_knownAnnouncementIds.has(a.id)) {
          _knownAnnouncementIds.add(a.id);
          if (_announcementInit) {
            pushNotif('system', a.title || 'Hub Announcement', a.message || '');
          }
        }
      }
      _announcementInit = true;
    } catch {}
  };
  setTimeout(poll, 12_000);
  setInterval(poll, 120_000); // every 2 minutes
}

// ── FRIEND REQUEST POLLING ────────────────────────────────────────────────────

const _knownFriendRequests = new Set(); // usernames we've already notified about

function startFriendRequestPolling() {
  const poll = async () => {
    if (!state.user?.username) return;
    if (state.settings?.notifFriendRequests === false) return;
    try {
      const data = await api.getFriendRequests().catch(() => null);
      for (const r of (data?.requests || [])) {
        const who = r.username || r.from_user || r.sender;
        if (who && !_knownFriendRequests.has(who)) {
          _knownFriendRequests.add(who);
          pushNotif('friend-request', 'Friend Request', `${who} sent you a friend request`);
        }
      }
    } catch {}
  };
  setTimeout(poll, 5_000); // first check 5s after login
  setInterval(poll, 60_000);
}

// ── SERVER UPDATE TRACKING ────────────────────────────────────────────────────

const _serverChangelogs = {}; // { name: changelog } — previous known state
let   _serverChangelogsInit = false;

function checkServerUpdates(servers) {
  if (state.settings?.notifServerUpdates === false) return;
  for (const s of servers) {
    if (!s.name) continue;
    const prev = _serverChangelogs[s.name];
    // Only fire on change, not on first load (avoid flooding on boot)
    if (_serverChangelogsInit && prev !== undefined && s.changelog && prev !== s.changelog) {
      pushNotif('server-update', s.name, 'New update posted — check the changelog');
    }
    _serverChangelogs[s.name] = s.changelog || '';
  }
  _serverChangelogsInit = true;
}

// Polls every 30s for new messages and badges the chat tab if any arrive.

function startMessagePolling() {
  setInterval(async () => {
    // Skip if not logged in
    if (!state.user?.username) return;
    try {
      const data = await api.getConversations().catch(() => null);
      if (!data?.conversations?.length) return;
      let newCount = 0;
      for (const c of data.conversations) {
        const username = c.username || c.with_user || c.other_user;
        if (!username) continue;
        // `last_message` from the conversations endpoint is whichever message
        // is newest — could be ours or theirs. We CANNOT assume it's incoming,
        // so never merge it into DM_STORE (that was the "hey copied from me to
        // them" bug). Only badge based on the server's `unread` count, which
        // is specifically messages where receiver=me AND is_read=0.
        const unread = parseInt(c.unread || '0', 10) || 0;
        if (unread <= 0) continue;
        const activePanel = document.querySelector('.rs-tab.active')?.dataset?.panel;
        if (activePanel === 'chat' && state.activeDM === username) continue;
        newCount += unread;
      }
      if (newCount > 0) addUnread('chat', newCount);
    } catch {}
  }, 30_000);
}

let _heartbeatInterval = null;
let _cachedVersion = null;
async function collectHeartbeatMeta() {
  try {
    if (!_cachedVersion) _cachedVersion = await window.hub.getVersion();
  } catch {}
  const meta = {};
  if (_cachedVersion) meta.version = _cachedVersion;
  // Current tab: pull from live DOM if available, else from state
  const domTab = document.querySelector('.rs-tab.active')?.dataset?.tab;
  const tab = domTab || state.activeTab;
  if (tab) meta.tab = tab;
  // Music: only report if actively playing (not paused)
  try {
    const M = window.RH_MUSIC;
    if (M && M.current && !M.paused) {
      const name = M.current.name || '';
      const cat  = M.current.category ? ` (${M.current.category})` : '';
      if (name) meta.music = (name + cat).slice(0, 120);
    }
  } catch {}
  return meta;
}
function startHeartbeat() {
  if (_heartbeatInterval) return;
  const ping = async () => {
    try {
      const meta = await collectHeartbeatMeta();
      await window.hub.post('/api/heartbeat', meta);
    } catch {}
  };
  ping();
  _heartbeatInterval = setInterval(ping, 60_000);
}

function startSessionTimer() {
  const el    = document.getElementById('status-session');
  if (!el) return;
  const start = Date.now();
  setInterval(() => {
    const secs  = Math.floor((Date.now() - start) / 1000);
    const h     = Math.floor(secs / 3600);
    const m     = Math.floor((secs % 3600) / 60);
    const s     = secs % 60;
    const pad   = n => String(n).padStart(2, '0');
    el.textContent = h > 0
      ? `⌛ Session: ${pad(h)}:${pad(m)}:${pad(s)}`
      : `⌛ Session: ${pad(m)}:${pad(s)}`;
  }, 1000);
}

// ── DEVELOPER PORTAL ─────────────────────────────────────────────────────────

// Canonical tag list shown as checkboxes in the dev portal. Any tag on a
// server that isn't in this list still shows up as a checkbox (pre-checked)
// so saving never accidentally wipes something the server already had.
const DEV_TAGS_LIST = [
  'OSRS', 'Pre-EOC', 'EOC', 'Custom',
  'PvM', 'PvP', 'Economy', 'Gambling',
  'Ironman', 'Group Ironman', 'Hardcore', 'Leagues',
  'Skilling', 'Raids', 'Bossing', 'Minigames',
  'Vanilla', '1x XP', 'High XP',
  'RuneLite', 'Mobile',
];
const XP_RATES = ['1x','5x','10x','25x','50x','100x','Custom/Varies'];

let _devPortalEl  = null;
let _devIsStaff   = false;

async function openDevPortal(startSection = 'my-servers') {
  if (_devPortalEl) return;
  // TODO: Before launch, remove the `|| true` so only real staff see staff sections
  try {
    const check = await window.hub.get('/api/dev/check');
    _devIsStaff = !!(check?.isStaff ?? state.user?.isStaff);
  } catch {
    _devIsStaff = !!state.user?.isStaff;
  }

  const overlay = document.createElement('div');
  overlay.id        = 'dev-portal-overlay';
  overlay.className = 'dp-overlay';
  overlay.innerHTML = buildDevPortalShell(_devIsStaff);
  document.body.appendChild(overlay);
  _devPortalEl = overlay;

  overlay.querySelector('#dp-close').addEventListener('click', closeDevPortal);

  overlay.querySelectorAll('.dp-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      overlay.querySelectorAll('.dp-nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      devPortalLoadSection(item.dataset.section);
    });
  });

  // Activate the correct nav item for the start section
  overlay.querySelectorAll('.dp-nav-item').forEach(i => {
    i.classList.toggle('active', i.dataset.section === startSection);
  });
  devPortalLoadSection(startSection);
}

function closeDevPortal() {
  _devPortalEl?.remove();
  _devPortalEl = null;
}

function buildDevPortalShell(isStaff) {
  return `
<div class="dp-container">
  <div class="dp-sidebar">
    <div class="dp-sidebar-hdr"><span class="dp-sidebar-icon">⚒</span> Dev Portal</div>
    <nav class="dp-nav">
      <div class="dp-nav-label">MY LISTING</div>
      <div class="dp-nav-item active" data-section="my-servers">My Servers</div>
      <div class="dp-nav-item" data-section="submit">Submit New Server</div>
      <div class="dp-nav-item" data-section="claim">Claim a Listing</div>
      ${isStaff ? `
      <div class="dp-nav-label" style="margin-top:16px">STAFF</div>
      <div class="dp-nav-item" data-section="pending">Pending Submissions</div>
      <div class="dp-nav-item" data-section="all-servers">All Servers</div>
      <div class="dp-nav-item" data-section="announcements">Post Announcement</div>
      ` : ''}
    </nav>
  </div>
  <div class="dp-content" id="dp-content"></div>
  <button class="dp-close-btn" id="dp-close">✕</button>
</div>`;
}

async function devPortalLoadSection(section) {
  const el = document.getElementById('dp-content');
  if (!el) return;
  el.innerHTML = '<p class="loading-msg">Loading…</p>';
  try {
    switch (section) {
      case 'my-servers': {
        const d = await window.hub.get('/api/dev/my-servers');
        renderDevServerList(el, d.servers || [], false);
        break;
      }
      case 'submit':
        renderDevEditor(el, null);
        break;
      case 'claim':
        renderDevClaim(el);
        break;
      case 'pending': {
        const d = await window.hub.get('/api/dev/pending');
        if (!d.servers?.length && d.error) {
          el.innerHTML = `
            <div class="dp-section-hdr">Pending Submissions</div>
            <div class="coming-soon-wrap" style="padding:40px 20px">
              <span class="coming-soon-icon">⚠️</span>
              <span class="coming-soon-title">API Error</span>
              <span class="coming-soon-sub" style="font-family:monospace;font-size:0.7rem;word-break:break-all;max-width:480px;display:block;margin:8px auto 0">${escHtml(d.error)}</span>
            </div>`;
        } else {
          renderDevPending(el, d.servers || []);
        }
        break;
      }
      case 'all-servers': {
        const d = await window.hub.get('/api/dev/all-servers');
        if (!d.servers?.length && d.error) {
          el.innerHTML = `
            <div class="dp-section-hdr">All Servers</div>
            <div class="coming-soon-wrap" style="padding:40px 20px">
              <span class="coming-soon-icon">⚠️</span>
              <span class="coming-soon-title">API Error</span>
              <span class="coming-soon-sub" style="font-family:monospace;font-size:0.7rem;word-break:break-all;max-width:480px;display:block;margin:8px auto 0">${escHtml(d.error)}</span>
            </div>`;
        } else {
          renderDevServerList(el, d.servers || [], true, d.fallback ? d.fallbackReason : null);
        }
        break;
      }
      case 'announcements':
        renderDevAnnouncements(el);
        break;
    }
  } catch (e) {
    el.innerHTML = `<p class="empty-msg" style="padding:30px">Failed to load: ${escHtml(e.message)}</p>`;
  }
}

function renderDevServerList(el, servers, isAll, fallbackReason) {
  const title = isAll ? 'All Servers' : 'My Servers';
  if (!servers.length) {
    el.innerHTML = `
      <div class="dp-section-hdr">${title}</div>
      <div class="coming-soon-wrap" style="padding:50px 20px">
        <span class="coming-soon-icon">🏰</span>
        <span class="coming-soon-title">No Servers</span>
        <span class="coming-soon-sub">${isAll ? 'No servers in the database.' : 'You haven\'t submitted any servers yet.<br>Use "Submit New Server" to get started.'}</span>
      </div>`;
    return;
  }
  const fallbackBanner = fallbackReason
    ? `<div style="background:#2a1800;border:1px solid #8b5e00;border-radius:6px;padding:8px 14px;margin-bottom:12px;font-size:0.72rem;color:#c8a840">
        ⚠️ <strong>servers/all.php unavailable</strong> — showing live servers from list.php instead.<br>
        <span style="opacity:0.7">${escHtml(fallbackReason)}</span>
       </div>`
    : '';
  el.innerHTML = `
    <div class="dp-section-hdr">${title}</div>
    ${fallbackBanner}
    <div class="dp-server-list">
      ${servers.map(s => `
        <div class="dp-server-row">
          <div class="dp-server-icon" style="${s.iconUrl ? `background-image:url(${escHtml(s.iconUrl)});background-size:cover;background-position:center` : ''}">
            ${!s.iconUrl ? escHtml(s.name?.[0]?.toUpperCase() || '?') : ''}
          </div>
          <div class="dp-server-info">
            <div class="dp-server-name">${escHtml(s.name)}</div>
            <div class="dp-server-badges">
              <span class="dp-badge ${s.approved ? 'dp-badge-ok' : 'dp-badge-warn'}">${s.approved ? 'Approved' : 'Pending'}</span>
              <span class="dp-badge ${s.serverOnline === 1 ? 'dp-badge-ok' : 'dp-badge-off'}">${s.serverOnline === 1 ? 'Online' : 'Offline'}</span>
              ${s.hubPlayers > 0 ? `<span class="dp-badge">${s.hubPlayers} hub players</span>` : ''}
              ${s.xpRate ? `<span class="dp-badge">${escHtml(s.xpRate)}</span>` : ''}
            </div>
          </div>
          <button class="dp-edit-btn" data-id="${s.id}">Edit</button>
        </div>
      `).join('')}
    </div>`;

  el.querySelectorAll('.dp-edit-btn').forEach(btn => {
    const srv = servers.find(s => s.id === parseInt(btn.dataset.id));
    btn.addEventListener('click', () => { if (srv) renderDevEditor(el, srv); });
  });
}

function renderDevPending(el, servers) {
  el.innerHTML = `<div class="dp-section-hdr">Pending Submissions</div>`;
  if (!servers.length) {
    el.innerHTML += `<p class="empty-msg" style="padding:30px;text-align:center">No pending submissions 🎉</p>`;
    return;
  }
  const list = document.createElement('div');
  list.className = 'dp-server-list';
  list.innerHTML = servers.map(s => `
    <div class="dp-pending-row" data-id="${s.id}">
      <div class="dp-pending-info">
        <div class="dp-server-name">${escHtml(s.name)}</div>
        <div class="dp-pending-desc">${escHtml((s.description || '').slice(0, 120))}${(s.description?.length || 0) > 120 ? '…' : ''}</div>
        <div class="dp-pending-meta">
          ${s.xpRate ? `<span>${escHtml(s.xpRate)} XP</span>` : ''}
          ${s.submittedBy ? `<span>by ${escHtml(s.submittedBy)}</span>` : ''}
          ${s.jarUrl ? `<span class="dp-jar-url">${escHtml(s.jarUrl.slice(0,40))}…</span>` : ''}
        </div>
      </div>
      <div class="dp-pending-btns">
        <button class="dp-approve-btn" data-id="${s.id}">✓ Approve</button>
        <button class="dp-reject-btn"  data-id="${s.id}">✗ Reject</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.dp-approve-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = 'Approving…';
      try {
        await window.hub.post('/api/dev/approve', { id: parseInt(btn.dataset.id) });
        btn.closest('.dp-pending-row').remove();
        showToast('Server approved!', 'success');
      } catch { btn.disabled = false; btn.textContent = '✓ Approve'; showToast('Failed to approve', 'error'); }
    });
  });
  list.querySelectorAll('.dp-reject-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = 'Rejecting…';
      try {
        await window.hub.post('/api/dev/reject', { id: parseInt(btn.dataset.id) });
        btn.closest('.dp-pending-row').remove();
        showToast('Server rejected.', 'info');
      } catch { btn.disabled = false; btn.textContent = '✗ Reject'; showToast('Failed to reject', 'error'); }
    });
  });
  el.appendChild(list);
}

async function renderDevAnnouncements(el) {
  let recent = [];
  try {
    const d = await fetch('https://api.therspshub.com/api/announcements/list.php').then(r => r.json()).catch(() => null);
    recent = d?.announcements || [];
  } catch {}

  el.innerHTML = `
    <div class="dp-section-hdr">Post Announcement</div>
    <div style="display:flex;gap:20px;align-items:flex-start">
      <!-- Form -->
      <div class="dp-form" style="flex:1;min-width:0">
        <div class="dp-field">
          <label class="dp-label">Title <span class="dp-req">*</span></label>
          <input class="dp-input" id="ann-title" type="text" placeholder="e.g. Scheduled Maintenance Tonight" maxlength="120">
        </div>
        <div class="dp-field">
          <label class="dp-label">Message <span class="dp-req">*</span></label>
          <textarea class="dp-input dp-textarea" id="ann-msg" rows="5" placeholder="Write your announcement here..." maxlength="1000" style="resize:vertical"></textarea>
        </div>
        <div class="dp-form-footer">
          <button class="dp-submit-btn" id="ann-post-btn">📣 Post Announcement</button>
        </div>
      </div>
      <!-- Live Preview -->
      <div style="width:300px;flex-shrink:0">
        <div style="font-family:'Cinzel',serif;font-size:0.62rem;color:#5a4a28;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">Live Preview</div>
        <div id="ann-preview" style="background:#1a1408;border:1px solid #2e2410;border-radius:6px;overflow:hidden">
          <div class="news-card" style="margin:0;border:none;border-radius:0">
            <div class="news-card-header">
              <div class="news-server-icon" style="background:linear-gradient(135deg,#c8a840,#8a6820);color:#fff;font-family:'Cinzel',serif;font-weight:700">H</div>
              <div class="news-server-meta">
                <span class="news-server-name" id="ann-prev-title" style="font-style:italic;color:#8a7050">Enter a title…</span>
                <span class="news-server-tag">HUB ANNOUNCEMENT</span>
              </div>
            </div>
            <div class="news-body" id="ann-prev-body" style="color:#6a5a3a;font-style:italic">Your message will appear here…</div>
          </div>
        </div>
      </div>
    </div>

    <div class="dp-section-hdr" style="margin-top:24px">Recent Announcements</div>
    <div id="ann-recent-list" style="max-height:400px;overflow-y:auto">
      ${!recent.length
        ? `<p class="empty-msg" style="padding:16px 0">No announcements yet.</p>`
        : recent.map(a => `
          <div class="dp-pending-row" style="flex-direction:column;align-items:flex-start;gap:4px" data-id="${a.id}">
            <div style="display:flex;align-items:center;gap:8px;width:100%">
              <span style="color:#c8a840;font-family:'Cinzel',serif;font-size:0.75rem;font-weight:700">${escHtml(a.title)}</span>
              <span style="color:#5a4a28;font-size:0.6rem;margin-left:auto">${escHtml(a.created_at || '')}</span>
              <button class="dp-reject-btn ann-delete-btn" style="padding:2px 8px;font-size:0.6rem" data-id="${a.id}">Delete</button>
            </div>
            <p style="color:#9a8a6a;font-size:0.72rem;margin:0;line-height:1.5;white-space:pre-wrap">${escHtml(a.message)}</p>
          </div>`).join('')}
    </div>`;

  // Live preview update
  const titleIn = el.querySelector('#ann-title');
  const msgIn   = el.querySelector('#ann-msg');
  const prevTitle = el.querySelector('#ann-prev-title');
  const prevBody  = el.querySelector('#ann-prev-body');
  const updatePreview = () => {
    const t = titleIn.value.trim();
    const m = msgIn.value.trim();
    prevTitle.textContent = t || 'Enter a title…';
    prevTitle.style.color  = t ? '#d4c090' : '#8a7050';
    prevTitle.style.fontStyle = t ? 'normal' : 'italic';
    prevBody.textContent  = m || 'Your message will appear here…';
    prevBody.style.color  = m ? '#9a8a6a' : '#6a5a3a';
    prevBody.style.fontStyle = m ? 'normal' : 'italic';
  };
  titleIn.addEventListener('input', updatePreview);
  msgIn.addEventListener('input', updatePreview);

  el.querySelector('#ann-post-btn').addEventListener('click', async () => {
    const btn   = el.querySelector('#ann-post-btn');
    const title = titleIn.value.trim();
    const msg   = msgIn.value.trim();
    if (!title || !msg) { showToast('Title and message are required', 'error'); return; }
    btn.disabled = true; btn.textContent = 'Posting…';
    try {
      const res = await window.hub.post('/api/announcements', { title, message: msg });
      if (res?.error) throw new Error(res.error);
      showToast('Announcement posted!', 'success');
      renderDevAnnouncements(el);
    } catch (e) {
      showToast('Failed: ' + e.message, 'error');
      btn.disabled = false; btn.textContent = '📣 Post Announcement';
    }
  });

  el.querySelectorAll('.ann-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await window.hub.post('/api/announcements/delete', { id: parseInt(btn.dataset.id) });
        btn.closest('[data-id]').remove();
        showToast('Deleted.', 'info');
      } catch { btn.disabled = false; showToast('Failed to delete', 'error'); }
    });
  });
}

function renderDevClaim(el) {
  el.innerHTML = `
    <div class="dp-section-hdr">Claim a Listing</div>
    <p class="dp-claim-desc">If your server already appears in RSPS Hub but you didn't submit it, verify ownership and claim it below.</p>
    <div class="dp-form">
      <div class="dp-field">
        <label class="dp-label">Server Name <span class="dp-req">*</span></label>
        <input class="dp-input" id="claim-name" type="text" placeholder="Exact name as shown in the Hub">
      </div>
      <div class="dp-field">
        <label class="dp-label">Verification URL <span class="dp-req">*</span></label>
        <input class="dp-input" id="claim-verify" type="text" placeholder="Your website domain or Discord invite URL">
        <span class="dp-hint">We'll verify you control this domain or Discord server</span>
      </div>
      <button class="dp-submit-btn" id="claim-submit">Claim Ownership</button>
    </div>`;

  el.querySelector('#claim-submit').addEventListener('click', async () => {
    const name   = el.querySelector('#claim-name').value.trim();
    const verify = el.querySelector('#claim-verify').value.trim();
    if (!name || !verify) { showToast('Please fill in all fields', 'error'); return; }
    const btn = el.querySelector('#claim-submit');
    btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      await window.hub.post('/api/dev/claim', { server_name: name, verify });
      showToast('Claim submitted! We\'ll review within 24h.', 'success');
      el.querySelector('#claim-name').value = '';
      el.querySelector('#claim-verify').value = '';
    } catch { showToast('Claim failed — try again later.', 'error'); }
    btn.disabled = false; btn.textContent = 'Claim Ownership';
  });
}

function renderDevEditor(el, server) {
  const isNew = !server;
  const s     = server || {};
  const tags  = Array.isArray(s.tags) ? s.tags : (s.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const shots = Array.isArray(s.screenshots) ? s.screenshots : [];

  el.innerHTML = `
<div class="dp-editor">

  <!-- ── FORM ── -->
  <div class="dp-editor-form">
    <div class="dp-section-hdr">${isNew ? 'Submit New Server' : `Editing: ${escHtml(s.name || '')}`}</div>

    <div class="dp-form-section">
      <div class="dp-form-section-hdr">🎨 Branding</div>
      <div class="dp-field">
        <label class="dp-label">Server Name <span class="dp-req">*</span></label>
        <input class="dp-input" id="dp-name" type="text" value="${escHtml(s.name)}" placeholder="Your server name" maxlength="60">
      </div>
      <div class="dp-field">
        <label class="dp-label">Tagline</label>
        <input class="dp-input" id="dp-tagline" type="text" value="${escHtml(s.tagline)}" placeholder="Short catchy line" maxlength="80">
      </div>
      <div class="dp-field">
        <label class="dp-label">Accent Color</label>
        <div class="dp-color-row">
          <input class="dp-input dp-color-text" id="dp-accent" type="text" value="${escHtml(s.accentColor || '#c8a840')}" maxlength="7" placeholder="#c8a840">
          <input type="color" id="dp-accent-picker" value="${escHtml(s.accentColor || '#c8a840')}" class="dp-color-swatch-input">
        </div>
      </div>
      <div class="dp-field">
        <label class="dp-label">Server Icon</label>
        <div class="dp-img-row">
          <input class="dp-input" id="dp-icon-url" type="text" value="${escHtml(s.iconUrl)}" placeholder="https://...">
          <button class="dp-file-btn" id="dp-icon-pick">📁</button>
        </div>
        <div class="dp-size-hint">Recommended: <b>256 × 256</b> (square, 1:1) · PNG with transparent background</div>
        <div class="dp-img-thumb" id="dp-icon-preview">${s.iconUrl ? `<img src="${escHtml(s.iconUrl)}" onerror="this.style.display='none'">` : ''}</div>
      </div>
      <div class="dp-field">
        <label class="dp-label">Card Banner <span class="dp-hint">— store thumbnail</span></label>
        <div class="dp-img-row">
          <input class="dp-input" id="dp-card-banner-url" type="text" value="${escHtml(s.cardBannerUrl)}" placeholder="https://...">
          <button class="dp-file-btn" id="dp-card-banner-pick">📁</button>
        </div>
        <div class="dp-size-hint">Recommended: <b>840 × 460</b> (aspect 1.83:1) · displays at 210×115 · PNG or JPG</div>
        <div class="dp-img-thumb dp-img-wide" id="dp-card-banner-preview">${s.cardBannerUrl ? `<img src="${escHtml(s.cardBannerUrl)}" onerror="this.style.display='none'">` : ''}</div>
      </div>
      <div class="dp-field">
        <label class="dp-label">Detail Banner <span class="dp-hint">— page header</span></label>
        <div class="dp-img-row">
          <input class="dp-input" id="dp-banner-url" type="text" value="${escHtml(s.bannerUrl)}" placeholder="https://...">
          <button class="dp-file-btn" id="dp-banner-pick">📁</button>
        </div>
        <div class="dp-size-hint">Recommended: <b>1920 × 540</b> (ultra-wide, aspect 3.5:1) · PNG or JPG</div>
        <div class="dp-img-thumb dp-img-wide" id="dp-banner-preview">${s.bannerUrl ? `<img src="${escHtml(s.bannerUrl)}" onerror="this.style.display='none'">` : ''}</div>
      </div>
    </div>

    <div class="dp-form-section">
      <div class="dp-form-section-hdr">📖 About</div>
      <div class="dp-field">
        <label class="dp-label">Description <span class="dp-req">*</span></label>
        <textarea class="dp-input dp-textarea" id="dp-desc" placeholder="Tell players about your server…" maxlength="2000">${escHtml(s.description)}</textarea>
      </div>
      <div class="dp-field">
        <label class="dp-label">Changelog / Patch Notes</label>
        <textarea class="dp-input dp-textarea" id="dp-changelog" placeholder="Latest update notes…" maxlength="1000">${escHtml(s.changelog)}</textarea>
      </div>
    </div>

    <div class="dp-form-section">
      <div class="dp-form-section-hdr">🖼 Screenshots</div>
      <div id="dp-shots-list">
        ${shots.map((url, i) => dpShotRow(url, i)).join('')}
      </div>
      <button class="dp-add-btn" id="dp-add-shot">+ Add Screenshot</button>
    </div>

    <div class="dp-form-section">
      <div class="dp-form-section-hdr">⚙️ Server Details</div>
      <div class="dp-field">
        <label class="dp-label">JAR Download URL <span class="dp-req">*</span></label>
        <input class="dp-input" id="dp-jar" type="text" value="${escHtml(s.jarUrl)}" placeholder="https://...">
      </div>
      <div class="dp-field">
        <label class="dp-label">XP Rate</label>
        <select class="dp-select" id="dp-xprate">
          ${XP_RATES.map(r => `<option value="${r}"${s.xpRate === r ? ' selected' : ''}>${r}</option>`).join('')}
        </select>
      </div>
      <div class="dp-field">
        <label class="dp-label">Website URL</label>
        <input class="dp-input" id="dp-website" type="text" value="${escHtml(s.websiteUrl)}" placeholder="https://yourserver.com">
      </div>
      <div class="dp-field">
        <label class="dp-label">Discord URL</label>
        <input class="dp-input" id="dp-discord" type="text" value="${escHtml(s.discordUrl)}" placeholder="https://discord.gg/...">
      </div>
      ${_devIsStaff ? `
      <div class="dp-field">
        <label class="dp-label">Players Online <span class="dp-hint">— staff override</span></label>
        <input class="dp-input" id="dp-players" type="number" value="${s.playersOnline || 0}" min="0">
      </div>` : ''}
    </div>

    <div class="dp-form-section">
      <div class="dp-form-section-hdr">🏷 Tags</div>
      <div class="dp-tags-grid">
        ${(() => {
          // Build the render list: canonical tags + any extras the server
          // already has (case-insensitive compare so "PVM" / "PvM" don't both
          // render). Extras land at the end so the form looks consistent.
          const lc = t => String(t).trim().toLowerCase();
          const existing = (Array.isArray(tags) ? tags : []).map(String);
          const existingLc = new Set(existing.map(lc));
          const canonLc = new Set(DEV_TAGS_LIST.map(lc));
          const extras = existing.filter(t => !canonLc.has(lc(t)));
          return [...DEV_TAGS_LIST, ...extras].map(t => {
            const checked = existingLc.has(lc(t)) ? ' checked' : '';
            return `
              <label class="dp-tag-check">
                <input type="checkbox" class="dp-tag-cb" data-tag="${escHtml(t)}"${checked}>
                <span class="dp-tag-lbl">${escHtml(t)}</span>
              </label>`;
          }).join('');
        })()}
      </div>
      ${!isNew ? `
      <div style="margin-top:12px">
        <label class="dp-tag-check">
          <input type="checkbox" id="dp-visible"${s.visible ? ' checked' : ''}>
          <span class="dp-tag-lbl">Visible in store</span>
        </label>
        <div style="font-size:0.72rem;color:#6a5a3a;margin-top:4px;margin-left:24px;font-style:italic">
          Uncheck to hide your listing while you polish it.
        </div>
      </div>` : ''}
    </div>

    <div class="dp-form-section dp-form-footer">
      <div class="dp-form-btns">
        ${!isNew ? `<button class="dp-delete-btn" id="dp-delete">Delete Server</button>` : ''}
        <button class="dp-submit-btn" id="dp-save">${isNew ? 'Submit for Review' : 'Save Changes'}</button>
      </div>
    </div>
  </div>

  <!-- ── LIVE PREVIEW ── -->
  <div class="dp-preview-panel">
    <div class="dp-preview-hdr">
      Live Preview
      <div class="dp-preview-tabs">
        <button class="dp-ptab active" data-tab="card">Store Card</button>
        <button class="dp-ptab" data-tab="detail">Detail Page</button>
      </div>
    </div>
    <div id="dp-pcard" class="dp-preview-wrap">${buildDevCardPreview(s)}</div>
    <div id="dp-pdetail" class="dp-preview-wrap" style="display:none">${buildDevDetailPreview(s)}</div>
  </div>

</div>`;

  // Preview tab switching
  el.querySelectorAll('.dp-ptab').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.dp-ptab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      el.querySelector('#dp-pcard').style.display   = btn.dataset.tab === 'card'   ? '' : 'none';
      el.querySelector('#dp-pdetail').style.display = btn.dataset.tab === 'detail' ? '' : 'none';
    });
  });

  // Live preview refresh on any input
  ['dp-name','dp-tagline','dp-accent','dp-desc','dp-card-banner-url','dp-banner-url','dp-icon-url'].forEach(id => {
    el.querySelector(`#${id}`)?.addEventListener('input', () => devRefreshPreview(el));
  });
  el.querySelectorAll('.dp-tag-cb').forEach(cb => cb.addEventListener('change', () => devRefreshPreview(el)));
  el.querySelector('#dp-accent-picker')?.addEventListener('input', e => {
    el.querySelector('#dp-accent').value = e.target.value;
    devRefreshPreview(el);
  });
  el.querySelector('#dp-accent')?.addEventListener('input', e => {
    if (/^#[0-9a-f]{6}$/i.test(e.target.value))
      el.querySelector('#dp-accent-picker').value = e.target.value;
    devRefreshPreview(el);
  });

  // Image file pickers — uploads to VPS and sets public URL
  [
    { pick: 'dp-icon-pick',        input: 'dp-icon-url',        preview: 'dp-icon-preview',        endpoint: '/api/dev/upload/icon'        },
    { pick: 'dp-card-banner-pick', input: 'dp-card-banner-url', preview: 'dp-card-banner-preview', endpoint: '/api/dev/upload/card-banner' },
    { pick: 'dp-banner-pick',      input: 'dp-banner-url',      preview: 'dp-banner-preview',      endpoint: '/api/dev/upload/banner'      },
  ].forEach(({ pick, input, preview, endpoint }) => {
    el.querySelector(`#${pick}`)?.addEventListener('click', async () => {
      const btn = el.querySelector(`#${pick}`);
      const filePath = await window.hub.pickAvatar();
      if (!filePath) return;

      // If server doesn't have an id yet (new submission), just show local preview
      const serverId = s.id;
      if (!serverId) {
        const localUrl = 'file:///' + filePath.replace(/\\/g, '/');
        el.querySelector(`#${input}`).value = localUrl;
        const p = el.querySelector(`#${preview}`);
        if (p) p.innerHTML = `<img src="${localUrl}">`;
        devRefreshPreview(el);
        return;
      }

      btn.textContent = '⏳';
      btn.disabled = true;
      try {
        const base64 = await window.hub.readFileBase64(filePath);
        if (!base64) throw new Error('Could not read file');
        const res = await window.hub.post(endpoint, { serverId, base64 });
        if (res?.error) throw new Error(res.error);
        el.querySelector(`#${input}`).value = res.url;
        const p = el.querySelector(`#${preview}`);
        if (p) p.innerHTML = `<img src="${escHtml(res.url)}" onerror="this.style.display='none'">`;
        devRefreshPreview(el);
        showToast('Image uploaded!', 'success');
      } catch (e) {
        showToast('Upload failed: ' + e.message, 'error');
      } finally {
        btn.textContent = '📁';
        btn.disabled = false;
      }
    });
    el.querySelector(`#${input}`)?.addEventListener('input', e => {
      const p = el.querySelector(`#${preview}`);
      if (p) p.innerHTML = e.target.value ? `<img src="${escHtml(e.target.value)}" onerror="this.style.display='none'">` : '';
      devRefreshPreview(el);
    });
  });

  // Screenshots
  let shotIdx = shots.length;
  el.querySelector('#dp-add-shot')?.addEventListener('click', () => {
    const div = document.createElement('div');
    div.innerHTML = dpShotRow('', shotIdx++);
    const row = div.firstElementChild;
    row.querySelector('.dp-remove-shot')?.addEventListener('click', () => row.remove());
    el.querySelector('#dp-shots-list').appendChild(row);
  });
  el.querySelectorAll('.dp-remove-shot').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.dp-shot-row').remove());
  });

  // Save
  el.querySelector('#dp-save')?.addEventListener('click', () => devPortalSave(el, server));

  // Delete
  el.querySelector('#dp-delete')?.addEventListener('click', async () => {
    const ok = await rhConfirm(`Delete "${s.name}"? This cannot be undone.`, {
      title: 'Delete server', confirmText: 'Delete', cancelText: 'Cancel', danger: true,
    });
    if (!ok) return;
    const btn = el.querySelector('#dp-delete');
    btn.disabled = true;
    try {
      await window.hub.post('/api/dev/delete', { id: s.id });
      showToast('Server deleted.', 'info');
      devPortalLoadSection('my-servers');
    } catch { btn.disabled = false; showToast('Delete failed.', 'error'); }
  });
}

function dpShotRow(url, idx) {
  return `<div class="dp-shot-row">
    <input class="dp-input dp-shot-input" type="text" value="${escHtml(url)}" placeholder="https://i.imgur.com/...">
    ${url ? `<img class="dp-shot-thumb" src="${escHtml(url)}" onerror="this.style.display='none'">` : ''}
    <button class="dp-remove-shot">✕</button>
  </div>`;
}

function devCollect(el) {
  const tags  = [...el.querySelectorAll('.dp-tag-cb:checked')].map(c => c.dataset.tag);
  const shots = [...el.querySelectorAll('.dp-shot-input')].map(i => i.value.trim()).filter(Boolean);
  return {
    name:            el.querySelector('#dp-name')?.value.trim()           || '',
    tagline:         el.querySelector('#dp-tagline')?.value.trim()        || '',
    accent_color:    el.querySelector('#dp-accent')?.value.trim()         || '#c8a840',
    icon_url:        el.querySelector('#dp-icon-url')?.value.trim()       || '',
    card_banner_url: el.querySelector('#dp-card-banner-url')?.value.trim()|| '',
    banner_url:      el.querySelector('#dp-banner-url')?.value.trim()     || '',
    description:     el.querySelector('#dp-desc')?.value.trim()           || '',
    changelog:       el.querySelector('#dp-changelog')?.value.trim()      || '',
    jar_url:         el.querySelector('#dp-jar')?.value.trim()            || '',
    xp_rate:         el.querySelector('#dp-xprate')?.value                || '1x',
    website_url:     el.querySelector('#dp-website')?.value.trim()        || '',
    discord_url:     el.querySelector('#dp-discord')?.value.trim()        || '',
    tags:            tags.join(','),
    screenshots:     shots,
    // Only include `visible` if the checkbox is actually in the form. When
    // it's absent (e.g. on a new submission), leave it out so the server
    // doesn't accidentally get hidden. Backend keeps the existing value.
    ...(el.querySelector('#dp-visible')
        ? { visible: el.querySelector('#dp-visible').checked ? 1 : 0 }
        : {}),
    players_online:  parseInt(el.querySelector('#dp-players')?.value || '0'),
  };
}

async function devPortalSave(el, server) {
  const data = devCollect(el);
  if (!data.name)        { showToast('Server name is required', 'error'); return; }
  if (!data.description) { showToast('Description is required', 'error'); return; }
  const btn = el.querySelector('#dp-save');
  btn.disabled = true; btn.textContent = server ? 'Saving…' : 'Submitting…';
  try {
    if (server) {
      const res = await window.hub.post('/api/dev/update', { ...data, id: server.id });
      if (res?.error) throw new Error(res.error);
      showToast('Changes saved!', 'success');
      // Refresh in-memory server list so subsequent card + detail views
      // pick up the new banner/icon/etc. Without this, state.servers keeps
      // the pre-save snapshot and new images silently don't render.
      try { await loadServers(); } catch {}
    } else {
      const res = await window.hub.post('/api/dev/submit', data);
      if (res?.error) throw new Error(res.error);
      showToast('Server submitted for review!', 'success');
      devPortalLoadSection('my-servers');
    }
  } catch (e) {
    showToast('Save failed: ' + (e.message || 'error'), 'error');
  }
  btn.disabled = false; btn.textContent = server ? 'Save Changes' : 'Submit for Review';
}

function devRefreshPreview(el) {
  const d = devCollect(el);
  const pc = el.querySelector('#dp-pcard');
  const pd = el.querySelector('#dp-pdetail');
  if (pc) pc.innerHTML = buildDevCardPreview(d);
  if (pd) pd.innerHTML = buildDevDetailPreview(d);
}

function buildDevCardPreview(s) {
  const name       = s.name || 'Server Name';
  const accent     = s.accentColor || s.accent_color || '#c8a840';
  const cardBanner = s.cardBannerUrl || s.card_banner_url || s.bannerUrl || s.banner_url || '';
  const tags       = Array.isArray(s.tags) ? s.tags : (s.tags||'').split(',').map(t=>t.trim()).filter(Boolean);
  const desc       = s.description || '';
  const grad       = bannerColor(name);
  // Scale real card (natural 500px wide, 115px tall) down to fit 272px preview panel
  const SCALE = 0.544, NW = 500, NH = 115;

  // Render at natural size then scale down — guarantees pixel-perfect match with real card
  return `
<div style="position:relative;height:${Math.round(NH*SCALE)}px;overflow:hidden;border-radius:4px">
  <div style="position:absolute;top:0;left:0;transform-origin:top left;transform:scale(${SCALE});width:${NW}px;pointer-events:none">
    <div class="server-card" style="width:${NW}px;min-height:${NH}px">
      <div class="card-banner" style="height:${NH}px;background:${grad}">
        ${cardBanner
          ? `<img src="${escHtml(cardBanner)}" alt="" onerror="this.style.display='none'">`
          : `<span class="banner-placeholder">${escHtml(name)}</span>`}
      </div>
      <div class="card-info">
        <div class="card-header">
          <span class="card-title">${escHtml(name)}</span>
          <span class="status-dot online"></span>
          <span class="level-badge-wrap">
            <span class="level-badge" style="border-color:${escHtml(accent)};color:${escHtml(accent)}">Lv. 1</span>
          </span>
        </div>
        <p class="card-desc">${escHtml(desc.slice(0,200))}</p>
        <div class="card-tags">
          ${tags.slice(0,4).map(t=>`<span class="tag-pill">${escHtml(t.toUpperCase())}</span>`).join('')}
        </div>
      </div>
      <div class="card-actions">
        <span class="player-count">▲ 0 Hub Players Online</span>
        <button class="action-btn play-btn" style="pointer-events:none">PLAY</button>
        <button class="fav-btn" style="pointer-events:none">☆ Favourite</button>
      </div>
    </div>
  </div>
</div>`;
}

function buildDevDetailPreview(s) {
  const name   = s.name || 'Server Name';
  const accent = s.accentColor || s.accent_color || '#c8a840';
  const banner = s.bannerUrl || s.banner_url || '';
  const icon   = s.iconUrl || s.icon_url || '';
  const tags   = Array.isArray(s.tags) ? s.tags : (s.tags||'').split(',').map(t=>t.trim()).filter(Boolean);
  const desc   = s.description || '';
  const tagline= s.tagline || '';
  const xp     = s.xpRate || s.xp_rate || '';
  const grad   = bannerColor(name);
  // Scale real modal (natural 500px wide) down to fit 272px preview panel
  const SCALE = 0.544, NW = 500;
  // Dynamic natural height based on description length
  const descLines = desc ? Math.ceil(desc.length / 55) : 0;
  const NH = 420 + descLines * 20;

  // Render at natural size then scale — pixel-perfect match with real detail modal
  return `
<div style="overflow-y:auto;overflow-x:hidden;max-height:420px;border-radius:6px">
  <div style="position:relative;height:${Math.round(NH*SCALE)}px">
  <div style="position:absolute;top:0;left:0;transform-origin:top left;transform:scale(${SCALE});width:${NW}px;pointer-events:none">
    <div style="width:${NW}px;background:linear-gradient(180deg,#1e1a10,#141008);border:1px solid #5a4828;border-radius:6px;overflow:hidden;display:flex;flex-direction:column">
      <div class="sd-banner" style="background:${grad}">
        ${banner ? `<img src="${escHtml(banner)}" alt="" onerror="this.style.display='none'">` : ''}
        <div class="sd-banner-gradient"></div>
      </div>
      <div class="sd-header">
        <div class="sd-icon" style="background:${grad};border-color:${escHtml(accent)}">
          ${icon
            ? `<img src="${escHtml(icon)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
               <span style="display:none">${escHtml(name[0]?.toUpperCase()||'?')}</span>`
            : `<span>${escHtml(name[0]?.toUpperCase()||'?')}</span>`}
        </div>
        <div class="sd-title-block">
          <div class="sd-name-row">
            <h2 class="sd-name">${escHtml(name)}</h2>
            <span class="sd-status-dot online"></span>
          </div>
          ${tagline ? `<p class="sd-tagline">${escHtml(tagline)}</p>` : ''}
          <div class="sd-tags">
            ${tags.map(t=>`<span class="tag-pill">${escHtml(t.toUpperCase())}</span>`).join('')}
          </div>
        </div>
      </div>
      <div class="sd-stats-row">
        <div class="sd-stat">
          <span class="sd-stat-val">0</span>
          <span class="sd-stat-lbl">Hub Players Online</span>
        </div>
        ${xp ? `<div class="sd-stat"><span class="sd-stat-val">${escHtml(xp)}</span><span class="sd-stat-lbl">XP Rate</span></div>` : ''}
      </div>
      <div style="padding:16px 20px">
        ${desc ? `
          <div class="sd-section">
            <h3 class="sd-section-title">ABOUT</h3>
            <p class="sd-description">${escHtml(desc)}</p>
          </div>` : ''}
      </div>
      <div class="sd-footer">
        <div class="sd-footer-left"></div>
        <div class="sd-footer-right">
          <button class="sd-link-btn" style="pointer-events:none">☆ Favourite</button>
          <button class="action-btn play-btn" style="pointer-events:none;height:36px;font-size:0.72rem;min-width:100px">PLAY</button>
        </div>
      </div>
    </div>
  </div>
  </div>
</div>`;
}

// ── SETTINGS ─────────────────────────────────────────────────────────────────

const ACCENT_PRESETS = [
  { color: '#c8a840', name: 'Gold'   },
  { color: '#ff981f', name: 'Orange' },
  { color: '#4da6ff', name: 'Blue'   },
  { color: '#50cc50', name: 'Green'  },
  { color: '#cc3a3a', name: 'Red'    },
  { color: '#9b5de5', name: 'Purple' },
];
const SERVER_PREF_TAGS = ['PvP','Economy','OSRS','Hardcore','Leagues','Vanilla','Ironman','Skilling','Custom','Minigames'];

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Palette-matching confirm/alert modal. Replaces native window.confirm().
// rhConfirm(message, { title, confirmText, cancelText, danger }) -> Promise<boolean>
function rhConfirm(message, opts = {}) {
  return new Promise(resolve => {
    const {
      title       = 'Are you sure?',
      confirmText = 'Confirm',
      cancelText  = 'Cancel',
      danger      = false,
    } = opts;
    const overlay = document.createElement('div');
    overlay.className = 'rh-confirm-overlay';
    overlay.innerHTML = `
      <div class="rh-confirm">
        <div class="rh-confirm-title">${escHtml(title)}</div>
        <div class="rh-confirm-msg">${escHtml(message)}</div>
        <div class="rh-confirm-btns">
          <button class="rh-confirm-cancel">${escHtml(cancelText)}</button>
          <button class="rh-confirm-ok ${danger ? 'danger' : ''}">${escHtml(confirmText)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    const close = (result) => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter')  close(true);
    };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.rh-confirm-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('.rh-confirm-ok').addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    // Focus the OK button by default for quick Enter-confirm
    setTimeout(() => overlay.querySelector('.rh-confirm-ok')?.focus(), 50);
  });
}

function setToggleHtml(id, checked) {
  return `<label class="set-toggle"><input type="checkbox" id="${id}"${checked ? ' checked' : ''}><span class="set-slider"></span></label>`;
}

function buildSettingsHTML(s) {
  const nd = v => v !== false; // notif default = true when undefined

  return `
<div class="settings-wrap">
  <div class="alt-header"><h2>SETTINGS</h2><p>Launcher preferences</p></div>

  <!-- ── LAUNCHER ── -->
  <div class="set-section">
    <div class="set-section-hdr">⚙️&nbsp; Launcher</div>
    <div class="set-row set-between">
      <div>
        <div class="set-label">Minimize on Launch</div>
        <div class="set-sub">Minimize the launcher when a game starts</div>
      </div>
      ${setToggleHtml('set-minimize', s.minimizeOnLaunch)}
    </div>
    <div class="set-row set-between">
      <div>
        <div class="set-label">Auto-Update Clients</div>
        <div class="set-sub">Re-download game clients when a new version is detected</div>
      </div>
      ${setToggleHtml('set-autoupdate', s.autoUpdateClients)}
    </div>
    <div class="set-row set-col">
      <label class="set-label" for="set-dl-path">Download Path</label>
      <div class="set-path-row">
        <input class="set-input set-path-input" id="set-dl-path" type="text"
               value="${escHtml(s.downloadPath)}" readonly>
        <button class="set-browse-btn" id="set-browse">Browse</button>
      </div>
    </div>
  </div>

  <!-- ── NOTIFICATIONS ── -->
  <div class="set-section">
    <div class="set-section-hdr">🔔&nbsp; Notifications</div>
    ${[
      ['set-nf-fr',     'notifFriendRequests', 'Friend Requests',  'When someone sends you a friend request'],
      ['set-nf-fo',     'notifFriendOnline',   'Friends Online',   'When a friend comes online'],
      ['set-nf-su',     'notifServerUpdates',  'Server Updates',   'When a server you play pushes an update'],
      ['set-nf-streak', 'notifStreakReminder',  'Streak Reminders', 'Remind you to play before your daily streak resets'],
      ['set-nf-sys',    'notifSystem',         'System Messages',  'Hub announcements and important updates'],
    ].map(([id, key, lbl, sub]) => `
      <div class="set-row set-between">
        <div>
          <div class="set-label">${lbl}</div>
          <div class="set-sub">${sub}</div>
        </div>
        ${setToggleHtml(id, nd(s[key]))}
      </div>
    `).join('')}
  </div>

  <!-- ── STAFF ── -->
  ${state.user?.isStaff ? `
  <div class="set-section" style="border-left:2px solid #c8a840">
    <div class="set-section-hdr" style="color:#e0c87a">⚔️&nbsp; Staff Panel</div>
    <div class="set-row set-between">
      <div>
        <div class="set-label">All Servers</div>
        <div class="set-sub">View and edit every server listing in the database</div>
      </div>
      <button class="set-browse-btn" id="set-open-staff">Open</button>
    </div>
    <div class="set-row set-between" style="margin-top:4px">
      <div>
        <div class="set-label">Pending Submissions</div>
        <div class="set-sub">Approve or reject servers awaiting review</div>
      </div>
      <button class="set-browse-btn" id="set-open-pending">Open</button>
    </div>
  </div>` : ''}

  <!-- ── DEVELOPER ── -->
  <div class="set-section">
    <div class="set-section-hdr">👨‍💻&nbsp; Developer</div>
    <div class="set-row set-between">
      <div>
        <div class="set-label">Developer Portal</div>
        <div class="set-sub">Submit or manage your RSPS server listing</div>
      </div>
      <button class="set-browse-btn" id="set-open-devportal">Open</button>
    </div>
  </div>

  <!-- ── ACCOUNT ── -->
  <div class="set-section">
    <div class="set-section-hdr">🔐&nbsp; Account</div>
    <div class="set-row set-between">
      <span class="set-label">Logged in as</span>
      <span class="set-value">${escHtml(state.user?.username)}</span>
    </div>
    <div class="set-row set-col" style="margin-top:8px">
      <div class="set-label">Change Password</div>
      <div class="set-sub" style="margin-bottom:6px">Requires your current password. Other devices will be signed out.</div>
      ${[
        ['set-pw-current', 'Current password',                                       'current-password'],
        ['set-pw-new',     '8+ chars, upper + lower + number + special',             'new-password'],
        ['set-pw-confirm', 'Confirm new password',                                   'new-password'],
      ].map(([id, ph, ac]) => `
        <div class="set-pw-wrap" style="position:relative;margin-bottom:6px">
          <input class="set-input" id="${id}" type="password" autocomplete="${ac}" placeholder="${ph}" style="padding-right:42px;width:100%">
          <button type="button" class="set-pw-eye" data-target="${id}"
            style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:transparent;border:0;color:#888;cursor:pointer;font-size:14px;padding:4px 6px"
            aria-label="Show password">👁</button>
        </div>
      `).join('')}
      <div class="set-row set-between">
        <div id="set-pw-msg" class="set-sub" style="color:#888"></div>
        <button class="set-browse-btn" id="set-pw-submit">Change Password</button>
      </div>
    </div>
    <div class="set-account-btns" style="margin-top:10px">
      <button class="set-danger-btn" id="set-logout">Logout</button>
    </div>
  </div>

  <!-- ── ABOUT ── -->
  <div class="set-section">
    <div class="set-section-hdr">ℹ️&nbsp; About</div>
    <div class="set-row set-between"><span class="set-label">RSPS Hub</span><span class="set-value" id="about-version">v…</span></div>
    <div class="set-row set-between"><span class="set-label">Platform</span><span class="set-value">Electron + Java</span></div>
    <div class="set-row set-between"><span class="set-label">Engine</span><span class="set-value">Javalin 6 · Java 17</span></div>
  </div>
</div>`;
}

function bindSettingsEvents(el, initial) {
  async function save(key, value) {
    try {
      await api.saveSettings({ [key]: value });
      state.settings[key] = value; // keep in-memory cache in sync
    } catch (_) {}
  }

  // Developer portal
  el.querySelector('#set-open-devportal')?.addEventListener('click', () => openDevPortal('my-servers'));

  // Staff panel shortcuts
  el.querySelector('#set-open-staff')?.addEventListener('click',   () => openDevPortal('all-servers'));
  el.querySelector('#set-open-pending')?.addEventListener('click', () => openDevPortal('pending'));

  // Launcher toggles
  el.querySelector('#set-minimize')?.addEventListener('change', e =>
    save('minimizeOnLaunch', e.target.checked));
  el.querySelector('#set-autoupdate')?.addEventListener('change', e =>
    save('autoUpdateClients', e.target.checked));

  // Download path — folder picker
  el.querySelector('#set-browse')?.addEventListener('click', async () => {
    const folder = await window.hub.selectFolder(el.querySelector('#set-dl-path')?.value || undefined);
    if (folder) {
      el.querySelector('#set-dl-path').value = folder;
      save('downloadPath', folder);
    }
  });

  // Notification toggles
  const notifMap = {
    'set-nf-fr':     'notifFriendRequests',
    'set-nf-fo':     'notifFriendOnline',
    'set-nf-su':     'notifServerUpdates',
    'set-nf-streak': 'notifStreakReminder',
    'set-nf-sys':    'notifSystem',
  };
  Object.entries(notifMap).forEach(([id, key]) => {
    el.querySelector(`#${id}`)?.addEventListener('change', e => save(key, e.target.checked));
  });

  // Logout
  // Password show/hide eye toggles
  el.querySelectorAll('.set-pw-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = el.querySelector('#' + btn.dataset.target);
      if (!input) return;
      const shown = input.type === 'text';
      input.type = shown ? 'password' : 'text';
      btn.textContent = shown ? '👁' : '🙈';
      btn.setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
    });
  });

  el.querySelector('#set-pw-submit')?.addEventListener('click', async () => {
    const cur = el.querySelector('#set-pw-current');
    const nw  = el.querySelector('#set-pw-new');
    const cf  = el.querySelector('#set-pw-confirm');
    const msg = el.querySelector('#set-pw-msg');
    const btn = el.querySelector('#set-pw-submit');
    const setMsg = (text, color = '#c96') => { msg.textContent = text; msg.style.color = color; };
    if (!cur.value || !nw.value || !cf.value) return setMsg('Fill in all three password fields.');
    if (nw.value.length < 8)                return setMsg('New password must be at least 8 characters.');
    if (!/[A-Z]/.test(nw.value))            return setMsg('New password must contain an uppercase letter.');
    if (!/[a-z]/.test(nw.value))            return setMsg('New password must contain a lowercase letter.');
    if (!/[0-9]/.test(nw.value))            return setMsg('New password must contain a number.');
    if (!/[^A-Za-z0-9]/.test(nw.value))     return setMsg('New password must contain a special character.');
    if (nw.value !== cf.value)              return setMsg('New passwords do not match.');
    if (nw.value === cur.value)             return setMsg('New password must be different from current.');
    btn.disabled = true; setMsg('Updating…', '#888');
    try {
      const res = await window.hub.post('/api/auth/change-password', { current: cur.value, new: nw.value });
      if (res && res.success) {
        setMsg('Password changed. Other devices have been signed out.', '#4caf50');
        cur.value = nw.value = cf.value = '';
      } else {
        setMsg(res?.error || 'Failed to change password.');
      }
    } catch (err) {
      setMsg((err && err.message) || 'Network error.');
    } finally {
      btn.disabled = false;
    }
  });

  el.querySelector('#set-logout')?.addEventListener('click', async () => {
    try { await api.logout(); } catch {}
    await logoutCleanup();
    closeAllDropdowns();
  });
}

// ── LEVEL / XP — matches ServerSkillSystem.java exactly ─────────────────────
// Square-root curve: Lv99 = 60,000 minutes (1,000 hours)
const MAX_MINUTES = 60000;

function calcLevel(minutes) {
  if (minutes <= 0) return 1;
  const ratio = Math.min(1.0, minutes / MAX_MINUTES);
  return Math.min(99, Math.floor(1 + 98 * Math.sqrt(ratio)));
}

function levelToMinutes(level) {
  if (level <= 1) return 0;
  const ratio = (level - 1) / 98.0;
  return ratio * ratio * MAX_MINUTES;
}

function calcXpProgress(minutes) {
  const level = calcLevel(minutes);
  if (level >= 99) return 1;
  const minCurrent = levelToMinutes(level);
  const minNext    = levelToMinutes(level + 1);
  return Math.min(1, Math.max(0, (minutes - minCurrent) / (minNext - minCurrent)));
}

function getRankName(level) {
  if (level >= 99) return 'INFERNAL';
  if (level >= 85) return 'DRAGON';
  if (level >= 70) return 'RUNE';
  if (level >= 55) return 'ADAMANT';
  if (level >= 40) return 'MITHRIL';
  if (level >= 25) return 'BLACK';
  if (level >= 10) return 'STEEL';
  if (level >= 5)  return 'IRON';
  return 'BRONZE';
}

function getMilestoneColor(level) {
  if (level >= 99) return '#ffd700';
  if (level >= 75) return '#9b5de5';
  if (level >= 50) return '#ff981f';
  if (level >= 25) return '#4caf50';
  if (level >= 10) return '#4a9eff';
  return '#8b92a5';
}

function calcTooltip(name, level, minutes) {
  if (level >= 99) return name + ' — Level 99 MAX';
  const toNext = Math.ceil(levelToMinutes(level + 1) - minutes);
  const timeStr = toNext < 60 ? toNext + 'm' : Math.floor(toNext/60) + 'h ' + (toNext%60) + 'm';
  return name + ' — Lv.' + level + ' · ' + timeStr + ' to next level';
}

// ── LEVEL BADGE GLOBAL TOOLTIP ───────────────────────────────────────────────

function initLevelTooltip() {
  // Single shared tooltip living on <body> — escapes card overflow:hidden
  const tip = document.createElement('div');
  tip.id = 'level-tooltip-global';
  tip.className = 'level-tooltip';
  tip.style.display = 'none';
  document.body.appendChild(tip);

  // Delegate hover to any .level-badge-wrap
  document.addEventListener('mouseover', e => {
    const wrap = e.target.closest('.level-badge-wrap');
    if (!wrap) return;
    const d    = wrap.dataset;
    const mc   = d.mc || '#c8a840';
    const timeStr = d.time || '';
    tip.innerHTML = `
      <div class="lt-orb" style="border-color:${mc};box-shadow:0 0 8px ${mc}44">
        ${state.profile.avatarPath
          ? `<img src="file:///${state.profile.avatarPath.replace(/\\/g,'/')}?t=${Date.now()}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
          : `<span style="color:${mc}">${d.orb || '?'}</span>`
        }
      </div>
      <div class="lt-info">
        <span class="lt-lv" style="color:${mc}">Lv. ${d.lv}</span>
        <span class="lt-rank">${d.rank}</span>
      </div>
      <div class="lt-xp-track">
        <div class="lt-xp-fill" style="width:${d.xp}%;background:${mc}"></div>
      </div>
      ${timeStr ? `<span class="lt-time">${timeStr}</span>` : ''}
    `;

    // Position fixed relative to the badge
    const rect = wrap.getBoundingClientRect();
    tip.style.display = 'flex';
    // Calculate position — show below badge, aligned to right edge
    let top  = rect.bottom + 8;
    let left = rect.right - 150; // tooltip width 150px
    // Keep on screen
    if (left < 8) left = 8;
    if (top + 180 > window.innerHeight) top = rect.top - 185;
    tip.style.top  = top  + 'px';
    tip.style.left = left + 'px';
  });

  document.addEventListener('mouseout', e => {
    const wrap = e.target.closest('.level-badge-wrap');
    if (!wrap) return;
    // Only hide if not moving into the tooltip itself
    const to = e.relatedTarget;
    if (tip.contains(to)) return;
    tip.style.display = 'none';
  });

  tip.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
}

// ── MOVING BACKGROUND PARTICLES ──────────────────────────────────────────────

function initBgParticles() {
  const RUNES = ['᛫','ᚱ','ᚢ','ᚾ','ᛖ','✦','◆','✧','⬧','⋆'];
  const count = 22;
  const container = document.createElement('div');
  container.id = 'bg-particles';
  container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden;';
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    const size    = 8 + Math.random() * 14;
    const left    = Math.random() * 100;
    const delay   = Math.random() * 18;
    const dur     = 14 + Math.random() * 16;
    const opacity = 0.04 + Math.random() * 0.10;
    p.textContent = RUNES[Math.floor(Math.random() * RUNES.length)];
    p.style.cssText = `
      position:absolute;
      left:${left}%;
      bottom:-40px;
      font-size:${size}px;
      color:#c8a840;
      opacity:0;
      animation: bgFloat ${dur}s ${delay}s linear infinite;
      text-shadow: 0 0 6px rgba(200,168,64,0.4);
      --op:${opacity};
    `;
    container.appendChild(p);
  }
  // Insert before everything else
  document.body.insertBefore(container, document.body.firstChild);
}

function bannerColor(name) {
  // deterministic dark gradient per server name
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `linear-gradient(135deg, hsl(${hue},40%,8%) 0%, hsl(${hue},35%,12%) 50%, hsl(${hue},30%,6%) 100%)`;
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n).trim() + '…' : str;
}

function formatNumber(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
}

function formatMinutes(mins) {
  if (!mins) return '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
