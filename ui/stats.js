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
        return `<div class="sd-cell sd-l${cell.level}" style="grid-column:${c+2};grid-row:${r+1}" data-tip="${esc(tip)}"></div>`;
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

  // ── hub-wide achievement badges ──────────────────────
  // 100+ cross-cutting goals covering playtime, exploration, streaks, skill
  // tiers, time-of-day, active days, account tenure, leaderboard rank, and
  // single-server focus. Everything here is computable from the fields the
  // stats endpoint already returns.
  function computeHubBadges(data) {
    const totalMin      = data.totalMinutes || 0;
    const totalHours    = totalMin / 60;
    const servers       = data.serversPlayed || (data.topServers || []).length || 0;
    const streak        = data.streak || 0;
    const skill         = data.skillTotal || 0;
    const rank          = data.globalRank || 0;
    const top           = data.topServers || [];
    const tod           = data.timeOfDay || {};
    const heat          = data.heatmap || {};
    const hasAvatar     = !!data.hasAvatar;
    const milestones    = data.milestones || [];
    const longest       = milestones.find(m => m.type === 'longestSession');
    const longestMin    = longest ? parseInt((longest.label || '').match(/\d+/)?.[0] || '0', 10) : 0;
    // Days with any activity in the heatmap
    const activeDays    = Object.values(heat).filter(v => (+v) > 0).length;
    // Max minutes in a single day
    const busiestDay    = Math.max(0, ...Object.values(heat).map(v => +v || 0));
    // How many servers the user has reached a given level on
    const serversAtLv   = lv => top.filter(s => (s.level || 0) >= lv).length;
    // Account age in days
    const ageDays = data.createdAt
      ? Math.floor((Date.now() - new Date(data.createdAt).getTime()) / 86400000)
      : 0;
    // Time-of-day buckets (minutes)
    const todBuckets = ['morning','afternoon','evening','night'].map(k => +(tod[k] || 0));
    const activeTodBuckets = todBuckets.filter(m => m >= 30).length;
    // Top-server minutes helpers
    const topMinsOn = (n) => top[n - 1]?.minutes || 0;

    return [
      // ── PLAYTIME ────────────────────────────────
      { icon:'⚔️',  name:'First Steps',     sub:'Play your first session',    unlocked: totalMin > 0 },
      { icon:'🔥',  name:'Warming Up',      sub:'1 hour played',              unlocked: totalHours >= 1 },
      { icon:'📈',  name:'Getting Into It', sub:'5 hours played',             unlocked: totalHours >= 5 },
      { icon:'⏳',  name:'Grinder',         sub:'10 hours played',            unlocked: totalHours >= 10 },
      { icon:'🔨',  name:'Committed',       sub:'25 hours played',            unlocked: totalHours >= 25 },
      { icon:'💪',  name:'Addict',          sub:'50 hours played',            unlocked: totalHours >= 50 },
      { icon:'💎',  name:'Dedicated',       sub:'100 hours played',           unlocked: totalHours >= 100 },
      { icon:'🛡️', name:'Veteran',         sub:'250 hours played',           unlocked: totalHours >= 250 },
      { icon:'🗡️', name:'Die Hard',        sub:'500 hours played',           unlocked: totalHours >= 500 },
      { icon:'👑',  name:'Hub Legend',      sub:'1000 hours played',          unlocked: totalHours >= 1000 },
      { icon:'🌠',  name:'Immortal',        sub:'2500 hours played',          unlocked: totalHours >= 2500 },
      { icon:'🏛️', name:'Eternal',         sub:'5000 hours played',          unlocked: totalHours >= 5000 },

      // ── SERVER EXPLORATION ─────────────────────
      { icon:'👣',  name:'Sampled',         sub:'Play 2 different servers',   unlocked: servers >= 2 },
      { icon:'🔭',  name:'Scout',           sub:'Play 3 different servers',   unlocked: servers >= 3 },
      { icon:'🗺️', name:'Explorer',        sub:'Play 5 different servers',   unlocked: servers >= 5 },
      { icon:'🧭',  name:'Wanderer',        sub:'Play 10 different servers',  unlocked: servers >= 10 },
      { icon:'🌍',  name:'Globetrotter',    sub:'Play 15 different servers',  unlocked: servers >= 15 },
      { icon:'📚',  name:'Encyclopedia',    sub:'Play 20 different servers',  unlocked: servers >= 20 },
      { icon:'🎓',  name:'Connoisseur',     sub:'Play 25 different servers',  unlocked: servers >= 25 },
      { icon:'🏰',  name:'Hub Mayor',       sub:'Play 30 different servers',  unlocked: servers >= 30 },
      { icon:'♾️',  name:'Omni-Player',     sub:'Play 40 different servers',  unlocked: servers >= 40 },

      // ── LOGIN STREAKS ──────────────────────────
      { icon:'📅',  name:'Returning Player', sub:'2-day login streak',        unlocked: streak >= 2 },
      { icon:'🔁',  name:'Habit Forming',    sub:'3-day login streak',        unlocked: streak >= 3 },
      { icon:'🗓️', name:'Week Warrior',     sub:'7-day login streak',        unlocked: streak >= 7 },
      { icon:'📆',  name:'Fortnightly',      sub:'14-day login streak',       unlocked: streak >= 14 },
      { icon:'🏆',  name:'Month Master',     sub:'30-day login streak',       unlocked: streak >= 30 },
      { icon:'🎖️', name:'Two-Month Grind',  sub:'60-day login streak',       unlocked: streak >= 60 },
      { icon:'💯',  name:'100-Day Club',     sub:'100-day login streak',      unlocked: streak >= 100 },
      { icon:'📜',  name:'Year Round',       sub:'365-day login streak',      unlocked: streak >= 365 },

      // ── FIRST-TIME TIER UNLOCKS (any server) ───
      { icon:'🟫',  name:'First Iron',       sub:'Reach Iron tier on any server',     unlocked: serversAtLv(5)  >= 1 },
      { icon:'⚙️',  name:'First Steel',      sub:'Reach Steel tier on any server',    unlocked: serversAtLv(10) >= 1 },
      { icon:'🖤',  name:'First Black',      sub:'Reach Black tier on any server',    unlocked: serversAtLv(25) >= 1 },
      { icon:'🟢',  name:'First Mithril',    sub:'Reach Mithril tier on any server',  unlocked: serversAtLv(40) >= 1 },
      { icon:'🟩',  name:'First Adamant',    sub:'Reach Adamant tier on any server',  unlocked: serversAtLv(55) >= 1 },
      { icon:'🔷',  name:'First Rune',       sub:'Reach Rune tier on any server',     unlocked: serversAtLv(70) >= 1 },
      { icon:'🟣',  name:'First Dragon',     sub:'Reach Dragon tier on any server',   unlocked: serversAtLv(85) >= 1 },
      { icon:'🔥',  name:'First Infernal',   sub:'Reach Lv 99 on any server',         unlocked: serversAtLv(99) >= 1 },

      // ── MULTI-SERVER TIER MASTERY (3 servers) ──
      { icon:'🥉',  name:'Iron Collector',     sub:'Iron tier on 3 servers',     unlocked: serversAtLv(5)  >= 3 },
      { icon:'🥈',  name:'Steel Collector',    sub:'Steel tier on 3 servers',    unlocked: serversAtLv(10) >= 3 },
      { icon:'🪨',  name:'Black Collector',    sub:'Black tier on 3 servers',    unlocked: serversAtLv(25) >= 3 },
      { icon:'🌿',  name:'Mithril Collector',  sub:'Mithril tier on 3 servers',  unlocked: serversAtLv(40) >= 3 },
      { icon:'🌳',  name:'Adamant Collector',  sub:'Adamant tier on 3 servers',  unlocked: serversAtLv(55) >= 3 },
      { icon:'💠',  name:'Rune Collector',     sub:'Rune tier on 3 servers',     unlocked: serversAtLv(70) >= 3 },
      { icon:'🐉',  name:'Dragon Collector',   sub:'Dragon tier on 3 servers',   unlocked: serversAtLv(85) >= 3 },
      { icon:'🏆',  name:'Max Collector',      sub:'Lv 99 on 3 servers',         unlocked: serversAtLv(99) >= 3 },

      // ── SKILL TOTAL ────────────────────────────
      { icon:'📖',  name:'Rookie',        sub:'50 total skill levels',   unlocked: skill >= 50 },
      { icon:'📘',  name:'Apprentice',    sub:'100 total skill levels',  unlocked: skill >= 100 },
      { icon:'📗',  name:'Journeyman',    sub:'250 total skill levels',  unlocked: skill >= 250 },
      { icon:'📙',  name:'Expert',        sub:'500 total skill levels',  unlocked: skill >= 500 },
      { icon:'📕',  name:'Master',        sub:'1000 total skill levels', unlocked: skill >= 1000 },
      { icon:'📜',  name:'Grandmaster',   sub:'1500 total skill levels', unlocked: skill >= 1500 },
      { icon:'🪄',  name:'Ascendant',     sub:'2000 total skill levels', unlocked: skill >= 2000 },
      { icon:'✨',  name:'Transcendent',  sub:'2500 total skill levels', unlocked: skill >= 2500 },

      // ── TIME OF DAY ────────────────────────────
      { icon:'🌅',  name:'Early Bird',       sub:'Play in the morning',         unlocked: (tod.morning   || 0) >= 30 },
      { icon:'☀️', name:'Afternoon Player', sub:'Play in the afternoon',       unlocked: (tod.afternoon || 0) >= 30 },
      { icon:'🌆',  name:'Golden Hour',      sub:'Play in the evening',         unlocked: (tod.evening   || 0) >= 30 },
      { icon:'🌙',  name:'Night Owl',        sub:'Play in the night',           unlocked: (tod.night     || 0) >= 30 },
      { icon:'🕓',  name:'Round the Clock',  sub:'Play in all 4 time-of-day buckets', unlocked: activeTodBuckets >= 4 },

      // ── ACTIVE DAYS (heatmap) ──────────────────
      { icon:'🗓️', name:'Active Week',      sub:'Play on 7 different days',    unlocked: activeDays >= 7 },
      { icon:'📆',  name:'Active Month',     sub:'Play on 20 different days',   unlocked: activeDays >= 20 },
      { icon:'🧱',  name:'Active Quarter',   sub:'Play on 50 different days',   unlocked: activeDays >= 50 },
      { icon:'🏞️', name:'Active Year',      sub:'Play on 200 different days',  unlocked: activeDays >= 200 },
      { icon:'🌋',  name:'Hot Day',          sub:'4h+ in a single day',         unlocked: busiestDay >= 240 },
      { icon:'🪨',  name:'Grind Day',        sub:'8h+ in a single day',         unlocked: busiestDay >= 480 },

      // ── ACCOUNT TENURE ─────────────────────────
      { icon:'🌱',  name:'Hub Original',     sub:'Account among first 30 days', unlocked: data.createdAt && ageDays >= 0 && new Date(data.createdAt) <= new Date('2026-05-09') },
      { icon:'🕰️', name:'1 Month Member',   sub:'Account 30+ days old',        unlocked: ageDays >= 30 },
      { icon:'📅',  name:'6 Month Member',   sub:'Account 180+ days old',       unlocked: ageDays >= 180 },
      { icon:'🎂',  name:'1 Year Member',    sub:'Account 365+ days old',       unlocked: ageDays >= 365 },
      { icon:'🏛️', name:'Ancient',          sub:'Account 2+ years old',        unlocked: ageDays >= 730 },

      // ── GLOBAL RANK ────────────────────────────
      { icon:'📊',  name:'Top 1000',    sub:'Global rank ≤ 1000', unlocked: rank > 0 && rank <= 1000 },
      { icon:'📈',  name:'Top 500',     sub:'Global rank ≤ 500',  unlocked: rank > 0 && rank <= 500 },
      { icon:'⭐',  name:'Top 100',     sub:'Global rank ≤ 100',  unlocked: rank > 0 && rank <= 100 },
      { icon:'💫',  name:'Top 50',      sub:'Global rank ≤ 50',   unlocked: rank > 0 && rank <= 50 },
      { icon:'🌟',  name:'Top 25',      sub:'Global rank ≤ 25',   unlocked: rank > 0 && rank <= 25 },
      { icon:'🥇',  name:'Top 10',      sub:'Global rank ≤ 10',   unlocked: rank > 0 && rank <= 10 },
      { icon:'🏅',  name:'Top 5',       sub:'Global rank ≤ 5',    unlocked: rank > 0 && rank <= 5 },
      { icon:'👑',  name:'Number One',  sub:'Global rank = 1',    unlocked: rank === 1 },

      // ── LONGEST SESSION ────────────────────────
      { icon:'🎮',  name:'First Session',   sub:'Complete a full session',     unlocked: !!milestones.find(m => m.type === 'firstSession') },
      { icon:'🏃',  name:'Long Play',       sub:'2-hour single session',       unlocked: longestMin >= 120 },
      { icon:'🔥',  name:'Marathon',        sub:'4-hour single session',       unlocked: longestMin >= 240 },
      { icon:'⚡',  name:'Epic Run',        sub:'8-hour single session',       unlocked: longestMin >= 480 },
      { icon:'🌙',  name:'All-Nighter',     sub:'12-hour single session',      unlocked: longestMin >= 720 },

      // ── SINGLE-SERVER FOCUS ────────────────────
      { icon:'🏠',  name:'Found Home',      sub:'10h on a single server',      unlocked: topMinsOn(1) >= 600 },
      { icon:'❤️', name:'Loyal Fan',       sub:'50h on a single server',      unlocked: topMinsOn(1) >= 3000 },
      { icon:'💖',  name:'True Believer',   sub:'100h on a single server',    unlocked: topMinsOn(1) >= 6000 },
      { icon:'⚜️', name:'Devotee',         sub:'250h on a single server',    unlocked: topMinsOn(1) >= 15000 },
      { icon:'🗿',  name:'Ascetic',         sub:'500h on a single server',    unlocked: topMinsOn(1) >= 30000 },

      // ── BREADTH+DEPTH COMBOS ───────────────────
      { icon:'⚖️', name:'Balanced',        sub:'10h+ on each of your top 3 servers', unlocked: top.length >= 3 && top.slice(0, 3).every(s => (s.minutes || 0) >= 600) },
      { icon:'🎯',  name:'Sampler',         sub:'Lv 5+ on 10 different servers',      unlocked: serversAtLv(5)  >= 10 },
      { icon:'🧩',  name:'Well-Traveled',   sub:'Lv 10+ on 5 different servers',      unlocked: serversAtLv(10) >= 5 },
      { icon:'🔮',  name:'Polymath',        sub:'Lv 25+ on 3 different servers',      unlocked: serversAtLv(25) >= 3 },
      { icon:'🎖️', name:'Well-Rounded',    sub:'Lv 40+ on 2 different servers',      unlocked: serversAtLv(40) >= 2 },

      // ── PROFILE / META ─────────────────────────
      { icon:'🖼️', name:'Face of the Hub', sub:'Upload a profile avatar',     unlocked: hasAvatar },
      { icon:'🎉',  name:'Joined the Hub',  sub:'Create your RSPS Hub account', unlocked: !!data.createdAt },

      // ── STYLE / HOOKS FOR FUTURE ───────────────
      { icon:'❓',  name:'Secret Achievement', sub:'Find the hidden easter egg',  unlocked: false },
      { icon:'🕵️', name:'Detective',          sub:'Discover all 5 hidden tabs',  unlocked: false },
      { icon:'🎃',  name:'Halloween Hunter',   sub:'Play during Halloween event', unlocked: false },
      { icon:'🎄',  name:'Christmas Spirit',   sub:'Play during Christmas event', unlocked: false },
      { icon:'❄️', name:'Winter Grinder',     sub:'Play during Winter event',    unlocked: false },
      { icon:'🌸',  name:'Spring Awakening',   sub:'Play during Spring event',    unlocked: false },
      { icon:'🏐',  name:'Summer Vibes',       sub:'Play during Summer event',    unlocked: false },
      { icon:'🍂',  name:'Autumn Glow',        sub:'Play during Autumn event',    unlocked: false },
      { icon:'🎁',  name:'Gift Receiver',      sub:'Get a gift from staff',       unlocked: false },
      { icon:'💌',  name:'Hub Pen Pal',        sub:'Send 100 DMs',                unlocked: false },
      { icon:'🤝',  name:'First Friend',       sub:'Add your first friend',       unlocked: false },
      { icon:'👥',  name:'Social Butterfly',   sub:'5 friends added',             unlocked: false },
      { icon:'🌐',  name:'Community Pillar',   sub:'10 friends added',            unlocked: false },
      { icon:'⭐',  name:'Hub Ambassador',     sub:'25 friends added',            unlocked: false },
      { icon:'📝',  name:'Reviewer',           sub:'Write a server review',       unlocked: false },
      { icon:'⭐',  name:'Critic',             sub:'Write 10 server reviews',     unlocked: false },
      { icon:'🎵',  name:'Music Lover',        sub:'Favorite a music track',      unlocked: false },
      { icon:'🎶',  name:'DJ',                 sub:'Favorite 25 music tracks',    unlocked: false },
    ];
  }

  function buildHubBadges(data) {
    const badges = computeHubBadges(data);
    const earned = badges.filter(b => b.unlocked).length;
    return `
      <div class="sd-badge-grid">
        ${badges.map(b => `
          <div class="sd-badge ${b.unlocked ? 'unlocked' : 'locked'}" title="${esc(b.sub)}">
            <span class="sd-badge-icon">${b.icon}</span>
            <div class="sd-badge-body">
              <div class="sd-badge-name">${esc(b.name)}</div>
              <div class="sd-badge-sub">${esc(b.sub)}</div>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="sd-badge-count">${earned} / ${badges.length} unlocked</div>
    `;
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
  // When `username` is provided, render that user's public profile instead of
  // the caller's own stats. Otherwise default to /api/stats/me.
  async function render(el, username = null) {
    const title = username
      ? `${esc(username)}'S PROFILE`
      : 'STATS';
    const subtitle = username
      ? `Public profile · stats & achievements`
      : 'Your personal playtime dashboard';
    el.innerHTML = `
      <div class="alt-header"><h2>${title}</h2><p>${subtitle}</p></div>
      <div class="sd-loading">Loading…</div>
    `;
    const endpoint = username
      ? '/api/stats/user/' + encodeURIComponent(username)
      : '/api/stats/me';
    // For own-profile view, check the shared tab cache first. If there's
    // already fresh data from the login-time prefetch, render instantly
    // and still kick off a background refresh in case anything's changed.
    let data = null;
    const useCache = !username && window.getCached;
    // Capture which tab asked for this render so the background refresh
    // callback can verify we're STILL on Stats before re-rendering.
    // Otherwise the callback would re-render Stats into whatever tab the
    // user switched to (Chat, Achievements, etc.) because #alt-content is
    // the same DOM node across tabs.
    const initialPanel = document.querySelector('.rs-tab.active')?.dataset?.panel;
    const shouldStillRender = () => {
      if (username) {
        // Profile-modal render — check the overlay still exists + contains el
        const overlay = document.getElementById('user-profile-overlay');
        return !!overlay && overlay.contains(el);
      }
      // Tab render — check we're still on the same tab AND the node is live
      const nowPanel = document.querySelector('.rs-tab.active')?.dataset?.panel;
      return nowPanel === initialPanel && document.contains(el);
    };

    if (useCache) {
      const { data: cached, isStale } = window.getCached('stats');
      if (cached) {
        data = cached;
        if (isStale) {
          window.hub.get(endpoint).then(fresh => {
            if (fresh && 'totalMinutes' in fresh) {
              window.setCache('stats', fresh);
              if (shouldStillRender()) render(el, username);
            }
          }).catch(() => {});
        }
      }
    }
    if (!data) {
      try {
        data = await window.hub.get(endpoint);
        if (useCache && data && 'totalMinutes' in data) window.setCache('stats', data);
      } catch (e) {
        console.error('[stats] load failed', e);
        data = null;
      }
      // Another guard: between the time we kicked off the fetch and got a
      // response, the user may have switched tabs. Bail out of the final
      // render if so — don't overwrite whatever they're looking at now.
      if (!shouldStillRender()) return;
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
        : (username
            ? 'Could not load this user\'s profile. They may have their profile hidden, or the backend needs a restart.'
            : 'Stats endpoint unavailable — please fully close the launcher (both windows) and reopen to load the latest backend.');
      el.innerHTML = `
        <div class="alt-header"><h2>${title}</h2><p>${subtitle}</p></div>
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

  // Dedicated achievements-only render for the ACHIEVE sidebar tab. Fetches
  // the stats data and draws only the hero totals + achievements grid, no
  // heatmap / milestones / top servers (those live on the Stats tab).
  // Persisted filter choice so it survives tab switches
  let _achFilter = 'all'; // 'all' | 'unlocked' | 'locked'

  window.renderAchievements = async function renderAchievements(el) {
    el.innerHTML = `
      <div class="alt-header"><h2>ACHIEVEMENTS</h2><p>Track your milestones across all servers</p></div>
      <div class="sd-loading">Loading achievements…</div>
    `;
    let data = null;
    // Same anti-race guard as the Stats tab: only update DOM if the user
    // is still on the Achievements tab when the fetch resolves.
    const initialPanel = document.querySelector('.rs-tab.active')?.dataset?.panel;
    const shouldStillRender = () =>
      document.querySelector('.rs-tab.active')?.dataset?.panel === initialPanel
      && document.contains(el);

    if (window.getCached) {
      const { data: cached, isStale } = window.getCached('stats');
      if (cached) {
        data = cached;
        if (isStale) {
          window.hub.get('/api/stats/me').then(fresh => {
            if (fresh && 'totalMinutes' in fresh) {
              window.setCache('stats', fresh);
              if (shouldStillRender()) window.renderAchievements(el);
            }
          }).catch(() => {});
        }
      }
    }
    if (!data) {
      try {
        data = await window.hub.get('/api/stats/me');
        if (data && 'totalMinutes' in data && window.setCache) window.setCache('stats', data);
      } catch (e) {}
      if (!shouldStillRender()) return;
    }
    const isEmpty = !data || data.error || (typeof data === 'object' && 'raw' in data) || !('totalMinutes' in data);
    if (isEmpty) {
      el.innerHTML = `
        <div class="alt-header"><h2>ACHIEVEMENTS</h2><p>Track your milestones across all servers</p></div>
        <div class="sd-empty">Could not load achievements. Please try again in a moment.</div>
      `;
      return;
    }
    // Match the Stats-tab level curve
    (data.topServers || []).forEach(s => { s.level = levelFor(s.minutes); });
    const badges  = computeHubBadges(data);
    const earned  = badges.filter(b => b.unlocked).length;

    function drawBadges() {
      const list = _achFilter === 'unlocked' ? badges.filter(b => b.unlocked)
                  : _achFilter === 'locked'   ? badges.filter(b => !b.unlocked)
                  : badges;
      const grid = el.querySelector('.sd-badge-grid');
      if (!grid) return;
      grid.innerHTML = list.length
        ? list.map(b => `
            <div class="sd-badge ${b.unlocked ? 'unlocked' : 'locked'}" data-tip="${esc(b.name)} — ${esc(b.sub)}">
              <span class="sd-badge-icon">${b.icon}</span>
              <div class="sd-badge-body">
                <div class="sd-badge-name">${esc(b.name)}</div>
                <div class="sd-badge-sub">${esc(b.sub)}</div>
              </div>
            </div>`).join('')
        : `<div class="sd-empty small">
            ${_achFilter === 'unlocked' ? "You haven't unlocked any yet — start playing to earn your first badge!"
              : "You've unlocked all of them — nothing left to chase here. Legend."}
           </div>`;
    }

    el.innerHTML = `
      <div class="alt-header">
        <h2>ACHIEVEMENTS</h2>
        <p><b style="color:#e0c87a">${earned}</b> / ${badges.length} unlocked</p>
      </div>
      <div class="ach-filter-row">
        <button class="ach-filter ${_achFilter === 'all' ? 'active' : ''}" data-filter="all">All · ${badges.length}</button>
        <button class="ach-filter ${_achFilter === 'unlocked' ? 'active' : ''}" data-filter="unlocked">Unlocked · ${earned}</button>
        <button class="ach-filter ${_achFilter === 'locked' ? 'active' : ''}" data-filter="locked">Locked · ${badges.length - earned}</button>
      </div>
      <div class="sd-section">
        <div class="sd-badge-grid"></div>
      </div>
    `;
    el.querySelectorAll('.ach-filter').forEach(b => {
      b.addEventListener('click', () => {
        _achFilter = b.dataset.filter;
        el.querySelectorAll('.ach-filter').forEach(x => x.classList.toggle('active', x.dataset.filter === _achFilter));
        drawBadges();
      });
    });
    drawBadges();
  };

  // Open another user's public profile in a centered overlay modal.
  window.openUserProfile = function openUserProfile(username) {
    if (!username) return;
    const prior = document.getElementById('user-profile-overlay');
    if (prior) prior.remove();
    const overlay = document.createElement('div');
    overlay.id = 'user-profile-overlay';
    overlay.innerHTML = `
      <div class="upm-box" onclick="event.stopPropagation()">
        <button class="upm-close" id="upm-close" title="Close">✕</button>
        <div class="upm-body" id="upm-body"></div>
      </div>
    `;
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
    overlay.querySelector('#upm-close').addEventListener('click', () => overlay.remove());
    // Render into the body directly — no flex/alt-panel interference.
    render(overlay.querySelector('#upm-body'), username);
  };
})();
