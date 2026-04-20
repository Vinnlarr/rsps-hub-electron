// ══════════════════════════════════════════════════════════
// LEADERBOARD — Phase 1 (Global + Friends)
// ══════════════════════════════════════════════════════════

(function () {
  'use strict';

  const state = {
    scope:  'global',    // 'global' | 'friends'
    period: 'all',       // 'all' | 'today' | 'week' | 'month'
    rows:   [],
    you:    null,
    total:  0,
    loading: false,
  };

  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function fmtHours(min) {
    if (!min) return '0h';
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h >= 100) return `${h.toLocaleString()}h`;
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
  }
  // Match the existing skill curve: level = 1 at 0h, 99 at 1000h (~60000 min)
  // Using a roughly quadratic curve that feels OSRS-ish: fast early levels, slow late.
  function levelFor(min) {
    if (!min || min <= 0) return 1;
    const cap = 60000; // 1000h
    const ratio = Math.min(1, min / cap);
    return Math.max(1, Math.min(99, Math.floor(1 + Math.pow(ratio, 0.65) * 98)));
  }

  // Cap at top 50 — keeps the board competitive. Users below the cutoff
  // still see their absolute rank via the pinned YOUR RANK row (server
  // computes that via the `you` field regardless of limit).
  const LB_LIMIT = 50;

  async function load() {
    state.loading = true;
    rerender();
    try {
      const data = await window.hub.get(
        '/api/leaderboard?scope=' + state.scope + '&period=' + state.period + '&limit=' + LB_LIMIT
      );
      state.rows  = data.rows || [];
      state.you   = data.you || null;
      state.total = data.total || 0;
    } catch (e) {
      console.error('[leaderboard] load failed', e);
      state.rows = []; state.you = null; state.total = 0;
    }
    state.loading = false;
    rerender();
  }

  function avatarHtml(row) {
    if (row.hasAvatar) {
      return `<img class="lb-avatar-img" src="https://api.therspshub.com/uploads/avatars/${encodeURIComponent(row.username)}.jpg" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
              <span class="lb-avatar-fallback" style="display:none">${esc(row.username[0].toUpperCase())}</span>`;
    }
    return `<span class="lb-avatar-fallback">${esc(row.username[0].toUpperCase())}</span>`;
  }

  function rankBadge(rank) {
    if (rank === 1) return '<span class="lb-crown">👑</span>';
    if (rank === 2) return '<span class="lb-medal silver">🥈</span>';
    if (rank === 3) return '<span class="lb-medal bronze">🥉</span>';
    return '';
  }

  function rowHtml(r, opts = {}) {
    const lvl = levelFor(r.minutes);
    const cls = [
      'lb-row',
      r.rank === 1 ? 'lb-gold'   : '',
      r.rank === 2 ? 'lb-silver' : '',
      r.rank === 3 ? 'lb-bronze' : '',
      r.isYou     ? 'lb-you'    : '',
      opts.pinned ? 'lb-pinned' : '',
    ].filter(Boolean).join(' ');
    return `
      <div class="${cls}">
        <div class="lb-rank">${r.rank <= 3 ? rankBadge(r.rank) : `#${r.rank}`}</div>
        <div class="lb-avatar">${avatarHtml(r)}</div>
        <div class="lb-info">
          <div class="lb-name">${esc(r.username)}${r.isYou ? ' <span class="lb-you-tag">YOU</span>' : ''}</div>
          <div class="lb-sub">${r.mostPlayed ? 'Most played: ' + esc(r.mostPlayed) : 'No main server yet'}</div>
        </div>
        <div class="lb-metric">
          <div class="lb-metric-val">${fmtHours(r.minutes)}</div>
          <div class="lb-metric-sub">Lv ${lvl}</div>
        </div>
      </div>
    `;
  }

  function rerender() {
    if (!state.rootEl) return;
    const el = state.rootEl;
    const body = el.querySelector('.lb-body');
    if (!body) return;
    if (state.loading) {
      body.innerHTML = `<div class="lb-empty">Loading…</div>`;
      return;
    }
    if (!state.rows.length) {
      body.innerHTML = `
        <div class="lb-empty">
          ${state.scope === 'friends'
            ? 'No friends yet. Add some from the Friends tab to unlock the friend leaderboard.'
            : 'No players on the board yet.'}
        </div>`;
      return;
    }
    // If caller has a rank outside the shown rows, pin their row at the bottom
    const hasYouInRows = state.rows.some(r => r.isYou);
    const showPinned   = state.you && !hasYouInRows;
    body.innerHTML = `
      <div class="lb-list">
        ${state.rows.map(r => rowHtml(r)).join('')}
      </div>
      ${showPinned ? `
        <div class="lb-pinned-wrap">
          <div class="lb-pinned-divider">YOUR RANK</div>
          ${rowHtml(state.you, { pinned: true })}
        </div>` : ''}
    `;
    // Update total count display
    const totalEl = el.querySelector('.lb-total');
    if (totalEl) totalEl.textContent = state.total + (state.total === 1 ? ' player' : ' players');
  }

  function render(rootEl) {
    state.rootEl = rootEl;
    rootEl.innerHTML = `
      <div class="lb-root">
        <div class="alt-header">
          <h2>LEADERBOARD</h2>
          <p class="lb-total">—</p>
        </div>
        <div class="lb-periods">
          <button class="lb-period ${state.period === 'today' ? 'active' : ''}" data-period="today">TODAY</button>
          <button class="lb-period ${state.period === 'week'  ? 'active' : ''}" data-period="week">WEEK</button>
          <button class="lb-period ${state.period === 'month' ? 'active' : ''}" data-period="month">MONTH</button>
          <button class="lb-period ${state.period === 'all'   ? 'active' : ''}" data-period="all">ALL TIME</button>
        </div>
        <div class="lb-tabs">
          <button class="lb-tab ${state.scope === 'global'  ? 'active' : ''}" data-scope="global">GLOBAL</button>
          <button class="lb-tab ${state.scope === 'friends' ? 'active' : ''}" data-scope="friends">FRIENDS</button>
        </div>
        <div class="lb-body"></div>
      </div>
    `;
    rootEl.querySelectorAll('.lb-tab').forEach(b => {
      b.addEventListener('click', () => {
        state.scope = b.dataset.scope;
        rootEl.querySelectorAll('.lb-tab').forEach(x => x.classList.toggle('active', x === b));
        load();
      });
    });
    rootEl.querySelectorAll('.lb-period').forEach(b => {
      b.addEventListener('click', () => {
        state.period = b.dataset.period;
        rootEl.querySelectorAll('.lb-period').forEach(x => x.classList.toggle('active', x === b));
        load();
      });
    });
    load();
  }

  window.renderLeaderboard = render;
})();
