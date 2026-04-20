// ══════════════════════════════════════════════════════════
// STATS DASHBOARD
//   Hero card • 365-day heatmap • Top-server bars •
//   Time-of-day donut • Milestones timeline
// ══════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── helpers ────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function fmtHours(min) {
    if (!min) return '0h';
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h >= 100) return `${h.toLocaleString()}h`;
    if (h === 0)  return `${m}m`;
    return `${h}h ${m}m`;
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
  }
  function fmtRelDays(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days < 1)   return 'today';
    if (days < 2)   return 'yesterday';
    if (days < 30)  return `${days}d ago`;
    if (days < 365) return `${Math.floor(days/30)}mo ago`;
    return `${Math.floor(days/365)}y ago`;
  }
  // Canonical level curve — MUST match app.js calcLevel() and ServerSkillSystem.java
  // so the Stats dashboard agrees with server cards / leaderboard / playtime tooltip.
  // Square-root curve: 1 + 98·√(min/60000), capped at 99. 1000h = lvl 99.
  function levelFor(min) {
    if (!min || min <= 0) return 1;
    const ratio = Math.min(1, min / 60000);
    return Math.min(99, Math.floor(1 + 98 * Math.sqrt(ratio)));
  }
  // Nth suffix: 1 → 1st, 23 → 23rd, etc.
  function ord(n) {
    const s = ['th','st','nd','rd'], v = n % 100;
    return n + (s[(v-20)%10] || s[v] || s[0]);
  }

  // ── heatmap ────────────────────────────────────────────
  // Build a 26-wide × 7-tall grid ending on today (≈6 months). Narrower than
  // a full GitHub-style 53-week grid so it fits in the side panel without
  // scrolling — today's cell is always visible on the right.
  const HEAT_WEEKS = 26;
  function buildHeatmap(heatmap) {
    const today = new Date();
    today.setHours(0,0,0,0);
    // Align end-of-grid to the last Saturday (so weekdays stack cleanly).
    const gridEnd = new Date(today);
    gridEnd.setDate(gridEnd.getDate() + (6 - today.getDay()));
    const totalCells = HEAT_WEEKS * 7;
    const start = new Date(gridEnd);
    start.setDate(start.getDate() - (totalCells - 1));

    // Find per-bucket thresholds from non-zero values (quartile-ish).
    const vals = Object.values(heatmap).map(v => +v).filter(v => v > 0).sort((a,b) => a-b);
    const q = (p) => vals.length ? vals[Math.min(vals.length-1, Math.floor(vals.length*p))] : 0;
    const thresh = [q(0.25), q(0.50), q(0.75), q(0.92)];

    const cols = [];
    const monthLabels = [];
    let cur = new Date(start);
    let lastMonth = -1;

    for (let c = 0; c < HEAT_WEEKS; c++) {
      const colStart = new Date(cur);
      const cells = [];
      for (let r = 0; r < 7; r++) {
        const d = new Date(cur);
        const iso = d.toISOString().slice(0,10);
        const mins = +heatmap[iso] || 0;
        const future = d > today;
        let level = 0;
        if (mins > 0) {
          if      (mins <= thresh[0]) level = 1;
          else if (mins <= thresh[1]) level = 2;
          else if (mins <= thresh[2]) level = 3;
          else if (mins <= thresh[3]) level = 4;
          else                         level = 5;
        }
        cells.push({ iso, mins, level, future });
        cur.setDate(cur.getDate() + 1);
      }
      cols.push(cells);
      // Month label when month changes from first cell of column
      if (colStart.getMonth() !== lastMonth) {
        lastMonth = colStart.getMonth();
        monthLabels.push({ col: c, name: colStart.toLocaleString(undefined, { month:'short' }) });
      }
    }

    // Render
    const weekdays = ['','Mon','','Wed','','Fri',''];
    const monthRow = monthLabels
      .map(m => `<span class="sd-month" style="grid-column:${m.col+2}">${m.name}</span>`)
      .join('');
    const weekdayCol = weekdays
      .map((w,i) => `<span class="sd-wd" style="grid-row:${i+1}">${w}</span>`)
      .join('');
    const cells = cols.map((col, c) =>
      col.map((cell, r) => {
        if (cell.future) return `<div class="sd-cell sd-future" style="grid-column:${c+2};grid-row:${r+1}"></div>`;
        const tip = cell.mins
          ? `${fmtHours(cell.mins)} on ${fmtDate(cell.iso)}`
          : `No playtime on ${fmtDate(cell.iso)}`;
        return `<div class="sd-cell sd-l${cell.level}" style="grid-column:${c+2};grid-row:${r+1}" title="${esc(tip)}"></div>`;
      }).join('')
    ).join('');

    return `
      <div class="sd-heatgrid">
        <div class="sd-months">${monthRow}</div>
        ${weekdayCol}
        ${cells}
      </div>
      <div class="sd-heat-legend">
        <span>Less</span>
        <span class="sd-cell sd-l0"></span>
        <span class="sd-cell sd-l1"></span>
        <span class="sd-cell sd-l2"></span>
        <span class="sd-cell sd-l3"></span>
        <span class="sd-cell sd-l4"></span>
        <span class="sd-cell sd-l5"></span>
        <span>More</span>
      </div>
    `;
  }

  // ── time-of-day donut ──────────────────────────────────
  function buildDonut(tod) {
    const entries = [
      ['morning',   '🌅', '6-12',  '#c8a840'],
      ['afternoon', '☀️', '12-18', '#e0c87a'],
      ['evening',   '🌆', '18-24', '#8a7a5a'],
      ['night',     '🌙', '0-6',   '#5a4a2a'],
    ];
    const total = entries.reduce((s, [k]) => s + (+tod[k] || 0), 0);
    if (!total) {
      return `<div class="sd-donut-empty">No session history yet</div>`;
    }
    // Build conic-gradient string
    let start = 0;
    const stops = [];
    const rows  = [];
    let best = { key:'', pct:0 };
    entries.forEach(([key, icon, range, col]) => {
      const v = +tod[key] || 0;
      const pct = v / total * 100;
      if (pct > best.pct) best = { key, pct };
      if (pct > 0) {
        stops.push(`${col} ${start.toFixed(2)}% ${(start+pct).toFixed(2)}%`);
        start += pct;
      }
      rows.push({ key, icon, range, col, v, pct });
    });
    // Fill remainder if floating point gap
    if (start < 100 && stops.length) {
      const last = entries[entries.length-1][3];
      stops[stops.length-1] = stops[stops.length-1].replace(/[\d.]+%\s*$/, '100%');
    }

    const bestLabel = best.key.charAt(0).toUpperCase() + best.key.slice(1);
    const bestIcon  = entries.find(e => e[0]===best.key)?.[1] || '';

    const legend = rows.map(r => `
      <div class="sd-tod-row">
        <span class="sd-tod-dot" style="background:${r.col}"></span>
        <span class="sd-tod-name">${r.icon} ${r.key.charAt(0).toUpperCase()+r.key.slice(1)}</span>
        <span class="sd-tod-time">${fmtHours(r.v)}</span>
        <span class="sd-tod-pct">${r.pct.toFixed(0)}%</span>
      </div>
    `).join('');

    return `
      <div class="sd-donut-wrap">
        <div class="sd-donut" style="background:conic-gradient(${stops.join(', ')})">
          <div class="sd-donut-hole">
            <span class="sd-donut-icon">${bestIcon}</span>
            <span class="sd-donut-best">${bestLabel}</span>
            <span class="sd-donut-sub">Peak time</span>
          </div>
        </div>
        <div class="sd-tod-legend">${legend}</div>
      </div>
    `;
  }

  // ── top servers bars ───────────────────────────────────
  function buildTopServers(top) {
    if (!top || !top.length) {
      return `<div class="sd-empty">No server playtime yet. Install and launch a server to start tracking.</div>`;
    }
    const max = top[0].minutes || 1;
    return top.map((s, i) => {
      const lvl = s.level || levelFor(s.minutes);
      const pct = Math.max(2, (s.minutes / max) * 100);
      return `
        <div class="sd-srv-row">
          <span class="sd-srv-rank">#${i+1}</span>
          <span class="sd-srv-name" title="${esc(s.server)}">${esc(s.server)}</span>
          <div class="sd-srv-bar-track"><div class="sd-srv-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
          <span class="sd-srv-lvl" title="Skill level">Lv ${lvl}</span>
          <span class="sd-srv-time">${fmtHours(s.minutes)}</span>
        </div>
      `;
    }).join('');
  }

  // ── server milestones — tier progression per server ──
  // Tier thresholds match app.js getRankName() / getMilestoneColor() so
  // ranks agree everywhere in the UI.
  const TIERS = [
    { level:  1, name: 'BRONZE',   color: '#8b92a5' },
    { level:  5, name: 'IRON',     color: '#b8b8b8' },
    { level: 10, name: 'STEEL',    color: '#4a9eff' },
    { level: 25, name: 'BLACK',    color: '#2a2a2a' },
    { level: 40, name: 'MITHRIL',  color: '#4caf50' },
    { level: 55, name: 'ADAMANT',  color: '#7dc96d' },
    { level: 70, name: 'RUNE',     color: '#5ab4d8' },
    { level: 85, name: 'DRAGON',   color: '#9b5de5' },
    { level: 99, name: 'INFERNAL', color: '#ffd700' },
  ];
  function tierFor(level) {
    for (let i = TIERS.length - 1; i >= 0; i--) if (level >= TIERS[i].level) return TIERS[i];
    return TIERS[0];
  }
  function nextTier(level) {
    for (const t of TIERS) if (t.level > level) return t;
    return null;
  }
  // Inverse of the sqrt level curve: minutes required to reach `lvl`.
  function minutesForLevel(lvl) {
    const r = (lvl - 1) / 98;
    return Math.round(r * r * 60000);
  }

  function buildServerMilestones(topServers) {
    if (!topServers.length) {
      return '<div class="sd-empty small">Play a server to start unlocking tier milestones.</div>';
    }
    return topServers.map(s => {
      const lvl = levelFor(s.minutes);
      const cur = tierFor(lvl);
      const next = nextTier(lvl);
      const baseMin  = minutesForLevel(cur.level);
      const nextMin  = next ? minutesForLevel(next.level) : s.minutes;
      const span     = Math.max(1, nextMin - baseMin);
      const progress = next
        ? Math.min(100, Math.max(0, ((s.minutes - baseMin) / span) * 100))
        : 100;
      const nextLabel = next
        ? `Next: ${next.name} · ${fmtHours(Math.max(0, nextMin - s.minutes))} to go`
        : '⭐ Max tier unlocked';
      return `
        <div class="sd-ms-server">
          <div class="sd-ms-server-head">
            <span class="sd-ms-server-name" title="${esc(s.server)}">${esc(s.server)}</span>
            <span class="sd-ms-server-tier" style="color:${cur.color};border-color:${cur.color}">${cur.name}</span>
            <span class="sd-ms-server-lvl">Lv ${lvl}</span>
          </div>
          <div class="sd-ms-bar-track">
            <div class="sd-ms-bar-fill" style="width:${progress.toFixed(1)}%;background:linear-gradient(90deg, ${cur.color}99, ${cur.color})"></div>
          </div>
          <div class="sd-ms-server-next">${nextLabel}</div>
        </div>
      `;
    }).join('');
  }

  // ── (legacy) personal milestones timeline — kept for future ref ──
  function buildMilestones(ms) {
    if (!ms || !ms.length) return '';
    // Sort ascending by date so timeline reads naturally
    const sorted = [...ms].sort((a,b) => new Date(a.date) - new Date(b.date));
    return sorted.map(m => {
      let icon = '⭐';
      if (m.type === 'joined')         icon = '🎉';
      if (m.type === 'firstSession')   icon = '🚀';
      if (m.type === 'longestSession') icon = '⏱️';
      const sub = [fmtDate(m.date), fmtRelDays(m.date), m.server ? esc(m.server) : null]
        .filter(Boolean).join(' · ');
      return `
        <div class="sd-ms-row">
          <span class="sd-ms-icon">${icon}</span>
          <div class="sd-ms-body">
            <div class="sd-ms-label">${esc(m.label)}</div>
            <div class="sd-ms-sub">${sub}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ── hero card ──────────────────────────────────────────
  function buildHero(d) {
    const total = d.totalMinutes || 0;
    const rank  = d.globalRank || 0;
    const tot   = d.totalPlayers || 1;
    const pct   = rank > 0 ? Math.max(0.1, (rank / tot) * 100) : 100;
    const pctLabel = pct < 1 ? 'Top 1%' : pct < 10 ? `Top ${pct.toFixed(0)}%` : `Top ${Math.round(pct)}%`;
    const skill = d.skillTotal || 0;
    const streak = d.streak || 0;

    const totalHours = (total/60).toFixed(0);
    const rankSub = rank > 0 ? `${pctLabel} · ${tot.toLocaleString()} total` : 'Play to rank';
    const skillSub = d.serversPlayed > 0
      ? `${d.serversPlayed} server${d.serversPlayed === 1 ? '' : 's'}`
      : 'No servers yet';
    const streakSub = streak > 0 ? '🔥 active' : 'Play to start';

    return `
      <div class="sd-hero">
        <div class="sd-hero-cell">
          <span class="sd-hero-label">TOTAL TIME</span>
          <span class="sd-hero-value">${fmtHours(total)}</span>
          <span class="sd-hero-sub">${totalHours} hours</span>
        </div>
        <div class="sd-hero-cell">
          <span class="sd-hero-label">GLOBAL RANK</span>
          <span class="sd-hero-value">#${rank.toLocaleString()}</span>
          <span class="sd-hero-sub">${rankSub}</span>
        </div>
        <div class="sd-hero-cell">
          <span class="sd-hero-label">SKILL TOTAL</span>
          <span class="sd-hero-value">${skill.toLocaleString()}</span>
          <span class="sd-hero-sub">${skillSub}</span>
        </div>
        <div class="sd-hero-cell">
          <span class="sd-hero-label">LOGIN STREAK</span>
          <span class="sd-hero-value">${streak}<span class="sd-hero-unit">d</span></span>
          <span class="sd-hero-sub">${streakSub}</span>
        </div>
      </div>
    `;
  }

  // ── main render ────────────────────────────────────────
  async function render(el) {
    el.innerHTML = `
      <div class="alt-header"><h2>STATS</h2><p>Your personal playtime dashboard</p></div>
      <div class="sd-loading">Loading stats…</div>
    `;
    let data;
    try {
      data = await window.hub.get('/api/stats/me');
    } catch (e) {
      console.error('[stats] load failed', e);
      data = null;
    }
    // main.js returns { raw: '' } for non-JSON responses (e.g. the Java backend
    // 404'd because it's running an older build without /api/stats/me).
    // Treat that as a real error instead of silently rendering zeros.
    const isEmpty = !data
      || data.error
      || (typeof data === 'object' && 'raw' in data)
      || !('totalMinutes' in data);
    if (isEmpty) {
      const hint = data && data.error
        ? esc(data.error)
        : 'Stats endpoint unavailable — please fully close the launcher (both windows) and reopen to load the latest backend.';
      el.innerHTML = `
        <div class="alt-header"><h2>STATS</h2><p>Your personal playtime dashboard</p></div>
        <div class="sd-empty">${hint}</div>
      `;
      return;
    }

    // Override the server-computed skill levels with our OSRS XP curve so
    // the UI is always in sync (server data doesn't have to be redeployed).
    (data.topServers || []).forEach(s => { s.level = levelFor(s.minutes); });
    const clientSkillTotal = (data.topServers || []).reduce((sum, s) => sum + levelFor(s.minutes), 0);
    // If the API's skillTotal looks like the old curve (way lower than client
    // computation), prefer the client value so the hero stays consistent.
    if (clientSkillTotal > (data.skillTotal || 0)) data.skillTotal = clientSkillTotal;

    const hero       = buildHero(data);
    const heatmap    = buildHeatmap(data.heatmap || {});
    const topServers = buildTopServers(data.topServers || []);
    const mostPlayed = data.mostPlayed ? esc(data.mostPlayed) : '—';

    el.innerHTML = `
      <div class="alt-header">
        <h2>STATS</h2>
        <p>Most played: <b style="color:#e0c87a">${mostPlayed}</b> · Member since ${fmtDate(data.createdAt)}</p>
      </div>

      ${hero}

      <div class="sd-section">
        <h3 class="sd-section-title">YEAR IN PLAY</h3>
        <p class="sd-section-sub">Daily activity over the last 365 days</p>
        ${heatmap}
      </div>

      <div class="sd-section">
        <h3 class="sd-section-title">TOP SERVERS</h3>
        <p class="sd-section-sub">Your favorites, ranked by playtime</p>
        <div class="sd-srv-list">${topServers}</div>
      </div>

      <div class="sd-section">
        <h3 class="sd-section-title">MILESTONES</h3>
        <p class="sd-section-sub">Tier progression on your servers — chase the next rank</p>
        <div class="sd-ms-server-list">${buildServerMilestones(data.topServers || [])}</div>
      </div>
    `;
  }

  window.renderStats = render;
})();
