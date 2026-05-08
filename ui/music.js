// ══════════════════════════════════════════════════════════
// MUSIC PLAYER — "Stone of Song"
// Global audio + Web Audio API visualizer + particle embers
// Lives on `window.RH_MUSIC` so any tab switch keeps playing.
// ══════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── STATE ────────────────────────────────────────────────
  const M = window.RH_MUSIC = {
    audio:    null,            // HTMLAudioElement (global, persists)
    ctx:      null,            // AudioContext
    analyser: null,            // AnalyserNode for visualizer
    source:   null,            // MediaElementSourceNode
    freq:     null,            // Uint8Array for freq data
    tracks:   [],              // Full catalog from server
    filtered: [],              // After search / category filter
    index:    -1,              // Index into .filtered
    current:  null,            // Current track object
    paused:   true,
    shuffle:  false,
    repeat:   'off',           // 'off' | 'all' | 'one'
    volume:   0.6,
    favorites: new Set(),
    category: 'All',
    search:    '',
    rafId:    null,
    particleCvs: null,
    particleCtx: null,
    particles: [],
    panelEl:  null,            // Music panel DOM root (if mounted)
  };

  // ── PREFS (persisted) ────────────────────────────────────
  async function loadPrefs() {
    try {
      const p = await window.hub.getMusicPrefs();
      if (p) {
        M.favorites = new Set(Array.isArray(p.favorites) ? p.favorites : []);
        M.volume    = typeof p.volume === 'number' ? p.volume : 0.6;
        M.shuffle   = !!p.shuffle;
        // Migrate: 'all' was removed; collapse to 'off' since default advances automatically
        M.repeat    = p.repeat === 'one' ? 'one' : 'off';
      }
    } catch (_) {}
  }
  async function savePrefs() {
    try {
      await window.hub.saveMusicPrefs({
        favorites: [...M.favorites],
        volume:    M.volume,
        shuffle:   M.shuffle,
        repeat:    M.repeat,
        lastTrackId: M.current?.id || null,
      });
    } catch (_) {}
  }

  // ── AUDIO ELEMENT ────────────────────────────────────────
  function ensureAudio() {
    if (M.audio) return M.audio;
    const a = new Audio();
    a.crossOrigin = 'anonymous';
    a.preload = 'metadata';
    a.volume = M.volume;
    a.addEventListener('ended', onTrackEnded);
    a.addEventListener('timeupdate', () => {
      updateTimeDisplay();
      // Belt & braces: if ended event didn't fire (CORS quirks), detect end by time
      if (!M._endFired && a.duration && !isNaN(a.duration) && a.duration > 0 &&
          a.currentTime > 0 && a.duration - a.currentTime < 0.25 && !a.paused) {
        M._endFired = true;
        onTrackEnded();
      }
    });
    a.addEventListener('loadedmetadata', updateTimeDisplay);
    a.addEventListener('play',  () => { M.paused = false; M._endFired = false; refreshPlayingUI(); });
    a.addEventListener('pause', () => { M.paused = true;  refreshPlayingUI(); });
    a.addEventListener('error', (e) => {
      console.error('[music] audio error', a.error);
      // Auto-advance on error so a broken track doesn't stop the playlist
      setTimeout(() => { if (M.current) next(false); }, 500);
    });
    M.audio = a;
    return a;
  }

  function ensureAudioCtx() {
    if (M.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      M.ctx = new AC();
      M.source = M.ctx.createMediaElementSource(M.audio);
      M.analyser = M.ctx.createAnalyser();
      M.analyser.fftSize = 256;
      M.freq = new Uint8Array(M.analyser.frequencyBinCount);
      M.source.connect(M.analyser);
      M.analyser.connect(M.ctx.destination);
    } catch (e) { console.warn('[music] audioctx init failed', e); }
  }

  // ── CATALOG ──────────────────────────────────────────────
  async function loadCatalog() {
    try {
      const res = await fetch('https://api.therspshub.com/api/music/list.php');
      const data = await res.json();
      M.tracks = (data.tracks || []).map(t => ({
        id:       t.id,
        name:     t.name,
        url:      t.url,
        category: t.category || 'Other',
        size:     t.size || 0,
        duration: t.duration || 0,
      }));
    } catch (e) {
      console.error('[music] catalog fetch failed', e);
      M.tracks = [];
    }
    applyFilter();
  }

  function applyFilter() {
    const q = (M.search || '').trim().toLowerCase();
    M.filtered = M.tracks.filter(t => {
      if (M.category === 'Favourites') {
        if (!M.favorites.has(t.id)) return false;
      } else if (M.category !== 'All' && t.category !== M.category) {
        return false;
      }
      if (q && !t.name.toLowerCase().includes(q)) return false;
      return true;
    });
    // Resync index so next/prev keeps working if current track is still visible
    if (M.current) {
      const idx = M.filtered.findIndex(t => t.id === M.current.id);
      M.index = idx;
    }
  }

  function categories() {
    // Just two filters: All (default) and Favourites (local stars)
    return ['All', 'Favourites'];
  }

  // ── PLAYBACK ─────────────────────────────────────────────
  function playTrack(track, listIndex) {
    ensureAudio();
    // User triggered playback — bring back the docked mini if it was X-closed
    M._miniHidden = false;
    M.current = track;
    M.index = typeof listIndex === 'number' ? listIndex : M.filtered.findIndex(t => t.id === track.id);
    M.audio.src = track.url;
    M.audio.volume = M.volume;
    // Unlock AudioContext on first user gesture (browsers require this)
    if (M.ctx && M.ctx.state === 'suspended') M.ctx.resume().catch(()=>{});
    if (!M.ctx) ensureAudioCtx();
    M.audio.play().catch(err => console.warn('[music] play failed', err));
    savePrefs();
    refreshPlayingUI();
  }

  function togglePlay() {
    if (!M.audio || !M.current) {
      // Nothing queued — play the first filtered track if any
      if (M.filtered.length) playTrack(M.filtered[0], 0);
      return;
    }
    if (M.audio.paused) M.audio.play().catch(()=>{});
    else                M.audio.pause();
  }

  function next(_manual = true) {
    if (!M.filtered.length) return;
    let nextIdx;
    if (M.shuffle) {
      nextIdx = Math.floor(Math.random() * M.filtered.length);
      if (M.filtered.length > 1 && nextIdx === M.index) {
        nextIdx = (nextIdx + 1) % M.filtered.length;
      }
    } else {
      nextIdx = (M.index + 1) % M.filtered.length;
    }
    playTrack(M.filtered[nextIdx], nextIdx);
  }

  function prev() {
    if (!M.filtered.length) return;
    // If >3s into the track, restart it instead of going back
    if (M.audio && M.audio.currentTime > 3) {
      M.audio.currentTime = 0;
      return;
    }
    let idx = M.index - 1;
    if (idx < 0) idx = M.filtered.length - 1;
    playTrack(M.filtered[idx], idx);
  }

  function onTrackEnded() {
    M._endFired = true;
    if (M.repeat === 'one') {
      M.audio.currentTime = 0;
      M.audio.play().catch(()=>{});
      return;
    }
    // Always advance (shuffle-aware). next() handles random vs sequential.
    next(false);
  }

  function toggleShuffle() {
    M.shuffle = !M.shuffle;
    savePrefs();
    refreshControls();
  }
  function cycleRepeat() {
    // Two-state: off → one → off. "All" removed (default already wraps at end of list).
    M.repeat = M.repeat === 'one' ? 'off' : 'one';
    savePrefs();
    refreshControls();
  }
  function setVolume(v) {
    M.volume = Math.max(0, Math.min(1, v));
    if (M.audio) M.audio.volume = M.volume;
    savePrefs();
    refreshVolumeUI();
  }
  function toggleFav(id) {
    const wasFav = M.favorites.has(id);
    if (wasFav) M.favorites.delete(id);
    else M.favorites.add(id);
    savePrefs();
    // Mirror to server, then trigger achievement sync so Music Lover / DJ
    // unlock immediately rather than waiting for the next stats-modal
    // open. Show a coin toast for any newly-awarded achievement.
    if (window.hub?.post) {
      window.hub.post('/api/music/favorites', { track_id: id, action: wasFav ? 'remove' : 'add' })
        .then(() => window.hub.post('/api/achievements/sync', {}))
        .then(res => {
          if (res?.newly_unlocked?.length && typeof window.showToast === 'function') {
            res.newly_unlocked.forEach(a => {
              window.showToast(`🏆 ${a.name} unlocked! +${a.coins} coins`, 'success');
            });
            // Invalidate the stats cache so the next open shows the
            // newly-unlocked badge instead of stale data.
            if (window.DATA_CACHE?.stats) {
              window.DATA_CACHE.stats.data = null;
              window.DATA_CACHE.stats.at   = 0;
            }
          }
        })
        .catch(e => console.warn('[music] favorite sync failed:', e));
    }
    // If currently filtered to Favourites, re-render the list so unfavourited rows vanish
    if (M.category === 'Favourites') {
      applyFilter();
      const list = M.panelEl?.querySelector('.music-list');
      if (list) list.innerHTML = renderListHTML();
      return;
    }
    const star = M.panelEl?.querySelector(`[data-fav-id="${id}"]`);
    if (star) {
      const on = M.favorites.has(id);
      star.classList.toggle('on', on);
      star.innerHTML = on ? ICON.star : ICON.starOutline;
    }
  }

  // ── UI RENDERING ─────────────────────────────────────────
  function escHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Monochrome SVG icons — uses currentColor so CSS styles work
  const ICON = {
    play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15c0 .8.9 1.3 1.6.9l12-7.5a1.05 1.05 0 0 0 0-1.8l-12-7.5A1.05 1.05 0 0 0 7 4.5z"/></svg>`,
    pause: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5h3v14H8zM13 5h3v14h-3z"/></svg>`,
    prev:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 4.5v15c0 .8-.9 1.3-1.6.9l-12-7.5a1.05 1.05 0 0 1 0-1.8l12-7.5c.7-.4 1.6 0 1.6.9z"/></svg>`,
    next:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 4.5v15c0 .8.9 1.3 1.6.9l12-7.5a1.05 1.05 0 0 0 0-1.8l-12-7.5A1.05 1.05 0 0 0 4 4.5z"/></svg>`,
    shuffle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/></svg>`,
    repeat:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>`,
    repeat1: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/></svg>`,
    volume:  `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 10v4a1 1 0 0 0 1 1h3l4 4a1 1 0 0 0 1.7-.7V5.7A1 1 0 0 0 11 5L7 9H4a1 1 0 0 0-1 1z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 8a5 5 0 0 1 0 8M19.5 5a9 9 0 0 1 0 14"/></svg>`,
    star:    `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 7h7l-5.5 4.5 2 7.5-6.5-4.5-6.5 4.5 2-7.5L2 9h7z"/></svg>`,
    starOutline: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2l3 7h7l-5.5 4.5 2 7.5-6.5-4.5-6.5 4.5 2-7.5L2 9h7z"/></svg>`,
  };
  function fmtTime(secs) {
    if (!secs || isNaN(secs)) return '—:——';
    secs = Math.floor(secs);
    const m = Math.floor(secs / 60), s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }
  // Deterministic sigil letter + hue from track name
  function sigilOf(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    const hue = 30 + (h % 40);  // gold-ish range
    const letter = name.replace(/[^A-Za-z0-9]/g,'').slice(0,1).toUpperCase() || '♫';
    return { letter, color: `hsl(${hue},65%,60%)` };
  }

  function renderPanel(el) {
    M.panelEl = el;
    const cats = categories();
    el.classList.add('music-panel-root');
    el.innerHTML = `
      <div class="music-panel ${M.paused ? '' : 'playing'}">
        <div class="music-stage">
          <canvas class="music-particles"></canvas>

          <div class="music-stone-wrap">
            <svg class="music-progress-ring" width="160" height="160" viewBox="0 0 160 160">
              <defs>
                <linearGradient id="music-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%"  stop-color="#f4d77c"/>
                  <stop offset="100%" stop-color="#c8a840"/>
                </linearGradient>
              </defs>
              <circle class="track" cx="80" cy="80" r="75"></circle>
              <circle class="bar"   cx="80" cy="80" r="75"
                      stroke-dasharray="471.24" stroke-dashoffset="471.24"></circle>
            </svg>
            <div class="music-stone" id="music-stone" title="Play / Pause">
              <div class="music-stone-sigil"></div>
              <canvas class="music-stone-viz"></canvas>
              <div class="music-stone-icon">${M.paused ? ICON.play : ICON.pause}</div>
            </div>
          </div>

          <div class="music-meta">
            <div class="music-title">${escHtml(M.current?.name || 'Stone of Song')}</div>
            <div class="music-category">${escHtml(M.current?.category || 'choose a track below')}</div>
          </div>
          <div class="music-waveform-wrap">
            <canvas class="music-waveform"></canvas>
          </div>
          <div class="music-seek-row">
            <span class="music-time-cur">0:00</span>
            <div class="music-seek" title="Click or drag to seek">
              <div class="music-seek-track">
                <div class="music-seek-fill"></div>
                <div class="music-seek-thumb"></div>
              </div>
            </div>
            <span class="music-time-dur">—:——</span>
          </div>
        </div>

        <div class="music-controls">
          <button class="music-btn ${M.shuffle ? 'active' : ''}" data-ctl="shuffle" data-tip="${M.shuffle ? 'Shuffle: ON' : 'Shuffle: OFF'}">${ICON.shuffle}</button>
          <button class="music-btn" data-ctl="prev" data-tip="Previous">${ICON.prev}</button>
          <button class="music-btn music-btn-lg" data-ctl="play" data-tip="${M.paused ? 'Play' : 'Pause'}">${M.paused ? ICON.play : ICON.pause}</button>
          <button class="music-btn" data-ctl="next" data-tip="Next">${ICON.next}</button>
          <button class="music-btn ${M.repeat === 'one' ? 'active' : ''}" data-ctl="repeat"
                  data-tip="${M.repeat === 'one' ? 'Repeat One: ON' : 'Repeat One: OFF'}">
            ${ICON.repeat1}
          </button>
        </div>
        <div class="music-volume">
          <span class="music-volume-icon">${ICON.volume}</span>
          <input type="range" min="0" max="1" step="0.01" value="${M.volume}"
                 style="--vol:${Math.round(M.volume*100)}%" data-tip="Volume">
        </div>

        <div class="music-filters">
          <input class="music-search" placeholder="Search tracks..." value="${escHtml(M.search)}">
          <div class="music-cats">
            ${cats.map(c => `<button class="music-cat ${M.category === c ? 'active' : ''}" data-cat="${escHtml(c)}">${escHtml(c)}</button>`).join('')}
          </div>
        </div>

        <div class="music-list">
          ${renderListHTML()}
        </div>
      </div>
    `;
    wireEvents();
    startAnimations();
    refreshVolumeUI();
    updateTimeDisplay();
  }

  function renderListHTML() {
    if (!M.tracks.length) {
      return `<div class="music-empty">Loading catalog…</div>`;
    }
    if (!M.filtered.length) {
      return `<div class="music-empty">No tracks match.</div>`;
    }
    return M.filtered.map((t, i) => {
      const s = sigilOf(t.name);
      const isPlaying = M.current?.id === t.id && !M.paused;
      const fav = M.favorites.has(t.id);
      return `
        <div class="music-row ${isPlaying ? 'playing' : ''}" data-idx="${i}">
          <div class="music-sigil" style="--sigil-color:${s.color}">${escHtml(s.letter)}</div>
          <div class="music-row-info">
            <div class="music-row-name">${escHtml(t.name)}</div>
            <div class="music-row-cat">${escHtml(t.category)}</div>
          </div>
          <div class="music-row-dur">${t.duration ? fmtTime(t.duration) : '—:——'}</div>
          <button class="music-fav ${fav ? 'on' : ''}" data-fav-id="${t.id}" title="Favourite">${fav ? ICON.star : ICON.starOutline}</button>
        </div>
      `;
    }).join('');
  }

  function wireEvents() {
    const el = M.panelEl;
    el.querySelector('#music-stone').addEventListener('click', togglePlay);
    el.querySelectorAll('.music-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const ctl = btn.dataset.ctl;
        if (ctl === 'play')    togglePlay();
        if (ctl === 'next')    next();
        if (ctl === 'prev')    prev();
        if (ctl === 'shuffle') toggleShuffle();
        if (ctl === 'repeat')  cycleRepeat();
      });
    });
    el.querySelector('.music-volume input').addEventListener('input', e => setVolume(parseFloat(e.target.value)));

    // Seek bar: click or drag to jump to a position in the track
    const seek = el.querySelector('.music-seek');
    if (seek) {
      let dragging = false;
      const seekTo = (clientX) => {
        if (!M.audio || !M.audio.duration || isNaN(M.audio.duration)) return;
        const rect = seek.getBoundingClientRect();
        const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        M.audio.currentTime = p * M.audio.duration;
      };
      seek.addEventListener('mousedown', e => {
        dragging = true;
        seekTo(e.clientX);
      });
      window.addEventListener('mousemove', e => { if (dragging) seekTo(e.clientX); });
      window.addEventListener('mouseup',   () => { dragging = false; });
    }
    const search = el.querySelector('.music-search');
    search.addEventListener('input', e => {
      M.search = e.target.value;
      applyFilter();
      const list = el.querySelector('.music-list');
      if (list) list.innerHTML = renderListHTML();
    });
    el.querySelectorAll('.music-cat').forEach(btn => {
      btn.addEventListener('click', () => {
        M.category = btn.dataset.cat;
        applyFilter();
        el.querySelectorAll('.music-cat').forEach(b => b.classList.toggle('active', b === btn));
        const list = el.querySelector('.music-list');
        if (list) list.innerHTML = renderListHTML();
      });
    });
    el.addEventListener('click', e => {
      const favBtn = e.target.closest('.music-fav');
      if (favBtn) {
        e.stopPropagation();
        toggleFav(parseInt(favBtn.dataset.favId, 10));
        return;
      }
      const row = e.target.closest('.music-row');
      if (row) {
        const idx = parseInt(row.dataset.idx, 10);
        const track = M.filtered[idx];
        if (track) playTrack(track, idx);
      }
    });
  }

  function refreshVolumeUI() {
    const slider = M.panelEl?.querySelector('.music-volume input');
    if (slider) slider.style.setProperty('--vol', `${Math.round(M.volume * 100)}%`);
  }
  function refreshControls() {
    if (!M.panelEl) return;
    const shuf = M.panelEl.querySelector('[data-ctl="shuffle"]');
    const rep  = M.panelEl.querySelector('[data-ctl="repeat"]');
    if (shuf) {
      shuf.classList.toggle('active', M.shuffle);
      shuf.setAttribute('data-tip', M.shuffle ? 'Shuffle: ON' : 'Shuffle: OFF');
    }
    if (rep) {
      rep.classList.toggle('active', M.repeat === 'one');
      rep.innerHTML = ICON.repeat1;
      rep.setAttribute('data-tip', M.repeat === 'one' ? 'Repeat One: ON' : 'Repeat One: OFF');
    }
  }
  function refreshPlayingUI() {
    if (!M.panelEl) return;
    const panel = M.panelEl.querySelector('.music-panel');
    if (panel) panel.classList.toggle('playing', !M.paused);
    const title = M.panelEl.querySelector('.music-title');
    const cat   = M.panelEl.querySelector('.music-category');
    const icon  = M.panelEl.querySelector('.music-stone-icon');
    const playBtn = M.panelEl.querySelector('[data-ctl="play"]');
    if (title && M.current) title.textContent = M.current.name;
    if (cat   && M.current) cat.textContent = M.current.category;
    if (icon)    icon.innerHTML = M.paused ? ICON.play : ICON.pause;
    if (playBtn) {
      playBtn.innerHTML = M.paused ? ICON.play : ICON.pause;
      playBtn.setAttribute('data-tip', M.paused ? 'Play' : 'Pause');
    }
    const list = M.panelEl.querySelector('.music-list');
    if (list) list.innerHTML = renderListHTML();
  }
  function updateTimeDisplay() {
    if (!M.panelEl || !M.audio) return;
    const cur = M.panelEl.querySelector('.music-time-cur');
    const dur = M.panelEl.querySelector('.music-time-dur');
    if (cur) cur.textContent = fmtTime(M.audio.currentTime);
    if (dur) dur.textContent = fmtTime(M.audio.duration);
    const p = (M.audio.duration && !isNaN(M.audio.duration))
      ? M.audio.currentTime / M.audio.duration : 0;
    // progress ring around the Stone
    const bar = M.panelEl.querySelector('.music-progress-ring .bar');
    if (bar) {
      const C = 2 * Math.PI * 75;
      bar.setAttribute('stroke-dasharray', String(C));
      bar.setAttribute('stroke-dashoffset', String(C * (1 - p)));
    }
    // linear seek bar
    const fill = M.panelEl.querySelector('.music-seek-fill');
    const thumb = M.panelEl.querySelector('.music-seek-thumb');
    if (fill)  fill.style.width  = `${p * 100}%`;
    if (thumb) thumb.style.left  = `${p * 100}%`;
  }

  // ── VISUALIZER + PARTICLES ──────────────────────────────
  function startAnimations() {
    const panel = M.panelEl;
    if (!panel) return;
    const stoneCvs = panel.querySelector('.music-stone-viz');
    const waveCvs  = panel.querySelector('.music-waveform');
    const partCvs  = panel.querySelector('.music-particles');
    if (!stoneCvs || !waveCvs || !partCvs) return;

    const sizeCanvas = (c) => {
      const dpr = window.devicePixelRatio || 1;
      const r = c.getBoundingClientRect();
      c.width  = Math.max(1, r.width  * dpr);
      c.height = Math.max(1, r.height * dpr);
      const ctx = c.getContext('2d');
      ctx.scale(dpr, dpr);
      return ctx;
    };
    const stoneCtx = sizeCanvas(stoneCvs);
    const waveCtx  = sizeCanvas(waveCvs);
    const partCtx  = sizeCanvas(partCvs);

    M.particles = [];

    const loop = () => {
      // Stop if panel was unmounted (tab switched away)
      if (!stoneCvs.isConnected) { M.rafId = null; return; }
      drawStone(stoneCvs, stoneCtx);
      drawWave(waveCvs, waveCtx);
      drawParticles(partCvs, partCtx);
      updateTimeDisplay();
      M.rafId = requestAnimationFrame(loop);
    };
    if (M.rafId) cancelAnimationFrame(M.rafId);
    loop();
  }
  function getFreq() {
    if (!M.analyser || M.paused) return null;
    M.analyser.getByteFrequencyData(M.freq);
    return M.freq;
  }
  function drawStone(cvs, ctx) {
    const w = cvs.clientWidth, h = cvs.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const baseR = Math.min(w, h) / 2 - 6;
    const data = getFreq();
    const bars = 48;
    ctx.save();
    ctx.translate(cx, cy);
    for (let i = 0; i < bars; i++) {
      const a = (i / bars) * Math.PI * 2;
      const amp = data ? data[Math.floor(i * (data.length / bars))] / 255 : 0.1 + Math.sin(Date.now()/900 + i)*0.05;
      const r0 = baseR * 0.45;
      const r1 = baseR * (0.45 + amp * 0.55);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.strokeStyle = `hsla(${35 + amp*20}, 80%, ${40 + amp*30}%, ${0.35 + amp*0.65})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawWave(cvs, ctx) {
    const w = cvs.clientWidth, h = cvs.clientHeight;
    ctx.clearRect(0, 0, w, h);
    if (!M.analyser) {
      // flat line
      ctx.strokeStyle = 'rgba(200,168,64,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();
      return;
    }
    const td = new Uint8Array(M.analyser.fftSize);
    M.analyser.getByteTimeDomainData(td);
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(200,168,64,0.05)');
    grad.addColorStop(0.5, 'rgba(240,192,96,0.9)');
    grad.addColorStop(1, 'rgba(200,168,64,0.05)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.6;
    ctx.shadowColor = 'rgba(240,192,96,0.5)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    for (let i = 0; i < td.length; i++) {
      const x = (i / (td.length - 1)) * w;
      const v = (td[i] - 128) / 128;
      const y = h/2 + v * (h/2 - 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  function drawParticles(cvs, ctx) {
    const w = cvs.clientWidth, h = cvs.clientHeight;
    ctx.clearRect(0, 0, w, h);
    // Spawn particles based on volume & amplitude
    if (!M.paused) {
      const data = getFreq();
      let amp = 0;
      if (data) {
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        amp = (sum / data.length) / 255;
      }
      const spawnRate = Math.floor(amp * 3 * M.volume + 0.3);
      for (let i = 0; i < spawnRate; i++) {
        if (M.particles.length > 80) break;
        M.particles.push({
          x: w/2 + (Math.random() - 0.5) * 80,
          y: h/2 + 40 + (Math.random() - 0.5) * 10,
          vy: -(0.3 + Math.random() * 0.8),
          vx: (Math.random() - 0.5) * 0.4,
          life: 0,
          maxLife: 120 + Math.random() * 80,
          size: 0.8 + Math.random() * 1.6,
          hue:  35 + Math.random() * 18,
        });
      }
    }
    // Draw + update
    for (let i = M.particles.length - 1; i >= 0; i--) {
      const p = M.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life++;
      if (p.life > p.maxLife) { M.particles.splice(i, 1); continue; }
      const t = p.life / p.maxLife;
      const alpha = Math.sin(t * Math.PI) * 0.7;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `hsl(${p.hue}, 80%, 62%)`;
      ctx.shadowColor = `hsl(${p.hue}, 80%, 70%)`;
      ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── PUBLIC API ───────────────────────────────────────────
  // ── GLOBAL TOOLTIP ──────────────────────────────────────
  // One floating element on body, JS-positioned. Works across any
  // overflow:hidden parent and never conflicts with button pseudos.
  (function setupTooltip() {
    if (document.getElementById('rh-tooltip')) return;
    const tip = document.createElement('div');
    tip.id = 'rh-tooltip';
    document.body.appendChild(tip);
    let currentTarget = null;
    const show = (el) => {
      const text = el.getAttribute('data-tip');
      if (!text) return;
      currentTarget = el;
      tip.textContent = text;
      // Measure off-screen briefly with visibility hidden so we know the tooltip width
      tip.classList.remove('show');
      tip.style.left = '-10000px';
      tip.style.top  = '0px';
      tip.style.transform = 'translate(-50%, -100%)';
      const tr = tip.getBoundingClientRect();
      const r  = el.getBoundingClientRect();
      const margin = 8;
      const vw = window.innerWidth;
      let cx = r.left + r.width / 2;
      const half = tr.width / 2;
      if (cx - half < margin)      cx = margin + half;
      if (cx + half > vw - margin) cx = vw - margin - half;
      tip.style.left = cx + 'px';
      tip.style.top  = (r.top - 12) + 'px';
      const arrowOffsetX = (r.left + r.width / 2) - cx;
      tip.style.setProperty('--tip-arrow-x', arrowOffsetX + 'px');
      // Mouse may have left before we got here — only show if still hovering
      if (currentTarget === el) tip.classList.add('show');
    };
    const hide = () => {
      currentTarget = null;
      tip.classList.remove('show');
    };
    document.addEventListener('mouseover', e => {
      const el = e.target.closest('[data-tip]');
      if (el) show(el);
    });
    document.addEventListener('mouseout', e => {
      const el = e.target.closest('[data-tip]');
      if (el && !el.contains(e.relatedTarget)) hide();
    });
    // Also hide if the element gets removed or user scrolls/clicks
    window.addEventListener('scroll', hide, true);
    document.addEventListener('mousedown', hide);
  })();

  // ── STATUS BAR MUSIC TOGGLE ─────────────────────────────────
  // Small always-visible button in the status bar. If the user X-es out the
  // docked mini, this button brings it back without interrupting playback.
  function ensureStatusBarToggle() {
    if (document.getElementById('music-status-toggle')) return;
    const statusBar = document.querySelector('.status-bar');
    if (!statusBar) return;
    const btn = document.createElement('button');
    btn.id = 'music-status-toggle';
    btn.className = 'music-status-toggle';
    btn.setAttribute('data-tip', 'Show / hide music player');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 3v11.55a4 4 0 1 0 2 3.45V7h8V3z"/></svg>`;
    btn.addEventListener('click', () => {
      M._miniHidden = !M._miniHidden;
      refreshMini();
      refreshStatusToggle();
    });
    // Insert before the version label so it sits on the right edge
    const ver = statusBar.querySelector('#app-version-label');
    if (ver) statusBar.insertBefore(btn, ver);
    else     statusBar.appendChild(btn);
    M.statusToggleEl = btn;
    refreshStatusToggle();
  }

  function refreshStatusToggle() {
    const btn = M.statusToggleEl;
    if (!btn) return;
    // Dim if no track loaded; gold glow if playing; slight highlight if hidden
    btn.classList.toggle('has-track', !!M.current);
    btn.classList.toggle('is-playing', !!M.current && !M.paused);
    btn.classList.toggle('is-hidden', !!M._miniHidden);
  }

  // ── MINI PLAYER (always-visible strip above status bar) ─────
  // Creates a global dock that follows the user across every tab.
  // Shares all state + controls with the main Music tab.
  function ensureMiniPlayer() {
    if (document.getElementById('music-mini')) return;
    const statusBar = document.querySelector('.status-bar');
    if (!statusBar) return; // layout not ready yet

    const mini = document.createElement('div');
    mini.id = 'music-mini';
    mini.className = 'music-mini';
    mini.innerHTML = `
      <div class="music-mini-left" data-mini-expand>
        <div class="music-mini-sigil"></div>
        <div class="music-mini-text">
          <div class="music-mini-title">—</div>
          <div class="music-mini-sub">No track loaded</div>
        </div>
      </div>
      <div class="music-mini-seek">
        <div class="music-mini-seek-track">
          <div class="music-mini-seek-fill"></div>
        </div>
      </div>
      <div class="music-mini-ctrls">
        <button class="music-mini-btn" data-mini-ctl="prev" data-tip="Previous">${ICON.prev}</button>
        <button class="music-mini-btn music-mini-btn-lg" data-mini-ctl="play" data-tip="Play">${ICON.play}</button>
        <button class="music-mini-btn" data-mini-ctl="next" data-tip="Next">${ICON.next}</button>
        <button class="music-mini-btn music-mini-btn-xp" data-mini-ctl="popout" data-tip="Pop out (always on top)">${ICON.popout}</button>
        <button class="music-mini-btn music-mini-btn-xp" data-mini-ctl="expand" data-tip="Open music player">${ICON.expand}</button>
        <button class="music-mini-btn music-mini-btn-xp" data-mini-ctl="close" data-tip="Hide">${ICON.close}</button>
      </div>
    `;
    statusBar.parentNode.insertBefore(mini, statusBar);

    // Wire controls
    mini.querySelectorAll('[data-mini-ctl]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ctl = btn.dataset.miniCtl;
        if (ctl === 'play')   togglePlay();
        if (ctl === 'prev')   prev();
        if (ctl === 'next')   next();
        if (ctl === 'expand') openMusicTab();
        if (ctl === 'close')  { M._miniHidden = true; refreshMini(); }
        if (ctl === 'popout') {
          if (window.hub?.openMusicPopout) {
            window.hub.openMusicPopout();
            M._popoutOpen = true;
            refreshMini();
          }
        }
      });
    });
    // Click the left zone (sigil + text) also opens the music tab
    mini.querySelector('[data-mini-expand]').addEventListener('click', openMusicTab);

    // Seek bar
    const seek = mini.querySelector('.music-mini-seek');
    let dragging = false;
    const seekTo = (x) => {
      if (!M.audio || !M.audio.duration || isNaN(M.audio.duration)) return;
      const r = seek.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (x - r.left) / r.width));
      M.audio.currentTime = p * M.audio.duration;
    };
    seek.addEventListener('mousedown', e => { dragging = true; seekTo(e.clientX); });
    window.addEventListener('mousemove', e => { if (dragging) seekTo(e.clientX); });
    window.addEventListener('mouseup',   () => { dragging = false; });

    M.miniEl = mini;
    refreshMini();
  }

  function openMusicTab() {
    const btn = document.querySelector('.rs-tab[data-panel="music"]');
    if (btn) btn.click();
  }

  function refreshMini() {
    refreshStatusToggle();
    const mini = M.miniEl;
    if (!mini) return;
    // Hidden when no track, user-closed, or popout window is open
    if (!M.current || M._miniHidden || M._popoutOpen) {
      mini.classList.remove('visible');
      // Also push state to the popout window if it's open
      if (M._popoutOpen) pushStateToPopout();
      return;
    }
    mini.classList.add('visible');
    const s = sigilOf(M.current.name);
    const sigilEl = mini.querySelector('.music-mini-sigil');
    sigilEl.textContent = s.letter;
    sigilEl.style.setProperty('--sigil-color', s.color);
    mini.querySelector('.music-mini-title').textContent = M.current.name;
    const sub = mini.querySelector('.music-mini-sub');
    const cur = fmtTime(M.audio?.currentTime);
    const dur = fmtTime(M.audio?.duration);
    sub.textContent = `${M.current.category} · ${cur} / ${dur}`;
    const playBtn = mini.querySelector('[data-mini-ctl="play"]');
    playBtn.innerHTML = M.paused ? ICON.play : ICON.pause;
    playBtn.setAttribute('data-tip', M.paused ? 'Play' : 'Pause');
    mini.classList.toggle('playing', !M.paused);
    // Progress bar
    const fill = mini.querySelector('.music-mini-seek-fill');
    if (fill && M.audio?.duration) {
      const p = M.audio.currentTime / M.audio.duration;
      fill.style.width = (p * 100) + '%';
    }
  }

  // Hook refreshMini into all the key lifecycle points
  const _origRefreshPlaying = refreshPlayingUI;
  refreshPlayingUI = function () { _origRefreshPlaying(); refreshMini(); };
  const _origUpdateTime = updateTimeDisplay;
  updateTimeDisplay = function () { _origUpdateTime(); refreshMini(); };

  // Add extra icons to the dictionary
  ICON.expand  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="m21 3-8 8"/><path d="M9 21H3v-6"/><path d="m3 21 8-8"/></svg>`;
  ICON.popout  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M20 14v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6"/></svg>`;
  ICON.close   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 6-12 12"/><path d="m6 6 12 12"/></svg>`;

  // Popout IPC bridge: forward commands from popout → engine; push state → popout
  function pushStateToPopout() {
    if (!window.hub?.pushMusicState || !M._popoutOpen || !M.current) return;
    window.hub.pushMusicState({
      name:        M.current.name,
      category:    M.current.category,
      paused:      M.paused,
      currentTime: M.audio?.currentTime || 0,
      duration:    M.audio?.duration || 0,
      sigilLetter: sigilOf(M.current.name).letter,
      sigilColor:  sigilOf(M.current.name).color,
    });
  }
  if (window.hub?.onMusicPopoutCmd) {
    window.hub.onMusicPopoutCmd((cmd, value) => {
      if (cmd === 'play')   togglePlay();
      if (cmd === 'prev')   prev();
      if (cmd === 'next')   next();
      if (cmd === 'seek' && M.audio && M.audio.duration) M.audio.currentTime = value * M.audio.duration;
      if (cmd === 'closed') { M._popoutOpen = false; refreshMini(); }
    });
  }

  // Auto-reshow the docked mini when a new track starts (clears user-hidden state)
  document.addEventListener('click', (e) => {
    // If user plays any track via row click, reset hidden flag
    if (e.target.closest('.music-row')) M._miniHidden = false;
  });

  M.render = renderPanel;
  M.onPanelUnmount = () => {
    M.panelEl = null;
    if (M.rafId) { cancelAnimationFrame(M.rafId); M.rafId = null; }
    // NOTE: do NOT stop audio — it keeps playing when tab is closed
  };
  M.init = async () => {
    await loadPrefs();
    await loadCatalog();
    ensureAudio();
    // Mount mini player + status-bar toggle after DOM is ready
    const tryMount = () => {
      if (document.querySelector('.status-bar')) {
        ensureMiniPlayer();
        ensureStatusBarToggle();
      } else {
        setTimeout(tryMount, 200);
      }
    };
    tryMount();
  };

  // Boot on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => M.init());
  } else {
    M.init();
  }

  // Hooks for auth — app.js calls these on login/logout so favs/volume/etc.
  // are scoped per-user (main.js already scopes the file on disk).
  function refreshVisibleList() {
    // Re-render the currently visible track list so favourite stars reflect
    // the freshly loaded prefs. No-op if the music panel isn't mounted.
    const list = document.querySelector('.mp-list');
    if (list && typeof renderListHTML === 'function') {
      list.innerHTML = renderListHTML();
    }
  }
  window.reloadMusicPrefs = async () => {
    try { await loadPrefs(); } catch {}
    refreshVisibleList();
  };
  window.clearMusicPrefs = () => {
    M.favorites.clear();
    M.volume  = 0.6;
    M.shuffle = false;
    M.repeat  = 'off';
    if (M.audio) M.audio.volume = M.volume;
    refreshVisibleList();
  };
})();
