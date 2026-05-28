// ── JS ERROR TELEMETRY ────────────────────────────────────────────────────
// Production users can't open DevTools, so any uncaught error would be
// invisible. POST every error to /api/log/js-error so we see them on the
// backend instead of guessing. Self-throttled to 1 every 2s so a render
// loop doesn't DDoS the endpoint. Errors thrown FROM this handler itself
// are swallowed.
(function initJsErrorTelemetry() {
  let lastReport = 0;
  function report(payload) {
    const now = Date.now();
    if (now - lastReport < 2000) return;   // throttle
    lastReport = now;
    try {
      const body = JSON.stringify({
        ...payload,
        version: (window.APP_VERSION || ''),
        context: (location.hash || document.title || '').slice(0, 240),
      });
      // Direct POST to the VPS — bypass the local Java proxy so errors
      // before the proxy is up still get captured. Anonymous accepted.
      fetch('https://api.therspshub.com/api/log_js_error.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    } catch {}
  }
  window.addEventListener('error', (e) => {
    report({
      message: e.message || 'unknown error',
      source:  e.filename || '',
      lineno:  e.lineno || 0,
      colno:   e.colno  || 0,
      stack:   (e.error && e.error.stack) ? String(e.error.stack).slice(0, 4000) : '',
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason || {};
    report({
      message: 'unhandled promise: ' + (r.message || String(r)).slice(0, 400),
      stack:   r.stack ? String(r.stack).slice(0, 4000) : '',
    });
  });
})();

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
  install:          (name, jarUrl, jarSha256, jarSizeBytes) => window.hub.post(`/api/servers/${encodeURIComponent(name)}/install`, { jarUrl, jarSha256, jarSizeBytes }),
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
  state.activeDM = null;
  // Clear DM cache (private messages must not leak to the next login)
  for (const k of Object.keys(DM_STORE)) delete DM_STORE[k];
  // Clear server favourites (will be re-fetched from server on next login)
  state.favourites.clear();
  // Drop equipped cosmetics so the next user doesn't briefly inherit the
  // previous user's title/colour/border/effect on first render.
  state.equipped = null;
  // Strip any active theme CSS (background image, accent palette, overlays)
  // so the next login starts on the default palette until their own catalog
  // loads. Without this the previous user's theme keeps painting the
  // launcher chrome until something else triggers a reload.
  if (typeof window.clearTheme === 'function') {
    try { window.clearTheme(); } catch {}
  }
  // Force the Hub Store catalog to refetch on next visit so equipped flags
  // reflect the new user, not whatever was cached for the previous one.
  if (typeof window.invalidateHubStoreCatalog === 'function') {
    try { window.invalidateHubStoreCatalog(); } catch {}
  }
  // Clear tab data cache so the next login doesn't see the previous user's cached data
  window.clearCaches();
  // Tell music module to drop its prefs (favs, last track, etc.)
  if (window.clearMusicPrefs) try { window.clearMusicPrefs(); } catch {}
  // Un-scope main.js file paths
  try { await window.hub.setActiveUser(null); } catch {}

  // Close any open side panel + clear its body so the next user doesn't
  // briefly see the previous user's DMs / friends / etc.
  const panel = document.getElementById('slide-panel');
  if (panel) {
    panel.classList.remove('open');
    const body = document.getElementById('slide-panel-body');
    if (body) body.innerHTML = '';
  }
  // Deselect any active sidebar tab so the next login starts clean.
  document.querySelectorAll('.rs-tab.active').forEach(t => t.classList.remove('active'));

  // Close any chat popout windows the previous user had open.
  try { window.hub?.closeAllChatPopouts && window.hub.closeAllChatPopouts(); } catch {}

  // Reset all unread badges
  for (const k of Object.keys(_unread)) { _unread[k] = 0; updateBadge(k); }

  // Stop the achievement sync loop — next login restarts it fresh
  if (_achSyncTimer) { clearInterval(_achSyncTimer); _achSyncTimer = null; }

  renderUser();
}

// ── STATE ─────────────────────────────────────────────────────────────────────

// Exposed on `window` so other modules (stats.js public-profile actions,
// future widgets, etc.) can read username / activeDM / settings without
// duplicating the auth + cache logic that lives here.
let state = window.state = {
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
  streak:     { current: 0, best: 0 }, // daily-login streak (set on checkin)
};

// ── BOOT ─────────────────────────────────────────────────────────────────────

// ── AUTO UPDATE NOTIFICATIONS ────────────────────────────────────────────────

// Tracks whether a manual update check is in flight. When true, the
// next "no update" or "error" event surfaces a toast so the user gets
// concrete feedback. Auto-fired periodic checks stay quiet to avoid
// nagging anyone every hour with "already up to date" toasts.
let _manualUpdateCheck = false;
// Hard cooldown timestamp. Even after a check completes (the in-flight
// flag clears), the button stays locked out for a few seconds so users
// who spam-click don't get stacked toast walls.
let _manualUpdateCooldownUntil = 0;

if (window.hub?.onUpdateAvailable) {
  // The sidebar "Check for updates" button. Asks main to run a fresh
  // autoUpdater.checkForUpdates(), then surfaces a toast for whichever
  // outcome event fires next.
  const updateBtn = document.getElementById('rs-tab-update');
  if (updateBtn) {
    updateBtn.addEventListener('click', () => {
      const now = Date.now();
      if (_manualUpdateCheck || now < _manualUpdateCooldownUntil) return;
      _manualUpdateCheck = true;
      _manualUpdateCooldownUntil = now + 5000; // 5-second floor between checks
      updateBtn.classList.add('rs-tab-checking');
      showToast('Checking for updates…', 'info');
      try { window.hub.checkForUpdate(); } catch (_) {}
      // Safety: clear the in-flight flag after 30s so the button can
      // be clicked again even if no event ever fires.
      setTimeout(() => {
        _manualUpdateCheck = false;
        updateBtn.classList.remove('rs-tab-checking');
      }, 30000);
    });
  }
  if (window.hub.onUpdateChecking) {
    window.hub.onUpdateChecking(() => {
      // Periodic background check is starting. Quiet unless this is
      // a user-initiated check.
    });
  }
  if (window.hub.onUpdateNotAvailable) {
    window.hub.onUpdateNotAvailable(() => {
      if (_manualUpdateCheck) {
        _manualUpdateCheck = false;
        document.getElementById('rs-tab-update')?.classList.remove('rs-tab-checking');
        showToast('You are on the latest version.', 'success');
      }
    });
  }
  if (window.hub.onUpdateError) {
    window.hub.onUpdateError((msg) => {
      if (_manualUpdateCheck) {
        _manualUpdateCheck = false;
        document.getElementById('rs-tab-update')?.classList.remove('rs-tab-checking');
        showToast('Update check failed: ' + (msg || 'unknown'), 'error');
      }
    });
  }
  window.hub.onUpdateAvailable(() => {
    if (_manualUpdateCheck) {
      _manualUpdateCheck = false;
      document.getElementById('rs-tab-update')?.classList.remove('rs-tab-checking');
    }
    showToast('Update available — downloading in background…', 'info');
  });
  window.hub.onUpdateDownloaded(() => {
    const banner = document.createElement('div');
    banner.id = 'update-banner';
    banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#1a1d24;border-top:1px solid #2a2e39;color:#c8a840;font-family:Cinzel,serif;font-size:0.8rem;padding:10px 20px;display:flex;align-items:center;gap:12px;z-index:999999';
    banner.innerHTML = `<span>✦ Update ready to install</span><button id="update-banner-restart" style="background:#ff981f;color:#0f1115;border:none;padding:5px 14px;border-radius:3px;font-family:Cinzel,serif;font-size:0.75rem;cursor:pointer;font-weight:700">RESTART & UPDATE</button><button onclick="this.parentElement.remove()" style="background:none;border:none;color:#666;cursor:pointer;margin-left:auto;font-size:1rem">✕</button>`;
    document.body.appendChild(banner);
    // Confirm before restarting — a running game JAR gets killed on app
    // restart, so we want a clear heads-up rather than silently nuking
    // someone mid-fight.
    banner.querySelector('#update-banner-restart').addEventListener('click', async () => {
      const ok = await confirmThemed(
        'Restarting the launcher will close any RSPS game windows you have open. Save and log out first if you are in-game.',
        { title: 'Restart to apply update?', okLabel: 'Restart now', cancelLabel: 'Not yet', danger: true }
      );
      if (ok) window.hub.installUpdate();
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // Tag the body with the host platform so platform-specific CSS rules can
  // hide our custom Windows-style window controls on macOS (where the OS
  // already renders native traffic-light buttons via titleBarStyle).
  try {
    if (window.hub?.isMac)               document.body.classList.add('is-mac');
    else if (window.hub?.platform === 'linux') document.body.classList.add('is-linux');
    else                                 document.body.classList.add('is-win');
  } catch (_) {}
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

  // Profile load is deferred until AFTER auto-login sets state.user — see
  // the block below. Calling getProfile() here with no username returns
  // the default record (no avatarPath), which is why the avatar appeared
  // to "disappear on restart" — it was never loaded in the first place.

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
      // /api/users/me returns is_staff (snake_case); normalize so client
      // checks of state.user.isStaff (camelCase) work everywhere.
      state.user = { ...userData, isStaff: !!(userData.is_staff ?? userData.isStaff) };
      await window.hub.setActiveUser(userData.username);
      // Paint the user's cached theme INSTANTLY from localStorage so they
      // don't see the default palette flash before the catalog finishes
      // loading. The catalog fetch below confirms / corrects it.
      try { paintCachedThemeFor(userData.username); } catch (_) {}
      try { applyEquippedThemeIfAny(); } catch (_) {}
      // Background catalog refetch so the painted theme is reconciled
      // against the user's current server-side state. If they unequipped
      // or switched themes elsewhere, this overwrites the cached paint.
      if (typeof window.reloadHubStoreCatalog === 'function') {
        try { window.reloadHubStoreCatalog(); } catch (_) {}
      }
      // Load the per-user profile (avatarPath, displayName, bio, etc.) NOW
      // that we know who's logged in. Was previously called outside this
      // block with an undefined username, which silently returned the
      // default profile and made avatars appear to "vanish" on restart.
      try {
        state.profile = await window.hub.getProfile(userData.username);
        updateNavbarAvatar();
      } catch {}
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
      startNewsNotificationPolling();
      startPlaytimeRefresh();
      // Prefetch tab data so Stats/Friends/Chat open instantly from cache.
      prefetchTabs();
      // Hub Coins — daily login bonus (server-side idempotent: 25 coins
      // once per UTC day per user). Fire-and-forget; if it returns
      // `awarded > 0` show a toast.
      window.hub.post('/api/coins/daily', {}).then(res => {
        if (res?.awarded > 0 && window.showToast) {
          window.showToast(`Daily login bonus: +${res.awarded} Hub Coins`, 'success');
        }
      }).catch(() => {});
      // Periodic achievement sync — every 60s the server re-evaluates
      // every achievement against fresh stats and awards coins for any
      // newly-unlocked. Toast each new one (capped) so users see progress
      // in near-real-time as they play, not just when they open Stats.
      startAchievementSyncLoop();

      // Daily login streak — server is the source of truth (UTC day-stamped).
      // Fires once per launcher session. Updates streak counter and toasts
      // when it continues. If the streak is at risk (last login = yesterday,
      // not yet checked in today), the streak-reminder banner pops if the
      // user has the Settings toggle on.
      window.hub.post('/api/streak/checkin', {}).then(res => {
        if (!res || res.error) return;
        state.streak = { current: res.current || 0, best: res.best || 0 };
        if (res.continued && window.showToast) {
          const c = res.current || 1;
          window.showToast(`🔥 ${c}-day login streak! Keep it going.`, 'success');
        }
        // The checkin endpoint runs achievement sync server-side after the
        // streak update, so streak-based unlocks (week_warrior, dedicated,
        // devotee, etc.) get the coin toast on the same launcher session
        // they're earned, not on next Stats tab open.
        (res.newly_unlocked || []).forEach(a => {
          if (window.showToast) window.showToast(`🏆 ${a.name} unlocked! +${a.coins} coins`, 'success');
        });
        if (res.newly_unlocked?.length) {
          try { invalidateCaches('stats'); } catch {}
        }
      }).catch(() => {});

      // Streak-at-risk reminder. The Settings toggle "Streak Reminders"
      // (state.settings.notifStreakReminder) finally has a job here.
      // We fetch /api/streak/me — if at_risk is true (last login = yesterday
      // and not yet checked in today), drop a friendly banner. Currently
      // the checkin above ALREADY handles today's check-in, so at_risk
      // shouldn't normally fire from here, but keep it as a safety for
      // edge cases (e.g. clock skew between client + server) and for
      // future streak-rules.
      if (state.settings?.notifStreakReminder !== false) {
        window.hub.get('/api/streak/me').then(s => {
          if (s?.at_risk && !s?.already_today && s.current >= 2 && window.showToast) {
            window.showToast(`🔥 Don't break your ${s.current}-day streak! Stay logged in today.`, 'info');
          }
        }).catch(() => {});
      }
    }
  } catch {}


  // Load per-server playtime from Java backend
  try {
    const pt = await api.getPlaytime();
    if (pt && pt.perServer) {
      state.playtime = pt.perServer; // { "ServerName": minutesPlayed }

      // One-time backfill: pre-v1.0.50 playtime exists only in the local
      // PlaytimeStore file. Push it up to the VPS so the leaderboard,
      // Stats Top Servers, and other VPS-driven UIs reflect the user's
      // full history. Gated on a settings flag so it only fires once per
      // user, ever. Endpoint is idempotent (GREATEST merge) so even if
      // the flag fails to save, re-runs are safe.
      if (state.user?.username
          && state.settings
          && state.settings.hasReconciledPlaytime !== true
          && Object.keys(pt.perServer).length > 0) {
        try {
          const res = await window.hub.post('/api/playtime/reconcile', { perServer: pt.perServer });
          if (res && res.success) {
            await window.hub.post('/api/settings', { hasReconciledPlaytime: true }).catch(() => {});
            state.settings.hasReconciledPlaytime = true;
            // Refresh server list + stats now that VPS has merged data
            try { invalidateCaches('stats'); } catch {}
            loadServers({ quiet: true }).catch(() => {});
          }
        } catch {}
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

  // Wire the force-update modal so any 426 from the hub API triggers
  // it. Has to be initialised AFTER preload's window.hub is available,
  // which it always is by this point.
  if (window.RspsHubForceUpdate) {
    try { window.RspsHubForceUpdate.init(); } catch (_) {}
  }

  // First-launch onboarding tour. Auto-fires once per device when the
  // signed-in user lands on the store with the UI fully painted. No-op
  // after the first completion. Users can re-run via Settings.
  if (state.user && window.RspsHubOnboarding) {
    try { window.RspsHubOnboarding.autoStart(); } catch (_) {}
  }

  // Background quiet refresh — every 60s pull a fresh server list so
  // server_online / hub_players / NEW badges update without the user
  // having to hit the Refresh button. No spinner, no card flash.
  setInterval(() => {
    if (!state.user) return;                                // not logged in yet
    if (document.hidden) return;                            // tab/window minimised
    if (document.querySelector('.modal.open, .stats-overlay, .sd-overlay')) return; // user mid-action
    loadServers({ quiet: true }).catch(() => {});
  }, 60_000);
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
      notifBtn.classList.add('dropdown-open');
      notifBtn.classList.remove('rh-tip'); // suppress hover tooltip while open
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
      acctBtn.classList.add('dropdown-open');
      acctBtn.classList.remove('rh-tip'); // suppress hover tooltip while open
    }
  });

  // Clicks inside either dropdown must not bubble up to the document listener
  notifDropdown?.addEventListener('click', e => e.stopPropagation());
  acctDropdown?.addEventListener('click',  e => e.stopPropagation());

  document.addEventListener('click', closeAllDropdowns);

  // Global delegation: any element with [data-open-profile="username"] opens
  // that user's public profile modal. Used by reviews, news, leaderboard, friends.
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-open-profile]');
    if (!el) return;
    const username = el.dataset.openProfile;
    if (username && window.openUserProfile) {
      e.stopPropagation();
      window.openUserProfile(username);
    }
  });

  // Right-click on any [data-open-profile] = report that user. Skipped for
  // the current user (can't report yourself). Works in chat, friends list,
  // DMs, news comments, leaderboard, reviews — anywhere usernames render.
  document.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('[data-open-profile]');
    if (!el) return;
    const username = el.dataset.openProfile;
    if (!username || username === state.user?.username) return;
    e.preventDefault();
    e.stopPropagation();
    window.openReportModal?.('user', username, username);
  });

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
  // Restore hover tooltip class on the trigger buttons
  for (const id of ['btn-notifications', 'btn-account']) {
    const b = document.getElementById(id);
    if (!b) continue;
    b.classList.remove('dropdown-open');
    if (!b.classList.contains('rh-tip')) b.classList.add('rh-tip');
  }
}

// Returns the right <img src> for a given user's avatar.
// - For the current user: uses their local `~/.rsps_hub/avatar.png` (instant,
//   no network hop, reflects un-saved local changes immediately).
// - For other users: uses the server URL (uploaded via /api/users/upload-avatar).
//   Caller should fall back to a letter glyph if the user has no server avatar.
function userAvatarSrc(username, opts = {}) {
  const { hasAvatar = false, isMe = false } = opts;
  // Self-detection has to be bulletproof — case-insensitive match on username,
  // OR explicit isMe flag from the caller. If we get this wrong the leaderboard
  // shows the user's stale server-uploaded avatar instead of their fresh local
  // one, and they see two different images for "themselves" in the same UI.
  const me = state.user?.username || '';
  const isSelf = !!isMe || (username && me && String(username).toLowerCase() === me.toLowerCase());
  if (isSelf) {
    // Prefer the local file (instant, reflects un-uploaded edits).
    if (state.profile?.avatarPath) {
      return 'file:///' + state.profile.avatarPath.replace(/\\/g, '/') + '?t=' + Date.now();
    }
    // Fall through to the server copy — useful right after register/login,
    // before the local file has been hydrated from the server.
    if (state.profile?.hasAvatar || hasAvatar) {
      const safe = String(me).replace(/[^a-zA-Z0-9_-]/g, '');
      if (safe) return `https://api.therspshub.com/uploads/avatars/${encodeURIComponent(safe)}.jpg?t=${Date.now()}`;
    }
    return null;
  }
  if (!hasAvatar) return null;
  // Server stores at /uploads/avatars/<safeName>.jpg. Sanitize same way
  // server does so the URL doesn't 404 on usernames with special chars.
  const safe = String(username).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return null;
  // Cache-bust per launcher session so when someone uploads a new avatar,
  // it appears across DM headers / leaderboard / chat without browser cache
  // serving the previous version. Uses a session-scoped stamp (first call
  // wins) so we don't refetch the same image hundreds of times during one
  // session.
  if (!window._avatarSessionStamp) window._avatarSessionStamp = Date.now();
  return `https://api.therspshub.com/uploads/avatars/${encodeURIComponent(safe)}.jpg?v=${window._avatarSessionStamp}`;
}
window.userAvatarSrc = userAvatarSrc;

// Hub-wide cache invalidation helper. Used after friend / store / coin
// mutations so the next panel render fetches fresh data from the server
// instead of serving the 30-second TTL cache and "popping back up" stale
// rows the user just removed.
function invalidateCaches(...keys) {
  if (!window.DATA_CACHE) return;
  for (const k of keys) {
    if (window.DATA_CACHE[k]) {
      window.DATA_CACHE[k].data = null;
      window.DATA_CACHE[k].at   = 0;
    }
  }
}
window.invalidateCaches = invalidateCaches;

// ── Equipped-cosmetic helpers (Hub Store Phase 2 social) ─────────────────────
// Most social endpoints (hub chat, DMs, conversations, friends list, friend
// requests) now embed each user's `equipped.{title,color}` in their rows.
// These helpers render the title pill + name-color style consistently
// wherever a username appears.
//
// `equipped` shape: { title: { name, style: { nameStyle? } } | null,
//                     color: { name, style: { nameStyle? } } | null }

// Inline style attr to apply to the username text element. Returns "" if
// no name color equipped (fall through to default styling). Includes the
// inline-block + padding-right hack so gradient bg-clip-text doesn't clip
// the last letter — same Chromium bug we hit on the stats hero.
function nameStyleAttr(equipped) {
  const css = equipped?.color?.style?.nameStyle;
  if (!css) return '';
  return `style="${css}; display:inline-block; padding-right:0.15em"`;
}

// Renders a username as a string of `<span>` elements, one per letter, when
// the equipped name colour is a "split letters" effect (Bouncing Letters,
// Domino Flip, etc). The wrapping element gets the per-letter CSS class
// (`nc-bounce`, `nc-domino`...) so the keyframes can animate each glyph
// independently. For ordinary colours, returns the username with the
// regular nameStyleAttr applied.
//
// Use as: `${renderName(username, equipped)}`  (returns full <span>...).
function renderName(username, equipped) {
  const safe = escHtml(username || '');
  const colorStyle = equipped?.color?.style || {};
  if (colorStyle.splitLetters && colorStyle.ncClass) {
    const letters = String(username || '').split('').map(ch =>
      `<span>${escHtml(ch)}</span>`
    ).join('');
    return `<span class="${escAttr(colorStyle.ncClass)}" style="display:inline-block">${letters}</span>`;
  }
  // Ordinary single-element gradient/effect — apply inline style.
  const styleAttr = nameStyleAttr(equipped);
  return styleAttr
    ? `<span ${styleAttr}>${safe}</span>`
    : safe;
}
window.renderName = renderName;

// ── LAUNCHER THEMES ──────────────────────────────────────────────────────────
// Phase 0 of the Hub Store theme system. Themes live as items in the store
// catalog with style_json carrying a palette. When equipped, applyTheme()
// injects a single <style id="theme-vars"> block that overrides :root vars,
// repainting the title bar / sidebars / background on the fly.
//
// Token names match the defaults declared at the top of style.css.
//
// Usage from console (for testing):
//   applyTheme({ bgColor:'#1a0808', sidebarBg:'#2a0808', accent:'#ff4040' })
//   clearTheme()
const THEME_TOKEN_MAP = {
  bgColor:           '--bg-color',
  bgImage:           '--bg-image',           // CSS url(...) or 'none'
  bgImageFilter:     '--bg-image-filter',    // e.g. 'brightness(0.6)'
  centerImage:         '--center-image',          // banner over bg, under chrome
  centerImageFilter:   '--center-image-filter',
  centerImageSize:     '--center-image-size',     // cover | contain | <length>
  centerImagePosition: '--center-image-position', // e.g. "center top", "70% 50%"
  titlebarBg:        '--titlebar-bg',
  titlebarBorder:    '--titlebar-border',
  navbarBg:          '--navbar-bg',
  navbarBorder:      '--navbar-border',
  sidebarBg:         '--sidebar-bg',
  sidebarBorder:     '--sidebar-border',
  rsTabBg:           '--rstab-bg',
  rsTabBgHover:      '--rstab-bg-hover',
  rsTabBgActive:     '--rstab-bg-active',
  rsTabBorder:       '--rstab-border',
  accent:            '--accent',
  accentHot:         '--accent-hot',
};

// Per-user cache of the last-applied theme palette. Lets a login paint the
// equipped theme INSTANTLY from localStorage instead of waiting for the
// /api/store/list round-trip + JSON parse + applyEquippedThemeOnLoad chain
// to resolve. The catalog fetch still runs in the background and the real
// state always wins; the cache is purely a paint-asap optimisation. Key
// shape: rsps_hub_theme_${username}. Stored value is the same shape
// applyTheme expects: { palette, overlayHtml?, overlayCss? } or null if
// the user has nothing equipped.
function _themeCacheKey(username) {
  if (!username) return null;
  return 'rsps_hub_theme_' + String(username).toLowerCase();
}
function saveThemeCache(username, payload) {
  const k = _themeCacheKey(username);
  if (!k) return;
  try {
    if (payload && payload.palette) {
      localStorage.setItem(k, JSON.stringify(payload));
    } else {
      // payload null/no-palette signals "user unequipped" — drop the cache
      // so the next login doesn't repaint a theme they no longer have.
      localStorage.removeItem(k);
    }
  } catch (_) { /* quota or private-mode: silent */ }
}
function loadThemeCache(username) {
  const k = _themeCacheKey(username);
  if (!k) return null;
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && obj.palette) return obj;
  } catch (_) {}
  return null;
}
// Public so hubstore.js can update the cache from applyEquippedThemeOnLoad.
window.saveThemeCache = saveThemeCache;
window.loadThemeCache = loadThemeCache;

// Paint the cached theme for `username` immediately if one exists. Called
// from the login paths before the catalog fetch resolves. Idempotent.
function paintCachedThemeFor(username) {
  const cached = loadThemeCache(username);
  if (cached && cached.palette) {
    applyTheme(cached.palette, cached.overlayHtml || '', cached.overlayCss || '');
  } else {
    // No cache (new user, cleared storage, or unequipped): make sure no
    // previous user's theme is sticking around.
    clearTheme();
  }
}
window.paintCachedThemeFor = paintCachedThemeFor;

function applyTheme(palette, overlayHtml, overlayCss) {
  if (!palette || typeof palette !== 'object') return;
  // Overlay SVGs (leaves, anvil, crown, runic rings, jellyfish) are
  // disabled — banner images are now the sole centerpiece. Keep the
  // signature so callers don't have to change.
  overlayHtml = '';
  overlayCss  = '';
  const lines = [];
  for (const [key, val] of Object.entries(palette)) {
    const cssVar = THEME_TOKEN_MAP[key];
    if (!cssVar || val == null || val === '') continue;
    lines.push(`  ${cssVar}: ${val};`);
  }
  if (!lines.length) { clearTheme(); return; }
  let tag = document.getElementById('theme-vars');
  if (!tag) {
    tag = document.createElement('style');
    tag.id = 'theme-vars';
    document.head.appendChild(tag);
  }
  tag.textContent = `:root {\n${lines.join('\n')}\n}\n`;

  // Optional SVG / animated overlay layer. Lives at body level behind the
  // chrome (z-index 0, while .body > * children are z-index 1). Lets a
  // theme ship a centerpiece spectacle (astrolabe, forge, sigil, etc.)
  // that quietly animates behind the launcher. Cleared on unequip.
  let overlay = document.getElementById('theme-overlay');
  let overlayStyle = document.getElementById('theme-overlay-css');
  if (overlayHtml) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'theme-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden';
      document.body.insertBefore(overlay, document.body.firstChild);
    }
    overlay.innerHTML = overlayHtml;
  } else {
    overlay?.remove();
  }
  if (overlayCss) {
    if (!overlayStyle) {
      overlayStyle = document.createElement('style');
      overlayStyle.id = 'theme-overlay-css';
      document.head.appendChild(overlayStyle);
    }
    overlayStyle.textContent = overlayCss;
  } else {
    overlayStyle?.remove();
  }
}

function clearTheme() {
  document.getElementById('theme-vars')?.remove();
  document.getElementById('theme-overlay')?.remove();
  document.getElementById('theme-overlay-css')?.remove();
}

// Called after login + after equip/unequip in the store. Looks up the
// equipped theme item from the catalog and applies its palette. No-op if
// none equipped, or if the catalog hasn't loaded the user's equipped slot
// yet (which is fine — applyTheme will be called again post-load).
function applyEquippedThemeIfAny() {
  const t = state.equipped?.theme?.style;
  if (t?.palette) {
    applyTheme(t.palette, t.overlayHtml, t.overlayCss);
  } else {
    clearTheme();
  }
}

window.applyTheme               = applyTheme;
window.clearTheme               = clearTheme;
window.applyEquippedThemeIfAny  = applyEquippedThemeIfAny;

// Tiny gold/gradient title pill that sits under or beside a username in
// chat / DMs / friends / etc. Returns "" if no title equipped.
function equippedTitleHTML(equipped, opts = {}) {
  const t = equipped?.title;
  if (!t || !t.name) return '';
  const css = t.style?.nameStyle || '';
  const styleAttr = css
    ? `style="${css}; display:inline-block; padding:0 6px"`
    : '';
  const klass = opts.size === 'tiny' ? 'eq-title eq-title-tiny' : 'eq-title';
  return `<span class="${klass}" ${styleAttr}>${escHtml(t.name)}</span>`;
}

window.nameStyleAttr     = nameStyleAttr;
window.equippedTitleHTML = equippedTitleHTML;

// Returns inner HTML for an avatar circle: <img> when we have a source,
// else the user's first-letter glyph. Falls back to letter on img error.
function avatarInnerHTML(username, opts = {}) {
  const letter = (username || '?')[0].toUpperCase();
  const src = userAvatarSrc(username, opts);
  if (!src) return letter;
  return `<img src="${src}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${letter}'}))" />`;
}
window.avatarInnerHTML = avatarInnerHTML;

function updateNavbarAvatar() {
  const p         = state.profile || {};
  const navImg    = document.getElementById('nav-avatar-img');
  const navInitial = document.getElementById('user-initial');
  if (!navImg || !navInitial) return;

  const fallback = () => {
    navImg.style.display = 'none';
    navInitial.style.display = '';
    navInitial.textContent = (p.displayName || state.user?.username || 'P')[0].toUpperCase();
  };
  const username = state.user?.username;
  if (!username) { fallback(); return; }

  // Prefer local file if hydrated. Otherwise blindly try the server URL —
  // onerror swaps to the initial letter if there's no avatar. Avoids
  // having to coordinate hasAvatar across every endpoint.
  let src = null;
  if (p.avatarPath) {
    src = 'file:///' + p.avatarPath.replace(/\\/g, '/') + '?t=' + Date.now();
  } else {
    const safe = String(username).replace(/[^a-zA-Z0-9_-]/g, '');
    if (safe) src = `https://api.therspshub.com/uploads/avatars/${encodeURIComponent(safe)}.jpg?t=${Date.now()}`;
  }
  if (!src) { fallback(); return; }

  navImg.onerror = fallback;
  navImg.onload  = () => {
    navImg.style.display = '';
    navInitial.style.display = 'none';
  };
  navImg.src = src;
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
  const ch         = (displayName[0] || '?').toUpperCase();
  const showInitials = () => {
    if (avatarImg) avatarImg.style.display = 'none';
    if (navImg)    navImg.style.display    = 'none';
    if (initial)    { initial.style.display    = ''; initial.textContent    = ch; }
    if (navInitial) { navInitial.style.display = ''; navInitial.textContent = ch; }
  };
  // Prefer local file if hydrated. Otherwise blindly try server URL with
  // onerror fallback — same trick as updateNavbarAvatar.
  let src = null;
  if (p.avatarPath) {
    src = 'file:///' + p.avatarPath.replace(/\\/g, '/') + '?t=' + Date.now();
  } else {
    const safe = String(state.user?.username || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (safe) src = `https://api.therspshub.com/uploads/avatars/${encodeURIComponent(safe)}.jpg?t=${Date.now()}`;
  }
  if (!src) { showInitials(); }
  else {
    if (avatarImg) {
      avatarImg.onerror = showInitials;
      avatarImg.onload  = () => { avatarImg.style.display = ''; if (initial) initial.style.display = 'none'; };
      avatarImg.src = src;
    }
    if (navImg) {
      navImg.onerror = showInitials;
      navImg.onload  = () => { navImg.style.display = ''; if (navInitial) navInitial.style.display = 'none'; };
      navImg.src = src;
    }
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

  // Total playtime — prefer the authoritative number from /api/stats/me (same
  // field the Stats tab + status bar use). Fall back to summing perServer.
  const totalMins = (typeof _playtimeTotalMins === 'number' && _playtimeTotalMins !== null)
    ? _playtimeTotalMins
    : Object.values(state.playtime).reduce((a, m) => a + m, 0);
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
          <p id="avatar-chosen-name" style="font-family:'Inter',sans-serif;font-size:0.78rem;color:#7a6a4a;margin-top:8px;min-height:16px;"></p>
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

      // Upload to the server too so leaderboards / chat / public profiles
      // (anywhere OTHER players see this user) can show the avatar.
      // Server stores at /uploads/avatars/<username>.jpg.
      try {
        const base64 = await window.hub.readFileBase64(finalPath);
        if (base64) {
          await window.hub.post('/api/users/upload-avatar', { image: base64 });
          // Reflect server-side flag in cached profile so the achievement
          // engine + UI know we have a server avatar.
          state.profile.hasAvatar = true;
        }
      } catch (uploadErr) {
        console.error('[Avatar] server upload failed:', uploadErr);
        // Local save still succeeded, so don't fail the whole flow — but
        // tell the user other players might not see it yet.
        showToast('Avatar saved locally, but failed to sync to server. Try again in a moment.', 'info');
      }

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

async function loadServers(opts = {}) {
  // `quiet` skips the loading overlay so background refreshes don't flash
  // a spinner across the screen. The cron updates server_online every
  // 5 min; a 60s quiet poll picks that up without annoying the user.
  const quiet = !!opts.quiet;
  if (!quiet) showLoading(true);
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
    if (!quiet) state.servers = [];
    const countEl = document.getElementById('status-server-count');
    if (countEl) countEl.textContent = '● Offline';
  }
  if (!quiet) showLoading(false);
  renderServers();

  // Once per session, after the first successful load, scan every already
  // installed server for a newer JAR on the dev's website and silently
  // re-download if the remote has changed. Java's downloadClient is smart
  // enough to no-op when the remote is unchanged, so this is cheap.
  if (!_jarRefreshDone && state.servers.length) {
    _jarRefreshDone = true;
    setTimeout(refreshInstalledJars, 1500);   // give the UI a beat first
  }
}

// One-shot per launcher session — see loadServers() above.
let _jarRefreshDone = false;
async function refreshInstalledJars() {
  // Skip native .exe clients (BattleScape, EmberHold, Bethlehem, etc.).
  // They self-update via their own internal patcher; redownloading the
  // installer here is wasteful and can clobber a running .exe.
  const installed = state.servers.filter(s =>
    s.downloaded && s.jarUrl && !/\.exe(\?|$)/i.test(s.jarUrl)
  );
  if (!installed.length) return;
  console.log(`[jar-refresh] checking ${installed.length} installed JAR server(s) for updates...`);
  let updated = 0;
  for (const s of installed) {
    try {
      // Java decides whether to actually re-download based on remote
      // ETag / Last-Modified / size; if unchanged, this is a no-op HEAD.
      const res = await api.install(s.name, s.jarUrl, s.jarSha256, s.jarSizeBytes);
      if (res?.success) updated += 1;
    } catch (_) { /* best effort; never block the user */ }
  }
  console.log(`[jar-refresh] done. ${updated}/${installed.length} processed.`);
}

// ── REQUEST A SERVER ─────────────────────────────────────────────────────────
// Players hit the "+ Request a Server" button next to Refresh on the Store
// header. They submit the server name (required) plus optional links + reason.
// Posts go into the `server_requests` table; staff review them via the Dev
// Portal "Server Requests" section.
function openRequestServerModal() {
  if (!state.user) {
    showToast('Sign in first to request a server.', 'error');
    return;
  }
  if (document.getElementById('rsm-backdrop')) return;

  const overlay = document.createElement('div');
  overlay.id = 'rsm-backdrop';
  overlay.className = 'rsm-backdrop';
  overlay.innerHTML = `
    <div class="rsm-modal" role="dialog" aria-modal="true">
      <div class="rsm-hdr">
        <h3>Request a Server</h3>
        <button class="rsm-close" id="rsm-close" aria-label="Close">✕</button>
      </div>
      <div class="rsm-body">
        <p class="rsm-intro">Know an RSPS that should be in the launcher? Tell us — we'll reach out to the owner. Server name is the only required field.</p>

        <label class="rsm-label">Server name <span class="rsm-req">*</span></label>
        <input class="rsm-input" id="rsm-name" type="text" maxlength="96" placeholder="e.g. AwesomeRSPS" autocomplete="off">

        <label class="rsm-label">Website <span class="rsm-hint">(optional)</span></label>
        <input class="rsm-input" id="rsm-web" type="text" maxlength="512" placeholder="https://...">

        <label class="rsm-label">Discord <span class="rsm-hint">(optional)</span></label>
        <input class="rsm-input" id="rsm-disc" type="text" maxlength="512" placeholder="https://discord.gg/...">

        <label class="rsm-label">Why this server? <span class="rsm-hint">(optional)</span></label>
        <textarea class="rsm-input rsm-textarea" id="rsm-reason" maxlength="1000" placeholder="What makes it good? Any context that'd help us reach out?"></textarea>

        <div class="rsm-msg" id="rsm-msg"></div>
      </div>
      <div class="rsm-foot">
        <button class="rsm-btn" id="rsm-cancel">Cancel</button>
        <button class="rsm-btn rsm-btn-primary" id="rsm-submit">Submit Request</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('mousedown', e => e.stopPropagation());

  const close = () => overlay.remove();
  overlay.querySelector('#rsm-close').addEventListener('click', close);
  overlay.querySelector('#rsm-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });

  setTimeout(() => overlay.querySelector('#rsm-name').focus(), 30);

  overlay.querySelector('#rsm-submit').addEventListener('click', async () => {
    const name   = overlay.querySelector('#rsm-name').value.trim();
    const web    = overlay.querySelector('#rsm-web').value.trim();
    const disc   = overlay.querySelector('#rsm-disc').value.trim();
    const reason = overlay.querySelector('#rsm-reason').value.trim();
    const msgEl  = overlay.querySelector('#rsm-msg');
    const btn    = overlay.querySelector('#rsm-submit');

    if (!name) { msgEl.textContent = 'Server name is required.'; return; }
    for (const [u, label] of [[web, 'Website'], [disc, 'Discord']]) {
      if (u && !/^https?:\/\//i.test(u)) {
        msgEl.textContent = `${label} must start with http:// or https://`;
        return;
      }
    }

    btn.disabled = true; btn.textContent = 'Sending…'; msgEl.textContent = '';
    try {
      const res = await window.hub.post('/api/server_requests/submit', {
        server_name: name, website_url: web, discord_url: disc, reason,
      });
      if (res?.ok) {
        close();
        showToast('Request submitted. Thanks — staff will look into it.', 'success');
      } else {
        msgEl.textContent = res?.error || 'Failed to submit. Try again later.';
      }
    } catch (e) {
      msgEl.textContent = e?.message || 'Network error.';
    }
    btn.disabled = false; btn.textContent = 'Submit Request';
  });
}
window.openRequestServerModal = openRequestServerModal;

function getFilteredServers() {
  let list = [...state.servers];

  // Search — only matches the START of a server name. Typing "del" matches
  // Delanor; typing "nor" does NOT match Galanor.
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(s => s.name.toLowerCase().startsWith(q));
  }

  // Tag filter
  if (state.activeTag !== 'All') {
    list = list.filter(s => s.tags && s.tags.some(t =>
      t.toLowerCase() === state.activeTag.toLowerCase()
    ));
  }

  // Sort
  if (state.sortOrder === 'players')   list.sort((a, b) => (b.hubPlayers || 0) - (a.hubPlayers || 0));
  // The Java backend serialises these as camelCase (`reviewCount`,
  // `avgRating`). The PHP endpoint uses snake_case but Java's
  // ServerProfile maps with @SerializedName and re-emits camelCase. Reading
  // the snake_case names here was returning undefined on every server, so
  // every comparator returned 0 and `list.sort` was a no-op (Whiprealgood's
  // bug — Most Reviewed showed servers in API order, not by reviews).
  if (state.sortOrder === 'rating') {
    // Highest Rated: sort by count of 5-star reviews, not raw avgRating.
    // avgRating alone makes a server with one 5-star review beat a server
    // with 50 reviews averaging 4.8. By counting 5-stars we surface
    // servers that lots of players genuinely rate top. Tiebreak on avg
    // rating then total review count so within a five-star tier the
    // better-reviewed server still wins.
    list.sort((a, b) =>
      (b.fiveStarCount || 0) - (a.fiveStarCount || 0)
      || (+b.avgRating || 0) - (+a.avgRating || 0)
      || (b.reviewCount || 0) - (a.reviewCount || 0)
    );
  }
  if (state.sortOrder === 'reviews')   list.sort((a, b) => (b.reviewCount || 0) - (a.reviewCount || 0) || (+b.avgRating || 0) - (+a.avgRating || 0));
  if (state.sortOrder === 'name-asc')  list.sort((a, b) => a.name.localeCompare(b.name));
  if (state.sortOrder === 'name-desc') list.sort((a, b) => b.name.localeCompare(a.name));
  if (state.sortOrder === 'recent') {
    // Newest server first by created_at (camelCase or snake_case from API).
    list.sort((a, b) => {
      const ta = a.createdAt || a.created_at || '';
      const tb = b.createdAt || b.created_at || '';
      return tb.localeCompare(ta);
    });
  }

  // Favourites no longer pin to the main server list. They live only in the
  // left-hand favourites sidebar so the user's explicit sort always wins.
  // Pinning unrated favourites above 5-star non-favourites was the bug
  // Whiprealgood reported ("top results have no reviews while others
  // underneath do"). The favourites sidebar still gives one-click access.
  return list;
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
  // Tri-state status: 1 online, 0 offline, -1 unknown (no game_port and
  // no website to ping). Hide the dot entirely on unknown rather than
  // lying — see ping_servers.php.
  const statusCode   = (typeof server.serverOnline === 'number') ? server.serverOnline : -1;
  const isOnline     = statusCode === 1;
  const isUnknown    = statusCode === -1;
  const players      = server.hubPlayers || 0;
  const minutes      = state.playtime[server.name] || 0;
  const level        = calcLevel(minutes);
  const xpPct        = calcXpProgress(minutes);
  const rankName     = getRankName(level);
  const milestoneClr = getMilestoneColor(level);
  const tags         = (server.tags || []).slice(0, 6);
  const accent       = server.accentColor || server.accent_color || '#c8a840';

  // Smart badges
  const createdAt = server.createdAt || server.created_at;
  const ageDays   = createdAt ? (Date.now() - new Date(createdAt.replace(' ', 'T') + 'Z').getTime()) / 86_400_000 : 999;
  const isNew     = ageDays <= 14;
  const isActive  = players >= 5;

  // Visual star pictograph from avg_rating
  function starsFromRating(r) {
    const v = +r || 0;
    const full = Math.floor(v);
    const half = (v - full) >= 0.5 ? 1 : 0;
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - half);
  }

  const bannerGradient = bannerColor(server.name);
  const card = document.createElement('div');
  card.className = 'server-card';
  card.style.cssText = `display:flex;align-items:stretch;min-height:115px;background:linear-gradient(135deg,#3a3020,#281e10);border:1px solid #6b5228;border-left:4px solid ${accent};border-radius:4px;overflow:hidden;margin-bottom:0;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,0.8), inset 4px 0 12px ${accent}33;transition:transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;`;
  card.style.setProperty('--accent', accent);
  card.innerHTML = `
    <div class="card-banner" style="background:${bannerGradient};width:210px;min-width:210px;height:115px;position:relative;overflow:hidden;border-right:1px solid #3a2e14;">
      ${server.cardBannerUrl || server.bannerUrl
        ? `<img src="${escHtml(server.cardBannerUrl || server.bannerUrl)}" alt="${escHtml(server.name)}" onerror="this.style.display='none'">`
        : `<span class="banner-placeholder">${escHtml(server.name)}</span>`
      }
      ${(isNew || isActive) ? `
      <div class="card-badges">
        ${isNew    ? '<span class="card-badge b-new">NEW</span>' : ''}
        ${isActive ? '<span class="card-badge b-hot">🔥 ACTIVE</span>' : ''}
      </div>` : ''}
      ${buildLiveBadgeHTML(server)}
    </div>
    <div class="card-info">
      <div class="card-header">
        <span class="card-title">${escHtml(server.name)}</span>
        ${isUnknown ? '' : `<span class="status-dot ${isOnline ? 'online' : 'offline'}"></span>`}
        ${(() => {
          // Pinned announcement from the owner — shows up to viewers as a
          // small gold chip next to the name. Expires automatically per
          // announcementUntil set in the dashboard.
          if (!server.announcement) return '';
          if (server.announcementUntil) {
            const t = new Date(server.announcementUntil).getTime();
            if (t && t < Date.now()) return '';
          }
          return `<span class="card-announcement" title="${escAttr(server.announcement)}">
                    <span class="ann-pin">📌</span><span class="ann-text">${escHtml(server.announcement)}</span>
                  </span>`;
        })()}
        <span class="level-badge-wrap"
          data-lv="${level}"
          data-rank="${escHtml(rankName)}"
          data-mc="${milestoneClr}"
          data-orb="${escHtml(server.name[0].toUpperCase())}"
          data-xp="${Math.round(xpPct*100)}"
          data-time="${escHtml(calcTooltip(server.name, level, minutes).split('·')[1]?.trim() || 'Max level')}">
          <span class="level-badge" style="border-color:${accent};color:${accent}">Lv. ${level}</span>
        </span>
      </div>
      <p class="card-desc">${escHtml(truncate(server.description || '', 200))}</p>
      <div class="card-tags">
        ${tags.map(t => `<span class="tag-pill">${escHtml(String(t).toUpperCase())}</span>`).join('')}
        ${server.reviewCount > 0 ? `
          <span class="card-stars-row">
            <span class="card-stars">${starsFromRating(server.avgRating)}</span>
            <span class="card-stars-num">${(+server.avgRating).toFixed(1)}</span>
            <span class="card-stars-count">· ${server.reviewCount}</span>
          </span>
        ` : ''}
      </div>
    </div>
    <div class="card-actions">
      <span class="player-count">${buildPlayerCountHTML(server, players)}</span>
      ${server.launchType === 'web'
        ? `<button class="action-btn play-btn" data-action="play-web" data-name="${escAttr(server.name)}">PLAY</button>`
        : `<button class="action-btn ${isDownloaded ? 'play-btn' : 'install-btn'}"
                  data-action="${isDownloaded ? 'play' : 'install'}"
                  data-name="${escAttr(server.name)}">
             ${isDownloaded ? 'PLAY' : 'INSTALL'}
           </button>`
      }
      <button class="fav-btn ${isFav ? 'active' : ''}" data-name="${escAttr(server.name)}">
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
    btn.classList.add('is-loading');
    btn.textContent = action === 'play' ? 'Updating...'
                    : action === 'play-web' ? 'Opening...'
                    : 'Downloading...';
    try {
      if (action === 'play-web') {
        await launchWebServer(server);
        btn.classList.remove('is-loading');
        btn.disabled = false;
        btn.textContent = 'PLAY';
        return;
      }
      if (action === 'play') {
        await api.play(server.name);
        btn.classList.remove('is-loading');
        btn.disabled = false;
        btn.textContent = 'PLAY';
        startActiveSessionChip(server.name);
        if (state.settings?.minimizeOnLaunch) window.hub.minimize();
      }
      if (action === 'install') {
        const result = await api.install(server.name, server.jarUrl, server.jarSha256, server.jarSizeBytes);
        if (result && result.error) {
          showToast('Install failed: ' + result.error, 'error');
          btn.classList.remove('is-loading');
          btn.disabled = false;
          btn.textContent = 'INSTALL';
        } else if (result && result.success) {
          await loadServers();
        } else {
          showToast('Unexpected response: ' + JSON.stringify(result), 'error');
          btn.classList.remove('is-loading');
          btn.disabled = false;
          btn.textContent = 'INSTALL';
        }
      }
    } catch (err) {
      console.error('Install error:', err);
      showToast('Install failed: ' + (err.message || err), 'error');
      btn.classList.remove('is-loading');
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
    // No `title` attribute — that produces the ugly native OS tooltip with
    // wrong colors / wrong font. The .fav-tooltip span below is the custom
    // themed hover-name instead.
    const safeInitial = escHtml(name[0].toUpperCase());
    // Don't truncate the name client-side. Let CSS handle overflow with
    // ellipsis so we keep as much of the name visible as the slot allows,
    // and the full name still shows in the hover tooltip.
    const safeName = escHtml(name);
    slot.innerHTML = `
      ${server?.serverOnline === 1 ? '<span class="fav-online-dot"></span>' : ''}
      <button class="fav-remove-btn" aria-label="Remove favourite">✕</button>
      <span class="fav-initial">${safeInitial}</span>
      <span class="fav-name">${safeName}</span>
      <span class="fav-tooltip">${safeName}</span>
    `;
    // Quick-play: click the slot to launch instead of opening the detail
    // modal. Web servers open their BrowserWindow. Installed JAR servers
    // start the game directly with the session chip. Not-yet-installed
    // ones fall back to the detail page so the user can install first.
    slot.addEventListener('click', async e => {
      if (e.target.closest('.fav-remove-btn')) return;
      if (!server) return;
      if (server.launchType === 'web') {
        try { await launchWebServer(server); }
        catch { showToast('Failed to launch ' + server.name, 'error'); }
        return;
      }
      if (server.downloaded) {
        try {
          await api.play(server.name);
          startActiveSessionChip(server.name);
          if (state.settings?.minimizeOnLaunch) window.hub.minimize();
        } catch { showToast('Failed to launch ' + server.name, 'error'); }
        return;
      }
      // Not installed yet: show details so they can hit Install.
      showServerDetail(server);
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

/**
 * Build the player-count line for a server card. Logic:
 *  - If the server has self-reported a count in the last 10 min, show it as
 *    the primary number ("X live") with the hub count as a secondary
 *    verification badge so users can spot fake inflation.
 *  - Otherwise just show the hub count we trust directly.
 */
function buildPlayerCountHTML(server, hubPlayers) {
  // Always single-line, byte-identical to the original. The server-reported
  // live count (when fresh) is rendered as a floating badge on the banner
  // image instead — see buildLiveBadgeHTML — so the action column stays
  // the same size as every other card.
  return (hubPlayers > 0 ? '<span class="player-pulse"></span>' : '▲ ') +
         `${formatNumber(hubPlayers)} Hub Players Online`;
}

/** Returns an HTML snippet for the "X in game" pill that overlays the
 *  server card banner. Empty string when no fresh self-report exists. */
function buildLiveBadgeHTML(server) {
  const selfCount = server.playersOnline || 0;
  const ageSec    = server.playersOnlineAgeSeconds;
  const isFresh   = typeof ageSec === 'number' && ageSec >= 0 && ageSec < 600;
  if (!isFresh || selfCount <= 0) return '';
  return `<span class="card-live-badge" title="Server-reported live player count">● ${formatNumber(selfCount)} in game</span>`;
}

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

const PANEL_TITLES = { friends: 'Friends', chat: 'Friends Chat', groupchat: 'Hub Chat', stats: 'Stats', leaderboard: 'Leaderboard', achievements: 'Achievements', music: 'Music', settings: 'Settings' };

function setupSidebarTabs() {
  const panel     = document.getElementById('slide-panel');
  const closeBtn  = document.getElementById('slide-panel-close');
  const titleEl   = document.getElementById('slide-panel-title');
  const bodyEl    = document.getElementById('slide-panel-body');

  document.querySelectorAll('.rs-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const panelId = btn.dataset.panel;
      // Tabs without a data-panel (e.g. the UPDATE button) are action
      // tabs that have their own click handler elsewhere. Don't try to
      // open the slide panel for them.
      if (!panelId) return;
      const already = btn.classList.contains('active');

      // Toggle off if clicking same one
      document.querySelectorAll('.rs-tab').forEach(b => b.classList.remove('active'));
      if (already) {
        panel.classList.remove('open');
        return;
      }

      // STATS opens a centered modal (player profile dashboard) instead of
      // the slide panel — too much content for a 360-px sidebar.
      if (panelId === 'stats') {
        if (window.openStatsModal) window.openStatsModal();
        // No persistent active state — modal close puts us back to the
        // last real tab (Store / News / etc).
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

  // Strip the DM-only host class on every tab change. .dm-host applies
  // `overflow: hidden !important` so the chat surface can manage its own
  // scroll — leaving it on a non-DM tab kills scrolling everywhere
  // (achievements / stats / friends list etc.) until reload.
  el.classList.remove('dm-host');
  // Hub Chat (openGCRoom) sets inline `overflow:hidden; padding:0` on the
  // panel so the chat surface can fill the whole viewport. Inline styles
  // beat CSS classes, so leaving them in place after the user switches to
  // Achievements / Friends / Leaderboard freezes those tabs at viewport
  // height — content overflows but never scrolls. Reset them every time.
  el.style.overflow = '';
  el.style.padding  = '';

  // Stop the Hub Store featured-banner auto-rotate when switching away.
  // The store re-arms its own timer when the user comes back.
  if (tab !== 'hubstore' && window._hsFeatTimer) {
    clearInterval(window._hsFeatTimer);
    window._hsFeatTimer = null;
  }

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
      btn.addEventListener('click', async () => {
        const name = btn.getAttribute('data-lib-name') || '';
        const action = btn.getAttribute('data-lib-action');
        if (action === 'play') {
          // Show spinner so the player knows the launcher is doing the
          // pre-launch JAR freshness check, not frozen.
          const original = btn.textContent;
          btn.disabled = true;
          btn.classList.add('is-loading');
          btn.textContent = 'Updating...';
          try {
            await handleLibraryPlay(name);
          } finally {
            btn.classList.remove('is-loading');
            btn.disabled = false;
            btn.textContent = original;
          }
        } else if (action === 'uninstall') {
          handleLibraryUninstall(name);
        }
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
    // Launcher self-update toggle lives on the Electron side, not Java —
    // merge it in so the toggle reflects the on-disk pref.
    try { s.autoUpdateLauncher = await window.hub.getAutoUpdateLauncher(); } catch (_) { s.autoUpdateLauncher = true; }
    el.innerHTML = buildSettingsHTML(s);
    bindSettingsEvents(el, s);
    try {
      const v = await window.hub.getVersion();
      const av = el.querySelector('#about-version');
      if (av) av.textContent = 'v' + v;
    } catch {}
  }

  else if (tab === 'news') {
    await renderNewsTab(el);
  }

  else if (tab === 'hubstore') {
    if (window.renderHubStore) {
      window.renderHubStore(el);
    } else {
      el.innerHTML = '<p class="loading-msg">Loading Hub Store...</p>';
    }
  }
}

// ── THEMED CONFIRM ────────────────────────────────────────────────────────
// Drop-in replacement for window.confirm() that matches our palette.
// Returns a Promise<boolean>.
function confirmThemed(message, opts = {}) {
  const title       = opts.title       || 'Confirm';
  const okLabel     = opts.okLabel     || 'OK';
  const cancelLabel = opts.cancelLabel || 'Cancel';
  const danger      = !!opts.danger;
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'news-modal-backdrop';
    modal.innerHTML = `
      <div class="news-modal" style="width:min(420px,90vw)">
        <div class="news-modal-hdr">
          <h3>${escHtml(title)}</h3>
        </div>
        <div class="news-modal-body" style="color:#cdc0a0">${escHtml(message)}</div>
        <div class="news-modal-foot">
          <button class="news-btn" data-act="cancel">${escHtml(cancelLabel)}</button>
          <button class="news-btn ${danger ? 'news-btn-danger' : 'news-btn-primary'}" data-act="ok">${escHtml(okLabel)}</button>
        </div>
      </div>
    `;
    const close = (val) => { modal.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = e => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter')  close(true);
    };
    document.addEventListener('keydown', onKey);
    modal.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (btn) close(btn.dataset.act === 'ok');
      else if (e.target === modal) close(false);
    });
    document.body.appendChild(modal);
    setTimeout(() => modal.querySelector('[data-act="ok"]').focus(), 50);
  });
}

// Manual list toggle — execCommand misbehaves in some Electron builds.
// Handles: not-in-list → wrap, same type → unwrap, different type → convert.
function toggleListInEditor(editor, type /* 'ul'|'ol' */) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !editor.contains(sel.anchorNode)) {
    document.execCommand(type === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
    return;
  }
  let n = sel.anchorNode;
  if (n.nodeType === Node.TEXT_NODE) n = n.parentNode;
  let list = null;
  while (n && n !== editor) {
    const tag = n.tagName?.toLowerCase();
    if (tag === 'ul' || tag === 'ol') { list = n; break; }
    n = n.parentNode;
  }
  if (list) {
    if (list.tagName.toLowerCase() === type) {
      // Unwrap — convert each <li> to a <div>
      const parent = list.parentNode;
      const frag = document.createDocumentFragment();
      list.querySelectorAll(':scope > li').forEach(li => {
        const div = document.createElement('div');
        while (li.firstChild) div.appendChild(li.firstChild);
        frag.appendChild(div);
      });
      parent.insertBefore(frag, list);
      parent.removeChild(list);
    } else {
      // Convert UL ↔ OL
      const newList = document.createElement(type);
      while (list.firstChild) newList.appendChild(list.firstChild);
      list.parentNode.replaceChild(newList, list);
    }
  } else {
    // Plain text — wrap selection
    document.execCommand(type === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
  }
}

function renderPoll(post) {
  const poll = post.poll;
  if (!poll || !poll.options || !poll.options.length) return '';
  const total = poll.options.reduce((s, o) => s + (o.votes || 0), 0);
  const closed = poll.closes_at && new Date(poll.closes_at.replace(' ','T') + 'Z').getTime() < Date.now();
  const haveVoted = poll.options.some(o => o.my_vote);
  const multi = !!poll.multi_choice;
  const optsHtml = poll.options.map(o => {
    const pct = total ? Math.round(((o.votes || 0) / total) * 100) : 0;
    const marker = multi
      ? (o.my_vote ? '☑' : '☐')
      : (o.my_vote ? '●' : '○');
    return `
      <button type="button" class="news-poll-opt-btn ${o.my_vote ? 'voted' : ''}" data-poll-vote="${o.id}" data-poll-post="${post.id}" ${closed ? 'disabled' : ''}>
        <span class="news-poll-bar" style="width:${pct}%"></span>
        <span class="news-poll-marker">${marker}</span>
        <span class="news-poll-label">${escHtml(o.label)}</span>
        <span class="news-poll-votes">${o.votes || 0} · ${pct}%</span>
      </button>
    `;
  }).join('');
  return `
    <div class="news-poll-render">
      <div class="news-poll-q">📊 ${escHtml(poll.question)}</div>
      <div class="news-poll-list">${optsHtml}</div>
      <div class="news-poll-foot">
        ${total} vote${total === 1 ? '' : 's'} · ${poll.multi_choice ? 'multiple choices allowed' : 'single choice'}${closed ? ' · CLOSED' : ''}
      </div>
    </div>
  `;
}

// Open a themed full-content post view. Reuses the news-modal palette.
function openNewsDetail(post, container) {
  const sec = post.section;
  const reactions = NEWS_REACTIONS[sec] || ['🔥','❤️','👀'];
  const myReacts = new Set(post.my_reactions || []);
  const counts   = post.reactions || {};
  const titleName = sec === 'hub' ? 'RSPS Hub'
                  : sec === 'server' ? (post.server_name || 'Server')
                  : (post.username || '?');
  const reactBtns = reactions.map(em => `
    <span class="news-react ${myReacts.has(em) ? 'reacted' : ''}" data-react-emoji="${em}">
      ${em} <span class="rc">${counts[em] || 0}</span>
    </span>
  `).join('');

  const modal = document.createElement('div');
  modal.className = 'news-modal-backdrop news-detail-backdrop';
  modal.innerHTML = `
    <div class="news-modal news-detail-modal">
      <div class="news-modal-hdr">
        <div class="news-detail-hdr-meta">
          ${post.tag ? `<span class="news-tag tag-${post.tag.toLowerCase().replace(/\s+/g, '-')}">${escHtml(post.tag)}</span>` : ''}
          <span class="news-server-name">${escHtml(titleName)}</span>
          <span class="news-dot">·</span>
          <span class="news-author">${escHtml(post.username)}</span>
          <span class="news-ts">${formatNewsTs(post.created_at)}${post.edited_at && sec !== 'hub' ? ' · edited' : ''}</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="news-modal-close" id="news-detail-close">✕</button>
        </div>
      </div>
      <div class="news-modal-body">
        <h2 class="news-detail-title">${escHtml(post.title)}</h2>
        <div class="news-detail-body">${renderNewsBody(post.body)}</div>
        ${post.image_url ? `<div class="news-card-img" data-lightbox="${escAttr(post.image_url)}"><img src="${escAttr(post.image_url)}" alt="" draggable="false"></div>` : ''}
        ${renderPoll(post)}
        <div class="news-detail-reactions">${reactBtns}</div>
        <div class="news-detail-stats">
          ${post.view_count > 0 ? `<span>👁 ${post.view_count} view${post.view_count === 1 ? '' : 's'}</span>` : ''}
        </div>
        <div class="news-detail-comments">
          <div class="news-modal-label" style="margin-top:18px">💬 <span id="news-cmt-count">0</span> Comments</div>
          <div class="news-cmt-list" id="news-cmt-list"></div>
          <div class="news-cmt-write">
            <textarea class="news-modal-input" id="news-cmt-body" rows="3" maxlength="500" placeholder="Add a comment…"></textarea>
            <div class="news-cmt-emoji-picker" id="news-cmt-emoji-picker" style="display:none">
              ${NEWS_EMOJI.map(e => `<button type="button" class="news-emoji" data-emoji="${e}">${e}</button>`).join('')}
            </div>
            <div class="news-cmt-foot">
              <button type="button" class="news-tb-btn" id="news-cmt-emoji-btn" data-tip="Insert emoji">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
              </button>
              <span class="news-cmt-counter" id="news-cmt-counter">0 / 500</span>
              <span class="news-cmt-msg" id="news-cmt-msg"></span>
              <button class="news-btn news-btn-primary" id="news-cmt-submit">Post comment</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  const close = () => { modal.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  modal.querySelector('#news-detail-close').addEventListener('click', e => { e.stopPropagation(); close(); });

  // Image click → lightbox. Guard with contains() so a click that bubbled in
  // from a stacked modal (e.g. compose-while-editing) can't trigger us.
  modal.addEventListener('click', e => {
    if (!modal.contains(e.target)) return;
    const img = e.target.closest('.news-card-img');
    if (img && modal.contains(img)) {
      const url = img.dataset.lightbox || img.querySelector('img')?.src;
      if (url) openImageLightbox(url);
      return;
    }
    const lbImg = e.target.closest('.news-detail-body img');
    if (lbImg && modal.contains(lbImg)) { openImageLightbox(lbImg.src); return; }
  });


  // Re-render the reactions row from current post state. Used by both the
  // optimistic update and the server-confirmed update without touching scroll.
  function rerenderReactionsRow() {
    const reactRow = modal.querySelector('.news-detail-reactions');
    if (!reactRow) return;
    const myR = new Set(post.my_reactions || []);
    const cnt = post.reactions || {};
    reactRow.innerHTML = (NEWS_REACTIONS[sec] || ['🔥','❤️','👀']).map(em => `
      <span class="news-react ${myR.has(em) ? 'reacted' : ''}" data-react-emoji="${em}">
        ${em} <span class="rc">${cnt[em] || 0}</span>
      </span>
    `).join('');
  }
  function rerenderPollBlock() {
    const oldPoll = modal.querySelector('.news-poll-render');
    if (!oldPoll) return;
    const tmp = document.createElement('div'); tmp.innerHTML = renderPoll(post);
    const newPoll = tmp.firstElementChild;
    if (newPoll) oldPoll.replaceWith(newPoll);
    else oldPoll.remove();
  }

  // Sync the underlying feed card's reaction display so closing the modal
  // doesn't reveal stale counts/states. No re-render of the whole feed.
  function syncCardReactions() {
    if (!container) return;
    const cardEl = container.querySelector(`[data-post-id="${post.id}"]`);
    if (!cardEl) return;
    const myR = new Set(post.my_reactions || []);
    cardEl.querySelectorAll('[data-react-emoji]').forEach(btn => {
      const em = btn.dataset.reactEmoji;
      btn.classList.toggle('reacted', myR.has(em));
      const rc = btn.querySelector('.rc');
      const newCount = post.reactions?.[em] || 0;
      if (rc) rc.textContent = newCount;
      else btn.innerHTML = `${em} ${newCount || ''}`.trim();
    });
  }

  // Reactions + poll votes inside detail view — fully optimistic, server response
  // updates local state. NO full feed reload, NO scroll jump.
  modal.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-react-emoji]');
    if (r) {
      const emoji = r.dataset.reactEmoji;
      try {
        const res = await window.hub.post('/api/news/react', { post_id: post.id, emoji });
        if (res?.ok) {
          post.reactions    = res.reactions    || {};
          post.my_reactions = res.my_reactions || [];
          rerenderReactionsRow();
          // Mirror change to feed list + the card's DOM
          const card = _newsState.posts.find(p => p.id === post.id);
          if (card) { card.reactions = post.reactions; card.my_reactions = post.my_reactions; }
          syncCardReactions();
        }
      } catch { showToast('Failed to react', 'error'); }
      return;
    }
    const v = e.target.closest('[data-poll-vote]');
    if (v) {
      try {
        const res = await window.hub.post('/api/news/poll-vote', {
          post_id: +v.dataset.pollPost, option_id: +v.dataset.pollVote
        });
        if (res?.ok && res.poll) {
          post.poll = res.poll;
          rerenderPollBlock();
          const card = _newsState.posts.find(p => p.id === post.id);
          if (card) card.poll = res.poll;
        }
      } catch { showToast('Vote failed', 'error'); }
      return;
    }
  });

  // Stop ALL click/mousedown events from leaking out of the modal to handlers
  // behind (e.g. the news tab's image-click → lightbox handler).
  modal.addEventListener('mousedown', e => e.stopPropagation());
  modal.addEventListener('click',     e => e.stopPropagation());

  // Profile clicks inside the modal — handle directly since the document-level
  // delegation never sees the event (we stopPropagation above).
  modal.addEventListener('click', (e) => {
    const el = e.target.closest('[data-open-profile]');
    if (el && window.openUserProfile) {
      window.openUserProfile(el.dataset.openProfile);
    }
  });

  // ── COMMENTS ──────────────────────────────────────────────────────────
  function renderCmtItem(c, isReply = false) {
    const ago = formatNewsTs(c.created_at) + (c.edited_at ? ' · edited' : '');
    const initial = (c.username || '?')[0].toUpperCase();
    const avatarUrl = c.has_avatar ? `https://api.therspshub.com/uploads/avatars/${encodeURIComponent(c.username)}.jpg` : '';
    // Equipped cosmetics + hub stats — match the way server reviews render
    // commenter credentials (title pill, time on hub, servers tried).
    const eq        = c.equipped || {};
    const titlePill = eq.title
      ? `<span class="eq-title" style="${escAttr(eq.title.style?.nameStyle || '')}">${escHtml(eq.title.name)}</span>`
      : '';
    const totalMin  = c.hub_total_minutes || 0;
    const totalLbl  = totalMin >= 60 ? `${Math.round(totalMin/60)}h on hub` : `${totalMin}m on hub`;
    const srvCount  = c.hub_servers_played || 0;
    return `
      <div class="news-cmt-item ${isReply ? 'is-reply' : ''}" data-cmt-id="${c.id}">
        <div class="news-cmt-avatar">
          ${avatarUrl
            ? `<img src="${escAttr(avatarUrl)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span style="display:none">${escHtml(initial)}</span>`
            : `<span>${escHtml(initial)}</span>`}
        </div>
        <div class="news-cmt-content">
          <div class="news-cmt-row">
            <span class="news-cmt-name lb-clickable" data-open-profile="${escAttr(c.username)}">${renderName(c.username, eq)}</span>
            ${titlePill}
            <span class="news-cmt-ts" data-ts="${escAttr(c.created_at)}">${ago}</span>
            ${c.can_edit ? `<button class="news-cmt-action" data-edit-cmt="${c.id}" title="Edit">✎</button>` : ''}
            ${(c.is_own || state.user?.isStaff) ? `<button class="news-cmt-action" data-delete-cmt="${c.id}" title="Delete">🗑</button>` : ''}
          </div>
          <div class="news-cmt-creds">
            <span title="Total time this user has played across all servers">${escHtml(totalLbl)}</span>
            <span class="news-cmt-creds-sep">·</span>
            <span title="Number of different servers tried">${srvCount} server${srvCount === 1 ? '' : 's'} tried</span>
          </div>
          <div class="news-cmt-body">${renderNewsBody(c.body)}</div>
          <div class="news-cmt-actions">
            <button class="news-cmt-vote ${c.my_vote === 1 ? 'voted' : ''}" data-vote-cmt="${c.id}" data-vote="1" ${c.is_own ? 'disabled' : ''} title="${c.is_own ? 'Cannot vote on your own' : 'Thumbs up'}">👍 <span class="rc">${c.up_votes || 0}</span></button>
            <button class="news-cmt-vote ${c.my_vote === -1 ? 'voted-down' : ''}" data-vote-cmt="${c.id}" data-vote="-1" ${c.is_own ? 'disabled' : ''} title="${c.is_own ? 'Cannot vote on your own' : 'Thumbs down'}">👎 <span class="rc">${c.down_votes || 0}</span></button>
            ${!isReply ? `<button class="news-cmt-reply-btn" data-reply-cmt="${c.id}" data-reply-to="${escAttr(c.username)}">↩ Reply</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  async function loadComments() {
    const listEl  = modal.querySelector('#news-cmt-list');
    const countEl = modal.querySelector('#news-cmt-count');
    if (!listEl) return;
    let res; try { res = await window.hub.get('/api/news/comments?post_id=' + post.id); } catch {}
    const items = res?.comments || [];
    countEl.textContent = items.length;
    if (!items.length) {
      listEl.innerHTML = `<div class="news-cmt-empty">No comments yet — be the first.</div>`;
      return;
    }
    // Group: top-level comments + their replies.
    const tops = items.filter(c => !c.parent_id);
    const replies = {};
    items.filter(c => c.parent_id).forEach(c => {
      (replies[c.parent_id] = replies[c.parent_id] || []).push(c);
    });
    listEl.innerHTML = tops.map(c => `
      <div class="news-cmt-thread">
        ${renderCmtItem(c, false)}
        ${(replies[c.id] || []).map(r => renderCmtItem(r, true)).join('')}
        <div class="news-cmt-reply-form" id="news-cmt-reply-form-${c.id}" style="display:none"></div>
      </div>
    `).join('');
  }
  loadComments();

  // Live character counter for comments
  const cmtBodyEl = modal.querySelector('#news-cmt-body');
  const cmtCounter = modal.querySelector('#news-cmt-counter');
  function updateCmtCounter() {
    const n = cmtBodyEl.value.length;
    cmtCounter.textContent = `${n} / 500`;
    cmtCounter.classList.toggle('warn',  n > 400 && n <= 500);
    cmtCounter.classList.toggle('danger', n > 500);
  }
  cmtBodyEl?.addEventListener('input', updateCmtCounter);

  // Emoji picker for comments
  const cmtEmojiBtn = modal.querySelector('#news-cmt-emoji-btn');
  const cmtEmojiPicker = modal.querySelector('#news-cmt-emoji-picker');
  cmtEmojiBtn?.addEventListener('mousedown', e => e.preventDefault()); // keep textarea focus
  cmtEmojiBtn?.addEventListener('click', () => {
    cmtEmojiPicker.style.display = cmtEmojiPicker.style.display === 'none' ? 'flex' : 'none';
  });
  cmtEmojiPicker?.addEventListener('mousedown', e => e.preventDefault());
  cmtEmojiPicker?.querySelectorAll('.news-emoji').forEach(b => {
    b.addEventListener('click', () => {
      const emoji = b.dataset.emoji;
      const start = cmtBodyEl.selectionStart, end = cmtBodyEl.selectionEnd;
      cmtBodyEl.value = cmtBodyEl.value.substring(0, start) + emoji + cmtBodyEl.value.substring(end);
      const pos = start + emoji.length;
      cmtBodyEl.setSelectionRange(pos, pos);
      cmtBodyEl.focus();
      updateCmtCounter();
    });
  });

  modal.querySelector('#news-cmt-submit')?.addEventListener('click', async () => {
    const body = cmtBodyEl.value.trim();
    const msg = modal.querySelector('#news-cmt-msg');
    if (!body) { msg.textContent = 'Write something first.'; msg.style.color = '#c96'; return; }
    if (body.length > 500) { msg.textContent = `Too long (${body.length} / 500).`; msg.style.color = '#c84040'; return; }
    msg.textContent = 'Posting…'; msg.style.color = '#888';
    try {
      const res = await window.hub.post('/api/news/comments/post', { post_id: post.id, body });
      if (res?.ok) {
        cmtBodyEl.value = '';
        msg.textContent = '';
        cmtEmojiPicker.style.display = 'none';
        updateCmtCounter();
        await loadComments();
      } else { msg.textContent = res?.error || 'Failed to post comment.'; msg.style.color = '#c84040'; }
    } catch { msg.textContent = 'Network error.'; msg.style.color = '#c84040'; }
  });

  // Comment edit / delete (delegated)
  modal.querySelector('#news-cmt-list')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit-cmt]');
    if (editBtn) {
      const item = editBtn.closest('[data-cmt-id]');
      const bodyEl = item.querySelector('.news-cmt-body');
      const original = bodyEl.dataset.original ?? bodyEl.textContent.trim();
      bodyEl.dataset.original = original;
      bodyEl.innerHTML = `
        <textarea class="news-modal-input" maxlength="2000" rows="3">${escHtml(original)}</textarea>
        <div class="news-cmt-foot">
          <button class="news-btn" data-cancel-edit>Cancel</button>
          <button class="news-btn news-btn-primary" data-save-edit>Save</button>
        </div>
      `;
      bodyEl.querySelector('[data-cancel-edit]').addEventListener('click', () => loadComments());
      bodyEl.querySelector('[data-save-edit]').addEventListener('click', async () => {
        const newBody = bodyEl.querySelector('textarea').value.trim();
        if (!newBody) return;
        try {
          await window.hub.post('/api/news/comments/edit', { id: +editBtn.dataset.editCmt, body: newBody });
          await loadComments();
        } catch { showToast('Failed to save', 'error'); }
      });
      return;
    }
    const delBtn = e.target.closest('[data-delete-cmt]');
    if (delBtn) {
      const ok = await confirmThemed('Delete this comment? This cannot be undone.', {
        title: 'Delete comment', okLabel: 'Delete', danger: true,
      });
      if (!ok) return;
      try {
        await window.hub.post('/api/news/comments/delete', { id: +delBtn.dataset.deleteCmt });
        await loadComments();
      } catch { showToast('Failed to delete', 'error'); }
      return;
    }

    // Thumbs up / down
    const voteBtn = e.target.closest('[data-vote-cmt]');
    if (voteBtn) {
      if (voteBtn.disabled) return;
      const id   = +voteBtn.dataset.voteCmt;
      const vote = +voteBtn.dataset.vote; // 1 or -1
      // Toggle: if already in this direction, clearing it
      const wasVoted = voteBtn.classList.contains('voted') || voteBtn.classList.contains('voted-down');
      const sameDirection = (vote === 1 && voteBtn.classList.contains('voted'))
                         || (vote === -1 && voteBtn.classList.contains('voted-down'));
      const sendVote = sameDirection ? 0 : vote;
      try {
        const res = await window.hub.post('/api/news/comments/vote', { id, vote: sendVote });
        if (res?.ok) {
          // Update both buttons in this comment (up + down counts/states)
          const item = voteBtn.closest('[data-cmt-id]');
          item.querySelectorAll('[data-vote-cmt]').forEach(b => {
            const dir = +b.dataset.vote;
            const rc = b.querySelector('.rc');
            if (rc) rc.textContent = dir === 1 ? res.up_votes : res.down_votes;
            b.classList.toggle('voted',      dir ===  1 && res.my_vote ===  1);
            b.classList.toggle('voted-down', dir === -1 && res.my_vote === -1);
          });
        }
      } catch { showToast('Failed to vote', 'error'); }
      return;
    }

    // Reply button → show inline reply form under the parent comment
    const replyBtn = e.target.closest('[data-reply-cmt]');
    if (replyBtn) {
      const parentId = +replyBtn.dataset.replyCmt;
      const formHost = modal.querySelector('#news-cmt-reply-form-' + parentId);
      if (!formHost) return;
      if (formHost.style.display !== 'none') {
        // Toggle off
        formHost.style.display = 'none';
        formHost.innerHTML = '';
        return;
      }
      formHost.style.display = '';
      formHost.innerHTML = `
        <textarea class="news-modal-input news-cmt-reply-body" maxlength="500" rows="2" placeholder="Reply to ${escHtml(replyBtn.dataset.replyTo)}…"></textarea>
        <div class="news-cmt-foot">
          <span class="news-cmt-counter news-cmt-reply-counter">0 / 500</span>
          <button class="news-btn" data-cancel-reply>Cancel</button>
          <button class="news-btn news-btn-primary" data-post-reply>Reply</button>
        </div>
      `;
      const ta  = formHost.querySelector('textarea');
      const ctr = formHost.querySelector('.news-cmt-reply-counter');
      ta.addEventListener('input', () => {
        const n = ta.value.length;
        ctr.textContent = `${n} / 500`;
        ctr.classList.toggle('warn',  n > 400 && n <= 500);
        ctr.classList.toggle('danger', n > 500);
      });
      ta.focus();
      formHost.querySelector('[data-cancel-reply]').addEventListener('click', () => {
        formHost.style.display = 'none'; formHost.innerHTML = '';
      });
      formHost.querySelector('[data-post-reply]').addEventListener('click', async () => {
        const body = ta.value.trim();
        if (!body) return;
        if (body.length > 500) { showToast('Reply too long', 'error'); return; }
        try {
          await window.hub.post('/api/news/comments/post', { post_id: post.id, parent_id: parentId, body });
          formHost.style.display = 'none'; formHost.innerHTML = '';
          await loadComments();
        } catch { showToast('Failed to post reply', 'error'); }
      });
    }
  });

  // Increment view count (fire-and-forget)
  try { window.hub.post('/api/news/view', { post_id: post.id }); } catch {}

  document.body.appendChild(modal);
}

// Open a themed image-lightbox overlay.
function openImageLightbox(url) {
  const ov = document.createElement('div');
  ov.className = 'news-lightbox';
  ov.innerHTML = `
    <button class="news-lightbox-close" title="Close">✕</button>
    <img src="${escAttr(url)}" alt="" draggable="false">
  `;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('mousedown', e => e.stopPropagation());
  ov.addEventListener('click', e => {
    e.stopPropagation();
    if (e.target === ov || e.target.classList.contains('news-lightbox-close')) close();
  });
  document.body.appendChild(ov);
}

// Themed prompt — like window.prompt() but matches launcher palette. Returns
// Promise<string|null>. null if cancelled, string (possibly empty) if OK'd.
function promptThemed(title, label, defaultValue = '') {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'news-modal-backdrop';
    modal.innerHTML = `
      <div class="news-modal" style="width:min(420px,90vw)">
        <div class="news-modal-hdr"><h3>${escHtml(title)}</h3></div>
        <div class="news-modal-body">
          <label class="news-modal-label">${escHtml(label)}</label>
          <input class="news-modal-input" type="text" id="prompt-input" value="${escAttr(defaultValue)}">
        </div>
        <div class="news-modal-foot">
          <button class="news-btn" data-act="cancel">Cancel</button>
          <button class="news-btn news-btn-primary" data-act="ok">OK</button>
        </div>
      </div>
    `;
    const input = () => modal.querySelector('#prompt-input');
    const close = (val) => { modal.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = e => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter')  close(input().value);
    };
    document.addEventListener('keydown', onKey);
    modal.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (btn) close(btn.dataset.act === 'ok' ? input().value : null);
      else if (e.target === modal) close(null);
    });
    document.body.appendChild(modal);
    setTimeout(() => { input().focus(); input().select(); }, 50);
  });
}

// ── NEWS TAB ───────────────────────────────────────────────────────────────
// Three sections: Hub (staff-only), Servers (dev posts), Community (any user).
// Permissions enforced server-side; UI only hides the compose box accordingly.

// Tiny safe markdown renderer for post bodies. Order matters:
// 1) escape everything, 2) walk allowlisted patterns, 3) line breaks last.
// Image URLs are restricted to our own /uploads/news/ — anything else is a
// dead pattern and renders as plain text. Same security posture as before,
// just lets posts mix several images and bits of formatting between them.
// Domains we trust enough to drop the warning icon for. Everything else
// renders with a ⚠ badge next to the hostname so users know to be careful.
const NEWS_TRUSTED_DOMAINS = new Set([
  'youtube.com','youtu.be','m.youtube.com',
  'discord.gg','discord.com',
  'github.com','gitlab.com',
  'twitch.tv',
  'twitter.com','x.com',
  'reddit.com','old.reddit.com',
  'imgur.com','i.imgur.com',
  'rspshub.net','www.rspshub.net','therspshub.com','api.therspshub.com',
  'wikipedia.org','en.wikipedia.org',
  'runescape.wiki','oldschool.runescape.wiki',
]);

function newsHostnameOf(url) {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch { return ''; }
}

function renderNewsBody(text) {
  // Process line-level patterns FIRST (headers, lists) before escaping, working
  // on lines and emitting raw HTML. Inline patterns run on inner text.
  const inline = (s) => {
    let h = escHtml(s);
    h = h.replace(
      /!\[([^\]]*)\]\((https:\/\/api\.therspshub\.com\/uploads\/news\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|gif|webp))\)/g,
      (_, alt, url) => `<img class="news-md-img" src="${url}" alt="${escAttr(alt)}" loading="lazy" draggable="false">`
    );
    h = h.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)<>]+)\)/g,
      (_, label, url) => {
        const host = newsHostnameOf(url);
        const trusted = NEWS_TRUSTED_DOMAINS.has(host);
        const badge = host
          ? `<span class="news-link-host${trusted ? ' trusted' : ' untrusted'}" title="${trusted ? 'Trusted source' : 'Unverified link — check before clicking'}">${trusted ? '✓' : '⚠'} ${escHtml(host)}</span>`
          : '';
        return `<a href="${escAttr(url)}" target="_blank" rel="noopener">${label}</a>${badge}`;
      }
    );
    h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    h = h.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    // @mentions — username chars match users.username constraints (2-32 alnum/_)
    h = h.replace(/(^|[^\w@])@([A-Za-z0-9_]{2,32})/g,
      (_, lead, name) => `${lead}<span class="news-mention" data-mention="${escAttr(name)}">@${escHtml(name)}</span>`);
    return h;
  };

  // Walk lines: collect bullet/numbered groups into <ul>/<ol>, otherwise emit
  // headers or paragraph chunks.
  const lines = (text || '').split('\n');
  const out = [];
  let listType = null;     // 'ul' | 'ol' | null
  let listItems = [];
  const flushList = () => {
    if (!listType) return;
    out.push('<' + listType + ' class="news-md-list">' + listItems.map(li => '<li>' + inline(li) + '</li>').join('') + '</' + listType + '>');
    listType = null; listItems = [];
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.+)$/))) {
      flushList();
      const level = Math.min(3, m[1].length) + 2; // h3..h5 (h1/h2 reserved for page titles)
      out.push('<h' + level + ' class="news-md-h">' + inline(m[2]) + '</h' + level + '>');
    } else if ((m = line.match(/^[-*]\s+(.+)$/))) {
      if (listType !== 'ul') { flushList(); listType = 'ul'; }
      listItems.push(m[1]);
    } else if ((m = line.match(/^\d+\.\s+(.+)$/))) {
      if (listType !== 'ol') { flushList(); listType = 'ol'; }
      listItems.push(m[1]);
    } else if (line === '') {
      flushList();
      // Empty line → double break so paragraphs are visually separated.
      out.push('<br><br>');
    } else {
      flushList();
      out.push(inline(line));
    }
  }
  flushList();
  // Join with line breaks where adjacent inline lines aren't already block-level
  return out.map((chunk, i) => {
    if (i === 0) return chunk;
    const prev = out[i-1];
    const isBlock = (s) => /^<(h\d|ul|ol|br)/i.test(s);
    return (isBlock(prev) || isBlock(chunk)) ? chunk : '<br>' + chunk;
  }).join('');
}
// Used by escAttr above to be defensive with already-escaped strings used as attrs
function escAttr(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;'); }

// Walk a contentEditable node tree and produce markdown for storage.
// Stripping anything we don't recognise — same security posture as the
// renderNewsBody allowlist, just running in reverse.
function newsEditorToMarkdown(root) {
  function walk(node) {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const t = child.tagName.toLowerCase();
        if (t === 'br') out += '\n';
        else if (t === 'strong' || t === 'b')   out += '**' + walk(child) + '**';
        else if (t === 'em'     || t === 'i')   out += '*'  + walk(child) + '*';
        else if (t === 'del'    || t === 's' || t === 'strike') out += '~~' + walk(child) + '~~';
        else if (t === 'code')                  out += '`'  + walk(child) + '`';
        else if (t === 'a') {
          const href = child.getAttribute('href') || '';
          out += '[' + (walk(child) || href) + '](' + href + ')';
        }
        else if (t === 'img') {
          const src = child.getAttribute('src') || '';
          const alt = child.getAttribute('alt') || '';
          out += '![' + alt + '](' + src + ')';
        }
        else if (t === 'h1' || t === 'h2' || t === 'h3' || t === 'h4' || t === 'h5' || t === 'h6') {
          if (out && !out.endsWith('\n')) out += '\n';
          // Map any heading level down to ###/##/# (caps to three #) for our renderer
          const hashes = '###'.slice(0, Math.min(3, Math.max(1, t === 'h1' ? 1 : t === 'h2' ? 2 : 3)));
          out += hashes + ' ' + walk(child).trim() + '\n';
        }
        else if (t === 'ul' || t === 'ol') {
          if (out && !out.endsWith('\n')) out += '\n';
          let n = 1;
          for (const li of child.children) {
            if (li.tagName.toLowerCase() !== 'li') continue;
            out += (t === 'ol' ? (n++) + '. ' : '- ') + walk(li).trim() + '\n';
          }
        }
        else if (t === 'div' || t === 'p') {
          if (out && !out.endsWith('\n')) out += '\n';
          out += walk(child);
          if (!out.endsWith('\n')) out += '\n';
        }
        else {
          out += walk(child);
        }
      }
    }
    return out;
  }
  return walk(root).replace(/\n{3,}/g, '\n\n').trim();
}

// Bigger emoji set for the picker. Organised loosely by category so the grid
// reads roughly: RSPS-flavour → faces → gestures → symbols → food → animals → hearts.
const NEWS_EMOJI = [
  // ── RSPS / OSRS adventure flavour ──
  '⚔️','🗡️','🛡️','🏹','🪓','🔨','⚒️','🪛','🧰','⛏️','🪨','🪵','🌳','🌲','🌿','🍃',
  '🍂','🌾','🪴','🌺','🌷','🌹','🪻','🍀','🌱','🥕','🍓','🍇','🥚','🍗','🍖','🥩',
  '🐟','🐠','🐡','🦞','🦀','🦐','🐍','🐀','🦴','🐲','🐉','🦄','🦊','🐺','🦁','🐯',
  '🦅','🦉','🦇','🦂','🕷️','🕸️','🐙','🦑','💀','☠️','👻','👹','👺','👽','👾','🤖',
  '🧙','🧝','🧌','🧚','🧛','🧟','🧞','🧜','🧑‍🚀','🥷','🤺','🏇','⛷️','🏊','🧗','🚣',
  '🪄','📜','🗺️','🔮','🧿','🪬','⚱️','🪦','🚪','🪟','🪞','🛏️','🏰','🏯','🛕','⛩️',
  '🌋','🏔️','⛰️','🗻','🏝️','🏖️','🏟️','🌌','🌠','🌟','✨','💫','⭐','☄️','⚡','🔥',
  '❄️','💨','💦','🌊','🌪️','🌈','☀️','🌙','⛅','☁️','🪐','🌍','🌎','🌏','🍯','🧪',
  '💊','💉','🩹','⚗️','🪤','🪜','🧲','🪙','💰','💸','💎','👑','🏆','🥇','🥈','🥉',
  '🏅','🎖️','🎗️','🎁','🎉','🎊','🎯','🎲','🎮','🕹️','🪅','🎰',
  // ── Faces — happy / love / playful ──
  '😀','😃','😄','😁','😆','😅','😂','🤣','🥲','🥹','😊','😇','🙂','🙃','😉','😌',
  '😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸',
  '🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢',
  '😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔',
  '🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤',
  '😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺',
  '🤡','💩','👻','💀','☠️','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀',
  // Hand gestures + body
  '👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆',
  '🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️',
  '💪','🦾','🦵','🦶','👂','🦻','👃','👀','👁️','👅','👄','🫦','🧠','🦷','💋','🩸',
  // Symbols / status / reactions
  '💯','💢','💥','💫','💦','💨','🕳️','💣','💬','👁️‍🗨️','🗨️','🗯️','💭','💤','✨','⭐',
  '🌟','⚡','☄️','🔥','🌈','☀️','🌙','⛅','☁️','❄️','🌪️','🎯','🎲','🎮','🕹️','🎰',
  '✅','❌','❓','❗','‼️','⁉️','♨️','🚫','⛔','📛','🔞','✔️','☑️','📌','📍','🔔',
  '🔕','📣','📢','💡','🔆','🔅','🔎','🔍','🔒','🔓','🔑','🗝️','🛡️','⚔️','🗡️','🏹',
  '🪓','🔨','⚒️','🛠️','⚙️','🪛','🧰','🔧','🪤','🪜','🧲','🧪','💊','💉','🩹','🩺',
  // Currency / money / value
  '💎','💰','💸','💵','💴','💶','💷','🪙','💳','🧾','📊','📈','📉','📅','🛒','📦',
  // Trophies / awards / events
  '🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎁','🎉','🎊','🎈','🎂','🪅','🎵','🎶',
  '🎤','🎧','🎷','🎺','🎻','🥁','🪘','🎸','🪕','🎼','🚀','✈️','🛸','🛰️','⚓','🚂',
  // Foods / drinks
  '🍗','🍖','🍤','🥩','🍣','🍱','🍔','🍟','🌭','🍕','🥪','🌮','🌯','🥘','🍝','🍜',
  '🍲','🥗','🍿','🥨','🥐','🍞','🥖','🥯','🧀','🥚','🍳','🥞','🧇','🥓','🥪','🍙',
  '🍚','🍘','🍢','🍡','🍧','🍨','🍦','🥧','🍰','🎂','🧁','🍮','🍭','🍬','🍫','🍩',
  '🍪','☕','🍵','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🍾','🥤','🧃','🧉','🧊',
  // Animals / nature
  '🐉','🐲','🦄','🐎','🐂','🐗','🐺','🦊','🦝','🐱','🐶','🦁','🐯','🐅','🐆','🦓',
  '🐍','🦎','🐊','🐢','🦖','🦕','🐦','🦅','🦉','🦇','🐺','🐗','🐀','🦴','🐟','🐠',
  '🐡','🦈','🐙','🦑','🦞','🦀','🌳','🌲','🌴','🌵','🌷','🌸','🌹','🌺','🌻','🍀',
  // Hearts
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💖','💗','💓','💞',
  '💕','💟','💝','💘','💌',
];


const NEWS_TAGS = {
  hub:       ['Update', 'Event', 'News'],
  server:    ['Update', 'Event', 'Drop', 'Maintenance'],
  community: ['Guide',  'Review', 'LFG', 'Discussion', 'New Server'],
};
const NEWS_REACTIONS = {
  hub:       ['🔥', '❤️', '👀'],
  server:    ['🔥', '❤️', '🎉'],
  community: ['👍', '👎', '💬'],
};

let _newsState = { section: 'hub', filterTag: null, posts: [], sort: 'new', search: '', bookmarked: false };
let _newsSearchTimer = null;

async function refreshNewsUnreadBadges(el) {
  try {
    const res = await window.hub.get('/api/news/unread');
    const counts = res?.unread || {};
    el.querySelectorAll('[data-unread]').forEach(b => {
      const n = counts[b.dataset.unread] || 0;
      if (n > 0) { b.textContent = n > 99 ? '99+' : n; b.style.display = 'inline-block'; }
      else       { b.style.display = 'none'; }
    });
    // Also tell the bottom-nav News button there's something new
    const total = Object.values(counts).reduce((a,b) => a + (b || 0), 0);
    document.querySelector('.rs-tab[data-tab="news"]')?.classList.toggle('has-unread', total > 0);
  } catch {}
}

function newsDraftKey(section) { return 'news_draft_' + section; }
function loadNewsDraft(section) {
  try { return JSON.parse(localStorage.getItem(newsDraftKey(section)) || 'null'); } catch { return null; }
}
function saveNewsDraft(section, draft) {
  try {
    if (!draft || (!draft.title && !draft.body)) localStorage.removeItem(newsDraftKey(section));
    else localStorage.setItem(newsDraftKey(section), JSON.stringify(draft));
  } catch {}
}
function clearNewsDraft(section) { try { localStorage.removeItem(newsDraftKey(section)); } catch {} }

async function renderNewsTab(el) {
  el.innerHTML = `
    <div class="alt-header">
      <h2>NEWS</h2>
      <p>Latest from the hub, servers, and players</p>
      <button class="news-mark-read-btn" id="news-mark-all" title="Mark all sections as read">✓ Mark all read</button>
    </div>
    <div class="news-toptabs">
      <button class="news-toptab active" data-sec="hub">💎 Hub <span class="news-unread-badge" data-unread="hub" style="display:none">0</span></button>
      <button class="news-toptab"        data-sec="server">⚔️ Servers <span class="news-unread-badge" data-unread="server" style="display:none">0</span></button>
      <button class="news-toptab"        data-sec="community">💬 Community <span class="news-unread-badge" data-unread="community" style="display:none">0</span></button>
    </div>
    <div class="news-controls">
      <input type="search" id="news-search" class="news-search" placeholder="🔎 Search title or body…">
      <select id="news-sort" class="news-sort">
        <option value="new">Newest</option>
        <option value="top_week">Top this week</option>
        <option value="top_all">Top all time</option>
      </select>
    </div>
    <div id="news-filters" class="news-filters"></div>
    <div id="news-compose-host"></div>
    <div id="news-feed" class="news-feed"><p class="empty-msg" style="padding:24px 0">Loading…</p></div>
  `;
  el.querySelector('#news-mark-all').addEventListener('click', async () => {
    try {
      await window.hub.post('/api/news/mark-read', { section: 'all' });
      await refreshNewsUnreadBadges(el);
      showToast('All sections marked as read', 'success');
    } catch { showToast('Failed', 'error'); }
  });
  // Search debounced
  el.querySelector('#news-search').addEventListener('input', (e) => {
    clearTimeout(_newsSearchTimer);
    _newsSearchTimer = setTimeout(() => {
      _newsState.search = e.target.value.trim();
      loadAndRenderNews(el);
    }, 300);
  });
  el.querySelector('#news-sort').addEventListener('change', (e) => {
    _newsState.sort = e.target.value;
    loadAndRenderNews(el);
  });
  el.querySelectorAll('.news-toptab').forEach(btn => {
    btn.addEventListener('click', async () => {
      el.querySelectorAll('.news-toptab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _newsState.section = btn.dataset.sec;
      _newsState.filterTag = null;
      // Mark this section as read since the user is viewing it
      try { window.hub.post('/api/news/mark-read', { section: _newsState.section }); } catch {}
      await loadAndRenderNews(el);
      refreshNewsUnreadBadges(el);
    });
  });
  await loadAndRenderNews(el);
  // Initial mark-read for the default (hub) section + badges
  try { window.hub.post('/api/news/mark-read', { section: _newsState.section }); } catch {}
  refreshNewsUnreadBadges(el);

  // Event delegation — all interactions on cards live here.
  // Detach previous listener if renderNewsTab was called more than once
  // (e.g. user switched tabs and came back). Otherwise duplicate listeners
  // fire on each click → openNewsDetail runs twice → two stacked modals.
  if (el._newsClickHandler) el.removeEventListener('click', el._newsClickHandler);
  el._newsClickHandler = async (e) => {
    // Username clicks open the player profile — short-circuit before any
    // card-open handlers further down would intercept.
    if (e.target.closest('[data-open-profile]')) return;

    // Intercept any link inside a news post — confirm before navigating away.
    // Stops accidental clicks on phishing links posted by other users.
    const link = e.target.closest('.news-card-snippet a');
    if (link) {
      e.preventDefault();
      const url = link.getAttribute('href') || '';
      const ok = await confirmThemed(
        `This link will open in your browser:\n\n${url}\n\nOnly visit links from people you trust.`,
        { title: 'Open external link?', okLabel: 'Open', cancelLabel: 'Cancel' }
      );
      if (ok && /^https?:\/\//i.test(url)) {
        if (window.hub?.openExternal) window.hub.openExternal(url);
        else window.open(url, '_blank', 'noopener');
      }
      return;
    }

    const reactBtn = e.target.closest('[data-react-emoji]');
    if (reactBtn) {
      const cardEl = reactBtn.closest('[data-post-id]');
      const postId = +cardEl.dataset.postId;
      const emoji  = reactBtn.dataset.reactEmoji;
      try {
        const res = await window.hub.post('/api/news/react', { post_id: postId, emoji });
        if (res?.ok) {
          // Update local card data and re-render JUST this card's reactions
          const post = _newsState.posts.find(p => p.id === postId);
          if (post) {
            post.reactions = res.reactions || {};
            post.my_reactions = res.my_reactions || [];
            // Find each react button on this card and update it without scrolling.
            const myR = new Set(post.my_reactions || []);
            cardEl.querySelectorAll('[data-react-emoji]').forEach(btn => {
              const em = btn.dataset.reactEmoji;
              btn.classList.toggle('reacted', myR.has(em));
              const rc = btn.querySelector('.rc');
              const newCount = post.reactions?.[em] || 0;
              if (rc) rc.textContent = newCount;
              else {
                // some templates render the count inline next to emoji — handle both
                btn.innerHTML = `${em} ${newCount || ''}`.trim();
              }
            });
          }
        }
      } catch { showToast('Failed to react', 'error'); }
      return;
    }
    const reportBtn = e.target.closest('[data-report-id]');
    if (reportBtn) {
      const ok = await confirmThemed('Report this post for staff review?', {
        title: 'Report post', okLabel: 'Report', danger: true,
      });
      if (!ok) return;
      try {
        await window.hub.post('/api/news/report', { post_id: +reportBtn.dataset.reportId });
        showToast('Reported. Staff will review.', 'info');
      } catch { showToast('Failed to report.', 'error'); }
      return;
    }
    const delBtn = e.target.closest('[data-delete-id]');
    if (delBtn) {
      const ok = await confirmThemed('Delete this post? This cannot be undone.', {
        title: 'Delete post', okLabel: 'Delete', danger: true,
      });
      if (!ok) return;
      try {
        await window.hub.post('/api/news/moderate', { post_id: +delBtn.dataset.deleteId, action: 'delete' });
        await loadAndRenderNews(el);
      } catch { showToast('Failed to delete.', 'error'); }
      return;
    }
    const pinBtn = e.target.closest('[data-pin-id]');
    if (pinBtn) {
      const action = pinBtn.dataset.pinAction; // 'pin' or 'unpin'
      try {
        await window.hub.post('/api/news/moderate', { post_id: +pinBtn.dataset.pinId, action });
        await loadAndRenderNews(el);
      } catch {}
      return;
    }
    const bmBtn = e.target.closest('[data-bookmark-id]');
    if (bmBtn) {
      const wasMarked = bmBtn.classList.contains('is-bookmarked');
      // Optimistic toggle so the click feels instant
      bmBtn.classList.toggle('is-bookmarked');
      bmBtn.textContent = wasMarked ? '☆' : '★';
      try {
        await window.hub.post('/api/news/bookmark', { post_id: +bmBtn.dataset.bookmarkId });
        // If user is currently filtering by bookmarks, refresh so it disappears
        if (_newsState.bookmarked) await loadAndRenderNews(el);
      } catch {
        // Revert on error
        bmBtn.classList.toggle('is-bookmarked');
        bmBtn.textContent = wasMarked ? '★' : '☆';
        showToast('Failed to bookmark', 'error');
      }
      return;
    }
    const editBtn = e.target.closest('[data-edit-id]');
    if (editBtn) {
      const post = _newsState.posts.find(p => p.id === +editBtn.dataset.editId);
      if (post) openNewsCompose(el, post);
      return;
    }
    const srvPinBtn = e.target.closest('[data-server-pin-id]');
    if (srvPinBtn) {
      try {
        await window.hub.post('/api/news/pin-server', {
          post_id: +srvPinBtn.dataset.serverPinId,
          action:  srvPinBtn.dataset.serverPinAction
        });
        await loadAndRenderNews(el);
      } catch { showToast('Failed to update pin', 'error'); }
      return;
    }
    const composeOpen = e.target.closest('#news-compose-open');
    if (composeOpen) { openNewsCompose(el); return; }

    const readMoreBtn = e.target.closest('[data-readmore-id]');
    if (readMoreBtn) {
      const post = _newsState.posts.find(p => p.id === +readMoreBtn.dataset.readmoreId);
      if (post) openNewsDetail(post, el);
      return;
    }

    // Image click anywhere in a card → lightbox
    const imgInCard = e.target.closest('.news-card-img img, .news-card-snippet img');
    if (imgInCard) { e.preventDefault(); openImageLightbox(imgInCard.src); return; }

    // Click anywhere on the card body (title/snippet area) → open detail view.
    // Action buttons handled above already return early.
    const cardClick = e.target.closest('[data-post-id]');
    if (cardClick && (e.target.closest('.news-card-title, .news-card-snippet, .news-card-body, .news-card-content'))
        && !e.target.closest('.news-btn, .news-react, [data-react-emoji], a')) {
      const post = _newsState.posts.find(p => p.id === +cardClick.dataset.postId);
      if (post) openNewsDetail(post, el);
    }
  };
  el.addEventListener('click', el._newsClickHandler);
}

async function loadAndRenderNews(el) {
  const filtersHost = el.querySelector('#news-filters');
  const composeHost = el.querySelector('#news-compose-host');
  const feedHost    = el.querySelector('#news-feed');
  const sec = _newsState.section;
  const isStaff = !!state.user?.isStaff;
  const myUsername = state.user?.username || '';

  // Filters bar
  const tags = NEWS_TAGS[sec];
  filtersHost.innerHTML = `
    <div class="news-chip ${!_newsState.filterTag && !_newsState.bookmarked ? 'active' : ''}" data-tag="">All</div>
    ${tags.map(t => `<div class="news-chip ${_newsState.filterTag === t && !_newsState.bookmarked ? 'active' : ''}" data-tag="${t}">${t}</div>`).join('')}
    <div class="news-chip news-chip-bm ${_newsState.bookmarked ? 'active' : ''}" data-bookmarked="1">⭐ Bookmarked</div>
  `;
  filtersHost.querySelectorAll('.news-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.dataset.bookmarked) {
        _newsState.bookmarked = !_newsState.bookmarked;
      } else {
        _newsState.filterTag = chip.dataset.tag || null;
        _newsState.bookmarked = false;
      }
      loadAndRenderNews(el);
    });
  });

  // Compose box (shown if user is allowed to post in this section)
  let canPost = false, composeLabel = '';
  if (sec === 'hub') {
    canPost = isStaff;
    composeLabel = `Post hub-wide announcement as <strong>Staff</strong> — visible to every user.`;
  } else if (sec === 'server') {
    // Open to any logged-in user. They pick a target server from the dropdown
    // in the compose modal.
    canPost = !!state.user;
    composeLabel = `Post about a server — patch notes, events, drops, reviews, or discussion.`;
  } else { // community
    canPost = !!state.user;
    composeLabel = `Post to community as <strong>${escHtml(myUsername)}</strong> — guide, review, looking-for-group, or discussion.`;
  }
  composeHost.innerHTML = canPost ? `
    <div class="news-compose ${sec === 'community' ? 'community' : ''}" id="news-compose-open">
      <div class="news-compose-pen">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
      </div>
      <div class="news-compose-label">${composeLabel}</div>
    </div>
  ` : '';

  // Feed
  feedHost.innerHTML = `<p class="empty-msg" style="padding:24px 0">Loading…</p>`;
  let posts = [];
  try {
    const qs = new URLSearchParams({ section: sec });
    if (_newsState.filterTag) qs.set('tag', _newsState.filterTag);
    if (_newsState.sort && _newsState.sort !== 'new') qs.set('sort', _newsState.sort);
    if (_newsState.search)     qs.set('q', _newsState.search);
    if (_newsState.bookmarked) qs.set('bookmarked', '1');
    const res = await window.hub.get('/api/news/list?' + qs.toString());
    posts = res?.posts || [];
  } catch {}
  _newsState.posts = posts;

  if (!posts.length) {
    feedHost.innerHTML = `<p class="empty-msg" style="padding:24px 0">No posts yet. Be the first.</p>`;
    return;
  }

  feedHost.innerHTML = posts.map(p => renderNewsCard(p, sec, isStaff, myUsername)).join('');
}

function renderNewsCard(p, section, isStaff, myUsername) {
  const isOwn = (p.username === myUsername);
  const reactions = NEWS_REACTIONS[section];
  const myReacts = new Set(p.my_reactions || []);
  const counts   = p.reactions || {};
  const cardClass = (section === 'community') ? 'news-card community'
                  : (p.pinned ? 'news-card pinned' : (p.server_pinned ? 'news-card server-pinned' : 'news-card'));

  // Crest: hub uses gold sigil, server uses server color, community uses player avatar
  let crestHtml;
  if (section === 'hub') {
    crestHtml = `<div class="news-crest hub">⌬</div>`;
  } else if (section === 'server') {
    const accent = p.accent_color || '#ff981f';
    const initial = escHtml((p.server_name || 'S')[0].toUpperCase());
    crestHtml = p.server_icon
      ? `<div class="news-crest server" style="background-image:url(${escHtml(p.server_icon)})"></div>`
      : `<div class="news-crest server" style="background:linear-gradient(135deg,${accent},#1a1408);color:#fff">${initial}</div>`;
  } else {
    crestHtml = `<div class="news-crest player">${escHtml((p.username || '?')[0].toUpperCase())}</div>`;
  }

  const tagHtml = p.tag ? `<span class="news-tag tag-${p.tag.toLowerCase().replace(/\s+/g, '-')}">${escHtml(p.tag)}</span>` : '';
  const pinTag  = p.pinned        ? `<div class="news-pin-tag">📌 Pinned</div>`
                : p.server_pinned ? `<div class="news-pin-tag server">⭐ Pinned by server owner</div>` : '';
  const viewBadge = (p.view_count > 0)
    ? `<span class="news-view-count" title="${p.view_count} view${p.view_count === 1 ? '' : 's'}">👁 ${p.view_count}</span>`
    : '';
  const cmtBadge = (p.comment_count > 0)
    ? `<span class="news-view-count" title="${p.comment_count} comment${p.comment_count === 1 ? '' : 's'}">💬 ${p.comment_count}</span>`
    : '';
  const pollBadge = p.poll
    ? `<span class="news-poll-badge" title="This post has a poll">📊 Poll</span>` : '';
  const titleName = section === 'hub' ? 'RSPS Hub'
                  : section === 'server' ? (p.server_name || 'Server')
                  : (p.username || '?');

  const reactBtns = reactions.map(em => `
    <span class="news-react ${myReacts.has(em) ? 'reacted' : ''}" data-react-emoji="${em}">
      ${em} ${counts[em] || ''}
    </span>
  `).join('');

  // Action buttons row
  const actions = [];
  if (section === 'server') actions.push(`<button class="news-btn" data-visit-server="${p.server_id}">Visit server</button>`);
  actions.push(`<button class="news-btn news-btn-primary" data-readmore-id="${p.id}">Read more</button>`);
  // Bookmark — anyone, on any post
  actions.push(`<button class="news-btn news-btn-bookmark ${p.is_bookmarked ? 'is-bookmarked' : ''}" data-bookmark-id="${p.id}" title="${p.is_bookmarked ? 'Remove bookmark' : 'Bookmark'}">${p.is_bookmarked ? '★' : '☆'}</button>`);
  // Edit — own post within 1h, or staff
  if (p.can_edit) {
    actions.push(`<button class="news-btn" data-edit-id="${p.id}">Edit</button>`);
  }
  // Server-owner pin — server-section posts only, owner or staff
  if (section === 'server' && p.can_pin_server) {
    actions.push(p.server_pinned
      ? `<button class="news-btn" data-server-pin-id="${p.id}" data-server-pin-action="unpin">Unpin</button>`
      : `<button class="news-btn" data-server-pin-id="${p.id}" data-server-pin-action="pin">Pin to server</button>`);
  }
  if (section === 'community' && !isOwn) {
    actions.push(`<button class="news-btn news-btn-report" data-report-id="${p.id}">⚐ Report</button>`);
  }
  if (isStaff || isOwn) {
    actions.push(`<button class="news-btn news-btn-danger" data-delete-id="${p.id}">Delete</button>`);
  }
  if (isStaff && section === 'hub') {
    actions.push(p.pinned
      ? `<button class="news-btn" data-pin-id="${p.id}" data-pin-action="unpin">Unpin</button>`
      : `<button class="news-btn" data-pin-id="${p.id}" data-pin-action="pin">Pin</button>`);
  }
  // Hide the edited mark on hub announcements — staff curates those and
  // shouldn't have to broadcast every typo fix.
  if (p.edited_at && section !== 'hub') {
    actions.push(`<span class="news-edited-mark" title="Edited ${formatNewsTs(p.edited_at)}">✎ edited</span>`);
  }

  const ts = formatNewsTs(p.created_at);
  const playerLabel = section === 'community'
    ? `<span class="news-player-name lb-clickable" data-open-profile="${escAttr(p.username)}">${escHtml(p.username)}</span>`
    : `<span class="news-server-name">${escHtml(titleName)}</span>
       <span class="news-dot">·</span>
       <span class="news-author">${escHtml(p.username)}</span>`;

  return `
    <div class="${cardClass}" data-post-id="${p.id}">
      <div class="news-card-body">
        ${crestHtml}
        <div class="news-card-content">
          ${pinTag}
          <div class="news-meta-row">
            ${playerLabel}
            ${tagHtml}
            ${pollBadge}
            ${cmtBadge}
            ${viewBadge}
            <span class="news-ts">${ts}</span>
          </div>
          <div class="news-card-title">${escHtml(p.title)}</div>
          <div class="news-card-snippet">${renderNewsBody(p.body)}</div>
          ${p.image_url ? `<div class="news-card-img"><img src="${escHtml(p.image_url)}" alt="" loading="lazy" draggable="false"></div>` : ''}
          <div class="news-card-actions">
            ${actions.join('')}
            <div class="news-reactions">${reactBtns}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function formatNewsTs(iso) {
  if (!iso) return '';
  const t = new Date(iso.replace(' ', 'T') + 'Z').getTime();
  const diff = Math.floor((Date.now() - t) / 1000);
  if (diff < 60)        return 'just now';
  if (diff < 3600)      return Math.floor(diff / 60)   + 'm ago';
  if (diff < 86400)     return Math.floor(diff / 3600) + 'h ago';
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + 'd ago';
  return new Date(t).toLocaleDateString();
}

// Walk every element tagged with [data-ts] and refresh its relative-time label.
// Avoids re-fetching the feed just to bump "just now" → "2m ago" → "5m ago".
function refreshAllNewsTs() {
  document.querySelectorAll('[data-ts]').forEach(el => {
    el.textContent = formatNewsTs(el.dataset.ts);
  });
}
// Tick every 30s so timestamps stay fresh while the launcher is open.
setInterval(refreshAllNewsTs, 30_000);

function openNewsCompose(el, editPost = null) {
  const sec = editPost ? editPost.section : _newsState.section;
  const tags = NEWS_TAGS[sec];
  const myUsername = state.user?.username || '';
  const draft = !editPost ? loadNewsDraft(sec) : null;

  let serverOpts = '';
  if (sec === 'server') {
    // Anyone can post about any approved server. List them all alphabetically.
    const allServers = [...(state.servers || [])]
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const selectedServerId = editPost ? editPost.server_id : (draft?.server_id || (allServers[0] && allServers[0].id));
    serverOpts = `
      <label class="news-modal-label" for="news-cmp-server">Server</label>
      <select class="news-modal-input" id="news-cmp-server" ${editPost ? 'disabled' : ''}>
        ${allServers.map(s => `<option value="${s.id}" ${s.id === selectedServerId ? 'selected' : ''}>${escHtml(s.name)}</option>`).join('')}
      </select>
    `;
  }
  const modal = document.createElement('div');
  modal.className = 'news-modal-backdrop';
  const initialTitle = editPost?.title ?? draft?.title ?? '';
  const initialBody  = editPost?.body  ?? draft?.body  ?? '';
  const initialTag   = editPost?.tag   ?? draft?.tag   ?? '';
  const headerLabel = editPost
    ? (sec === 'hub' ? 'Edit hub announcement' : sec === 'server' ? 'Edit server announcement' : 'Edit community post')
    : (sec === 'hub' ? 'New hub announcement' : sec === 'server' ? 'New server announcement' : 'New community post');
  const draftHint = !editPost && draft && (draft.title || draft.body)
    ? `<div class="news-draft-hint">📝 Draft restored. <button type="button" class="news-link-btn" id="news-cmp-discard">discard</button></div>`
    : '';
  modal.innerHTML = `
    <div class="news-modal">
      <div class="news-modal-hdr">
        <h3>${headerLabel}</h3>
        <button class="news-modal-close" id="news-cmp-close">✕</button>
      </div>
      <div class="news-modal-body">
        ${draftHint}
        ${serverOpts}
        <label class="news-modal-label" for="news-cmp-tag">Tag</label>
        <select class="news-modal-input" id="news-cmp-tag">
          <option value="">(none)</option>
          ${tags.map(t => `<option value="${t}" ${t === initialTag ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <label class="news-modal-label" for="news-cmp-title">Title</label>
        <input class="news-modal-input" id="news-cmp-title" type="text" maxlength="160" placeholder="Short, punchy headline" value="${escAttr(initialTitle)}">
        <label class="news-modal-label" for="news-cmp-body">Body</label>
        <div class="news-toolbar">
          <button type="button" class="news-tb-btn" data-tb="bold"      data-tip="Bold (Ctrl+B)"><strong>B</strong></button>
          <button type="button" class="news-tb-btn" data-tb="italic"    data-tip="Italic (Ctrl+I)"><em>I</em></button>
          <button type="button" class="news-tb-btn" data-tb="strike"    data-tip="Strikethrough"><span style="text-decoration:line-through">S</span></button>
          <button type="button" class="news-tb-btn" data-tb="header"    data-tip="Heading"><strong>H</strong></button>
          <button type="button" class="news-tb-btn" data-tb="ul"        data-tip="Bulleted list">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1.2"/><circle cx="3.5" cy="12" r="1.2"/><circle cx="3.5" cy="18" r="1.2"/></svg>
          </button>
          <button type="button" class="news-tb-btn" data-tb="ol"        data-tip="Numbered list">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18h-2c0-1 2-2 2-3s-1-1.5-2-1"/></svg>
          </button>
          <button type="button" class="news-tb-btn" data-tb="link"   data-tip="Insert link">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </button>
          <button type="button" class="news-tb-btn" data-tb="image"  data-tip="Insert image">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </button>
          <button type="button" class="news-tb-btn" data-tb="emoji"  data-tip="Insert emoji">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
          </button>
          <span class="news-tb-hint">supports **bold** · *italic* · [text](url) · ![](image)</span>
          <input type="file" id="news-cmp-img-file" accept="image/jpeg,image/png,image/gif,image/webp" style="display:none">
        </div>
        <div class="news-modal-input news-body-editor" id="news-cmp-body" contenteditable="true" data-placeholder="Write your post. Toolbar buttons format the selection. Multiple images supported."></div>
        <div class="news-counter" id="news-counter">
          <span class="news-counter-chars">0 / 8000 characters</span>
          <span class="news-counter-sep">·</span>
          <span class="news-counter-imgs">0 / 10 images</span>
        </div>

        <div class="news-emoji-picker" id="news-emoji-picker" style="display:none">
          ${NEWS_EMOJI.map(e => `<button type="button" class="news-emoji" data-emoji="${e}">${e}</button>`).join('')}
        </div>

        <div class="news-poll-compose" id="news-poll-compose">
          <button type="button" class="news-btn" id="news-poll-toggle">📊 Attach poll</button>
          <div class="news-poll-fields" id="news-poll-fields" style="display:none">
            <label class="news-modal-label">Poll question</label>
            <input class="news-modal-input" id="news-poll-q" type="text" maxlength="255" placeholder="e.g. Which raid should we add next?">
            <label class="news-modal-label">Options (2–8)</label>
            <div id="news-poll-opts">
              <input class="news-modal-input news-poll-opt" type="text" maxlength="160" placeholder="Option 1">
              <input class="news-modal-input news-poll-opt" type="text" maxlength="160" placeholder="Option 2">
            </div>
            <button type="button" class="news-btn" id="news-poll-add-opt" style="margin-top:6px">+ Add option</button>
            <label class="news-poll-multi-label">
              <input type="checkbox" id="news-poll-multi">
              <span>Allow voters to pick more than one option</span>
            </label>
            <button type="button" class="news-btn news-btn-report" id="news-poll-remove" style="margin-top:6px">Remove poll</button>
          </div>
        </div>

        <div class="news-modal-msg" id="news-cmp-msg"></div>
      </div>
      <div class="news-modal-foot">
        <button class="news-btn" id="news-cmp-cancel">Cancel</button>
        <button class="news-btn news-btn-primary" id="news-cmp-submit">${editPost ? 'Save changes' : 'Post'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Belt-and-braces: nothing clicked inside the compose modal bubbles out
  modal.addEventListener('mousedown', e => e.stopPropagation());
  modal.addEventListener('click',     e => e.stopPropagation());

  const close = () => modal.remove();
  modal.querySelector('#news-cmp-close').addEventListener('click', e => { e.stopPropagation(); close(); });
  modal.querySelector('#news-cmp-cancel').addEventListener('click', e => { e.stopPropagation(); close(); });
  // Don't close on backdrop click — too easy to lose a long post in progress.

  const bodyEl  = modal.querySelector('#news-cmp-body');
  const titleEl = modal.querySelector('#news-cmp-title');
  const tagEl   = modal.querySelector('#news-cmp-tag');
  const imgFile = modal.querySelector('#news-cmp-img-file');
  const msgEl   = modal.querySelector('#news-cmp-msg');
  const emojiPicker = modal.querySelector('#news-emoji-picker');

  const MAX_CHARS = 8000;
  const MAX_IMAGES = 10;
  // Pre-fill the contentEditable with rendered markdown (for edit / draft restore)
  bodyEl.innerHTML = renderNewsBody(initialBody);

  function updateCounters() {
    const md = newsEditorToMarkdown(bodyEl);
    const chars = md.length;
    const imgs = bodyEl.querySelectorAll('img').length;
    const charEl = modal.querySelector('.news-counter-chars');
    const imgEl  = modal.querySelector('.news-counter-imgs');
    const counter = modal.querySelector('#news-counter');
    if (charEl) charEl.textContent = `${chars} / ${MAX_CHARS} characters`;
    if (imgEl)  imgEl.textContent  = `${imgs} / ${MAX_IMAGES} images`;
    counter?.classList.toggle('warn',   chars > MAX_CHARS * 0.8 || imgs > MAX_IMAGES * 0.8);
    counter?.classList.toggle('danger', chars > MAX_CHARS       || imgs > MAX_IMAGES);
  }
  updateCounters();
  bodyEl.addEventListener('input', updateCounters);

  // Shared image-upload helper used by toolbar/paste/drop
  async function uploadAndInsertImage(file) {
    if (!file || !file.type?.startsWith('image/')) return false;
    if (file.size > 5 * 1024 * 1024) { msgEl.textContent = 'Image too large (max 5MB).'; return false; }
    if (bodyEl.querySelectorAll('img').length >= MAX_IMAGES) {
      msgEl.textContent = `Image limit reached (${MAX_IMAGES} max).`; return false;
    }
    msgEl.textContent = 'Uploading image…';
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const res = await window.hub.post('/api/news/upload-image', { image: reader.result });
          if (res?.ok && res.url) {
            insertHtmlAtCaret(`<img class="news-md-img" src="${escAttr(res.url)}" alt="" draggable="false"><br>`);
            captureSelection(); msgEl.textContent = ''; updateCounters(); resolve(true);
          } else { msgEl.textContent = res?.error || 'Image upload failed.'; resolve(false); }
        } catch (err) { msgEl.textContent = err?.message || 'Image upload failed.'; resolve(false); }
      };
      reader.readAsDataURL(file);
    });
  }

  // Paste handling: image from clipboard → upload; otherwise plain-text paste.
  bodyEl.addEventListener('paste', async (e) => {
    const items = (e.clipboardData || window.clipboardData).items || [];
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        e.preventDefault();
        const file = it.getAsFile();
        await uploadAndInsertImage(file);
        return;
      }
    }
    e.preventDefault();
    const txt = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, txt);
  });

  // Drag-drop: image files dropped into the editor get uploaded + inserted at cursor.
  bodyEl.addEventListener('dragover', (e) => { e.preventDefault(); bodyEl.classList.add('drag-over'); });
  bodyEl.addEventListener('dragleave', () => bodyEl.classList.remove('drag-over'));
  bodyEl.addEventListener('drop', async (e) => {
    e.preventDefault(); bodyEl.classList.remove('drag-over');
    const files = e.dataTransfer?.files || [];
    for (const f of files) await uploadAndInsertImage(f);
  });

  // Selection focus tracking — captures on every selectionchange while modal is open.
  // selectionchange fires reliably whenever the user moves the caret or makes
  // a new selection, which is more robust than the keyup/mouseup hack.
  let savedRange = null;
  const captureSelection = () => {
    const sel = window.getSelection();
    if (sel.rangeCount && bodyEl.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  };
  const onSelChange = () => captureSelection();
  document.addEventListener('selectionchange', onSelChange);
  // Cleanup when modal closes
  const oldRemove = modal.remove.bind(modal);
  modal.remove = () => { document.removeEventListener('selectionchange', onSelChange); oldRemove(); };
  function restoreSelection() {
    if (!savedRange) { bodyEl.focus(); return; }
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }

  // Insert raw text at the current caret (used by emoji picker)
  function insertTextAtCaret(text) {
    bodyEl.focus(); restoreSelection();
    document.execCommand('insertText', false, text);
  }
  // Insert HTML (used by image insert)
  function insertHtmlAtCaret(html) {
    bodyEl.focus(); restoreSelection();
    document.execCommand('insertHTML', false, html);
  }

  // ── DRAFTS (only for new posts; never overwrite while editing) ──
  if (!editPost) {
    const persist = () => {
      const serverEl = modal.querySelector('#news-cmp-server');
      saveNewsDraft(sec, {
        title: titleEl.value,
        body:  newsEditorToMarkdown(bodyEl),
        tag:   tagEl.value,
        server_id: serverEl ? +serverEl.value : null,
      });
    };
    titleEl.addEventListener('input', persist);
    bodyEl.addEventListener('input',  persist);
    tagEl.addEventListener('change',  persist);
    const discardBtn = modal.querySelector('#news-cmp-discard');
    if (discardBtn) discardBtn.addEventListener('click', () => {
      clearNewsDraft(sec);
      titleEl.value = ''; bodyEl.innerHTML = ''; tagEl.value = '';
      modal.querySelector('.news-draft-hint')?.remove();
    });
  }

  // ── KEYBOARD SHORTCUTS ──
  bodyEl.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'b')      { e.preventDefault(); document.execCommand('bold'); captureSelection(); }
    else if (k === 'i') { e.preventDefault(); document.execCommand('italic'); captureSelection(); }
    else if (k === 'enter') { e.preventDefault(); modal.querySelector('#news-cmp-submit').click(); }
  });

  // Mousedown on toolbar buttons must NOT steal focus from the editor —
  // otherwise execCommand has no selection to act on.
  modal.querySelectorAll('.news-tb-btn').forEach(btn => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
  });

  modal.querySelectorAll('.news-tb-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.tb;
      bodyEl.focus(); restoreSelection();
      if (action === 'bold')   { document.execCommand('bold');   captureSelection(); return; }
      if (action === 'italic') { document.execCommand('italic'); captureSelection(); return; }
      if (action === 'strike') { document.execCommand('strikeThrough'); captureSelection(); return; }
      if (action === 'header') {
        // Toggle between paragraph and h3 for the current line
        const cur = document.queryCommandValue('formatBlock')?.toLowerCase() || '';
        document.execCommand('formatBlock', false, cur.includes('h3') ? 'p' : 'h3');
        captureSelection(); return;
      }
      if (action === 'ul')     { toggleListInEditor(bodyEl, 'ul'); captureSelection(); return; }
      if (action === 'ol')     { toggleListInEditor(bodyEl, 'ol'); captureSelection(); return; }
      if (action === 'image')  return imgFile.click();
      if (action === 'emoji')  {
        emojiPicker.style.display = (emojiPicker.style.display === 'none') ? 'flex' : 'none';
        return;
      }
      if (action === 'link') {
        const url = await promptThemed('Insert link', 'URL (https:// or http://)', '');
        if (url == null) return;
        if (!/^https?:\/\//i.test(url)) { msgEl.textContent = 'Link must start with http:// or https://'; return; }
        bodyEl.focus(); restoreSelection();
        const sel = window.getSelection();
        if (sel.toString()) {
          document.execCommand('createLink', false, url);
        } else {
          insertHtmlAtCaret(`<a href="${escAttr(url)}">${escHtml(url)}</a>`);
        }
        captureSelection();
      }
    });
  });

  // Stop emoji picker mousedowns from blurring the editor
  emojiPicker.addEventListener('mousedown', (e) => e.preventDefault());

  emojiPicker.querySelectorAll('.news-emoji').forEach(b => {
    b.addEventListener('click', () => {
      insertTextAtCaret(b.dataset.emoji);
      captureSelection();
      // Stay open — user might want to add several. Toggle the smile button to close.
    });
  });

  // Image button just delegates to the shared helper.
  imgFile.addEventListener('change', async () => {
    const file = imgFile.files?.[0];
    if (file) await uploadAndInsertImage(file);
    imgFile.value = '';
  });

  // Poll compose UI
  const pollFields = modal.querySelector('#news-poll-fields');
  const pollOpts   = modal.querySelector('#news-poll-opts');
  modal.querySelector('#news-poll-toggle').addEventListener('click', () => {
    pollFields.style.display = pollFields.style.display === 'none' ? 'block' : 'none';
  });
  modal.querySelector('#news-poll-remove').addEventListener('click', () => {
    pollFields.style.display = 'none';
    modal.querySelector('#news-poll-q').value = '';
    pollOpts.querySelectorAll('.news-poll-opt').forEach(i => i.value = '');
  });
  modal.querySelector('#news-poll-add-opt').addEventListener('click', () => {
    const count = pollOpts.querySelectorAll('.news-poll-opt').length;
    if (count >= 8) return;
    const inp = document.createElement('input');
    inp.className = 'news-modal-input news-poll-opt';
    inp.type = 'text'; inp.maxLength = 160;
    inp.placeholder = `Option ${count + 1}`;
    pollOpts.appendChild(inp);
  });

  // Pre-fill poll fields when editing a post that already has a poll
  if (editPost && editPost.poll && editPost.poll.options?.length) {
    pollFields.style.display = 'block';
    modal.querySelector('#news-poll-q').value = editPost.poll.question || '';
    modal.querySelector('#news-poll-multi').checked = !!editPost.poll.multi_choice;
    // Replace default 2 inputs with one per existing option
    pollOpts.innerHTML = '';
    editPost.poll.options.forEach((o, i) => {
      const inp = document.createElement('input');
      inp.className = 'news-modal-input news-poll-opt';
      inp.type = 'text'; inp.maxLength = 160;
      inp.placeholder = `Option ${i + 1}`;
      inp.value = o.label || '';
      pollOpts.appendChild(inp);
    });
  }

  modal.querySelector('#news-cmp-submit').addEventListener('click', async () => {
    const title = titleEl.value.trim();
    const body  = newsEditorToMarkdown(bodyEl);
    const tag   = tagEl.value || null;
    if (!title || !body) { msgEl.textContent = 'Title and body are required.'; return; }
    if (body.length > MAX_CHARS) {
      msgEl.textContent = `Body is too long (${body.length} / ${MAX_CHARS} characters). Trim it down before posting.`;
      return;
    }
    const imgCount = bodyEl.querySelectorAll('img').length;
    if (imgCount > MAX_IMAGES) {
      msgEl.textContent = `Too many images (${imgCount} / ${MAX_IMAGES} max).`;
      return;
    }
    if (title.length > 160) {
      msgEl.textContent = `Title too long (${title.length} / 160 characters).`;
      return;
    }
    msgEl.textContent = editPost ? 'Saving…' : 'Posting…';
    try {
      let res;
      if (editPost) {
        const editPayload = { post_id: editPost.id, title, body, tag };
        // Poll changes: 'remove' if user closed the poll fields, otherwise replace if filled
        if (pollFields.style.display === 'none') {
          if (editPost.poll) editPayload.poll_action = 'remove';
        } else {
          const q = modal.querySelector('#news-poll-q').value.trim();
          const opts = Array.from(pollOpts.querySelectorAll('.news-poll-opt'))
            .map(i => i.value.trim()).filter(v => v);
          if (q && opts.length >= 2) {
            editPayload.poll = {
              question: q, options: opts,
              multi_choice: modal.querySelector('#news-poll-multi').checked ? 1 : 0,
            };
          }
        }
        res = await window.hub.post('/api/news/edit', editPayload);
      } else {
        const payload = { section: sec, title, body, tag };
        if (sec === 'server') payload.server_id = +modal.querySelector('#news-cmp-server').value;
        if (pollFields.style.display !== 'none') {
          const q = modal.querySelector('#news-poll-q').value.trim();
          const opts = Array.from(pollOpts.querySelectorAll('.news-poll-opt'))
            .map(i => i.value.trim()).filter(v => v);
          if (q && opts.length >= 2) {
            payload.poll = {
              question: q, options: opts,
              multi_choice: modal.querySelector('#news-poll-multi').checked ? 1 : 0,
            };
          } else if (q || opts.length) {
            msgEl.textContent = 'Poll needs a question and at least 2 options.'; return;
          }
        }
        res = await window.hub.post('/api/news/post', payload);
      }
      if (res?.ok) {
        if (!editPost) clearNewsDraft(sec);
        close();
        await loadAndRenderNews(el);
        showToast(editPost ? 'Saved.' : 'Posted.', 'success');
      } else {
        msgEl.textContent = res?.error || (editPost ? 'Failed to save.' : 'Failed to post.');
      }
    } catch (err) { msgEl.textContent = err?.message || 'Network error.'; }
  });

  setTimeout(() => {
    // If draft/edit pre-filled the title, focus the body so they can keep typing
    if (titleEl.value) {
      bodyEl.focus();
      // Move caret to end of editor
      const range = document.createRange();
      range.selectNodeContents(bodyEl);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      captureSelection();
    } else {
      titleEl.focus();
    }
  }, 50);
}

async function handleLibraryPlay(name) {
  try { await api.play(name); startActiveSessionChip(name); } catch (err) { console.error(err); }
}

async function handleLibraryUninstall(name) {
  // Optimistic UI: flip the server's downloaded flag locally + re-render
  // immediately so the row vanishes the instant the user clicks. The API
  // call happens in the background; if it fails we restore the entry.
  // Was using `event.target` (non-standard global) which broke the button
  // state and left rows stuck on "REMOVING…" until manual reload.
  const srv = state.servers.find(s => s.name === name);
  const wasDownloaded = srv?.downloaded;
  if (srv) srv.downloaded = false;
  rerenderLibraryIfOpen();

  try {
    const result = await api.uninstall(name);
    if (result && result.success) {
      showToast(`${name} uninstalled.`, 'success');
      // Refresh in background so other state (e.g. card aggregates) catches up,
      // but the UI already shows the right thing.
      loadServers().catch(() => {});
    } else {
      // Restore: API said it failed, put the row back.
      if (srv) srv.downloaded = wasDownloaded;
      rerenderLibraryIfOpen();
      showToast('Uninstall failed' + (result?.error ? ': ' + result.error : '.'), 'error');
    }
  } catch (err) {
    if (srv) srv.downloaded = wasDownloaded;
    rerenderLibraryIfOpen();
    showToast('Uninstall error: ' + err.message, 'error');
  }
}

// Re-render the library tab in-place if it's the currently visible nav tab.
// Library is a top nav-tab (data-tab="library"), not a sidebar rs-tab —
// previous code was checking the wrong DOM tree, so the row never updated
// after uninstall and the user had to reload manually.
function rerenderLibraryIfOpen() {
  const activeNav = document.querySelector('.nav-tab.active')?.dataset?.tab;
  if (activeNav !== 'library') return;
  const altContent = document.getElementById('alt-content');
  if (altContent) renderAltContent('library', altContent);
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
        <div class="friend-avatar req">${avatarInnerHTML(r.username, { hasAvatar: !!r.hasAvatar })}</div>
        <div class="friend-info">
          <span class="friend-name lb-clickable" data-open-profile="${escAttr(r.username)}">${renderName(r.username, r.equipped)}</span>
          <span class="friend-status">Wants to be your friend</span>
        </div>
        <div class="friend-actions">
          <button class="friend-btn friend-accept-btn" data-username="${r.username}">✓</button>
          <button class="friend-btn friend-decline-btn" data-username="${r.username}">✕</button>
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
      <div class="friend-avatar ${f.online ? 'online' : ''}">${avatarInnerHTML(f.username, { hasAvatar: !!f.hasAvatar })}</div>
      <div class="friend-info">
        <span class="friend-name lb-clickable" data-open-profile="${escAttr(f.username)}">${renderName(f.username, f.equipped)}</span>
        <span class="friend-status">${statusText}</span>
      </div>
      <div class="friend-actions">
        <button class="friend-btn friend-msg-btn" data-username="${f.username}">💬</button>
        <button class="friend-btn friend-remove-btn" data-username="${f.username}">✕</button>
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
      invalidateCaches('friends', 'friendReqs');
    } catch { showToast('Failed to send request.', 'error'); }
    btn.disabled = false; btn.textContent = 'SEND REQUEST';
  });

  el.querySelector('#add-friend-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') el.querySelector('#send-req-btn')?.click();
  });

  // Accept/decline friend requests
  el.querySelectorAll('.friend-accept-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;             // de-bounce double-clicks
      btn.disabled = true;
      const username = btn.dataset.username;
      try {
        // acceptFriend returns Boolean from Java (false on error). Without
        // checking the return, the toast spammed "added as a friend!" even
        // when the server replied 404 (already accepted, race condition).
        const ok = await api.acceptFriend(username);
        if (!ok) {
          showToast(`Could not accept request from ${username} (may already be accepted).`, 'error');
          invalidateCaches('friends', 'friendReqs');
          renderAltContent('friends', el);
          return;
        }
        showToast(`${username} added as a friend!`, 'success');
        invalidateCaches('friends', 'friendReqs');
        renderAltContent('friends', el);
        // Trigger achievement sync — accepting a friend may unlock
        // First Friend / Social Butterfly / Community Pillar / Hub
        // Ambassador. Show a coin toast for each newly-awarded one.
        try {
          const res = await window.hub.post('/api/achievements/sync', {});
          (res?.newly_unlocked || []).forEach(a => {
            showToast(`🏆 ${a.name} unlocked! +${a.coins} coins`, 'success');
          });
          if (res?.newly_unlocked?.length && window.DATA_CACHE?.stats) {
            window.DATA_CACHE.stats.data = null;
            window.DATA_CACHE.stats.at   = 0;
          }
        } catch {}
      } catch {
        showToast('Failed to accept request.', 'error');
      }
      // Don't re-enable — the row is gone after re-render anyway.
    });
  });

  el.querySelectorAll('.friend-decline-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      const username = btn.dataset.username;
      try {
        await api.declineFriend(username);
        invalidateCaches('friends', 'friendReqs');
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
      if (btn.disabled) return;
      btn.disabled = true;
      const username = btn.dataset.username;
      const ok = await rhConfirm(`Remove ${username} from your friends?`, {
        title: 'Remove friend',
        confirmText: 'Remove',
        cancelText: 'Cancel',
        danger: true,
      });
      if (!ok) { btn.disabled = false; return; }
      try {
        // Java's removeFriend returns boolean (false if PHP responded with
        // an error). Without checking, the row got DOM-removed even when
        // the server-side delete failed → next panel refresh re-fetched
        // and the friend "popped back up". Force a fresh refresh from the
        // server so the visible state matches the DB.
        const success = await api.removeFriend(username);
        if (!success) {
          showToast(`Could not remove ${username}. Please try again.`, 'error');
          btn.disabled = false;
          return;
        }
        showToast(`${username} removed.`, 'success');
        invalidateCaches('friends', 'friendReqs');
        renderAltContent('friends', el);
      } catch {
        showToast('Failed to remove friend.', 'error');
        btn.disabled = false;
      }
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

  // Build a {username: unread-count} map from the server's conversations
  // payload so we can flag rows whose newest message hasn't been read yet.
  const unreadMap = {};
  // And lift the server-provided `equipped` (Hub Store Phase 2) so each
  // convo row can render the other party's title pill + name color.
  const equippedMap = {};
  // Same for hasAvatar so rows show real profile pictures instead of
  // falling back to the letter glyph (the convo `list` is built from a
  // local Set of usernames, so anything not lifted here is lost).
  const hasAvatarMap = {};
  for (const c of convos) {
    const u = c.username || c.with_user || c.other_user;
    if (!u) continue;
    const n = parseInt(c.unread || '0', 10) || 0;
    if (n > 0) unreadMap[u] = n;
    if (c.equipped) equippedMap[u] = c.equipped;
    if (c.hasAvatar || c.has_avatar) hasAvatarMap[u] = true;
  }

  const list = [...storeUsernames].map(username => {
    const msgs = dmStoreGet(username);
    const last = msgs.at(-1);
    return {
      username,
      lastMsg: last?.content || '',
      lastTs:  last?.timestamp || last?.sent_at || last?.created_at || '',
      unread:  unreadMap[username] || 0,
      equipped: equippedMap[username] || null,
      hasAvatar: !!hasAvatarMap[username],
    };
  })
  // Unread conversations float to the top; otherwise newest-message-first.
  .sort((a, b) => (b.unread > 0) - (a.unread > 0) || (b.lastTs || '').localeCompare(a.lastTs || ''));

  // Compact relative-time formatter for convo rows. Full ISO timestamps
  // (e.g. "2026-05-05 11:48:25") were eating ~150px and forcing the
  // username to truncate to "VinnTe...". Show "11:48" if today, "Yesterday",
  // "2d", "3w" or "MMM D" so the column stays under ~50px.
  function fmtConvoTs(raw) {
    if (!raw) return '';
    let d;
    try { d = new Date(String(raw).replace(' ', 'T') + (String(raw).endsWith('Z') ? '' : 'Z')); } catch { return ''; }
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const diffMs = now - d;
    const day = 86_400_000;
    if (diffMs < 2 * day) return 'Yesterday';
    if (diffMs < 7  * day) return Math.floor(diffMs / day) + 'd';
    if (diffMs < 30 * day) return Math.floor(diffMs / (7 * day)) + 'w';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  el.innerHTML = `
    <div class="alt-header"><h2>FRIENDS CHAT</h2><p>Direct messages</p></div>
    ${list.length === 0 ? '<p class="empty-msg">No conversations yet.</p>' : list.map(c => `
      <div class="convo-row ${c.unread > 0 ? 'has-unread' : ''}" data-username="${escHtml(c.username)}">
        <div class="friend-avatar">${avatarInnerHTML(c.username, { hasAvatar: !!c.hasAvatar })}</div>
        <div class="friend-info">
          <span class="friend-name">${renderName(c.username, c.equipped)}${c.unread > 0 ? `<span class="convo-unread-badge">${c.unread}</span>` : ''}</span>
          <span class="friend-status convo-preview">${escHtml(c.lastMsg || 'No messages yet')}</span>
        </div>
        ${c.lastTs ? `<span class="convo-ts">${escHtml(fmtConvoTs(c.lastTs))}</span>` : ''}
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
        <div class="friend-avatar" style="width:28px;height:28px;font-size:0.7rem">${avatarInnerHTML(username, { hasAvatar: true })}</div>
        <span class="dm-title">${username}</span>
        <button class="chat-popout-btn" id="dm-popout">⧉</button>
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

  // Pop-out 📤 — opens this DM in its own floating window
  el.querySelector('#dm-popout')?.addEventListener('click', () => {
    if (window.hub?.openChatPopout) window.hub.openChatPopout('dm', username);
  });

  function renderMessages() {
    const msgs = dmStoreGet(username);
    if (msgs.length === 0) {
      msgEl.innerHTML = '<p class="empty-msg" style="padding:16px">No messages yet. Say hi!</p>';
      return;
    }
    // Handle BOTH formats — legacy optimistic msgs ({isOwn}) and server
    // msgs ({sender}). Per-message timestamps were removed; they flickered
    // every send because the optimistic vs server time formats differed
    // and rendered as a buggy "pops up then vanishes" effect.
    const me = state.user?.username;
    msgEl.innerHTML = msgs.map(m => {
      const isOwn = (typeof m.isOwn === 'boolean') ? m.isOwn : (m.sender === me);
      const body  = m.content || m.message || '';
      return `
        <div class="dm-msg ${isOwn ? 'own' : 'other'}">
          ${!isOwn
            ? `<span class="dm-sender">${renderName(m.sender || '?', m.equipped)}</span>`
            : ''}
          <div class="dm-bubble">${escHtml(body)}</div>
        </div>`;
    }).join('');
    msgEl.scrollTop = msgEl.scrollHeight;
  }

  // Render from local store immediately (no flicker), then replace with
  // the server's authoritative message list. We do NOT keep stale
  // pending-flagged messages here — they're either already confirmed
  // (and will arrive via the server fetch with correct timestamps) or
  // they failed to send (and the user can retry). Keeping them stacked
  // them at the bottom out-of-order. The fresh server list is the truth.
  renderMessages();
  api.getMessages(username)
    .then(data => {
      if (!data || !data.messages) return;
      DM_STORE[username] = data.messages;
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
    div.innerHTML = `<div class="dm-bubble">${escHtml(content)}</div>`;
    msgEl.appendChild(div);
    msgEl.scrollTop = msgEl.scrollHeight;
    // Await the send so the re-enable happens only AFTER the message is
    // confirmed on the server. This is the actual fix for the duplicate-
    // send bug: the previous code re-enabled the button in the next tick
    // (before the network round-trip), letting a second Enter press queue
    // an identical send while the first was still in flight.
    try {
      await api.sendMessage(username, content);
      // Confirmed — drop the optimistic pending copy and let the next
      // server refresh re-render the canonical message with proper ts.
      const arr = dmStoreGet(username);
      const idx = arr.indexOf(msg);
      if (idx !== -1) { arr.splice(idx, 1); dmStoreSave(); }
      // Pull the fresh authoritative list so this user's bubble shows
      // its real server timestamp instead of an optimistic local one.
      try {
        const data = await api.getMessages(username);
        if (data?.messages) {
          DM_STORE[username] = data.messages;
          dmStoreSave();
          renderMessages();
        }
      } catch (_) {}
    } catch {}
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
  // Group chat as a feature was stripped pre-launch — the only working room
  // here is global Hub Chat, so we skip the channel-list step and open it
  // directly. Tab still exists (renamed "HUB") so users have a single click
  // path to the global feed.
  return openGCRoom(el, 'hub', 'Hub Chat');
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
        <span class="dm-title">${roomId === 'hub' ? '🌐' : '#'} ${roomName}</span>
        <span class="dm-sub" style="margin-left:8px;color:#6a5a3a;font-size:0.74rem">Global launcher chat</span>
        <button class="chat-popout-btn" id="gc-popout">⧉</button>
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

  // Format a server timestamp into the user's LOCAL HH:MM. Accepts both
  // ISO 8601 ("2026-05-06T09:16:56Z" — current PHP) and the legacy MySQL
  // datetime ("2026-05-06 09:16:56" — pre-fix; treat as UTC).
  function fmtLocalHM(raw) {
    if (!raw) return '';
    let s = String(raw);
    if (!s.includes('T')) s = s.replace(' ', 'T');
    if (!/[zZ]|[+\-]\d\d:?\d\d$/.test(s)) s += 'Z';
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function appendMsg(m, opts = {}) {
    const isOwn = m.username === myUsername;
    // Hub chat returns the body in `message`; DM endpoints return `content`.
    // Accept either so this same renderer works for both.
    const body = m.content || m.message || '';
    const tsRaw = m.created_at || m.sent_at || '';
    const ts = fmtLocalHM(tsRaw);
    const div = document.createElement('div');
    div.className = `dm-msg ${isOwn ? 'own' : 'other'}`;
    if (opts.optimistic) {
      // Tag optimistic bubbles so we can swap them for the real server
      // copy when the next poll returns, instead of leaving both.
      div.dataset.optimistic = '1';
      div.dataset.body = body;
      div.style.opacity = '0.6';
    }
    // Equipped name color is applied to the sender span via inline style;
    // equipped title renders as a small pill next to the name on the SAME
    // line. Both wrapped in `.dm-sender-row` because `.dm-msg` is a flex
    // column — without the wrapper each direct child stacks vertically and
    // the title pill ends up on its own row below the name.
    // Chat uses the standard pill (not the tiny one) since it now sits
    // inline with the name on the sender row — needs to read at a glance.
    const titlePill   = equippedTitleHTML(m.equipped);
    // Username in Hub Chat is clickable: opens the sender's profile modal
    // (same handler as leaderboard / news / friends list — see the
    // [data-open-profile] global delegation in app.js). Skipped for the
    // 'Hub' system messages so the welcome banner doesn't try to open a
    // non-existent profile.
    // renderName handles per-letter colours (Bouncing Letters, Domino
    // Flip, etc) by wrapping each glyph in a span. Single-element
    // gradient/glow colours fall through to inline-style.
    const isSystem = m.username === 'Hub';
    const senderInner = renderName(m.username, m.equipped);
    const senderHtml = (!isOwn && !isSystem)
      ? `<span class="dm-sender lb-clickable" data-open-profile="${escAttr(m.username)}">${senderInner}</span>`
      : `<span class="dm-sender">${senderInner}</span>`;
    // Staff get a tiny 🗑 next to each non-system message so they can
    // moderate inline without an SQL trip. Hidden when the row is just
    // an optimistic local bubble (no real server id yet).
    const isStaff   = !!(state.user?.is_staff || state.user?.isStaff);
    const canDelete = isStaff && !opts.optimistic && m.id && !isSystem;
    const deleteBtn = canDelete
      ? `<button class="hub-msg-delete" data-delete-hub-msg="${m.id}" title="Delete (staff)">🗑</button>`
      : '';
    if (m.id) div.dataset.msgId = m.id;
    div.innerHTML = `<div class="dm-sender-row">${senderHtml}${titlePill}${deleteBtn}</div><div class="dm-bubble">${escHtml(body)}</div><span class="dm-ts">${ts}</span>`;
    msgEl.appendChild(div);
  }

  // Drop any optimistic bubbles whose body matches an incoming server msg —
  // prevents the "message renders twice" effect (once from optimistic insert,
  // once from the next /api/chat/hub poll).
  function reconcileOptimistic(serverMsg) {
    if (serverMsg.username !== myUsername) return;
    const body = serverMsg.content || serverMsg.message || '';
    const stale = msgEl.querySelector(`.dm-msg[data-optimistic="1"][data-body="${CSS.escape(body)}"]`);
    if (stale) stale.remove();
  }

  async function poll() {
    try {
      const data = await window.hub.get(`/api/chat/hub?since=${lastId}`);
      const msgs = data?.messages || [];
      if (msgs.length) {
        if (lastId === 0) msgEl.innerHTML = '';
        const atBottom = msgEl.scrollHeight - msgEl.scrollTop - msgEl.clientHeight < 60;
        msgs.forEach(m => {
          reconcileOptimistic(m);
          appendMsg(m);
          lastId = Math.max(lastId, m.id);
        });
        if (atBottom) msgEl.scrollTop = msgEl.scrollHeight;
      } else if (lastId === 0) {
        msgEl.innerHTML = '<p class="empty-msg" style="padding:16px">No messages yet. Say something!</p>';
      }
    } catch {}
    pollTimer = setTimeout(poll, 3000);
  }
  poll();

  // Per-send guard. The "sends twice" report was traced to fast Enter
  // double-presses (and the SEND button click bubbling on top of an Enter
  // keydown). Lock on `sending` so a second invocation is a no-op until
  // the first POST completes.
  let sending = false;
  async function doSend() {
    if (sending) return;
    const content = input.value.trim();
    if (!content) return;
    sending = true;
    sendBtn.disabled = true;
    input.value = '';

    // Optimistic render so it appears instantly. Uses the live username
    // so my own bubble shows on the right immediately.
    if (msgEl.querySelector('.empty-msg')) msgEl.innerHTML = '';
    appendMsg({
      username: myUsername,
      message:  content,
      created_at: new Date().toISOString(),
    }, { optimistic: true });
    msgEl.scrollTop = msgEl.scrollHeight;

    try {
      await window.hub.post('/api/chat/hub', { message: content });
      // Force-poll right away so the canonical server message arrives
      // before the next 3s tick. The optimistic bubble gets reconciled
      // (removed) when the real one lands.
      clearTimeout(pollTimer);
      poll();
    } catch (e) {
      console.error('hub send failed:', e);
      // On send failure, drop the optimistic bubble so the user isn't
      // misled into thinking it went through.
      const orphan = msgEl.querySelector(`.dm-msg[data-optimistic="1"][data-body="${CSS.escape(content)}"]`);
      if (orphan) orphan.remove();
    }
    sending = false;
    sendBtn.disabled = false;
    input.focus();
  }

  sendBtn.addEventListener('click', doSend);
  input.addEventListener('keydown', e => {
    // Enter triggers send. preventDefault so the default form submit /
    // newline-into-input behavior can't queue a second send through some
    // ancestor handler.
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); doSend(); }
  });
  input.focus();

  // Pop-out button — spawns a floating always-on-top chat window
  el.querySelector('#gc-popout')?.addEventListener('click', () => {
    if (window.hub?.openChatPopout) window.hub.openChatPopout('hub');
  });

  // Staff inline delete on hub chat messages. Optimistic remove from the
  // DOM so the click feels instant; if the API call fails, restore.
  msgEl.addEventListener('click', async e => {
    const btn = e.target.closest('[data-delete-hub-msg]');
    if (!btn) return;
    e.stopPropagation();
    const id = parseInt(btn.dataset.deleteHubMsg, 10);
    if (!id) return;
    if (!confirm('Delete this message?')) return;
    const row = btn.closest('.dm-msg');
    const placeholder = row?.nextSibling;
    const parent = row?.parentNode;
    row?.remove();
    try {
      const res = await window.hub.post('/api/chat/hub/delete', { id });
      if (!res?.ok) {
        // Restore on failure.
        if (parent && row) parent.insertBefore(row, placeholder);
        showToast('Delete failed: ' + (res?.error || 'unknown'), 'error');
      }
    } catch (err) {
      if (parent && row) parent.insertBefore(row, placeholder);
      showToast('Delete failed: ' + (err.message || err), 'error');
    }
  });
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
            ${(() => {
              const src = userAvatarSrc(e.username, { hasAvatar: !!e.hasAvatar, isMe: !!isYou });
              const letter = (e.username || '?')[0].toUpperCase();
              return src
                ? `<img src="${src}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${letter}'}))" />`
                : letter;
            })()}
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

// ── ABUSE REPORT MODAL ─────────────────────────────────────────────────────────
// Generic report dialog used by "🚩 Report" buttons across the launcher.
// Submits to /api/reports/submit which lands in the staff portal pending list.

function openReportModal(targetType, targetRef, targetName) {
  document.getElementById('report-overlay')?.remove();

  const categories = targetType === 'server'
    ? [
        ['malicious_jar', 'Malicious / suspicious JAR'],
        ['scam',          'Scam / pay-to-win violation'],
        ['impersonation', 'Impersonating another server'],
        ['spam',          'Spam / fake content'],
        ['other',         'Other'],
      ]
    : [
        ['harassment',    'Harassment / threats'],
        ['spam',          'Spam'],
        ['impersonation', 'Impersonating another user'],
        ['other',         'Other'],
      ];

  const overlay = document.createElement('div');
  overlay.id = 'report-overlay';
  // Reuse the request-server modal's CSS classes so styling matches
  // the rest of the launcher (gold-on-dark palette).
  overlay.className = 'rsm-backdrop';
  overlay.innerHTML = `
    <div class="rsm-modal">
      <div class="rsm-hdr">
        <h3>🚩 Report ${escHtml(targetType)} · ${escHtml(targetName || targetRef)}</h3>
        <button class="rsm-close" id="rep-close">✕</button>
      </div>
      <div class="rsm-body">
        <label class="rsm-label">Reason <span class="rsm-req">*</span></label>
        <select class="rsm-input" id="rep-cat">
          ${categories.map(([v, l]) => `<option value="${v}">${escHtml(l)}</option>`).join('')}
        </select>
        <label class="rsm-label">Details <span class="rsm-hint">(optional, max 2000 chars)</span></label>
        <textarea class="rsm-input rsm-textarea" id="rep-det" maxlength="2000" rows="5"
          placeholder="What happened? Anything that helps staff investigate."></textarea>
        <div class="rsm-msg" id="rep-msg"></div>
      </div>
      <div class="rsm-foot">
        <button class="rsm-btn" id="rep-cancel">Cancel</button>
        <button class="rsm-btn" id="rep-submit" style="background:linear-gradient(180deg,#c8a840,#8a6f20);color:#1a1408;border-color:#c8a840">Submit report</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#rep-close').addEventListener('click', close);
  overlay.querySelector('#rep-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('#rep-submit').addEventListener('click', async () => {
    const cat   = overlay.querySelector('#rep-cat').value;
    const det   = overlay.querySelector('#rep-det').value.trim();
    const msgEl = overlay.querySelector('#rep-msg');
    msgEl.textContent = 'Submitting…'; msgEl.style.color = '#888';
    try {
      const res = await window.hub.post('/api/reports/submit', {
        target_type: targetType, target_ref: String(targetRef),
        category: cat, details: det,
      });
      if (res?.ok) {
        msgEl.textContent = '✓ Report submitted. Thank you.';
        msgEl.style.color = '#7ad88a';
        setTimeout(close, 1500);
      } else {
        msgEl.textContent = res?.error || 'Submit failed.';
        msgEl.style.color = '#c84040';
      }
    } catch (e) {
      msgEl.textContent = 'Network error.'; msgEl.style.color = '#c84040';
    }
  });
}
window.openReportModal = openReportModal;

// ── SERVER DETAIL MODAL ────────────────────────────────────────────────────────

function showServerDetail(server) {
  // Remove any existing detail modal
  document.getElementById('server-detail-overlay')?.remove();

  const isFav       = state.favourites.has(server.name);
  const isInstalled = server.downloaded || false;
  const statusCode  = (typeof server.serverOnline === 'number') ? server.serverOnline : -1;
  const isOnline    = statusCode === 1;
  const isUnknown   = statusCode === -1;
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

      <!-- BANNER — prefer the card banner (always present + curated), fall
           back to the wider bannerUrl only if no card banner exists. -->
      ${(() => {
        // Detail-page hero: prefer the FULL banner (1600x500). The card
        // banner is a store-card crop, so falling back to it only matters
        // when an owner hasn't uploaded a separate full banner yet.
        // Matches the website's /server.php behaviour for consistency.
        const heroImg = server.bannerUrl || server.cardBannerUrl || '';
        return `
        <div class="sd-banner" style="background:${bannerColor(server.name)}">
          ${heroImg
            ? `<img class="sd-banner-blur" src="${escHtml(heroImg)}" alt="" aria-hidden="true" onerror="this.style.display='none'">
               <img class="sd-banner-img"  src="${escHtml(heroImg)}" alt="${escHtml(server.name)}" onerror="this.style.display='none'">`
            : ''}
          <div class="sd-banner-gradient"></div>
          <button class="sd-close" id="sd-close-btn">✕</button>
        </div>`;
      })()}

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
            ${isUnknown ? '' : `<span class="sd-status-dot ${isOnline ? 'online' : 'offline'}" title="${isOnline ? 'Online' : 'Offline'}"></span>`}
            ${server.isNew ? '<span class="sd-new-badge">NEW</span>' : ''}
            <button class="sd-report-btn" data-report-server="${escAttr(String(server.id))}" data-report-name="${escAttr(server.name)}">🚩 Report</button>
          </div>
          <p class="sd-tagline">${escHtml(server.tagline || '')}</p>
          <div class="sd-tags">${tags.map(t => `<span class="tag-pill">${escHtml(String(t).toUpperCase())}</span>`).join('')}</div>
        </div>
      </div>

      <!-- STATS ROW -->
      <div class="sd-stats-row">
        <div class="sd-stat"><span class="sd-stat-val">${players.toLocaleString()}</span><span class="sd-stat-lbl">Hub Players Online</span></div>
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

        ${''/* Client integrity hash was previously surfaced here in the
              UI but it's not useful to regular users (they can't do
              anything with a SHA-256) and the rare staff need for it
              is better served by the dev portal Re-hash button which
              shows the value. Stays in the DB and enforced silently
              on every download. */}

        ${state.user?.isStaff ? `
        <div class="sd-section sd-staff-review">
          <h3 class="sd-section-title" style="color:#ff7a7a">⚠ STAFF REVIEW</h3>
          <p class="sd-section-sub">Raw submission data — verify before approving. Anything sketchy here is on YOU once it's live.</p>
          <div class="sd-staff-grid">
            ${server.approved
              ? `<span class="sd-staff-badge sd-staff-ok">✓ Approved</span>`
              : `<span class="sd-staff-badge sd-staff-warn">⏳ Pending review</span>`}
            ${server.submittedBy ? `<span class="sd-staff-meta">Submitted by <b>${escHtml(server.submittedBy)}</b></span>` : ''}
            ${server.createdAt ? `<span class="sd-staff-meta">Submitted ${escHtml(server.createdAt)}</span>` : ''}
          </div>
          <div class="sd-staff-urls">
            ${[
              ['Jar download (RUN MALWARE SCAN)', server.jarUrl, 'jar'],
              ['Website',  server.websiteUrl, 'web'],
              ['Discord',  server.discordUrl, 'discord'],
              ['Banner',   server.bannerUrl, 'img'],
              ['Card banner', server.cardBannerUrl, 'img'],
              ['Icon',     server.iconUrl, 'img'],
            ].filter(([_, url]) => url).map(([label, url, kind]) => `
              <div class="sd-staff-url" data-kind="${kind}">
                <span class="sd-staff-url-label">${escHtml(label)}</span>
                <code class="sd-staff-url-val">${escHtml(url)}</code>
                <button class="sd-link-btn sd-staff-open" data-open-url="${escAttr(url)}">↗ Open</button>
                <button class="sd-link-btn sd-staff-copy" data-copy-url="${escAttr(url)}">📋 Copy</button>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}

        ${server.approved !== false && server.approved !== 0 ? `
        <div class="sd-section" id="sd-reviews-section" data-server-id="${server.id || ''}">
          <h3 class="sd-section-title">REVIEWS</h3>
          <div class="sd-reviews-host">
            <p class="sd-empty-section">Loading reviews…</p>
          </div>
        </div>
        ` : ''}

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
          <button class="action-btn ${(server.launchType === 'web' || isInstalled) ? 'play-btn' : 'install-btn'}" id="sd-play-btn" style="height:36px;font-size:0.72rem;min-width:100px">
            ${(server.launchType === 'web' || isInstalled) ? 'PLAY' : 'INSTALL'}
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

  // Profile clicks inside the modal (review authors etc.) — handle directly
  // since the .sd-modal stopPropagation blocks the document-level delegation.
  overlay.addEventListener('click', (e) => {
    const el = e.target.closest('[data-open-profile]');
    if (el && window.openUserProfile) {
      e.stopPropagation();
      window.openUserProfile(el.dataset.openProfile);
    }
    // Staff review: open URL in browser
    const openBtn = e.target.closest('[data-open-url]');
    if (openBtn) {
      e.stopPropagation();
      const url = openBtn.dataset.openUrl;
      if (window.hub?.openExternal) window.hub.openExternal(url);
      else window.open(url, '_blank');
    }
    // Staff review: copy URL to clipboard
    const copyBtn = e.target.closest('[data-copy-url]');
    if (copyBtn) {
      e.stopPropagation();
      const url = copyBtn.dataset.copyUrl;
      try {
        navigator.clipboard.writeText(url).then(() => showToast('Copied to clipboard', 'success'));
      } catch {}
    }
  });

  overlay.querySelector('#sd-close-btn').addEventListener('click', e => {
    e.stopPropagation();
    closeServerDetail();
  });

  // Report this server — opens a modal with category + details
  overlay.querySelector('.sd-report-btn[data-report-server]')?.addEventListener('click', e => {
    e.stopPropagation();
    const btn = e.currentTarget;
    openReportModal('server', btn.dataset.reportServer, btn.dataset.reportName);
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
    btn.classList.add('is-loading');
    // Web-client servers (LostCity, Xternium, etc) skip the JAR install path
    // entirely: PLAY opens a dedicated BrowserWindow with the play URL and
    // session tracking is driven by that window's lifecycle.
    if (server.launchType === 'web') {
      btn.textContent = 'Opening...';
      try {
        await launchWebServer(server);
        closeServerDetail();
      } catch { showToast('Failed to launch ' + server.name, 'error'); }
      btn.classList.remove('is-loading');
      btn.disabled = false;
      btn.textContent = 'PLAY';
      return;
    }
    if (isInstalled) {
      btn.textContent = 'Updating...';
      try {
        await api.play(server.name);
        startActiveSessionChip(server.name);
        closeServerDetail();
        if (state.settings?.minimizeOnLaunch) window.hub.minimize();
      } catch { showToast('Failed to launch ' + server.name, 'error'); }
      btn.classList.remove('is-loading');
      btn.disabled = false;
      btn.textContent = 'PLAY';
    } else {
      btn.textContent = 'Downloading...';
      btn.classList.remove('install-btn');
      try {
        const result = await api.install(server.name, server.jarUrl, server.jarSha256, server.jarSizeBytes);
        if (result?.success) {
          await loadServers();
          closeServerDetail();
        } else {
          showToast('Install failed: ' + (result?.error || 'unknown error'), 'error');
          btn.classList.remove('is-loading');
          btn.disabled = false;
          btn.textContent = 'INSTALL';
          btn.classList.add('install-btn');
        }
      } catch (err) {
        showToast('Install failed: ' + (err.message || err), 'error');
        btn.classList.remove('is-loading');
        btn.disabled = false;
        btn.textContent = 'INSTALL';
        btn.classList.add('install-btn');
      }
    }
  });

  // ── Reviews wiring ──────────────────────────────────────────────────────
  // Skip loading reviews for pending submissions — section isn't rendered.
  if (server.approved !== false && server.approved !== 0) loadServerReviews(server, overlay);

  document.body.appendChild(overlay);
  // Animate in
  requestAnimationFrame(() => overlay.classList.add('open'));
}

// Render the reviews section (write box + list) for the given server.
async function loadServerReviews(server, overlay) {
  const host = overlay.querySelector('.sd-reviews-host');
  if (!host || !server.id) return;
  let data;
  try { data = await window.hub.get('/api/reviews/list?server_id=' + server.id); } catch {}
  if (!data) { host.innerHTML = `<div class="sd-empty-section">Couldn't load reviews.</div>`; return; }

  const myReview = data.my_review;
  const reviews  = data.reviews || [];
  const avg      = data.avg_rating;
  const count    = data.count || 0;
  const elig     = data.eligibility || { can_review: true };

  const stars = (n) => {
    const filled = Math.round(n || 0);
    return '★'.repeat(filled) + '☆'.repeat(5 - filled);
  };

  host.innerHTML = `
    <div class="sd-reviews-summary">
      ${count > 0
        ? `<div class="sd-rev-avg">${stars(avg)} <span class="sd-rev-num">${avg.toFixed(1)}</span></div>
           <div class="sd-rev-count">${count} review${count === 1 ? '' : 's'}</div>`
        : `<div class="sd-rev-empty">No reviews yet — be the first.</div>`}
    </div>

    ${elig.can_review || myReview ? `
    <div class="sd-rev-write" id="sd-rev-write">
      <div class="sd-rev-write-hdr">${myReview ? '✎ Edit your review' : '✍ Write a review'}</div>
      <div class="sd-rev-stars" id="sd-rev-stars" data-value="${myReview?.rating || 0}">
        ${[1,2,3,4,5].map(n => `<span class="sd-star" data-n="${n}">${(myReview?.rating || 0) >= n ? '★' : '☆'}</span>`).join('')}
      </div>
      <textarea class="sd-rev-body" id="sd-rev-body" maxlength="2000" rows="4"
        placeholder="Optional — what did you like / dislike? (max 2000 chars)">${escHtml(myReview?.body || '')}</textarea>
      <div class="sd-rev-actions">
        <span class="sd-rev-msg" id="sd-rev-msg"></span>
        <button class="action-btn" id="sd-rev-submit" style="height:32px;font-size:0.72rem;min-width:120px">${myReview ? 'Save changes' : 'Post review'}</button>
      </div>
    </div>
    ` : `
    <div class="sd-rev-locked">
      🔒 ${escHtml(elig.reason || 'You cannot review this server right now.')}
    </div>
    `}

    <div class="sd-rev-list">
      ${reviews.length
        ? reviews.map(r => renderReviewItem(r)).join('')
        : `<div class="sd-empty-section">Be the first to share your thoughts.</div>`}
    </div>
  `;

  // Star picker — only present when the user is eligible to review
  // (otherwise the .sd-rev-locked block renders instead). Skip wiring
  // the star/submit handlers when the picker isn't in the DOM.
  const starsEl = host.querySelector('#sd-rev-stars');
  if (!starsEl) return;
  starsEl.querySelectorAll('.sd-star').forEach(s => {
    s.addEventListener('click', () => {
      const n = +s.dataset.n;
      starsEl.dataset.value = n;
      starsEl.querySelectorAll('.sd-star').forEach(st => {
        st.textContent = +st.dataset.n <= n ? '★' : '☆';
      });
    });
    s.addEventListener('mouseover', () => {
      const n = +s.dataset.n;
      starsEl.querySelectorAll('.sd-star').forEach(st => {
        st.classList.toggle('hover', +st.dataset.n <= n);
      });
    });
    s.addEventListener('mouseout', () => {
      starsEl.querySelectorAll('.sd-star').forEach(st => st.classList.remove('hover'));
    });
  });

  // Submit
  host.querySelector('#sd-rev-submit').addEventListener('click', async () => {
    const rating = +starsEl.dataset.value || 0;
    const body   = host.querySelector('#sd-rev-body').value.trim();
    const msg    = host.querySelector('#sd-rev-msg');
    if (rating < 1) { msg.textContent = 'Pick a rating first.'; msg.style.color = '#c96'; return; }
    msg.textContent = 'Saving…'; msg.style.color = '#888';
    try {
      const res = await window.hub.post('/api/reviews/submit', { server_id: server.id, rating, body });
      if (res?.ok) {
        msg.textContent = res.updated ? 'Review updated.' : 'Review posted.';
        msg.style.color = '#7ad88a';
        await loadServerReviews(server, overlay);
        await loadServers(); // refresh card aggregates
      } else {
        msg.textContent = res?.error || 'Failed to save.'; msg.style.color = '#c84040';
      }
    } catch { msg.textContent = 'Network error.'; msg.style.color = '#c84040'; }
  });

  // Delete from the user's own review card (in the list, not the form)
  host.querySelectorAll('[data-delete-rev]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirmThemed('Delete your review of this server? This cannot be undone.', {
        title: 'Delete review', okLabel: 'Delete', danger: true,
      });
      if (!ok) return;
      try {
        await window.hub.post('/api/reviews/delete', { id: +btn.dataset.deleteRev });
        await loadServerReviews(server, overlay);
        await loadServers();
      } catch { showToast('Failed to delete review', 'error'); }
    });
  });

  // Report buttons on individual reviews
  host.querySelectorAll('[data-report-rev]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await confirmThemed('Report this review for staff review?', {
        title: 'Report review', okLabel: 'Report', danger: true,
      });
      if (!ok) return;
      try {
        await window.hub.post('/api/reviews/report', { id: +btn.dataset.reportRev });
        showToast('Reported. Staff will review.', 'info');
      } catch { showToast('Report failed.', 'error'); }
    });
  });
}

function renderReviewItem(r) {
  const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
  const ts = formatNewsTs(r.created_at) + (r.edited_at ? ' · edited' : '');
  const initial = (r.username || '?')[0].toUpperCase();
  const avatarUrl = r.has_avatar ? `https://api.therspshub.com/uploads/avatars/${encodeURIComponent(r.username)}.jpg` : '';
  // Reviewer credentials so readers can judge authority
  const onServer  = r.minutes_on_server || 0;
  const onSrvLbl  = onServer >= 60 ? `${Math.round(onServer/60)}h on this server`
                  : onServer > 0   ? `${onServer}m on this server` : 'New here';
  const totalLbl  = r.hub_total_minutes >= 60 ? `${Math.round(r.hub_total_minutes/60)}h total` : `${r.hub_total_minutes||0}m total`;
  const srvCount  = r.hub_servers_played || 0;
  return `
    <div class="sd-rev-item">
      <div class="sd-rev-avatar">
        ${avatarUrl
          ? `<img src="${escAttr(avatarUrl)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
             <span style="display:none">${escHtml(initial)}</span>`
          : `<span>${escHtml(initial)}</span>`}
      </div>
      <div class="sd-rev-content">
        <div class="sd-rev-row">
          <span class="sd-rev-name lb-clickable" data-open-profile="${escAttr(r.username)}">${
            renderName(r.username, {
              color: {
                style: {
                  nameStyle:    r.name_style    || null,
                  ncClass:      r.name_class    || null,
                  splitLetters: !!r.split_letters,
                }
              }
            })
          }</span>
          <span class="sd-rev-stars-static">${stars}</span>
          <span class="sd-rev-ts">${ts}</span>
          ${!r.is_own ? `<button class="sd-rev-report" data-report-rev="${r.id}" title="Report">⚐</button>` : ''}
          ${r.is_own ? `<button class="sd-rev-own-delete" data-delete-rev="${r.id}" title="Delete your review">🗑</button>` : ''}
        </div>
        <div class="sd-rev-creds">
          <span title="Time this reviewer has played on this server">⏱ ${escHtml(onSrvLbl)}</span>
          <span class="sd-rev-creds-sep">·</span>
          <span title="Reviewer's total hub playtime">${escHtml(totalLbl)} on hub</span>
          <span class="sd-rev-creds-sep">·</span>
          <span title="Number of different servers this reviewer has played">${srvCount} server${srvCount === 1 ? '' : 's'} tried</span>
        </div>
        ${r.body ? `<div class="sd-rev-body-text">${escHtml(r.body).replace(/\n/g, '<br>')}</div>` : ''}
      </div>
    </div>
  `;
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
  // Forgot-password form reset too
  const fBtn = document.getElementById('asf-btn');
  if (fBtn) { fBtn.disabled = false; fBtn.textContent = 'SEND RESET LINK'; fBtn.style.display = ''; }
  const fErr = document.getElementById('asf-err'); if (fErr) { fErr.style.display = 'none'; fErr.textContent = ''; }
  const fOk  = document.getElementById('asf-ok');  if (fOk)  { fOk.style.display  = 'none'; fOk.textContent  = ''; }
  const fEml = document.getElementById('asf-email'); if (fEml) fEml.value = '';
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

  // Forgot-password flow: login → email form → success message
  document.getElementById('asl-forgot')?.addEventListener('click', () => {
    resetAuthForms();
    document.getElementById('auth-screen-login').style.display  = 'none';
    document.getElementById('auth-screen-forgot').style.display = '';
    document.getElementById('asf-email')?.focus();
  });
  document.getElementById('asf-to-login')?.addEventListener('click', () => {
    resetAuthForms();
    document.getElementById('auth-screen-forgot').style.display = 'none';
    document.getElementById('auth-screen-login').style.display  = '';
    document.getElementById('asl-user')?.focus();
  });
  document.getElementById('asf-btn')?.addEventListener('click', async () => {
    const emailEl = document.getElementById('asf-email');
    const errEl   = document.getElementById('asf-err');
    const okEl    = document.getElementById('asf-ok');
    const btn     = document.getElementById('asf-btn');
    errEl.style.display = 'none'; okEl.style.display = 'none';
    const email = (emailEl?.value || '').trim();
    if (!email || !/.+@.+\..+/.test(email)) {
      errEl.textContent = 'Enter a valid email.'; errEl.style.display = ''; return;
    }
    btn.disabled = true; btn.textContent = 'SENDING…';
    try {
      // Direct POST to VPS — works even when the local Java backend is down.
      await fetch('https://api.therspshub.com/api/auth/forgot_password.php', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      okEl.textContent = 'If that email matches an account, a reset link is on its way. Check your inbox.';
      okEl.style.display = '';
      btn.style.display = 'none';
    } catch {
      errEl.textContent = 'Network error. Try again in a moment.'; errEl.style.display = '';
      btn.disabled = false; btn.textContent = 'SEND RESET LINK';
    }
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
    // Paint the user's cached theme INSTANTLY from localStorage. No network
    // round-trip on the visual path. If they unequipped or changed theme
    // since last login, the catalog fetch below will overwrite with the
    // current state (small flicker, acceptable trade-off).
    try { paintCachedThemeFor(res.username); } catch (_) {}
    // Then fire the Hub Store catalog refetch in the background to confirm
    // / correct the painted theme. Don't await — let it race against the
    // rest of the login bookkeeping. The reload triggers
    // applyEquippedThemeOnLoad internally which updates the cache too.
    if (typeof window.reloadHubStoreCatalog === 'function') {
      try { window.reloadHubStoreCatalog(); } catch (_) {}
    }
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
    startFriendOnlinePolling(); startAnnouncementPolling(); startNewsNotificationPolling();
    startPlaytimeRefresh();
    // Kick off background prefetch for expensive tab data so the first
    // click on Stats / Friends / Chat renders instantly from cache.
    prefetchTabs();
    showToast(isNew ? 'Welcome, ' + res.username + '!' : 'Welcome back, ' + res.username + '!', 'success');

    // First-launch onboarding — fires once per device. Brand-new accounts
    // get the tour immediately after registration; returning users only
    // see it if they've never completed it on this machine.
    if (window.RspsHubOnboarding) {
      try { window.RspsHubOnboarding.autoStart(); } catch (_) {}
    }
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
    const ref   = (document.getElementById('asr-ref')?.value || '').trim().toUpperCase() || undefined;
    const err   = document.getElementById('asr-err');
    err.style.display = 'none';
    if (!user || !pass) { err.textContent = 'Username and password are required.'; err.style.display = ''; return; }
    if (ref && !/^[A-Z0-9]{8}$/.test(ref)) { err.textContent = 'Referral code must be 8 characters.'; err.style.display = ''; return; }
    btn.disabled = true; btn.textContent = 'CREATING…';
    try {
      const res = await window.hub.post('/api/auth/register', { username: user, password: pass, email, ref });
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

// Cached authoritative total from the server; falls back to summing perServer
// if the endpoint hasn't reported a totalMinutes field yet.
let _playtimeTotalMins = null;

function updatePlaytimeStatus() {
  const el = document.getElementById('status-playtime');
  if (!el) return;
  const totalMins = (_playtimeTotalMins !== null)
    ? _playtimeTotalMins
    : Object.values(state.playtime).reduce((a, m) => a + m, 0);
  el.textContent = '⏱ RSPS Time: ' + (totalMins > 0 ? formatMinutes(Math.round(totalMins)) : '—');
}

// Refresh the cached playtime totals from the server every 60 seconds so the
// status-bar agrees with the Stats tab even after long sessions / mid-game.
let _playtimeRefreshTimer = null;
function startPlaytimeRefresh() {
  if (_playtimeRefreshTimer) return;
  const refresh = async () => {
    try {
      // Pull from the SAME endpoint the Stats tab uses so the numbers agree.
      const stats = await window.hub.get('/api/stats/me');
      if (stats && typeof stats.totalMinutes === 'number') {
        _playtimeTotalMins = stats.totalMinutes;
      }
      // Also keep state.playtime in sync for per-server displays elsewhere.
      const pt = await api.getPlaytime().catch(() => null);
      if (pt && pt.perServer) state.playtime = pt.perServer;
      updatePlaytimeStatus();
    } catch {}
  };
  refresh();
  _playtimeRefreshTimer = setInterval(refresh, 60_000);
}

let _activeSessionInterval = null;

// ── WEB-CLIENT SERVER LAUNCH ──────────────────────────────────────────────
// Sister to api.play() for JAR servers. Web-client servers (LostCity-style,
// Xternium etc.) open a dedicated BrowserWindow in the main process which
// owns session tracking + window lifecycle. The renderer's job is just to
// kick it off and surface a chip while the game window is open.
//
// Active web session is tracked client-side as a Map of serverId -> { name,
// startedAt, intervalId } so we can drive the chip even though the actual
// session pings happen in main.js.
const _activeWebSessions = new Map();

async function launchWebServer(server) {
  const url = server.webUrl || server.web_url;
  if (!url) {
    showToast(`${server.name}: no web client URL configured.`, 'error');
    return;
  }
  const res = await window.hub.launchWebServer({
    serverId: server.id,
    name: server.name,
    url,
  });
  if (res?.error) {
    showToast(`Failed to launch ${server.name}: ${res.error}`, 'error');
    return;
  }
  // Chip already running for this server (window was reused). Don't double-track.
  if (res?.reused) return;
  startWebSessionChip(server);
}

function startWebSessionChip(server) {
  // The active-session chip is shared across JAR and web sessions. Web mode
  // counts elapsed time client-side instead of polling /api/session/status
  // since there's no Java child process to watch.
  const chip   = document.getElementById('active-session-chip');
  const nameEl = document.getElementById('active-session-name');
  const timeEl = document.getElementById('active-session-time');
  if (!chip) return;

  // If a JAR-session interval is running, leave it alone — different server.
  // We only show one chip at a time though, so the most recent launch wins
  // the display. (If you click play on a second server while the first is
  // still going, the chip shows the second.)
  nameEl.textContent = server.name;
  timeEl.textContent = '0:00:00';
  chip.style.display = 'flex';

  const startedAt = Date.now();
  const intervalId = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    timeEl.textContent = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, 1000);

  // While the web window is open, the reaper on the VPS rolls over the
  // active session every 5 min and writes a chunk to session_log + updates
  // playtime + users.total_playtime_minutes. The launcher needs to pick up
  // those updates so the level badge on the server card, stats page, and
  // sidebar all reflect playtime as it accrues. Without this refresh,
  // users keep the game window open for hours and the launcher UI still
  // shows their pre-session totals, making it look like they're not
  // earning hours. Reported by Xterbium (05X).
  const refreshIntervalId = setInterval(async () => {
    try {
      const pt = await api.getPlaytime();
      if (pt && pt.perServer) state.playtime = pt.perServer;
      updatePlaytimeStatus();
      await loadServers({ quiet: true });
      try {
        const fresh = await window.hub.getProfile(state.user?.username);
        if (fresh) state.profile = fresh;
        renderUser();
      } catch {}
      invalidateCaches('stats');
    } catch {}
  }, 5 * 60 * 1000);

  _activeWebSessions.set(server.id, {
    name: server.name,
    startedAt,
    intervalId,
    refreshIntervalId,
  });

  // Give the VPS a few seconds to record the session start, then refresh so
  // our own card shows the +1 player count.
  setTimeout(() => { loadServers().catch(() => {}); }, 4000);
}

// main.js fires 'web-session-ended' when the game window is closed. Hide the
// chip + refresh everything that depends on session totals (playtime, hub
// player count, profile time-played badge).
if (window.hub?.onWebSessionEnded) {
  window.hub.onWebSessionEnded(async ({ serverId }) => {
    const sess = _activeWebSessions.get(serverId);
    if (sess) {
      clearInterval(sess.intervalId);
      if (sess.refreshIntervalId) clearInterval(sess.refreshIntervalId);
      _activeWebSessions.delete(serverId);
    }
    // Only hide the chip if nothing else is showing in it. JAR sessions
    // have their own interval that owns the chip, don't stomp it.
    if (_activeWebSessions.size === 0 && !_activeSessionInterval) {
      const chip = document.getElementById('active-session-chip');
      if (chip) chip.style.display = 'none';
    }
    // Refresh playtime, server list, profile — same as JAR session end.
    invalidateCaches('stats', 'friends', 'friendReqs');
    try {
      const pt = await api.getPlaytime();
      if (pt && pt.perServer) state.playtime = pt.perServer;
      updatePlaytimeStatus();
      await loadServers();
      const fresh = await window.hub.getProfile(state.user?.username);
      if (fresh) state.profile = fresh;
      renderUser();
      // Sync achievements + show coin toasts for any unlocked by this session.
      // VPS already ran sync server-side in session_end.php, this just
      // surfaces what was awarded.
      const sync = await window.hub.post('/api/achievements/sync', {});
      (sync?.newly_unlocked || []).forEach(a => {
        showToast(`🏆 ${a.name} unlocked! +${a.coins} coins`, 'success');
      });
    } catch {}
  });
}

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
        // Bust every cache that could carry stale post-session data so the
        // next render anywhere shows fresh numbers. Without this the stats
        // modal / sidebar happily showed minute-stale playtime, which made
        // users think tracking was broken when it actually wasn't.
        invalidateCaches('stats', 'friends', 'friendReqs');
        try {
          const pt = await api.getPlaytime();
          if (pt && pt.perServer) state.playtime = pt.perServer;
          updatePlaytimeStatus();
          // Pull fresh server list from VPS (new hub_players, per-server totals)
          await loadServers();
          // Refresh state.profile too — that's what hero / sidebar / nav
          // pull from for the "X hours played" badge. Otherwise the badge
          // sticks at pre-session totals until the user navigates away.
          try {
            const fresh = await window.hub.getProfile(state.user?.username);
            if (fresh) state.profile = fresh;
            renderUser();
          } catch {}
          // Achievement sync after every session. The VPS already ran sync
          // server-side inside session_end.php, so this call is fast (just
          // returns "already_unlocked" if there's nothing new). The point of
          // making the call from here is to surface coin toasts for anything
          // newly unlocked. Without these toasts, users earn coins silently.
          try {
            const sync = await window.hub.post('/api/achievements/sync', {});
            (sync?.newly_unlocked || []).forEach(a => {
              showToast(`🏆 ${a.name} unlocked! +${a.coins} coins`, 'success');
            });
            if (sync?.newly_unlocked?.length) {
              invalidateCaches('stats');
            }
          } catch {}
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

// Notification icons mapped by type. Anything not listed falls back to 🔔
const NOTIF_ICONS = {
  'friend-request': '👤',
  'server-update':  '📢',
  'friend-online':  '🟢',
  'message':        '💬',
  'system':         '📣',
  'mention':        '@',
  'reaction':       '❤️',
  'reply':          '💬',
  'pin':            '📌',
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
  // Also tell the server so the badge stays in sync across launches
  try { window.hub.post('/api/notifications/mark-read', { all: true }); } catch {}
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
    <div class="notif-item${n.read ? '' : ' notif-unread'}" data-notif-id="${n.id}" ${n.postId ? `data-post-id="${n.postId}"` : ''}>
      <div class="notif-icon-wrap">${NOTIF_ICONS[n.type] || '🔔'}</div>
      <div class="notif-body">
        <div class="notif-title">${escHtml(n.title)}</div>
        <div class="notif-msg">${escHtml(n.msg)}</div>
        <div class="notif-time">${notifTimeAgo(n.ts)}</div>
      </div>
    </div>
  `).join('');
  // Click handler — open post detail if the notification is tied to one
  list.querySelectorAll('[data-post-id]').forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const postId = +item.dataset.postId;
      if (!postId) return;
      // Find the post or fetch it (best-effort across sections)
      let post = _newsState.posts.find(p => p.id === postId);
      if (!post) {
        try {
          const lists = await Promise.all(['hub','server','community'].map(s =>
            window.hub.get(`/api/news/list?section=${s}&limit=50`)));
          for (const l of lists) {
            const p = (l?.posts || []).find(pp => pp.id === postId);
            if (p) { post = p; break; }
          }
        } catch {}
      }
      // Mark this single notification read
      const id = item.dataset.notifId;
      if (id?.startsWith('nn-')) {
        try { await window.hub.post('/api/notifications/mark-read', { ids: [+id.slice(3)] }); } catch {}
      }
      const stored = NOTIF_STORE.find(n => n.id === id);
      if (stored) stored.read = true;
      updateNotifBadge();
      item.classList.remove('notif-unread');
      // Close dropdown
      closeAllDropdowns();
      // Open post detail
      if (post) {
        const newsPanel = document.querySelector('#slide-panel.open .panel-content') || document.body;
        openNewsDetail(post, newsPanel);
      }
    });
  });
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

// ── NEWS NOTIFICATION POLLING ────────────────────────────────────────────────
// Pulls mention/reaction/reply notifications from /api/notifications/list and
// merges them into the existing NOTIF_STORE so they show in the bell dropdown.

const _seenNewsNotifIds = new Set();
let   _newsNotifInit    = false;

function _newsNotifLabel(n) {
  const verb = n.type === 'mention'  ? 'mentioned you'
             : n.type === 'reaction' ? 'reacted to your post'
             : n.type === 'reply'    ? 'replied to your post'
             : n.type === 'pin'      ? 'pinned your post'
             : 'has news for you';
  return { title: `${n.from_username} ${verb}`, msg: n.preview || n.post_title || '' };
}

function startNewsNotificationPolling() {
  const poll = async () => {
    if (!state.user?.username) return;
    let res;
    try { res = await window.hub.get('/api/notifications/list?limit=20'); } catch { return; }
    const items = res?.notifications || [];
    // First load seeds the seen-set without surfacing toasts for old items
    if (!_newsNotifInit) {
      for (const n of items) {
        const { title, msg } = _newsNotifLabel(n);
        NOTIF_STORE.push({
          id: 'nn-' + n.id, type: n.type, title, msg,
          ts: new Date(n.created_at.replace(' ', 'T') + 'Z').getTime(),
          read: !!n.read_at, postId: n.post_id,
        });
        _seenNewsNotifIds.add(n.id);
      }
      NOTIF_STORE.sort((a,b) => b.ts - a.ts);
      updateNotifBadge();
      renderNotifDropdown();
      _newsNotifInit = true;
      return;
    }
    // Subsequent polls: only push genuinely new items (still on top via pushNotif)
    const fresh = items.filter(n => !_seenNewsNotifIds.has(n.id) && !n.read_at);
    for (const n of fresh.reverse()) {
      const { title, msg } = _newsNotifLabel(n);
      NOTIF_STORE.unshift({
        id: 'nn-' + n.id, type: n.type, title, msg,
        ts: new Date(n.created_at.replace(' ', 'T') + 'Z').getTime(),
        read: false, postId: n.post_id,
      });
      _seenNewsNotifIds.add(n.id);
      showToast(`${NOTIF_ICONS[n.type] || '🔔'} ${title}`, 'info');
    }
    if (NOTIF_STORE.length > 50) NOTIF_STORE.length = 50;
    updateNotifBadge();
    renderNotifDropdown();
  };
  setTimeout(poll, 1_000);     // initial seed almost immediately after login
  setInterval(poll, 10_000);   // then every 10s so mentions feel near-real-time
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

// Two-timer polling: the slow tick (8s) handles the global CHAT badge so we
// notice unread DMs even when the panel is closed; the fast tick (1.5s) only
// runs while the CHAT panel is open and refreshes the visible surface (list
// or open DM) so new messages appear effectively instantly.
// Periodic achievement sync. Runs an immediate pass on login + then every
// 60s. Fires toasts for newly-unlocked achievements so users see coin
// awards happen in near-real-time as their playtime / server count climb.
let _achSyncTimer = null;
function startAchievementSyncLoop() {
  if (_achSyncTimer) return;            // already running, idempotent
  const tick = async () => {
    if (!state.user?.username) return;
    try {
      const res = await window.hub.post('/api/achievements/sync', {});
      if (res?.newly_unlocked?.length && window.showToast) {
        const newAch = res.newly_unlocked.slice(0, 3);
        newAch.forEach((a, i) => {
          setTimeout(() => {
            window.showToast(`${a.icon} ${a.name} unlocked! +${a.coins} Hub Coins`, 'success');
          }, i * 1100);
        });
        if (res.newly_unlocked.length > 3) {
          setTimeout(() => {
            window.showToast(`+ ${res.newly_unlocked.length - 3} more achievements unlocked`, 'success');
          }, newAch.length * 1100);
        }
        // Bust the stats cache so the next time the user opens their
        // profile the panel renders the new badge as unlocked instantly,
        // instead of using a stale unlockedAchievements list from before
        // the sync awarded them.
        if (window.DATA_CACHE?.stats) {
          window.DATA_CACHE.stats.data = null;
          window.DATA_CACHE.stats.at   = 0;
        }
      }
    } catch (_) {}
  };
  // Fire once immediately on login so first-session catch-up coins land
  // before the user even opens the Stats modal
  setTimeout(tick, 1500);
  _achSyncTimer = setInterval(tick, 60_000);
}

function startMessagePolling() {
  let lastBadgedTotal = 0;

  async function tick() {
    if (!state.user?.username) return;
    try {
      const data = await api.getConversations().catch(() => null);
      const convos = data?.conversations || [];
      const activePanel = document.querySelector('.rs-tab.active')?.dataset?.panel;
      const onChat = activePanel === 'chat';

      // Badge math (always)
      let total = 0;
      for (const c of convos) {
        const username = c.username || c.with_user || c.other_user;
        if (!username) continue;
        const unread = parseInt(c.unread || '0', 10) || 0;
        if (unread <= 0) continue;
        if (onChat && state.activeDM === username) continue;
        total += unread;
      }
      const delta = total - lastBadgedTotal;
      if (delta > 0) addUnread('chat', delta);
      lastBadgedTotal = total;

      // Live refresh while the chat panel is open — fast tick only.
      if (!onChat) return;
      const body = document.getElementById('slide-panel-body');
      if (!body) return;

      if (state.activeDM) {
        const fresh = await api.getMessages(state.activeDM).catch(() => null);
        if (!fresh?.messages) return;
        DM_STORE[state.activeDM] = fresh.messages;
        dmStoreSave();
        const msgEl = body.querySelector('#dm-messages');
        if (!msgEl) return;
        // Only re-render if message count or last id changed (avoids
        // pointless DOM churn / scroll glitches).
        if (msgEl.dataset.lastCount === String(fresh.messages.length)) return;
        msgEl.dataset.lastCount = String(fresh.messages.length);
        const wasBottom = msgEl.scrollHeight - msgEl.scrollTop - msgEl.clientHeight < 60;
        msgEl.innerHTML = fresh.messages.map(m => `
          <div class="dm-msg ${m.sender === state.user.username ? 'own' : 'other'}">
            ${m.sender !== state.user.username
              ? `<span class="dm-sender">${renderName(m.sender, m.equipped)}</span>`
              : ''}
            <div class="dm-bubble">${escHtml(m.content || m.message || '')}</div>
          </div>
        `).join('');
        if (wasBottom) msgEl.scrollTop = msgEl.scrollHeight;
      } else if (body.querySelector('.convo-row') || body.querySelector('.empty-msg')) {
        renderConversationList(body, convos);
      }
    } catch {}
  }

  // Slow tick — keeps the badge fresh when CHAT isn't open
  setInterval(tick, 8_000);
  // Fast tick — only does work when CHAT is open (the early return above
  // makes this cheap when it's not)
  setInterval(() => {
    if (document.querySelector('.rs-tab.active')?.dataset?.panel !== 'chat') return;
    tick();
  }, 1_500);
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
  // Era
  'OSRS', 'Pre-EOC', 'EOC',
  // Style
  'PvM', 'PvP', 'Economy', 'Gambling',
  // Mode
  'Ironman', 'Group Ironman',
  // Content
  'Skilling', 'Raids', 'Bossing', 'Minigames', 'Vanilla',
  // Client
  'Custom', 'RuneLite', 'Mobile',
];
const XP_RATES = ['1x','5x','10x','25x','50x','100x','Custom/Varies'];

let _devPortalEl  = null;
let _devIsStaff   = false;

async function openDevPortal(startSection = 'my-servers') {
  if (_devPortalEl) return;
  // Trust the normalized state.user.isStaff that we set on auto-login. The
  // old /api/dev/check round-trip was unreliable (no longer exists) and
  // could mask staff users when it 404'd.
  _devIsStaff = !!state.user?.isStaff;

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
      <div class="dp-nav-item" data-section="reports">Abuse Reports <span class="dp-nav-badge" id="dp-reports-badge" style="display:none"></span></div>
      <div class="dp-nav-item" data-section="server-requests">Server Requests</div>
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
      case 'server-requests':
        await renderDevServerRequests(el);
        break;
      case 'reports':
        await renderDevAbuseReports(el);
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

  // Persistent UI state so filter/sort survives a re-render after Re-hash etc.
  // Scoped to the section element so My Servers and All Servers don't share.
  const stateKey = '__devListState';
  el[stateKey] = el[stateKey] || { query: '', sort: 'default' };
  const state = el[stateKey];

  // Build the toolbar (search + sort) once. The list itself gets re-rendered
  // every keystroke / sort change so filtering feels instant.
  el.innerHTML = `
    <div class="dp-section-hdr">${title}</div>
    ${fallbackBanner}
    <div class="dp-list-toolbar">
      <input
        class="dp-list-search"
        type="text"
        placeholder="Search ${servers.length} server${servers.length === 1 ? '' : 's'}..."
        value="${escAttr(state.query)}"
        autocomplete="off"
        spellcheck="false">
      <select class="dp-list-sort">
        <option value="default"  ${state.sort === 'default'  ? 'selected' : ''}>Default order</option>
        <option value="az"       ${state.sort === 'az'       ? 'selected' : ''}>Name A-Z</option>
        <option value="za"       ${state.sort === 'za'       ? 'selected' : ''}>Name Z-A</option>
        <option value="nohash"   ${state.sort === 'nohash'   ? 'selected' : ''}>No hash first</option>
        <option value="pending"  ${state.sort === 'pending'  ? 'selected' : ''}>Pending JAR change first</option>
      </select>
      <span class="dp-list-count"></span>
    </div>
    <div class="dp-server-list"></div>`;

  const listEl  = el.querySelector('.dp-server-list');
  const countEl = el.querySelector('.dp-list-count');
  const searchEl = el.querySelector('.dp-list-search');
  const sortEl   = el.querySelector('.dp-list-sort');

  function renderRows() {
    const q = state.query.trim().toLowerCase();
    let rows = q
      ? servers.filter(s => (s.name || '').toLowerCase().includes(q))
      : servers.slice();

    if (state.sort === 'az') {
      rows.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
    } else if (state.sort === 'za') {
      rows.sort((a, b) => (b.name || '').localeCompare(a.name || '', undefined, { sensitivity: 'base' }));
    } else if (state.sort === 'nohash') {
      rows.sort((a, b) => {
        const ah = a.jarSha256 ? 1 : 0;
        const bh = b.jarSha256 ? 1 : 0;
        if (ah !== bh) return ah - bh;
        return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
      });
    } else if (state.sort === 'pending') {
      rows.sort((a, b) => {
        const ap = a.pendingJarUrl ? 0 : 1;
        const bp = b.pendingJarUrl ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
      });
    }

    countEl.textContent = q
      ? `${rows.length} of ${servers.length} match`
      : `${rows.length} server${rows.length === 1 ? '' : 's'}`;

    if (!rows.length) {
      listEl.innerHTML = `<div class="dp-list-empty">No servers match "${escHtml(state.query)}"</div>`;
      return;
    }

    listEl.innerHTML = rows.map(s => `
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
            ${s.jarSha256
              ? `<span class="dp-badge dp-badge-ok" title="${escAttr(s.jarSha256)}">✓ Hash ${escHtml(s.jarSha256.slice(0,8))}</span>`
              : `<span class="dp-badge dp-badge-warn">⚠ No hash</span>`}
            ${s.pendingJarUrl
              ? `<span class="dp-badge dp-badge-warn" title="${escAttr(s.pendingJarUrl)}">⏳ Pending JAR change</span>`
              : ''}
          </div>
        </div>
        ${isAll && s.approved ? `
          <button class="dp-rehash-btn" data-id="${s.id}" title="Re-download the JAR and refresh the integrity hash">↻ Re-hash</button>
          ${s.pendingJarUrl
            ? `<button class="dp-promote-btn" data-id="${s.id}" title="Move pending_jar_url to live and re-hash">✓ Approve JAR change</button>`
            : ''}
        ` : ''}
        <button class="dp-edit-btn" data-id="${s.id}">Edit</button>
      </div>
    `).join('');

    // Wire row-level buttons after each re-render (innerHTML wipes listeners).
    listEl.querySelectorAll('.dp-edit-btn').forEach(btn => {
      const srv = servers.find(s => s.id === parseInt(btn.dataset.id));
      btn.addEventListener('click', () => { if (srv) renderDevEditor(el, srv); });
    });

    // Re-hash: download the current live jar_url, recompute SHA-256, write
    // the new value to the DB. Useful when a server pushes a new client.
    listEl.querySelectorAll('.dp-rehash-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Hashing…';
        try {
          const res = await window.hub.post('/api/dev/rehash',
            { id: parseInt(btn.dataset.id), promote_pending: false });
          if (res.ok) {
            showToast(`Hash updated: ${String(res.jar_sha256 || '').slice(0,16)}…`, 'success');
            setTimeout(() => location.reload(), 600);
          } else {
            showToast(`Re-hash failed: ${res.error || 'unknown'}`, 'error');
            btn.disabled = false; btn.textContent = orig;
          }
        } catch (e) {
          showToast(`Re-hash failed: ${e.message}`, 'error');
          btn.disabled = false; btn.textContent = orig;
        }
      });
    });

    // Approve a pending jar_url: atomically promote pending_jar_url to live
    // and re-hash. Use when an owner has changed their download URL and
    // we've reviewed the new one as legit.
    listEl.querySelectorAll('.dp-promote-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await rhConfirm('Promote the pending JAR URL to live and re-hash now?',
              { title: 'Approve JAR change', confirmText: 'Approve' })) return;
        btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Promoting…';
        try {
          const res = await window.hub.post('/api/dev/rehash',
            { id: parseInt(btn.dataset.id), promote_pending: true });
          if (res.ok) {
            showToast(`Promoted and re-hashed: ${String(res.jar_sha256 || '').slice(0,16)}…`, 'success');
            setTimeout(() => location.reload(), 600);
          } else {
            showToast(`Promote failed: ${res.error || 'unknown'}`, 'error');
            btn.disabled = false; btn.textContent = orig;
          }
        } catch (e) {
          showToast(`Promote failed: ${e.message}`, 'error');
          btn.disabled = false; btn.textContent = orig;
        }
      });
    });
  }

  // Wire toolbar handlers
  searchEl.addEventListener('input', () => {
    state.query = searchEl.value;
    renderRows();
  });
  sortEl.addEventListener('change', () => {
    state.sort = sortEl.value;
    renderRows();
  });
  // Ctrl+F-style: pressing / when the section is open focuses search
  // (only if not already in an input, so it doesn't steal typing).
  el.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchEl
        && !(document.activeElement?.tagName === 'INPUT'
          || document.activeElement?.tagName === 'TEXTAREA')) {
      e.preventDefault();
      searchEl.focus();
    }
  });

  renderRows();
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
    <div class="dp-pending-row dp-clickable" data-id="${s.id}" title="Click to view full submission">
      <div class="dp-pending-info">
        <div class="dp-server-name">${escHtml(s.name)} <span class="dp-view-hint">👁 click to review</span></div>
        <div class="dp-pending-desc">${escHtml((s.description || '').slice(0, 120))}${(s.description?.length || 0) > 120 ? '…' : ''}</div>
        <div class="dp-pending-meta">
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

  // Click anywhere on the row (except action buttons) → open the same server
  // detail modal that public users see, so staff can review banner/icon/desc/etc.
  list.querySelectorAll('.dp-pending-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const id = +row.dataset.id;
      const server = servers.find(x => x.id === id);
      if (server) showServerDetail(server);
    });
  });

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

// Staff-only: list pending abuse reports (server + user reports filed
// from anywhere in the launcher). Same pattern as server requests —
// each row has Resolve / Dismiss buttons that close out the report.
async function renderDevAbuseReports(el) {
  el.innerHTML = `<div class="dp-section-hdr">Abuse Reports</div><p class="loading-msg">Loading…</p>`;
  let res;
  try {
    res = await window.hub.get('/api/reports/pending');
  } catch (e) {
    el.innerHTML = `<div class="dp-section-hdr">Abuse Reports</div>
      <p class="empty-msg" style="padding:30px">Failed to load: ${escHtml(e.message)}</p>`;
    return;
  }
  const reports = res?.reports || [];

  const categoryLabel = (c) => ({
    malicious_jar: 'Malicious JAR',
    scam:          'Scam / P2W',
    impersonation: 'Impersonation',
    harassment:    'Harassment',
    spam:          'Spam',
    other:         'Other',
  }[c] || c);

  el.innerHTML = `
    <div class="dp-section-hdr">
      Abuse Reports
      <span class="dp-section-count">${reports.length} pending</span>
    </div>
    ${reports.length === 0
      ? `<div class="coming-soon-wrap" style="padding:40px 20px">
           <span class="coming-soon-icon">✓</span>
           <span class="coming-soon-title">No pending reports.</span>
           <span class="coming-soon-sub">All clear. New reports will land here when players submit them.</span>
         </div>`
      : `<div class="abuse-list">${reports.map(r => `
          <div class="abuse-card" data-rep-id="${r.id}">
            <div class="abuse-hdr">
              <span class="abuse-id">#${r.id}</span>
              <span class="abuse-type abuse-type-${escAttr(r.target_type)}">${escHtml(r.target_type.toUpperCase())}</span>
              <span class="abuse-target">${escHtml(r.target_ref)}</span>
              <span class="abuse-cat">${escHtml(categoryLabel(r.category))}</span>
              <span class="abuse-when">${escHtml(r.created_at || '')}</span>
            </div>
            <div class="abuse-meta">Reported by <b>${escHtml(r.reporter)}</b> · status: ${escHtml(r.status)}</div>
            <div class="abuse-details">${r.details ? escHtml(r.details).replace(/\n/g, '<br>') : '<i style="color:#6a7080">(no details provided)</i>'}</div>
            <div class="abuse-actions">
              <button class="abuse-btn abuse-resolve" data-action="resolved" data-id="${r.id}">✓ Mark Resolved</button>
              <button class="abuse-btn abuse-dismiss" data-action="dismissed" data-id="${r.id}">✗ Dismiss</button>
              <span class="abuse-msg" data-msg="${r.id}"></span>
            </div>
          </div>`).join('')}
        </div>`}
  `;

  el.querySelectorAll('.abuse-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id     = btn.dataset.id;
      const action = btn.dataset.action;  // 'resolved' or 'dismissed'
      const msg    = el.querySelector(`[data-msg="${id}"]`);
      const card   = el.querySelector(`[data-rep-id="${id}"]`);
      card?.querySelectorAll('.abuse-btn').forEach(b => b.disabled = true);
      msg.textContent = '…';
      try {
        const r = await window.hub.post('/api/reports/resolve', {
          id: parseInt(id, 10), status: action,
        });
        if (r?.ok) {
          if (card) {
            card.style.opacity = '0.4';
            card.style.transition = 'opacity 0.3s';
            setTimeout(() => renderDevAbuseReports(el), 400);
          }
        } else {
          msg.textContent = r?.error || 'Failed.';
          msg.style.color = '#c84040';
          card?.querySelectorAll('.abuse-btn').forEach(b => b.disabled = false);
        }
      } catch (e) {
        msg.textContent = 'Network error.';
        msg.style.color = '#c84040';
        card?.querySelectorAll('.abuse-btn').forEach(b => b.disabled = false);
      }
    });
  });
}

// Staff-only: list every player-submitted server request, with filter chips
// (Open / Contacted / Done / Rejected / All) and quick-action buttons to
// move a row through the pipeline. Each row shows the requester, the target
// server, links, free-text reason, and an editable staff note.
async function renderDevServerRequests(el) {
  el.innerHTML = `
    <div class="dp-section-hdr">Server Requests</div>
    <div class="srq-tabs" id="srq-tabs">
      <button class="srq-tab active" data-status="">All</button>
      <button class="srq-tab" data-status="open">Open</button>
      <button class="srq-tab" data-status="contacted">Contacted</button>
      <button class="srq-tab" data-status="done">Done</button>
      <button class="srq-tab" data-status="rejected">Rejected</button>
    </div>
    <div id="srq-list"><p class="loading-msg">Loading…</p></div>
  `;

  const listEl = el.querySelector('#srq-list');

  async function load(status) {
    listEl.innerHTML = '<p class="loading-msg">Loading…</p>';
    try {
      const qs = status ? `?status=${encodeURIComponent(status)}` : '';
      const d = await window.hub.get('/api/server_requests/list' + qs);
      const rows = d.requests || [];
      const counts = d.counts || {};

      // Update tab counts
      el.querySelectorAll('.srq-tab').forEach(t => {
        const s = t.dataset.status;
        const baseLabel = s === '' ? 'All'
          : s.charAt(0).toUpperCase() + s.slice(1);
        const n = s === '' ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[s] || 0);
        t.textContent = `${baseLabel} (${n})`;
      });

      if (!rows.length) {
        listEl.innerHTML = `<p class="empty-msg" style="padding:30px 0;text-align:center">No requests yet.</p>`;
        return;
      }

      listEl.innerHTML = rows.map(r => {
        const created = new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleString();
        const statusClass = `srq-status srq-status-${r.status}`;
        return `
          <div class="srq-row" data-id="${r.id}">
            <div class="srq-row-hdr">
              <span class="srq-name">${escHtml(r.server_name)}</span>
              <span class="${statusClass}">${escHtml(r.status)}</span>
              <span class="srq-meta">requested by <b>${escHtml(r.requester)}</b> · ${escHtml(created)}</span>
            </div>
            ${(r.website_url || r.discord_url) ? `
              <div class="srq-links">
                ${r.website_url ? `<a href="${escHtml(r.website_url)}" target="_blank" rel="noopener noreferrer">🌐 ${escHtml(r.website_url)}</a>` : ''}
                ${r.discord_url ? `<a href="${escHtml(r.discord_url)}" target="_blank" rel="noopener noreferrer">💬 ${escHtml(r.discord_url)}</a>` : ''}
              </div>` : ''}
            ${r.reason ? `<div class="srq-reason">${escHtml(r.reason)}</div>` : ''}
            <div class="srq-note-row">
              <textarea class="srq-note" data-note-id="${r.id}" placeholder="Staff note (optional, visible to staff only)" maxlength="1000">${escHtml(r.staff_note || '')}</textarea>
            </div>
            <div class="srq-actions">
              <button class="srq-btn" data-action="open"      data-id="${r.id}">Open</button>
              <button class="srq-btn" data-action="contacted" data-id="${r.id}">Contacted</button>
              <button class="srq-btn srq-btn-ok"   data-action="done"     data-id="${r.id}">Done</button>
              <button class="srq-btn srq-btn-warn" data-action="rejected" data-id="${r.id}">Reject</button>
            </div>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.srq-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id     = +btn.dataset.id;
          const status = btn.dataset.action;
          const noteEl = listEl.querySelector(`.srq-note[data-note-id="${id}"]`);
          btn.disabled = true;
          try {
            const res = await window.hub.post('/api/server_requests/update', {
              id, status, staff_note: noteEl?.value ?? null,
            });
            if (res?.ok) {
              showToast(`Marked ${status}.`, 'success');
              load(status === 'open' ? '' : (el.querySelector('.srq-tab.active')?.dataset.status || ''));
            } else {
              showToast(res?.error || 'Failed.', 'error');
              btn.disabled = false;
            }
          } catch (e) {
            showToast(e?.message || 'Network error.', 'error');
            btn.disabled = false;
          }
        });
      });
    } catch (e) {
      listEl.innerHTML = `<p class="empty-msg" style="padding:30px 0;text-align:center;color:#ff7a7a">Failed to load: ${escHtml(e?.message || 'unknown')}</p>`;
    }
  }

  el.querySelectorAll('.srq-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      el.querySelectorAll('.srq-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      load(tab.dataset.status);
    });
  });

  load('');
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
        <label class="dp-label">Server Icon</label>
        <div class="dp-img-row">
          <input class="dp-input" id="dp-icon-url" type="text" value="${escHtml(s.iconUrl)}" placeholder="https://...">
          <button class="dp-file-btn" id="dp-icon-pick">📁</button>
          <button class="dp-file-btn dp-clear-btn" data-target="dp-icon-url" data-preview="dp-icon-preview" title="Remove image">✕</button>
        </div>
        <div class="dp-size-hint">Recommended: <b>256 × 256</b> (square, 1:1) · PNG with transparent background</div>
        <div class="dp-img-thumb" id="dp-icon-preview">${s.iconUrl ? `<img src="${escHtml(s.iconUrl)}" onerror="this.style.display='none'">` : ''}</div>
      </div>
      <div class="dp-field">
        <label class="dp-label">Card Banner <span class="dp-hint">— store thumbnail</span></label>
        <div class="dp-img-row">
          <input class="dp-input" id="dp-card-banner-url" type="text" value="${escHtml(s.cardBannerUrl)}" placeholder="https://...">
          <button class="dp-file-btn" id="dp-card-banner-pick">📁</button>
          <button class="dp-file-btn dp-clear-btn" data-target="dp-card-banner-url" data-preview="dp-card-banner-preview" title="Remove image">✕</button>
        </div>
        <div class="dp-size-hint">Recommended: <b>840 × 460</b> (aspect 1.83:1) · displays at 210×115 · PNG or JPG</div>
        <div class="dp-img-thumb dp-img-wide" id="dp-card-banner-preview">${s.cardBannerUrl ? `<img src="${escHtml(s.cardBannerUrl)}" onerror="this.style.display='none'">` : ''}</div>
      </div>
      <div class="dp-field">
        <label class="dp-label">Detail Banner <span class="dp-hint">— page header</span></label>
        <div class="dp-img-row">
          <input class="dp-input" id="dp-banner-url" type="text" value="${escHtml(s.bannerUrl)}" placeholder="https://...">
          <button class="dp-file-btn" id="dp-banner-pick">📁</button>
          <button class="dp-file-btn dp-clear-btn" data-target="dp-banner-url" data-preview="dp-banner-preview" title="Remove image">✕</button>
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

    ${s.apiKey ? `
    <div class="dp-form-section">
      <div class="dp-form-section-hdr">📡 Live Player Count API</div>
      <div class="dp-field">
        <label class="dp-label">Your API Key <span class="dp-hint">— keep this private</span></label>
        <div class="dp-img-row">
          <input class="dp-input" id="dp-apikey" type="text" value="${escHtml(s.apiKey)}" readonly style="font-family:monospace;font-size:11px">
          <button class="dp-file-btn" id="dp-apikey-copy" title="Copy key">📋</button>
        </div>
        <div class="dp-size-hint">Push your server's live player count to the hub by POSTing every 5 minutes (anything faster is fine). Counts above 5000 get capped. <b>Counts go to zero after 10 minutes of silence</b> so a crashed cron job can't keep showing fake numbers — keep the heartbeat alive.</div>
      </div>
      <div class="dp-field">
        <label class="dp-label">Example: curl <span class="dp-hint">(single POST, schedule via cron / systemd / screen to repeat every 30-60s)</span></label>
        <pre class="dp-snippet" id="dp-snippet-curl">curl -X POST "https://therspshub.com/api/servers/update_players.php" \\
  -H "X-Server-Key: ${escHtml(s.apiKey)}" \\
  -H "X-Server-Name: ${escHtml(s.name)}" \\
  -H "Content-Type: application/json" \\
  -d '{"count":56}'</pre>
      </div>
      <div class="dp-field">
        <label class="dp-label">Example: Java OkHttp <span class="dp-hint">(drop into a scheduled task — credit: crazzmc)</span></label>
        <pre class="dp-snippet" id="dp-snippet-java">RequestBody body = RequestBody.create(
    "{\\"count\\":NUMERICAL_PLAYER_COUNT}",
    MediaType.get("application/json")
);

Request request = new Request.Builder()
    .url("https://therspshub.com/api/servers/update_players.php")
    .header("X-Server-Key", "${escHtml(s.apiKey)}")
    .header("X-Server-Name", "${escHtml(s.name)}")
    .post(body)
    .build();</pre>
      </div>
      <div class="dp-field">
        <label class="dp-label">Example: PHP (cron every minute)</label>
        <pre class="dp-snippet" id="dp-snippet-php">$count = (int) $db->query("SELECT COUNT(*) FROM players WHERE online=1")->fetchColumn();
$ch = curl_init("https://api.therspshub.com/api/servers/update_players.php");
curl_setopt_array($ch, [
  CURLOPT_POST           => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER     => [
    "Content-Type: application/json",
    "X-Server-Key: ${escHtml(s.apiKey)}",
    "X-Server-Name: ${escHtml(s.name)}",
  ],
  CURLOPT_POSTFIELDS => json_encode(["count" => $count]),
]);
curl_exec($ch);
curl_close($ch);</pre>
      </div>
    </div>` : ''}

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

  </div>

  <!-- ── LIVE PREVIEW + STICKY ACTION BAR ── -->
  <!-- Save / Delete buttons used to live at the bottom of the form column,
       which meant scrolling all the way down every time. Xterbium asked to
       move them somewhere always visible. Now they sit at the top of the
       right column above the live preview, so you can save without losing
       your place in a long form. -->
  <div class="dp-preview-panel">
    <div class="dp-preview-actions">
      <button class="dp-submit-btn" id="dp-save">${isNew ? 'Submit for Review' : 'Save Changes'}</button>
      ${!isNew ? `<button class="dp-delete-btn" id="dp-delete">Delete</button>` : ''}
    </div>
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
  ['dp-name','dp-tagline','dp-desc','dp-card-banner-url','dp-banner-url','dp-icon-url'].forEach(id => {
    el.querySelector(`#${id}`)?.addEventListener('input', () => devRefreshPreview(el));
  });
  el.querySelectorAll('.dp-tag-cb').forEach(cb => cb.addEventListener('change', () => devRefreshPreview(el)));

  // Image file pickers — for new submissions we stash the picked file's
  // base64 in memory and upload AFTER submit (when we have a real id).
  // For existing servers we upload immediately. devPortalSave reads from
  // this stash on submit success and fires the deferred uploads.
  const _pendingUploads = el._pendingUploads = el._pendingUploads || {};
  [
    { pick: 'dp-icon-pick',        input: 'dp-icon-url',        preview: 'dp-icon-preview',        endpoint: '/api/dev/upload/icon',         field: 'icon'        },
    { pick: 'dp-card-banner-pick', input: 'dp-card-banner-url', preview: 'dp-card-banner-preview', endpoint: '/api/dev/upload/card-banner',  field: 'card_banner' },
    { pick: 'dp-banner-pick',      input: 'dp-banner-url',      preview: 'dp-banner-preview',      endpoint: '/api/dev/upload/banner',       field: 'banner'      },
  ].forEach(({ pick, input, preview, endpoint, field }) => {
    el.querySelector(`#${pick}`)?.addEventListener('click', async () => {
      const btn = el.querySelector(`#${pick}`);
      const filePath = await window.hub.pickAvatar();
      if (!filePath) return;

      const serverId = s.id;
      // New submission path — read the file NOW, stash it, defer upload
      // until the server gets created via submit.
      if (!serverId) {
        btn.textContent = '⏳';
        btn.disabled = true;
        try {
          const base64 = await window.hub.readFileBase64(filePath);
          if (!base64) throw new Error('Could not read file');
          _pendingUploads[field] = { endpoint, base64, input };
          // Show a local-file preview so the user can see what they picked.
          const localUrl = 'file:///' + filePath.replace(/\\/g, '/');
          el.querySelector(`#${input}`).value = '';   // don't pollute the form with file:///
          el.querySelector(`#${input}`).placeholder = 'will upload on submit';
          const p = el.querySelector(`#${preview}`);
          if (p) p.innerHTML = `<img src="${localUrl}">`;
          devRefreshPreview(el);
        } catch (e) {
          showToast('Could not load image: ' + e.message, 'error');
        } finally {
          btn.textContent = '📁';
          btn.disabled = false;
        }
        return;
      }

      // Existing-server path — upload immediately.
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
      // Typing wipes the "cleared" flag — user has clearly given up on deleting.
      e.target.dataset.cleared = '';
      devRefreshPreview(el);
    });
  });

  // ✕ clear buttons next to each image picker. Flag the input as "cleared"
  // so devCollect sends the 'delete' sentinel — update.php otherwise ignores
  // empty URL values to protect against stale-form-blank overwrites.
  el.querySelectorAll('.dp-clear-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const targetId  = btn.dataset.target;
      const previewId = btn.dataset.preview;
      const input  = el.querySelector('#' + targetId);
      const prev   = el.querySelector('#' + previewId);
      if (input) { input.value = ''; input.dataset.cleared = '1'; }
      if (prev)  prev.innerHTML = '';
      devRefreshPreview(el);
    });
  });

  // Live Player Count API — copy buttons (key + each language snippet)
  const copyToClipboard = (text, btn) => {
    navigator.clipboard.writeText(text).then(() => {
      if (!btn) return;
      const orig = btn.textContent;
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = orig; }, 1200);
    });
  };
  el.querySelector('#dp-apikey-copy')?.addEventListener('click', () => {
    const inp = el.querySelector('#dp-apikey');
    if (inp?.value) copyToClipboard(inp.value, el.querySelector('#dp-apikey-copy'));
  });
  // Click any snippet block to copy its full contents.
  el.querySelectorAll('.dp-snippet').forEach(pre => {
    pre.addEventListener('click', () => copyToClipboard(pre.textContent, null));
    pre.title = 'Click to copy';
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
  // URL fields: ONLY include if non-empty. The upload endpoints (upload_icon /
  // upload_banner / upload_card_banner) write the public URL directly to the
  // DB. If we always sent these fields and an input happened to be blank
  // (race condition, re-render, etc.) the save endpoint would overwrite the
  // URL the upload just stored. By omitting them when empty, the only way to
  // clear a URL is to type "delete" into the field, which we treat below.
  const iconEl   = el.querySelector('#dp-icon-url');
  const cardEl   = el.querySelector('#dp-card-banner-url');
  const bannerEl = el.querySelector('#dp-banner-url');
  const iconVal   = iconEl?.value.trim()   || '';
  const cardVal   = cardEl?.value.trim()   || '';
  const bannerVal = bannerEl?.value.trim() || '';
  // For each URL field: a typed value gets sent as-is; an empty field that
  // the user explicitly cleared via the ✕ button gets the sentinel 'delete'
  // so update.php blanks the column; a quiet empty (race condition, stale
  // form) gets omitted so update.php leaves the DB alone.
  const urlFields = {};
  if (iconVal)               urlFields.icon_url        = iconVal;
  else if (iconEl?.dataset.cleared === '1')   urlFields.icon_url        = 'delete';
  if (cardVal)               urlFields.card_banner_url = cardVal;
  else if (cardEl?.dataset.cleared === '1')   urlFields.card_banner_url = 'delete';
  if (bannerVal)             urlFields.banner_url      = bannerVal;
  else if (bannerEl?.dataset.cleared === '1') urlFields.banner_url      = 'delete';
  return {
    name:            el.querySelector('#dp-name')?.value.trim()           || '',
    tagline:         el.querySelector('#dp-tagline')?.value.trim()        || '',
    // accent_color removed — dev portal no longer exposes a colour picker
    ...urlFields,
    description:     el.querySelector('#dp-desc')?.value.trim()           || '',
    changelog:       el.querySelector('#dp-changelog')?.value.trim()      || '',
    jar_url:         el.querySelector('#dp-jar')?.value.trim()            || '',
    // xp_rate removed from the dev portal — was redundant with the
    // server's own description and ended up wrong on most listings.
    website_url:     el.querySelector('#dp-website')?.value.trim()        || '',
    discord_url:     el.querySelector('#dp-discord')?.value.trim()        || '',
    // Same guard as URL fields: only send tags if at least one is checked,
    // so a save with no boxes ticked can't blank an existing tag list.
    ...(tags.length ? { tags: tags.join(',') } : {}),
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
      // Backend returns { success, id, message } for a successful submit.
      // Use the new id to fire any deferred image uploads the dev queued
      // before the server existed.
      const newId = res?.id;
      const pending = el._pendingUploads || {};
      const keys = Object.keys(pending);
      if (newId && keys.length) {
        btn.textContent = `Uploading ${keys.length} image${keys.length === 1 ? '' : 's'}…`;
        for (const k of keys) {
          const { endpoint, base64 } = pending[k];
          try {
            await window.hub.post(endpoint, { serverId: newId, base64 });
          } catch (uerr) {
            console.warn(`[submit] ${k} upload failed:`, uerr);
            // Non-fatal — server is created, the dev can re-upload from edit
            showToast(`Image upload for ${k} failed — try the edit page.`, 'error');
          }
        }
        el._pendingUploads = {};
      }
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
  // Match the real detail page: full banner first, card banner fallback.
  const banner = s.bannerUrl || s.banner_url || s.cardBannerUrl || s.card_banner_url || '';
  const icon   = s.iconUrl || s.icon_url || '';
  const tags   = Array.isArray(s.tags) ? s.tags : (s.tags||'').split(',').map(t=>t.trim()).filter(Boolean);
  const desc   = s.description || '';
  const tagline= s.tagline || '';
  const xp     = '';   // XP rate removed
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
        ${banner ? `
          <img class="sd-banner-blur" src="${escHtml(banner)}" alt="" aria-hidden="true" onerror="this.style.display='none'">
          <img class="sd-banner-img"  src="${escHtml(banner)}" alt="" onerror="this.style.display='none'">` : ''}
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
        <div class="set-label">Auto-Update Launcher</div>
        <div class="set-sub">Automatically download and install RSPS Hub updates in the background</div>
      </div>
      ${setToggleHtml('set-autoupdate', s.autoUpdateLauncher !== false)}
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
    <div class="set-row set-between" style="margin-top:4px">
      <div>
        <div class="set-label">Server Requests</div>
        <div class="set-sub">Player-submitted requests for new servers to add</div>
      </div>
      <button class="set-browse-btn" id="set-open-requests">Open</button>
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
      <div class="set-label">Email
        ${state.profile?.email_verified_at
          ? '<span style="color:#4caf50;font-size:11px;margin-left:8px">✓ verified</span>'
          : (state.profile?.email
              ? '<span style="color:#c96;font-size:11px;margin-left:8px">⚠ unverified</span> <button id="set-email-resend" class="set-link-btn" style="font-size:11px;margin-left:6px;background:none;border:0;color:#c8a840;cursor:pointer;text-decoration:underline;padding:0">Resend verification</button>'
              : '')}
      </div>
      <div class="set-sub" style="margin-bottom:6px">Used for password resets. We never share it. Changing it triggers a fresh verification email.</div>
      <div class="set-row set-between" style="gap:8px">
        <input class="set-input" id="set-email-input" type="email" placeholder="you@example.com"
               value="${escAttr(state.profile?.email || '')}" style="flex:1">
        <button class="set-browse-btn" id="set-email-submit">Update Email</button>
      </div>
      <div id="set-email-msg" class="set-sub" style="color:#888;margin-top:4px"></div>
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
    <div class="set-row set-col" style="margin-top:8px">
      <div class="set-label">Refer a Friend
        <span id="set-ref-count" class="set-sub" style="margin-left:8px;font-size:11px;color:#888">…</span>
      </div>
      <div class="set-sub" style="margin-bottom:6px">Share your code. When a friend signs up using it, you BOTH get <b>500 hub coins</b> after their first login.</div>
      <div class="set-row set-between" style="gap:8px">
        <input class="set-input" id="set-ref-code" type="text" readonly style="flex:1;text-transform:uppercase;letter-spacing:2px;font-family:monospace;background:#1a1610">
        <button class="set-browse-btn" id="set-ref-copy">Copy Code</button>
      </div>
    </div>
    <div class="set-row set-col" style="margin-top:8px">
      <div class="set-label">Discord
        <span id="set-discord-status" class="set-sub" style="margin-left:8px;font-size:11px;color:#888">Loading…</span>
      </div>
      <div class="set-sub" style="margin-bottom:6px">Pair your Discord with this hub account. In Discord, run <b>/link</b> and paste the 6-char code below.</div>
      <div class="set-row set-between" style="gap:8px">
        <input class="set-input" id="set-discord-code" type="text" placeholder="ABC123" maxlength="6"
               style="flex:1;text-transform:uppercase;letter-spacing:2px;font-family:monospace">
        <button class="set-browse-btn" id="set-discord-submit">Link Discord</button>
      </div>
      <div id="set-discord-msg" class="set-sub" style="color:#888;margin-top:4px"></div>
    </div>
    <div class="set-account-btns" style="margin-top:10px">
      <button class="set-danger-btn" id="set-logout">Logout</button>
    </div>
  </div>

  <!-- ── ABOUT ── -->
  <div class="set-section">
    <div class="set-section-hdr">☕&nbsp; Support the Hub</div>
    <div class="set-row set-col">
      <div class="set-label">RSPS Hub is free.</div>
      <div class="set-sub" style="margin-bottom:8px">Costs are low and donations aren't expected. If you want to chip in anyway, Ko-fi's below.</div>
      <button class="set-browse-btn" id="set-kofi-btn" style="align-self:flex-start;padding:8px 18px">☕ Support on Ko-fi</button>
    </div>
  </div>

  <div class="set-section">
    <div class="set-section-hdr">🧭&nbsp; Help</div>
    <div class="set-row set-between">
      <div>
        <span class="set-label">Show me around again</span>
        <div class="set-sub">Replay the first-launch tour. Reminds you what every tab does and where things live.</div>
      </div>
      <button class="set-browse-btn" id="set-replay-onboarding" type="button">Start tour</button>
    </div>
  </div>

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

  // Re-run onboarding tour. Closes Settings panel first so the tour can
  // highlight nav tabs without the settings panel covering them.
  el.querySelector('#set-replay-onboarding')?.addEventListener('click', () => {
    if (!window.RspsHubOnboarding) return;
    // Switch back to the Store so the highlighted tabs are visible in
    // their normal positions, then kick off the tour.
    try { setActiveNavTab('store'); } catch (_) {}
    window.RspsHubOnboarding.reset();
    setTimeout(() => window.RspsHubOnboarding.start(), 200);
  });

  // Ko-fi donation — opens the support page in the user's default browser.
  el.querySelector('#set-kofi-btn')?.addEventListener('click', () => {
    window.hub?.openExternal('https://ko-fi.com/rspshub');
  });

  // Staff panel shortcuts
  el.querySelector('#set-open-staff')?.addEventListener('click',    () => openDevPortal('all-servers'));
  el.querySelector('#set-open-pending')?.addEventListener('click',  () => openDevPortal('pending'));
  el.querySelector('#set-open-requests')?.addEventListener('click', () => openDevPortal('server-requests'));

  // Launcher toggles
  el.querySelector('#set-minimize')?.addEventListener('change', e =>
    save('minimizeOnLaunch', e.target.checked));
  el.querySelector('#set-autoupdate')?.addEventListener('change', async e => {
    const enabled = e.target.checked;
    // Persist locally so the renderer can show the right toggle state next time
    save('autoUpdateLauncher', enabled);
    // Tell the Electron main process to update its electron-updater config
    // immediately + write the on-disk pref so the next launch honours it.
    try { await window.hub.setAutoUpdateLauncher(enabled); } catch {}
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

  // Referral code: load + copy button
  (async () => {
    const codeEl  = el.querySelector('#set-ref-code');
    const cntEl   = el.querySelector('#set-ref-count');
    if (!codeEl) return;
    let res = null;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await window.hub.get('/api/referrals/me');
        if (r && r.code) { res = r; break; }
      } catch {}
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
    if (res?.code) {
      codeEl.value = res.code;
      if (cntEl) cntEl.textContent = `${res.paid || 0} paid · ${res.total || 0} total`;
    } else if (cntEl) {
      cntEl.textContent = 'failed to load';
    }
  })();
  el.querySelector('#set-ref-copy')?.addEventListener('click', () => {
    const codeEl = el.querySelector('#set-ref-code');
    if (!codeEl?.value) return;
    navigator.clipboard.writeText(codeEl.value).then(() => {
      const btn = el.querySelector('#set-ref-copy');
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }).catch(() => showToast('Could not copy. Select the code manually.', 'error'));
  });

  // Discord link status + actions
  const dStatusEl = el.querySelector('#set-discord-status');
  const dCodeEl   = el.querySelector('#set-discord-code');
  const dMsgEl    = el.querySelector('#set-discord-msg');
  const dBtnEl    = el.querySelector('#set-discord-submit');
  const dSetStatus = (linked) => {
    if (!dStatusEl) return;
    if (linked) {
      dStatusEl.innerHTML = '<span style="color:#4caf50">✓ linked</span> <a href="#" id="set-discord-unlink" style="color:#c96;margin-left:8px;font-size:11px">Unlink</a>';
      el.querySelector('#set-discord-unlink')?.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!await rhConfirm('Unlink your Discord from this account?', { title: 'Unlink Discord', confirmText: 'Unlink', cancelText: 'Cancel' })) return;
        try { await window.hub.post('/api/discord/unlink', {}); dSetStatus(false); }
        catch { showToast('Unlink failed', 'error'); }
      });
      if (dCodeEl) dCodeEl.disabled = true;
      if (dBtnEl)  dBtnEl.disabled  = true;
    } else {
      dStatusEl.innerHTML = '<span style="color:#888">not linked</span>';
      if (dCodeEl) dCodeEl.disabled = false;
      if (dBtnEl)  dBtnEl.disabled  = false;
    }
  };
  // Try status check up to 3x with backoff — Java's HTTP client occasionally
  // times out reaching the VPS. Without retry the UI sticks on "not linked"
  // even when the DB says otherwise.
  (async () => {
    let res = null;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await window.hub.get('/api/discord/status');
        if (r && (r.linked !== undefined)) { res = r; break; }
      } catch {}
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
    dSetStatus(!!res?.linked);
  })();
  el.querySelector('#set-discord-submit')?.addEventListener('click', async () => {
    const code = (dCodeEl?.value || '').trim().toUpperCase();
    const setMsg = (t, c = '#c96') => { if (dMsgEl) { dMsgEl.textContent = t; dMsgEl.style.color = c; } };
    if (!/^[A-Z0-9]{6}$/.test(code)) { setMsg('Code must be 6 characters (letters + numbers).'); return; }
    dBtnEl.disabled = true; setMsg('Linking…', '#888');
    let res = null;
    try {
      res = await window.hub.post('/api/discord/confirm-link', { code });
    } catch {}
    // Java backend timeouts are common when the VPS is slow. Even when the
    // POST appears to fail, the backend may already have committed the link.
    // Re-check status as the source of truth before declaring failure.
    if (res?.ok) {
      setMsg('Discord linked!', '#4caf50');
      dCodeEl.value = '';
      dSetStatus(true);
    } else {
      let statusRes = null;
      try { statusRes = await window.hub.get('/api/discord/status'); } catch {}
      if (statusRes?.linked) {
        setMsg('Discord linked!', '#4caf50');
        dCodeEl.value = '';
        dSetStatus(true);
      } else {
        setMsg(res?.error || 'Link failed. Try again in a moment.');
      }
    }
    dBtnEl.disabled = false;
  });

  // Resend verification email
  el.querySelector('#set-email-resend')?.addEventListener('click', async () => {
    const btn = el.querySelector('#set-email-resend');
    const msg = el.querySelector('#set-email-msg');
    const setMsg = (t, c = '#c96') => { if (msg) { msg.textContent = t; msg.style.color = c; } };
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const res = await window.hub.post('/api/auth/send-verification', {});
      if (res?.ok) {
        setMsg('Verification email sent. Check your inbox.', '#4caf50');
        if (res.already_verified && state.profile) state.profile.email_verified_at = new Date().toISOString();
      } else {
        setMsg(res?.error || 'Failed to send verification.');
      }
    } catch (e) { setMsg('Network error.'); }
    finally { btn.disabled = false; btn.textContent = 'Resend verification'; }
  });

  el.querySelector('#set-email-submit')?.addEventListener('click', async () => {
    const inp = el.querySelector('#set-email-input');
    const msg = el.querySelector('#set-email-msg');
    const btn = el.querySelector('#set-email-submit');
    const setMsg = (text, color = '#c96') => { msg.textContent = text; msg.style.color = color; };
    const email = (inp?.value || '').trim();
    if (!email || !/.+@.+\..+/.test(email)) return setMsg('Enter a valid email.');
    btn.disabled = true; setMsg('Updating…', '#888');
    try {
      const res = await window.hub.post('/api/users/update-email', { email });
      if (res && res.success) {
        setMsg('Email updated.', '#4caf50');
        if (state.profile) state.profile.email = email;
      } else {
        setMsg(res?.error || 'Failed to update email.');
      }
    } catch (err) {
      setMsg((err && err.message) || 'Network error.');
    } finally {
      btn.disabled = false;
    }
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
