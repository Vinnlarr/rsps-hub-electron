// ══════════════════════════════════════════════════════════
// STATS DASHBOARD
//   Hero card • 365-day heatmap • Top-server bars •
//   Time-of-day donut • Milestones timeline
// ══════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Achievement catalog (server-published coin rewards) ─────────────
  // Loaded once per launcher session from /api/achievements/catalog. Maps
  // achievement name → coin reward so drawBadges can render "+50" style
  // pills next to each badge. Without this, players have no visibility
  // into which achievements actually pay out.
  let _achCatalogByName = {};
  let _achCatalogTotal  = 0;
  let _achCatalogPromise = null;
  function loadAchCatalog() {
    if (_achCatalogPromise) return _achCatalogPromise;
    if (!window.hub?.get) return Promise.resolve();
    _achCatalogPromise = window.hub.get('/api/achievements/catalog')
      .then(d => {
        const list = d?.achievements || [];
        list.forEach(a => { _achCatalogByName[a.name] = a; });
        _achCatalogTotal = d?.totalCoins || list.reduce((s, a) => s + (a.coins || 0), 0);
      })
      .catch(e => console.warn('[stats] achievement catalog load failed:', e));
    return _achCatalogPromise;
  }
  // Pre-fetch on script init so the catalog is ready by the time the user
  // opens the stats modal / achievements panel.
  setTimeout(() => { loadAchCatalog(); }, 1500);

  // ── helpers ────────────────────────────────────────────
  // Build the inner spans for a Hub Store effect overlay (sparkles, petals,
  // embers, snow, prism, hearts, confetti, glow, shimmer). Mirrors the
  // helper in hubstore.js so a previewed effect renders the same way it
  // does in the store tile.
  function effectFxSpansFor(fx) {
    if (fx === 'sparkles') {
      let h = '';
      for (let i = 1; i <= 8; i++) h += `<span style="left:${i*12}%;animation-duration:${3+i*0.2}s;animation-delay:${i*0.3}s"></span>`;
      return h;
    }
    if (fx === 'petals')   return [8,25,45,62,80,90].map((l,i) => `<span style="left:${l}%;animation-duration:${5+i*0.3}s;animation-delay:${i*0.5}s">🌸</span>`).join('');
    if (fx === 'embers')   return [10,25,40,55,70,85,95].map((l,i) => `<span style="left:${l}%;animation-duration:${2.5+i*0.15}s;animation-delay:${i*0.3}s"></span>`).join('');
    if (fx === 'snow')     return [5,18,35,48,62,78,90].map((l,i) => `<span style="left:${l}%;animation-duration:${5.5+i*0.25}s;animation-delay:${i*0.4}s"></span>`).join('');
    if (fx === 'hearts')   return [10,30,50,70,88].map((l,i) => `<span style="left:${l}%;animation-duration:${5+i*0.3}s;animation-delay:${i*0.5}s">💗</span>`).join('');
    if (fx === 'confetti') {
      const colors = ['#ff5050','#50c8ff','#ffd050','#a855d6','#50d050','#ff80c0','#80d8ff'];
      return colors.map((c,i) => `<span style="left:${i*14+5}%;background:${c};animation-duration:${4+i*0.15}s;animation-delay:${i*0.3}s"></span>`).join('');
    }
    // ── Round 2 effects ─────────────────────────────────────
    if (fx === 'lightning') {
      // 4 vertical bolts at varied positions, varied flash phase offsets
      const positions = [22, 48, 70, 88];
      return positions.map((l,i) => `<span style="left:${l}%;height:${50+i*15}vh;animation-duration:${3+i*0.6}s;animation-delay:${i*0.7}s"></span>`).join('');
    }
    if (fx === 'matrix') {
      // 200 chars spread across the FULL modal — random top/left so the
      // green rain fills the whole stats page, not one band at the top.
      const chars = ['0','1','｜','ﾊ','ﾐ','ﾌ','ｦ','ｱ','ｴ','ｵ','ﾑ','ﾒ','*','#'];
      let out = '';
      for (let i = 0; i < 200; i++) {
        const ch = chars[Math.floor(Math.random()*chars.length)];
        const x = (Math.random()*100).toFixed(1);
        const y = (Math.random()*100).toFixed(1);
        const dur = (2.5+Math.random()*3).toFixed(2);
        const delay = (-Math.random()*5).toFixed(2);
        out += `<span style="left:${x}%;top:${y}%;animation-duration:${dur}s;animation-delay:${delay}s">${ch}</span>`;
      }
      return out;
    }
    if (fx === 'fireflies') {
      let out = '';
      for (let i = 0; i < 10; i++) out += `<span style="left:${i*10+5}%;animation-duration:${5+i*0.4}s;animation-delay:${i*0.6}s"></span>`;
      return out;
    }
    if (fx === 'bubbles') {
      let out = '';
      const sizes = [10, 14, 8, 16, 12, 18, 10, 14];
      for (let i = 0; i < 8; i++) {
        const s = sizes[i];
        out += `<span style="left:${i*12+4}%;width:${s}px;height:${s}px;animation-duration:${6+i*0.5}s;animation-delay:${i*0.7}s"></span>`;
      }
      return out;
    }
    if (fx === 'twinkling' || fx === 'radiation' || fx === 'holy_light' ||
        fx === 'cyber_glitch' || fx === 'toxic_smoke' || fx === 'radiant_halo') {
      // Pure background-aura effects — no particle spans needed
      return '';
    }
    if (fx === 'leaves') {
      const emojis = ['🍂','🍁','🍂','🍁','🍂'];
      return emojis.map((e,i) => `<span style="left:${i*22+5}%;animation-duration:${6+i*0.5}s;animation-delay:${i*0.8}s">${e}</span>`).join('');
    }
    if (fx === 'diamond_dust') {
      let out = '';
      for (let i = 0; i < 30; i++) {
        const x = (Math.random()*100).toFixed(1);
        const y = (Math.random()*100).toFixed(1);
        out += `<span style="left:${x}%;top:${y}%;animation-duration:${1.5+Math.random()*2}s;animation-delay:${Math.random()*3}s"></span>`;
      }
      return out;
    }
    if (fx === 'lava_bubbles') {
      let out = '';
      for (let i = 0; i < 8; i++) {
        out += `<span style="left:${i*12+4}%;animation-duration:${5+i*0.4}s;animation-delay:${i*0.6}s"></span>`;
      }
      return out;
    }
    if (fx === 'ghost_wisps') {
      const wisps = ['👻','👻','👻'];
      return wisps.map((w,i) => `<span style="top:${20+i*25}%;animation-duration:${10+i*2}s;animation-delay:${i*3}s">${w}</span>`).join('');
    }
    if (fx === 'bat_flock') {
      const bats = ['🦇','🦇','🦇','🦇'];
      return bats.map((b,i) => `<span style="top:${15+i*22}%;animation-duration:${6+i*0.8}s;animation-delay:${i*1.2}s">${b}</span>`).join('');
    }
    // ── v3 particle effects — denser, instant-visibility (negative delay)
    if (fx === 'confetti_v3') {
      const colors = ['#ff3080','#30c0ff','#ffd030','#50ff80','#c050ff','#ff8040','#80c0ff','#ff60c0'];
      let out = '';
      // 140 particles spread across the FULL modal height (random top%)
      // so confetti is visible everywhere, not just one falling band.
      for (let i = 0; i < 140; i++) {
        const x = (Math.random()*100).toFixed(1);
        const y = (Math.random()*100).toFixed(1);
        const c = colors[i % colors.length];
        const dur = (3+Math.random()*3).toFixed(2);
        const delay = (-Math.random()*6).toFixed(2);
        const rot = Math.floor(Math.random()*360);
        out += `<span style="left:${x}%;top:${y}%;background:${c};animation-duration:${dur}s;animation-delay:${delay}s;--r:${rot}deg"></span>`;
      }
      return out;
    }
    if (fx === 'cherry_storm_v3') {
      let out = '';
      // 100 petals spread across the FULL modal height
      for (let i = 0; i < 100; i++) {
        const x = (Math.random()*100).toFixed(1);
        const y = (Math.random()*100).toFixed(1);
        const dur = (4+Math.random()*4).toFixed(2);
        const delay = (-Math.random()*8).toFixed(2);
        out += `<span style="left:${x}%;top:${y}%;animation-duration:${dur}s;animation-delay:${delay}s">🌸</span>`;
      }
      return out;
    }
    if (fx === 'deepsea_bubbles_v3') {
      let out = '';
      // 120 bubbles spread across the FULL modal height with random top%.
      for (let i = 0; i < 120; i++) {
        const x = (Math.random()*100).toFixed(1);
        const y = (Math.random()*100).toFixed(1);
        const sz = 4+Math.floor(Math.random()*14);
        const dur = (4+Math.random()*4).toFixed(2);
        const delay = (-Math.random()*8).toFixed(2);
        out += `<span style="left:${x}%;top:${y}%;width:${sz}px;height:${sz}px;animation-duration:${dur}s;animation-delay:${delay}s"></span>`;
      }
      return out;
    }
    if (fx === 'snowglobe_v3') {
      let out = '';
      // 130 snowflakes spread across the FULL modal height
      for (let i = 0; i < 130; i++) {
        const x = (Math.random()*100).toFixed(1);
        const y = (Math.random()*100).toFixed(1);
        const dur = (4+Math.random()*4).toFixed(2);
        const delay = (-Math.random()*8).toFixed(2);
        const sz = 2+Math.floor(Math.random()*4);
        out += `<span style="left:${x}%;top:${y}%;width:${sz}px;height:${sz}px;animation-duration:${dur}s;animation-delay:${delay}s"></span>`;
      }
      return out;
    }
    if (fx === 'galaxy_drift_v3') {
      const cols = ['#fff','#fff','#c0a0ff','#80c0ff','#ffe0b0','#fff'];
      let out = '';
      for (let i = 0; i < 80; i++) {
        const x = (Math.random()*100).toFixed(1);
        const y = (Math.random()*100).toFixed(1);
        const sz = 1+Math.floor(Math.random()*3);
        const dur = (1.5+Math.random()*2.5).toFixed(2);
        const delay = (-Math.random()*4).toFixed(2);
        out += `<span style="left:${x}%;top:${y}%;width:${sz}px;height:${sz}px;background:${cols[i%cols.length]};animation-duration:${dur}s;animation-delay:${delay}s"></span>`;
      }
      return out;
    }
    if (fx === 'constellation_v3') {
      const stars = [
        [20,15,-0.2],[35,30,-0.8],[25,50,-1.2],[50,65,-0.6],
        [40,80,-1.5],[65,20,-1.0],[75,42,-0.4],[80,60,-1.8],
        [60,85,-0.9],[15,75,-1.3],[55,10,-0.5],[90,30,-1.6],
        [10,40,-0.3],[42,8,-1.4],[88,50,-2.1],[5,90,-0.7],
        [30,95,-1.9],[70,5,-0.6],[95,15,-2.4],[12,55,-1.1],
      ];
      const lines = [
        [21,15,18,40,-0.5],[35,30,22,-22,-1.2],[25,50,18,60,-2.0],
        [50,65,18,-25,-0.8],[65,20,25,15,-1.5],[75,42,22,8,-2.2],
        [55,10,18,50,-1.0],[60,85,14,-110,-1.7],
        [10,40,15,30,-1.4],[88,50,8,-160,-0.9],[42,8,12,80,-2.3],
      ];
      let out = '';
      for (const [t,l,d] of stars)
        out += `<span class="star" style="top:${t}%;left:${l}%;animation-delay:${d}s"></span>`;
      for (const [t,l,w,r,d] of lines)
        out += `<span class="line" style="top:${t}%;left:${l}%;width:${w}%;transform:rotate(${r}deg);animation-delay:${d}s"></span>`;
      return out;
    }
    if (fx === 'zarosian_void_v3') {
      const runes = [
        [18,18,-0.5,'Z',32],[30,78,-1.5,'⏣',26],
        [62,12,-2.5,'Z',30],[75,70,-1.0,'⏣',24],
        [48,50,-3.0,'Ƶ',40],[12,60,-2.0,'Z',26],
        [85,30,-0.8,'Ƶ',28],[55,90,-1.8,'⏣',22],
      ];
      return runes.map(([t,l,d,ch,sz]) =>
        `<span class="rune" style="top:${t}%;left:${l}%;animation-delay:${d}s;font-size:${sz}px">${ch}</span>`
      ).join('');
    }
    return ''; // glow / prism / shimmer don't need particle spans
  }

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

    const badges = [
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
      { icon:'📝',  name:'Reviewer',           sub:'Write a server review',       unlocked: (data.reviewsWritten || 0) >= 1 },
      { icon:'⭐',  name:'Critic',             sub:'Write 10 server reviews',     unlocked: (data.reviewsWritten || 0) >= 10 },
      { icon:'🎵',  name:'Music Lover',        sub:'Favorite a music track',      unlocked: false },
      { icon:'🎶',  name:'DJ',                 sub:'Favorite 25 music tracks',    unlocked: false },
    ];
    // Server is authoritative for unlocks. Walk the badge list, look up
    // each by name in the loaded catalog (gives us the server id), and if
    // that id is in data.unlockedAchievements, override the client
    // predicate. Catches every badge whose client predicate is wrong /
    // hardcoded false (Music Lover, DJ, friends, etc.) AND any future
    // server/client drift.
    const unlockedSet = new Set(data?.unlockedAchievements || []);
    if (unlockedSet.size && _achCatalogByName) {
      for (const b of badges) {
        const cat = _achCatalogByName[b.name];
        if (cat && unlockedSet.has(cat.id)) b.unlocked = true;
      }
    }
    return badges;
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

    const headerName = username ? `${esc(username).toUpperCase()}` : 'STATS';
    el.innerHTML = `
      <div class="alt-header">
        <h2>${headerName}</h2>
        <p>${username ? `<b style="color:#e0c87a">${esc(username)}</b> · ` : ''}Most played: <b style="color:#e0c87a">${mostPlayed}</b> · Member since ${fmtDate(data.createdAt)}</p>
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

  // ──────────────────────────────────────────────────────────────
  // Hub Coin sigil — reusable inline SVG. Pass `size` in pixels.
  // Used in the stats modal hero + coin-activity rows + (eventually)
  // the nav balance widget.
  // ──────────────────────────────────────────────────────────────
  function coinSvg(size = 28, idSuffix = '') {
    const sfx = idSuffix || ('c' + Math.random().toString(36).slice(2, 7));
    return `
      <svg viewBox="0 0 64 64" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" aria-label="Hub Coin">
        <defs>
          <radialGradient id="cf-${sfx}" cx="35%" cy="30%" r="80%">
            <stop offset="0%"  stop-color="#ffe296"/>
            <stop offset="35%" stop-color="#f4d77c"/>
            <stop offset="70%" stop-color="#c8a840"/>
            <stop offset="100%" stop-color="#7a5818"/>
          </radialGradient>
          <linearGradient id="cr-${sfx}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stop-color="#fff0b0"/>
            <stop offset="50%" stop-color="#c8a840"/>
            <stop offset="100%" stop-color="#5a3e10"/>
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="30" fill="url(#cr-${sfx})"/>
        <circle cx="32" cy="32" r="25" fill="url(#cf-${sfx})" stroke="#5a3e10" stroke-width="0.8"/>
        ${size >= 24 ? `
        <g stroke="#7a5818" stroke-width="0.8" opacity="0.5">
          <line x1="32" y1="3"  x2="32" y2="6"/>
          <line x1="32" y1="58" x2="32" y2="61"/>
          <line x1="3"  y1="32" x2="6"  y2="32"/>
          <line x1="58" y1="32" x2="61" y2="32"/>
          <line x1="11.5" y1="11.5" x2="13.5" y2="13.5"/>
          <line x1="50.5" y1="50.5" x2="52.5" y2="52.5"/>
          <line x1="50.5" y1="11.5" x2="52.5" y2="13.5"/>
          <line x1="11.5" y1="50.5" x2="13.5" y2="52.5"/>
        </g>` : ''}
        <text x="32" y="42" text-anchor="middle" font-family="Cinzel, serif" font-weight="900" font-size="26" fill="#3a2410">H</text>
        ${size >= 24 ? `<path d="M14 18 Q22 12 30 14" stroke="#fff5d0" stroke-width="1.5" fill="none" opacity="0.55" stroke-linecap="round"/>` : ''}
      </svg>`;
  }
  window.coinSvg = coinSvg;

  // ──────────────────────────────────────────────────────────────
  // Modal-specific helpers — wider 53-week heatmap + milestone tier
  // ladder. The existing `buildHeatmap` is sized for the old 26-week
  // side panel; these are bigger and use the sm- CSS namespace.
  // ──────────────────────────────────────────────────────────────
  function buildModalHeatmap(heatmap) {
    const today = new Date(); today.setHours(0,0,0,0);
    const days = 365;
    const start = new Date(today); start.setDate(start.getDate() - (days - 1));

    // quartile buckets from non-zero days
    const vals = Object.values(heatmap || {}).map(v => +v).filter(v => v > 0).sort((a,b) => a-b);
    const q = (p) => vals.length ? vals[Math.min(vals.length-1, Math.floor(vals.length*p))] : 0;
    const t = [q(0.25), q(0.5), q(0.75), q(0.92)];

    const firstDow = start.getDay();
    let html = '';
    // Pad blank cells for days-of-week before the first real date
    for (let i = 0; i < firstDow; i++) {
      html += `<div class="sm-hm-cell" style="opacity:0"></div>`;
    }
    const cur = new Date(start);
    for (let i = 0; i < days; i++) {
      const iso = cur.toISOString().slice(0,10);
      const mins = +(heatmap || {})[iso] || 0;
      let lvl = 0;
      if (mins > 0) {
        if      (mins <= t[0]) lvl = 1;
        else if (mins <= t[1]) lvl = 2;
        else if (mins <= t[2]) lvl = 3;
        else                   lvl = 4;
      }
      const tip = mins ? `${fmtHours(mins)} on ${fmtDate(iso)}` : `No playtime on ${fmtDate(iso)}`;
      html += `<div class="sm-hm-cell${lvl ? ' l' + lvl : ''}" data-tip="${esc(tip)}"></div>`;
      cur.setDate(cur.getDate() + 1);
    }
    return html;
  }

  function buildModalMilestones(topServers) {
    if (!topServers || !topServers.length) {
      return `<div class="sm-empty-mini">No server playtime yet. Install one from the Store and start climbing.</div>`;
    }
    // Hard cap at the top 5 servers — this is a consistent rule across
    // every section (Top Servers + Milestones). Never raise this number
    // without a UX review; more rows turns this from a glance-able
    // dashboard into a wall of bars.
    return topServers.slice(0, 5 /* SERVERS_PER_SECTION */).map(s => {
      const lvl = s.level || levelFor(s.minutes);
      const cur = tierFor(lvl);
      // Find the next tier (if any) for the "X levels to NEXT" hint
      const idx = TIERS.findIndex(t => t.name === cur.name);
      const next = idx < TIERS.length - 1 ? TIERS[idx + 1] : null;
      const toNext = next ? Math.max(0, next.level - lvl) : 0;
      const ladder = TIERS.map(t => {
        const cls = lvl >= t.level
          ? (t.name === cur.name ? 'current' : 'reached')
          : '';
        return `
          <div class="sm-ms-tier ${cls}">
            <span class="sm-ms-tier-name">${t.name}</span>
            <span class="sm-ms-tier-lvl">Lv ${t.level}</span>
          </div>`;
      }).join('');
      return `
        <div class="sm-ms-row">
          <div class="sm-ms-row-head">
            <span class="sm-ms-name">${esc(s.server || s.name || '?')}</span>
            <span class="sm-ms-current">${cur.name}</span>
            ${next ? `<span class="sm-ms-next">${toNext} level${toNext === 1 ? '' : 's'} to ${next.name}</span>`
                   : `<span class="sm-ms-next">Maxed out</span>`}
          </div>
          <div class="sm-ms-ladder">${ladder}</div>
        </div>`;
    }).join('');
  }

  // Single source of truth for "max servers shown per section" so we never
  // accidentally render more than 5 servers in Top Servers / Milestones.
  const SERVERS_PER_SECTION = 5;

  // ──────────────────────────────────────────────────────────────
  // STATS MODAL — replaces the old slide-panel stats tab AND the
  // public-profile modal. Wide-format dashboard (Discord/Steam style).
  // Pass `username` to render someone else's profile (no coin balance,
  // no coin activity, action buttons in hero).
  // ──────────────────────────────────────────────────────────────
  window.openStatsModal = async function openStatsModal(username = null, opts = {}) {
    // Reuse if already open
    if (document.getElementById('stats-modal-overlay')) return;
    const isSelf = !username;
    // Optional preview overrides from the Hub Store. When set, the hero
    // renders as if this item were equipped (without persisting it to the
    // user's account). Lets players try-before-buy.
    const previewItem = opts.previewItem || null;
    const previewSlot = opts.previewSlot || null; // title / color / border / effect

    const overlay = document.createElement('div');
    overlay.id = 'stats-modal-overlay';
    overlay.className = 'stats-overlay';
    overlay.innerHTML = `
      <div class="stats-modal" role="dialog" aria-modal="true">
        <button class="stats-close" id="stats-close-btn" aria-label="Close">✕</button>
        <div class="stats-body" id="stats-modal-body">
          <div class="stats-loading">Loading your stats…</div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // 30s ticker that rewrites every Coin-Activity row's relative-time
    // text. Without this, "just now" stays frozen for the lifetime of the
    // modal. Cleared when the modal closes.
    const tsTick = setInterval(() => {
      overlay.querySelectorAll('[data-tx-ts]').forEach(el => {
        const iso = el.getAttribute('data-tx-ts');
        if (!iso) return;
        try {
          const d = new Date(String(iso).replace(' ', 'T') + (String(iso).endsWith('Z') ? '' : 'Z'));
          const diffMs = Date.now() - d.getTime();
          const m = 60_000, h = 60 * m, day = 24 * h;
          let txt;
          if (diffMs < m)            txt = 'just now';   // first 60s only
          else if (diffMs < h)       txt = Math.floor(diffMs / m) + 'm ago';
          else if (diffMs < 24 * h)  txt = Math.floor(diffMs / h) + 'h ago';
          else if (diffMs < 7 * day) txt = Math.floor(diffMs / day) + 'd ago';
          else txt = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
          if (el.textContent !== txt) el.textContent = txt;
        } catch {}
      });
    }, 30_000);

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onEsc);
      clearInterval(tsTick);
    };
    const onEsc = e => { if (e.key === 'Escape') close(); };
    overlay.querySelector('#stats-close-btn').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onEsc);

    // Fetch stats data. Self uses /api/stats/me; profile view uses
    // /api/stats/user/<name> (same endpoint the old renderStats used).
    let data = null;
    const endpoint = isSelf ? '/api/stats/me' : '/api/stats/user/' + encodeURIComponent(username);
    try {
      data = await window.hub.get(endpoint);
    } catch (e) { console.error('[stats-modal] fetch failed', e); }

    // For own profile: sync achievements (server awards coins for any
    // newly-unlocked) AND fetch coin balance + transactions in parallel.
    let coinsPayload = null;
    let syncResult   = null;
    if (isSelf) {
      try {
        const [c, s] = await Promise.all([
          window.hub.get('/api/coins/me').catch(() => null),
          window.hub.post('/api/achievements/sync', {}).catch(() => null),
        ]);
        coinsPayload = c;
        syncResult   = s;
        // If new achievements unlocked, fetch coins again to get the
        // post-award balance + transactions
        if (syncResult?.newly_unlocked?.length) {
          coinsPayload = await window.hub.get('/api/coins/me').catch(() => coinsPayload);
          // Merge the newly-awarded IDs into the stats payload so the
          // achievements panel renders them as unlocked immediately,
          // instead of waiting for the next /api/stats/me refresh / a
          // full launcher restart.
          if (data && Array.isArray(data.unlockedAchievements)) {
            const newIds = syncResult.newly_unlocked.map(a => a.id);
            const merged = new Set([...data.unlockedAchievements, ...newIds]);
            data.unlockedAchievements = Array.from(merged);
          } else if (data) {
            data.unlockedAchievements = syncResult.newly_unlocked.map(a => a.id);
          }
        }
      } catch (e) { console.error('[stats-modal] coins/sync failed', e); }
    }

    if (!data || data.error || !('totalMinutes' in data)) {
      overlay.querySelector('#stats-modal-body').innerHTML = `
        <div class="stats-empty">Could not load stats. Try restarting the launcher.</div>`;
      return;
    }

    // Recompute skill levels with our OSRS curve (same logic as renderStats)
    (data.topServers || []).forEach(s => { s.level = levelFor(s.minutes); });

    // Build the achievements summary (uses computeHubBadges from earlier in this file)
    const badges    = computeHubBadges(data);
    const earnedAch = badges.filter(b => b.unlocked).length;
    const totalAch  = badges.length;
    const recentAch = badges.filter(b => b.unlocked).slice(-3).reverse();

    // Hub Level — clamp at 99 per server, sum, hero displays current total
    const hubLevel = (data.topServers || []).reduce((s, srv) => s + (srv.level || 0), 0);

    // Coin balance — comes from /api/coins/me (Phase 1 backend).
    // Falls back to 0 on profile view (we don't expose other users' coins).
    const coins = isSelf
      ? ((coinsPayload && typeof coinsPayload.balance === 'number') ? coinsPayload.balance : 0)
      : 0;

    // Hours played
    const hoursPlayed = Math.floor((data.totalMinutes || 0) / 60);

    const displayName = isSelf
      ? (window.state?.user?.username || data.username || 'Player')
      : (username || data.username || 'Player');
    const initial = displayName[0].toUpperCase();
    // Hero avatar: prefer the local file for self / server URL for others.
    // Falls back to the letter glyph if neither is available.
    const heroAvatarSrc = (typeof window.userAvatarSrc === 'function')
      ? window.userAvatarSrc(displayName, { hasAvatar: !!data.hasAvatar, isMe: isSelf })
      : null;
    const heroAvatarHtml = heroAvatarSrc
      ? `<img src="${esc(heroAvatarSrc)}" alt="${esc(displayName)}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${esc(initial)}'}))" />`
      : esc(initial);
    // Login streak. For self we have it cached in window.state (refreshed
    // on every launcher boot via /api/streak/checkin). For other users
    // it'd come from their stats payload.
    const loginStreak = isSelf
      ? (window.state?.streak?.current || data.loginStreak || 0)
      : (data.loginStreak || data.streak || 0);

    // Equipped cosmetics. Comes from /api/stats/me (Phase 2 backend) under
    // `data.equipped.{title|color|border|effect}` with style hints inside
    // each slot's `.style` object.
    //
    // Preview mode (from the Hub Store): the previewed item *replaces*
    // whatever the user currently has equipped in that one slot. The user's
    // other slots stay unchanged so they can see how a new cosmetic fits
    // alongside their existing loadout.
    const eq = data.equipped || {};
    let equippedTitle  = eq.title?.name  || 'None';
    let equippedColor  = eq.color?.name  || 'None';
    let equippedBorder = eq.border?.name || 'None';
    let equippedEffect = eq.effect?.name || null;
    let nameStyleCss   = eq.color?.style?.nameStyle || '';
    let avBorderColor  = eq.border?.style?.avBorder || '#c8a840';
    let avBorderGlow   = eq.border?.style?.avGlow   || '0 4px 18px rgba(200,168,64,0.35)';
    let avBorderType   = eq.border?.style?.borderType || '';
    let effectFx       = eq.effect?.style?.fx || null;

    if (previewItem && previewSlot) {
      // Override only the previewed slot. Existing items in other slots
      // remain visible so the user sees how the new cosmetic looks
      // alongside their current loadout.
      if (previewSlot === 'title')  equippedTitle  = previewItem.name;
      if (previewSlot === 'color')  { equippedColor  = previewItem.name; nameStyleCss = previewItem.nameStyle || ''; }
      if (previewSlot === 'border') {
        equippedBorder    = previewItem.name;
        avBorderColor     = previewItem.avBorder || '#c8a840';
        avBorderGlow      = previewItem.avGlow   || '0 4px 18px rgba(200,168,64,0.35)';
        // previewItem comes from hubstore.js's normalised catalog where
        // borderType is a flat field. Lift it so the spike cage renders
        // in preview mode too.
        avBorderType      = previewItem.borderType || '';
      }
      if (previewSlot === 'effect') { equippedEffect = previewItem.name; effectFx = previewItem.fx || null; }
    }

    // Top servers (capped at SERVERS_PER_SECTION = 5)
    const topServers = (data.topServers || []).slice(0, SERVERS_PER_SECTION);

    // Recent achievements (last 3 unlocked, mock until backend tracks unlock-time)
    const achRows = recentAch.length ? recentAch.map(a => {
      // Pull the real coin value from the server's published catalog instead
      // of the old "default to 100" hardcode that made every row look the
      // same. _achCatalogByName is pre-fetched on launcher init.
      const reward = _achCatalogByName[a.name]?.coins ?? a.coins ?? 0;
      return `
      <div class="sm-ach-row">
        <div class="sm-ach-icon">${esc(a.icon || '🏆')}</div>
        <div class="sm-ach-info">
          <div class="sm-ach-name">${esc(a.name)}</div>
          <div class="sm-ach-meta">${esc(a.sub || '')}</div>
        </div>
        <div class="sm-ach-coin">+${reward}</div>
      </div>`;
    }).join('') : '<div class="sm-empty-mini">No achievements yet. Go play to unlock some.</div>';

    // Coin activity from /api/coins/me. Pretty-print the source string so
    // users see "Achievement: First Steps" instead of "achievement / first_steps".
    function fmtTxLabel(t) {
      const src = t.source || '';
      const sid = t.source_id || '';
      if (src === 'achievement') {
        const a = (typeof ach_by_id === 'function') ? null : null;
        // Look up the human name from the catalog the JS doesn't have;
        // fall back to a tidied version of the id slug.
        const pretty = sid.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return 'Achievement: ' + pretty;
      }
      if (src === 'daily')      return 'Daily login bonus';
      if (src === 'purchase') {
        // Prefer the real catalog name + category label so users see
        // "Bought: Frost (Name Color)" instead of "Bought: c_frost".
        // Catalog is published on window by hubstore.js; falls back to a
        // prettified slug if the store hasn't been opened yet this session.
        const item = window.HUB_STORE_BY_ID?.[sid];
        if (item) {
          const cat = window.HUB_STORE_CAT_LABEL?.[item.cat] || '';
          return cat ? `Bought: ${item.name} (${cat})` : `Bought: ${item.name}`;
        }
        if (!sid) return 'Bought: cosmetic';
        // Fallback: c_frost → Frost / b_stone → Stone / t_just_vibes → Just Vibes
        const slug = sid.replace(/^[a-z]_/, '').replace(/_/g, ' ');
        const pretty = slug.replace(/\b\w/g, c => c.toUpperCase());
        return 'Bought: ' + pretty;
      }
      if (src === 'milestone')    return 'Hub Level milestone';
      if (src === 'admin')        return 'Staff adjustment';
      if (src === 'refund')       return 'Refund';
      if (src === 'login_streak') return 'Login streak bonus';
      if (src === 'referral')     return 'Referral bonus';
      // Fallback: snake_case → Sentence case (e.g. "some_thing" → "Some thing")
      if (!src) return 'Transaction';
      return src.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
    }
    function fmtTxWhen(iso) {
      if (!iso) return '';
      try {
        const d = new Date(String(iso).replace(' ', 'T') + (String(iso).endsWith('Z') ? '' : 'Z'));
        const diffMs = Date.now() - d.getTime();
        const m = 60_000, h = 60 * m, day = 24 * h;
        if (diffMs < m)       return 'just now';        // first 60s only
        if (diffMs < h)       return Math.floor(diffMs / m) + 'm ago';
        if (diffMs < 24 * h)  return Math.floor(diffMs / h) + 'h ago';
        if (diffMs < 7 * day) return Math.floor(diffMs / day) + 'd ago';
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      } catch { return ''; }
    }
    const coinActivity = (coinsPayload?.transactions || []).slice(0, 5);
    // Render relative-time text inside spans tagged with the raw ISO. A
    // 30s timer (set up after innerHTML lands) walks these and rewrites
    // them so "just now" eventually becomes "1m ago", "2m ago", etc.,
    // without forcing the user to close and reopen the modal.
    const coinRows = coinActivity.length ? coinActivity.map(t => `
      <div class="sm-tx">
        <div class="sm-tx-icon">${coinSvg(26)}</div>
        <div class="sm-tx-info">
          <div class="sm-tx-source">${esc(fmtTxLabel(t))}</div>
          <div class="sm-tx-when" data-tx-ts="${esc(t.created_at || '')}">${esc(fmtTxWhen(t.created_at))}</div>
        </div>
        <div class="sm-tx-amt ${t.amount >= 0 ? 'positive' : 'negative'}">${t.amount >= 0 ? '+ ' : '\u2212 '}${Math.abs(t.amount)}</div>
      </div>`).join('') : `
      <div class="sm-empty-mini">You haven't earned or spent any Hub Coins yet. Unlock achievements, log in daily, and hit Hub Level milestones to start filling this list.</div>`;

    // Hero stats row: self gets Coins + Streak + Played + Achievements.
    // Other-player gets just Streak + Played + Achievements (no coins).
    const heroStreakStat = `
        <div class="sm-hero-stat">
          <div class="sm-hero-stat-icon" style="font-size:1.7rem">🔥</div>
          <div class="sm-hero-stat-num">${loginStreak}d</div>
          <div class="sm-hero-stat-lbl">Login Streak</div>
        </div>`;
    const heroFirstStat = isSelf ? `
        <div class="sm-hero-stat">
          <div class="sm-hero-stat-icon">${coinSvg(28)}</div>
          <div class="sm-hero-stat-num">${coins.toLocaleString()}</div>
          <div class="sm-hero-stat-lbl">Hub Coins</div>
        </div>${heroStreakStat}` : heroStreakStat;

    // Action buttons only render on someone else's profile (DM / Add Friend).
    const heroActions = isSelf ? '' : `
      <div class="sm-hero-actions">
        <button class="sm-action-btn primary" data-sm-dm="${esc(displayName)}">💬 Send Message</button>
        <button class="sm-action-btn" data-sm-friend="${esc(displayName)}">+ Add Friend</button>
      </div>`;

    // Banner that floats over the modal explaining preview mode. Lets the
    // user know their real loadout hasn't changed and gives them a way to
    // jump back to the store and actually buy/equip the previewed item.
    const previewBanner = previewItem ? `
      <div class="sm-preview-banner">
        <span>👁️  Previewing: <b>${esc(previewItem.name)}</b> · This is what your profile would look like with this ${previewSlot} equipped.</span>
        <button class="sm-preview-close" id="sm-preview-close-btn">CLOSE PREVIEW</button>
      </div>` : '';

    // Profile effect now spans the WHOLE stats modal (petals fall through
    // every section, not just the hero). Injected at the modal level so it
    // covers the full scrollable body.
    if (effectFx) {
      const modal = overlay.querySelector('.stats-modal');
      // Strip any existing fx layer from a prior open (defensive)
      modal.querySelector('.sm-modal-fx')?.remove();
      const fxNode = document.createElement('div');
      fxNode.className = `sm-modal-fx hs-fx-layer hs-fx-${effectFx}`;
      fxNode.innerHTML = effectFxSpansFor(effectFx);
      // Insert as the first child so the modal background sits behind it
      // but `.stats-body` (z-index:1) sits in front.
      modal.insertBefore(fxNode, modal.firstChild);
      // Flag the modal so the .has-fx CSS overrides kick in and dim
      // every card panel so the fx bleeds through.
      modal.classList.add('has-fx');
    } else {
      const modal = overlay.querySelector('.stats-modal');
      modal?.classList.remove('has-fx');
    }

    // Avatar style override (when previewing a border)
    const avatarStyle = `style="border-color:${avBorderColor}; box-shadow:${avBorderGlow}"`;
    // Animated border cage — Mod Crown laser spikes, Lightning bolts,
    // Wave ripples, etc. Uses the shared `borderCageHTML` builder from
    // hubstore.js so the same cage HTML renders everywhere. Wrapped in
    // .sm-hero-av-frame so the cage sits as a sibling of the avatar
    // (avatar's overflow:hidden doesn't clip the cage) and the avatar
    // renders ON TOP via z-index.
    const heroSpikes = (typeof window.borderCageHTML === 'function')
      ? window.borderCageHTML(avBorderType)
      : '';
    const usingSpikes = !!heroSpikes;
    // Name color style override (when previewing a name color)
    const nameStyle = nameStyleCss ? `style="${nameStyleCss}"` : '';
    // Title pill picks up the title's own nameStyle so a gradient title
    // (e.g. Voidwalker's purple gradient, Firstborn's gold inferno) renders
    // here exactly the way it does on the Hub Store tile, instead of
    // falling back to the default flat gold pill styling.
    const titleStyleCss = (previewItem && previewSlot === 'title')
      ? (previewItem.nameStyle || '')
      : (eq.title?.style?.nameStyle || '');
    const titleStyle = titleStyleCss ? `style="${titleStyleCss}"` : '';

    overlay.querySelector('#stats-modal-body').innerHTML = `
      ${previewBanner}
      <!-- HERO -->
      <div class="sm-hero">
        ${usingSpikes
          ? `<div class="sm-hero-av-frame">${heroSpikes}<div class="sm-hero-avatar" ${avatarStyle}>${heroAvatarHtml}</div></div>`
          : `<div class="sm-hero-avatar" ${avatarStyle}>${heroAvatarHtml}</div>`}
        <div class="sm-hero-info">
          <div class="sm-hero-name">${
            // Use shared renderName so per-letter name colours
            // (Bouncing Letters, Domino Flip, etc) wrap each glyph in a
            // span. Falls back to single-element inline-style for
            // ordinary gradient/glow colours. previewItem in colour-
            // preview mode wins; otherwise read from equipped.
            (typeof window.renderName === 'function')
              ? window.renderName(displayName,
                  (previewItem && previewSlot === 'color')
                    ? { color: { style: previewItem } }
                    : { color: eq.color })
              : `<span style="${nameStyleCss}">${esc(displayName)}</span>`
          }</div>
          ${equippedTitle && equippedTitle !== 'None' ? `<div class="sm-hero-title" ${titleStyle}>${esc(equippedTitle)}</div>` : ''}
          ${heroActions}
        </div>
        <div class="sm-hero-stats">
          ${heroFirstStat}
          <div class="sm-hero-stat">
            <div class="sm-hero-stat-icon" style="font-size:1.7rem">⏱</div>
            <div class="sm-hero-stat-num">${hoursPlayed}h</div>
            <div class="sm-hero-stat-lbl">Played</div>
          </div>
          <div class="sm-hero-stat">
            <div class="sm-hero-stat-icon" style="font-size:1.7rem">🏆</div>
            <div class="sm-hero-stat-num">${earnedAch} / ${totalAch}</div>
            <div class="sm-hero-stat-lbl">Achievements</div>
          </div>
        </div>
      </div>

      <!-- HUB LEVEL ROW -->
      <div class="sm-lvl-row">
        <span class="sm-lvl-tag">Hub Level</span>
        <span class="sm-lvl-num">${hubLevel}</span>
        <div class="sm-lvl-bar"><div class="sm-lvl-bar-fill" style="width:${Math.min(100, (hubLevel % 100))}%"></div></div>
        <span class="sm-lvl-meta">${(data.topServers || []).length} servers tracked</span>
      </div>

      <!-- YEAR IN PLAY HEATMAP -->
      <div class="sm-card">
        <div class="sm-card-hdr">
          <span class="sm-card-icon">📅</span> Year in Play
          <span class="sm-card-sub">Daily activity over the last 365 days</span>
        </div>
        <div class="sm-heatmap-wrap">
          <div class="sm-heatmap">${buildModalHeatmap(data.heatmap || {})}</div>
        </div>
        <div class="sm-hm-legend">
          <span>Less</span>
          <div class="sm-hm-legend-cells">
            <div class="sm-hm-cell"></div>
            <div class="sm-hm-cell l1"></div>
            <div class="sm-hm-cell l2"></div>
            <div class="sm-hm-cell l3"></div>
            <div class="sm-hm-cell l4"></div>
          </div>
          <span>More</span>
        </div>
      </div>

      <!-- 3-COL CARD GRID -->
      <div class="sm-grid-3">
        <div class="sm-card" style="margin-bottom:0">
          <div class="sm-card-hdr"><span class="sm-card-icon">⚔</span> Top Servers</div>
          ${topServers.length ? topServers.map((s, i) => `
            <div class="sm-ts-row ${i < 3 ? 'top' + (i + 1) : ''}">
              <span class="sm-ts-rank">${i + 1}</span>
              <span class="sm-ts-name">${esc(s.server || s.name || s.serverName || '?')}</span>
              <span class="sm-ts-lvl">Lv. ${s.level || 1}</span>
            </div>`).join('') : '<div class="sm-empty-mini">No servers played yet. Install one from the Store to start tracking.</div>'}
        </div>

        <div class="sm-card" style="margin-bottom:0">
          <div class="sm-card-hdr"><span class="sm-card-icon">🏆</span> Recent Achievements</div>
          ${achRows}
        </div>

        <div class="sm-card" style="margin-bottom:0">
          <div class="sm-card-hdr"><span class="sm-card-icon">✨</span> Equipped</div>
          <div class="sm-eq-row"><div class="sm-eq-lbl">Title</div><div class="sm-eq-val">${esc(equippedTitle)}</div></div>
          <div class="sm-eq-row"><div class="sm-eq-lbl">Name Color</div><div class="sm-eq-val">${esc(equippedColor)}</div></div>
          <div class="sm-eq-row"><div class="sm-eq-lbl">Avatar Border</div><div class="sm-eq-val">${esc(equippedBorder)}</div></div>
          ${equippedEffect ? `<div class="sm-eq-row"><div class="sm-eq-lbl">Profile Effect</div><div class="sm-eq-val">${esc(equippedEffect)}</div></div>` : ''}
          ${isSelf ? `<button class="sm-eq-btn" id="sm-open-store-btn">Open Hub Store →</button>` : ''}
        </div>
      </div>

      <!-- MILESTONES (full-width tier ladder) -->
      <div class="sm-card">
        <div class="sm-card-hdr">
          <span class="sm-card-icon">📜</span> Milestones
          <span class="sm-card-sub">Tier progression${isSelf ? ' on your servers, chase the next rank' : ''}</span>
        </div>
        ${buildModalMilestones(data.topServers || [])}
      </div>

      ${isSelf ? `
      <!-- COIN ACTIVITY (own profile only) -->
      <div class="sm-card">
        <div class="sm-card-hdr"><span class="sm-card-icon">${coinSvg(20)}</span> Coin Activity</div>
        ${coinRows}
      </div>` : ''}
    `;

    // If the sync awarded new achievements this session, surface a toast
    // for each (capped at 3 to avoid spam if a user is way behind).
    if (isSelf && syncResult?.newly_unlocked?.length && window.showToast) {
      const newAch = syncResult.newly_unlocked.slice(0, 3);
      newAch.forEach((a, i) => {
        setTimeout(() => {
          window.showToast(`${a.icon} ${a.name} unlocked! +${a.coins} Hub Coins`, 'success');
        }, i * 1100); // stagger so they don't pile up
      });
      if (syncResult.newly_unlocked.length > 3) {
        setTimeout(() => {
          window.showToast(`+ ${syncResult.newly_unlocked.length - 3} more achievements unlocked`, 'success');
        }, newAch.length * 1100);
      }
    }

    // Wire "Open Hub Store" button — closes the modal and switches tabs
    const openStoreBtn = overlay.querySelector('#sm-open-store-btn');
    if (openStoreBtn) {
      openStoreBtn.addEventListener('click', () => {
        close();
        document.querySelector('.nav-tab[data-tab="hubstore"]')?.click();
      });
    }

    // Wire CLOSE PREVIEW button when in store-preview mode
    const previewCloseBtn = overlay.querySelector('#sm-preview-close-btn');
    if (previewCloseBtn) {
      previewCloseBtn.addEventListener('click', () => {
        close();
        // Re-focus the Hub Store tab so users land back where they came from
        const storeTab = document.querySelector('.nav-tab[data-tab="hubstore"]');
        if (storeTab && !storeTab.classList.contains('active')) storeTab.click();
      });
    }

    // Wire profile actions (only present in other-player view)
    if (!isSelf) {
      const dmBtn = overlay.querySelector('[data-sm-dm]');
      if (dmBtn) dmBtn.addEventListener('click', () => {
        close();
        // Open the DM thread directly. Setting state.activeDM and clicking
        // the chat tab works ONLY if the chat tab isn't already active —
        // clicking an already-active tab toggles the panel CLOSED instead.
        // So we manually deactivate first, then click.
        if (window.state) window.state.activeDM = displayName;
        const chatTab = document.querySelector('.rs-tab[data-panel="chat"]');
        const panel = document.getElementById('slide-panel');
        if (!chatTab) return;
        // Deactivate any currently-active tab so the click below always
        // opens the panel fresh on the chat surface.
        document.querySelectorAll('.rs-tab.active').forEach(t => t.classList.remove('active'));
        if (panel) panel.classList.remove('open');
        // Defer the click to next tick so the modal close animation doesn't
        // race with the slide-panel open animation.
        setTimeout(() => chatTab.click(), 30);
      });
      const frBtn = overlay.querySelector('[data-sm-friend]');
      if (frBtn) frBtn.addEventListener('click', async () => {
        frBtn.disabled = true; frBtn.textContent = 'Sending…';
        try {
          await window.hub.post('/api/friends', { username: displayName });
          frBtn.textContent = '✓ Request sent';
        } catch (e) {
          frBtn.disabled = false; frBtn.textContent = '+ Add Friend';
          if (window.showToast) window.showToast('Friend request failed.', 'error');
        }
      });
    }
  };

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
    // Make sure the achievement catalog (server-side coin rewards) is
    // loaded before we paint the grid; otherwise the first render shows
    // badges with no coin pills until the user filter-clicks.
    await loadAchCatalog();
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
        ? list.map(b => {
            // Look up coin reward from server catalog. Match by name; fall
            // back to 0 if the client has a badge the server doesn't pay
            // out for (we have ~112 client badges, ~83 server-paying).
            const cat = _achCatalogByName[b.name];
            const coins = cat ? cat.coins : 0;
            const coinPill = coins > 0
              ? `<span class="sd-badge-coin ${b.unlocked ? 'earned' : ''}">+${coins.toLocaleString()}</span>`
              : '';
            // No `data-tip` or `title=` — the badge body already shows
            // name + sub + coin pill. A hover tooltip just duplicated the
            // same text, often visible alongside it.
            return `
            <div class="sd-badge ${b.unlocked ? 'unlocked' : 'locked'}">
              <span class="sd-badge-icon">${b.icon}</span>
              <div class="sd-badge-body">
                <div class="sd-badge-name">${esc(b.name)}</div>
                <div class="sd-badge-sub">${esc(b.sub)}</div>
              </div>
              ${coinPill}
            </div>`;
          }).join('')
        : `<div class="sd-empty small">
            ${_achFilter === 'unlocked' ? "You haven't unlocked any yet — start playing to earn your first badge!"
              : "You've unlocked all of them — nothing left to chase here. Legend."}
           </div>`;
    }

    el.innerHTML = `
      <div class="alt-header"><h2>ACHIEVEMENTS</h2></div>
      <div class="ach-progress">
        <div class="ach-progress-num"><span class="ach-progress-earned">${earned}</span><span class="ach-progress-slash"> / </span><span class="ach-progress-total">${badges.length}</span></div>
        <div class="ach-progress-label">UNLOCKED</div>
        <div class="ach-progress-bar"><div class="ach-progress-fill" style="width:${Math.round((earned / Math.max(1, badges.length)) * 100)}%"></div></div>
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

  // Open another user's public profile. Now routes through the same
  // modal as your own stats — same layout, profile-mode rendering (no
  // coins, login streak instead, DM + Add Friend buttons in the hero).
  // The legacy upm-box overlay is gone; everything lives in #stats-modal-overlay.
  window.openUserProfile = function openUserProfile(username) {
    if (!username) return;
    if (window.openStatsModal) window.openStatsModal(username);
  };
})();
