/**
 * hubstore.js — Hub Store cosmetics shop (Phase 2)
 *
 * Renders into #alt-content when the user clicks the HUB STORE nav tab.
 * Catalog is hardcoded for now; backend wiring (DB tables + /api/store/*
 * endpoints + buy/equip flow) lands in Phase 2 backend work. The buttons
 * here show toast confirmations as placeholders so the UX flow is testable
 * end-to-end before we put real coins on the line.
 *
 * Layout follows the v7 + v8 mockups:
 *   - Featured banner (rotating spotlight on a flagship item)
 *   - Sticky sidebar with categories / filters / tier
 *   - Tile grid grouped by tier
 *
 * Profile Effects category renders a live animated preview of the effect
 * playing on a sample profile card, since the effect IS the product.
 */
(function () {
  'use strict';

  // ── Helpers ────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function coinSvg(size) {
    const id = 'hsc' + Math.floor(Math.random() * 1e9);
    return `<svg class="hs-coin" viewBox="0 0 64 64" style="width:${size}px;height:${size}px" aria-hidden="true">
      <defs>
        <radialGradient id="${id}" cx="50%" cy="40%" r="50%">
          <stop offset="0%" stop-color="#ffe48a"/><stop offset="60%" stop-color="#d8a830"/><stop offset="100%" stop-color="#7a5a18"/>
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="28" fill="url(#${id})" stroke="#5a4218" stroke-width="2"/>
      <text x="32" y="42" font-family="Cinzel" font-weight="900" font-size="26" text-anchor="middle" fill="#3a2810">H</text>
    </svg>`;
  }

  // Returns the cage HTML for an animated avatar border. Each `borderType`
  // gets a different number of spans (and sometimes glyph content). CSS
  // for each cage type lives in hubstore.css. Exposed on window so stats.js
  // hero rendering can use the same builder.
  function borderCageHTML(borderType) {
    if (!borderType) return '';
    if (borderType === 'mod_spikes')
      return `<div class="hs-mod-spikes-cage">${'<span></span>'.repeat(8)}</div>`;
    if (borderType === 'lightning_bolts')
      return `<div class="hs-cage hs-cage--lightning">${'<span></span>'.repeat(5)}</div>`;
    if (borderType === 'wave_ripples')
      return `<div class="hs-cage hs-cage--ripple">${'<span></span>'.repeat(3)}</div>`;
    if (borderType === 'orbit_stars')
      return `<div class="hs-cage hs-cage--stars">${'<span>★</span>'.repeat(5)}</div>`;
    if (borderType === 'energy_sparks')
      return `<div class="hs-cage hs-cage--sparks">${'<span></span>'.repeat(8)}</div>`;
    if (borderType === 'petal_crown')
      return `<div class="hs-cage hs-cage--petals">${'<span>🌸</span>'.repeat(8)}</div>`;
    if (borderType === 'rune_circle') {
      const runes = ['ᚠ','ᚱ','ᛏ','ᛞ','ᛗ','ᛟ'];
      return `<div class="hs-cage hs-cage--runes">${runes.map(r => `<span>${r}</span>`).join('')}</div>`;
    }
    if (borderType === 'plasma_ring')
      return `<div class="hs-cage hs-cage--plasma"></div>`;
    return '';
  }
  window.borderCageHTML = borderCageHTML;

  // Returns inner HTML for an avatar slot showing the *current user's* face.
  // Uses the global `userAvatarSrc` helper (local file for self, falls back
  // to the first-letter glyph). Used by featured-banner border previews,
  // tile border previews, and effect preview cards so users see their own
  // avatar instead of a placeholder "V".
  function meAvatarHTML() {
    const me = window.state?.user?.username || 'Player';
    const letter = me[0].toUpperCase();
    if (typeof window.userAvatarSrc === 'function') {
      const src = window.userAvatarSrc(me, { isMe: true });
      if (src) return `<img src="${src}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${letter}'}))" />`;
    }
    return esc(letter);
  }

  // ── Catalog (live, fetched from /api/store/list) ──────────────────────────
  // Items shape from server: { id, category, tier, name, description, cost,
  //   requirement, style: {nameStyle? avBorder? avGlow? fx?}, owned, equipped }
  // Normalised on load so existing renderers can keep using `item.cat`,
  // `item.desc`, `item.nameStyle`, `item.avBorder`, `item.avGlow`, `item.fx`.
  let catalog = [];

  // Hardcoded fallback used only if the API is unreachable. Keeps the store
  // browseable offline and makes the "Loading…" state graceful instead of
  // showing an empty grid forever.
  const FALLBACK_CATALOG_RAW = [
    // ── TITLES ────────────────────────────────────────────────────────────
    { id:'t_wanderer',     cat:'titles', tier:'com', name:'The Wanderer',          desc:"For those who refuse to settle on one server.",                       cost:0,    owned:true, equipped:true,  nameStyle:'color:#e0c87a' },
    { id:'t_first_door',   cat:'titles', tier:'com', name:'First Through Door',    desc:'Awarded to early Hub adopters. Worn with quiet pride.',               cost:0,    owned:true,                   nameStyle:'color:#9a8a6a' },
    { id:'t_botanist',     cat:'titles', tier:'com', name:'The Botanist',          desc:'For the herblore lifers and tea-drinking pacifists.',                 cost:500,                                nameStyle:'color:#90c090' },
    { id:'t_quartermaster',cat:'titles', tier:'com', name:'The Quartermaster',     desc:'For those who never log out without a full inventory.',               cost:3500,                               nameStyle:'color:#c0a060' },
    { id:'t_just_vibes',   cat:'titles', tier:'com', name:'Just Vibes',            desc:"No pressure, no agenda. You log in, you exist, that's enough.",       cost:300,                                nameStyle:'color:#a89878' },
    { id:'t_mythbreaker',  cat:'titles', tier:'rar', name:'Mythbreaker',           desc:'For the ones who clear the impossible bosses solo.',                  cost:1500,                               nameStyle:'color:#5a9ad6' },
    { id:'t_old_guard',    cat:'titles', tier:'rar', name:'Old Guard',             desc:'Pre-launch members only. Pillars of the early Hub.',                  cost:0,    owned:true,                   nameStyle:'color:#5a9ad6' },
    { id:'t_patient',      cat:'titles', tier:'rar', name:'The Patient One',       desc:'Awarded to players with 500+ hours across any server.',               cost:1800,                               nameStyle:'color:#5a9ad6' },
    { id:'t_slayer',       cat:'titles', tier:'rar', name:'Slayer of Kings',       desc:"Earn three GWD-tier kills and you've earned this title.",             cost:4000,                               nameStyle:'color:#5a9ad6' },
    { id:'t_voidwalker',   cat:'titles', tier:'epi', name:'Voidwalker',            desc:'Beat the void content on five servers. No shortcuts, no help.',       cost:5000,                               nameStyle:'background:linear-gradient(90deg,#a55ad6,#d65aa5);-webkit-background-clip:text;background-clip:text;color:transparent' },
    { id:'t_firstborn',    cat:'titles', tier:'leg', name:'Firstborn',             desc:'First 100 Hub members to hit Hub Level 99. No reprints.',             cost:10000, requirement:'Req. Hub Lv 99', nameStyle:'background:linear-gradient(90deg,#ffd070,#ff7030,#ffd070);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:0 0 8px rgba(255,160,40,0.5)' },
    { id:'t_eternal',      cat:'titles', tier:'leg', name:'Eternal',               desc:"For the ones who never log out. Top of the leaderboard, forever.",    cost:12000,                              nameStyle:'color:#ffd070;text-shadow:0 0 8px rgba(255,160,40,0.6)' },

    // ── NAME COLORS ───────────────────────────────────────────────────────
    { id:'c_tide_pool',    cat:'colors', tier:'rar', name:'Tide Pool',             desc:'A name color that flows from cool blue into deep amethyst.',         cost:2000,                                nameStyle:'background:linear-gradient(90deg,#5a9ad6,#a55ad6);-webkit-background-clip:text;background-clip:text;color:transparent' },
    { id:'c_ember',        cat:'colors', tier:'rar', name:'Ember',                 desc:'Burnt orange to deep red, like cooling lava.',                       cost:2200,                                nameStyle:'background:linear-gradient(90deg,#ffa050,#d04010);-webkit-background-clip:text;background-clip:text;color:transparent' },
    { id:'c_forest',       cat:'colors', tier:'com', name:'Forest',                desc:'Deep green. Quiet, patient, rooted.',                                cost:600,                                 nameStyle:'color:#5fa05f' },
    { id:'c_frost',        cat:'colors', tier:'com', name:'Frost',                 desc:'Pale ice blue with a faint shimmer.',                                cost:700,                                 nameStyle:'color:#9ad0e8' },
    { id:'c_shadow',       cat:'colors', tier:'epi', name:'Shadowflame',           desc:'Pulsing purple-to-black gradient, animated.',                        cost:5500,                                nameStyle:'background:linear-gradient(90deg,#a55ad6,#1a0a30);-webkit-background-clip:text;background-clip:text;color:transparent' },

    // ── BORDERS ───────────────────────────────────────────────────────────
    { id:'b_stone',        cat:'borders', tier:'com', name:'Stone Ring',           desc:'A simple stone ring that frames your avatar.',                       cost:600,    avBorder:'#a89878' },
    { id:'b_bronze',       cat:'borders', tier:'com', name:'Bronze Ring',          desc:'Warm bronze with hammered detailing.',                               cost:800,    avBorder:'#b07030' },
    { id:'b_tidebound',    cat:'borders', tier:'rar', name:'Tidebound Ring',       desc:'An animated blue glow that frames your avatar everywhere.',          cost:2400,   avBorder:'#5a9ad6', avGlow:'0 0 12px rgba(90,154,214,0.6)' },
    { id:'b_voidring',     cat:'borders', tier:'epi', name:'Voidring',             desc:'Dark purple aura. Pulses faintly when you take damage.',             cost:4500,   avBorder:'#a55ad6', avGlow:'0 0 14px rgba(165,90,214,0.6)' },
    { id:'b_inferno',      cat:'borders', tier:'leg', name:'Inferno Crown',        desc:'A blazing animated halo. No reprints, no exceptions.',               cost:8000,   avBorder:'#ffd070', avGlow:'0 0 22px #ffd070, inset 0 0 12px rgba(255,208,112,0.4)' },

    // ── PROFILE EFFECTS ────────────────────────────────────────────────────
    { id:'e_warm_glow',    cat:'effects', tier:'com', name:'Warm Glow',            desc:'A soft golden halo around your profile. Subtle, classy.',            cost:1200,   fx:'glow' },
    { id:'e_shimmer',      cat:'effects', tier:'com', name:'Shimmer Sweep',        desc:'A gold light sweeps across your card every few seconds.',            cost:1000,   fx:'shimmer' },
    { id:'e_sparkles',     cat:'effects', tier:'epi', name:'Golden Sparkles',      desc:'Shimmering motes of gold rise quietly from the bottom of your card.',cost:4000,   fx:'sparkles' },
    { id:'e_petals',       cat:'effects', tier:'epi', name:'Cherry Blossom',       desc:'Pink petals drift down across your profile, soft and slow.',         cost:4500,   fx:'petals' },
    { id:'e_embers',       cat:'effects', tier:'epi', name:'Ember Rise',           desc:'Glowing embers float up from beneath your card.',                    cost:4200,   fx:'embers' },
    { id:'e_snow',         cat:'effects', tier:'epi', name:'Winterfall',           desc:'Soft snow drifts across your card with a faint blue glow.',          cost:3800,   fx:'snow' },
    { id:'e_confetti',     cat:'effects', tier:'epi', name:'Celebration',          desc:"A constant party. Multi-color confetti rains across your card.",     cost:4000,   fx:'confetti' },
    { id:'e_prism',        cat:'effects', tier:'leg', name:'Prism Aura',           desc:'A slow-shifting rainbow halo bathes your profile in color.',         cost:8500,   fx:'prism' },
    { id:'e_hearts',       cat:'effects', tier:'leg', name:'Heart Shower',         desc:'Pink hearts cascade across your card. Wear it without irony.',       cost:7500,   fx:'hearts' },

    // ── BACKGROUNDS / BADGES — placeholder, can grow ──────────────────────
    // Keeping these short; grow as we build assets.
  ];

  // Normalise a raw API item into the shape our renderers use. The PHP
  // response uses `category` and nests cosmetic-specific fields under
  // `style`; the renderers were written before the API existed and use
  // `cat` + flat fields. This bridges the two without rewriting renderers.
  function normaliseItem(raw) {
    const style = raw.style || {};
    return {
      id:          raw.id,
      cat:         raw.category || raw.cat,
      tier:        raw.tier,
      name:        raw.name,
      desc:        raw.description || raw.desc || '',
      cost:        Number(raw.cost) || 0,
      requirement: raw.requirement || null,
      owned:       !!raw.owned,
      equipped:    !!raw.equipped,
      stockLimit:     (raw.stock_limit     != null) ? Number(raw.stock_limit)     : null,
      stockRemaining: (raw.stock_remaining != null) ? Number(raw.stock_remaining) : null,
      nameStyle:   style.nameStyle || raw.nameStyle || '',
      avBorder:    style.avBorder  || raw.avBorder  || '',
      avGlow:      style.avGlow    || raw.avGlow    || '',
      fx:          style.fx        || raw.fx        || '',
      borderType:  style.borderType || raw.borderType || '',
      // Per-letter name colours (Bouncing Letters, Letter Wave, Domino
      // Flip, etc). When splitLetters is true, the renderer wraps each
      // glyph in a span and applies `ncClass` to the parent so the
      // per-letter @keyframes can animate each child individually.
      splitLetters: !!(style.splitLetters || raw.splitLetters),
      ncClass:      style.ncClass || raw.ncClass || '',
      createdAt:    raw.created_at || raw.createdAt || '',
      featured:        !!(raw.featured),
      featuredTag:     raw.featured_tag || raw.featuredTag || '',
      featuredSubline: raw.featured_subline || raw.featuredSubline || '',
      // Launcher theme palette — used by .cat='themes' items. Renders as
      // a mini-chrome preview in the tile and gets handed to applyTheme()
      // when the user equips the theme.
      palette:      style.palette || null,
      // Optional SVG / animated overlay packaged with the theme. Legendary
      // themes use these for centerpiece spectacles (Astrolabe, Forge, etc.)
      overlayHtml:  style.overlayHtml || '',
      overlayCss:   style.overlayCss  || '',
    };
  }

  // Try the live API first; on any failure fall back to the local catalog.
  async function loadCatalog() {
    try {
      const data = await window.hub.get('/api/store/list');
      const items = (data && data.items) ? data.items : [];
      if (Array.isArray(items) && items.length) {
        catalog = items.map(normaliseItem);
        publishCatalog();
        applyEquippedThemeOnLoad();
        return;
      }
    } catch (e) {
      console.warn('[hubstore] /api/store/list failed, using fallback catalog:', e);
    }
    catalog = FALLBACK_CATALOG_RAW.map(normaliseItem);
    publishCatalog();
    injectAllThemeOverlayCss();
  }

  // After every catalog load, look up the user's equipped theme item
  // and paint its palette. Survives launcher restarts without needing a
  // separate user-state fetch (the catalog already carries equipped flags
  // for the logged-in user via /api/store/list joining user_equipped).
  // Inject every theme's overlayCss into ONE global <style id="hs-theme-overlay-css">
  // so the mini-previews (which use the same SVG class names like .t-astro-outer)
  // animate in the store tiles. Idempotent — replaces on each catalog load.
  function injectAllThemeOverlayCss() {
    // Overlays disabled — banners are the art. Wipe any previously-injected
    // overlay CSS so leftover animations don't keep running.
    let css = '';
    let tag = document.getElementById('hs-theme-overlay-css');
    if (!tag) {
      tag = document.createElement('style');
      tag.id = 'hs-theme-overlay-css';
      document.head.appendChild(tag);
    }
    tag.textContent = css;
  }

  function applyEquippedThemeOnLoad() {
    injectAllThemeOverlayCss();
    const t = catalog.find(i => i.cat === 'themes' && i.equipped);
    if (t?.palette && typeof window.applyTheme === 'function') {
      window.applyTheme(t.palette, t.overlayHtml, t.overlayCss);
    } else if (typeof window.clearTheme === 'function') {
      window.clearTheme();
    }
  }

  // Expose the catalog as a global lookup table so other modules (notably
  // stats.js's Coin Activity formatter) can resolve "Bought: c_frost" into
  // the real item name "Frost". Keyed by item id for O(1) lookup.
  function publishCatalog() {
    const map = {};
    catalog.forEach(i => { map[i.id] = i; });
    window.HUB_STORE_CATALOG    = catalog;
    window.HUB_STORE_BY_ID      = map;
    // Human-readable category labels for activity feed: "Frost (Name Color)"
    window.HUB_STORE_CAT_LABEL  = {
      titles: 'Title',
      colors: 'Name Color',
      borders: 'Avatar Border',
      effects: 'Profile Effect',
      backgrounds: 'Background',
    };
  }

  // Categories with icons + display names
  const CATEGORIES = [
    { id:'all',     ico:'★',  name:'All',             titleHdr:'EVERYTHING',         titleSub:'The full Hub Store catalogue.' },
    { id:'titles',  ico:'🏷️', name:'Titles',          titleHdr:'TITLES',             titleSub:'Words you wear. Show up next to your name everywhere in the Hub.' },
    { id:'colors',  ico:'🎨', name:'Name Colors',     titleHdr:'NAME COLORS',        titleSub:'Recolour your name across the launcher. Subtle or loud.' },
    { id:'borders', ico:'⭕', name:'Avatar Borders',  titleHdr:'AVATAR BORDERS',     titleSub:'Frame your face. From quiet stone to legendary inferno.' },
    { id:'effects', ico:'✨', name:'Profile Effects', titleHdr:'PROFILE EFFECTS',    titleSub:'Animated overlays that play on your profile card. The flex tier.' },
    { id:'themes',  ico:'🎭', name:'Launcher Themes', titleHdr:'LAUNCHER THEMES',    titleSub:'Repaint the entire launcher. Background, sidebars, top bar, accent.' },
  ];

  // Tier display order + label
  const TIER_ORDER = ['com', 'rar', 'epi', 'leg'];
  const TIER_LABELS = { com:'COMMON', rar:'RARE', epi:'EPIC', leg:'LEGENDARY' };

  // Featured items rotate through these — flagship, animated, glossy.
  // `subline` is now a function that derives text from the live item state
  // (stock_remaining / stock_limit). Falls back to a static descriptor when
  // the item isn't a limited run.
  // FEATURED is driven entirely by the DB. If nothing is flagged
  // featured=1, the carousel hides — no default fallback. Staff toggle
  // items via the inline ☆ Feature button on each tile.
  function buildFeatured() {
    return catalog.filter(i => i.featured).map(i => ({
      id:      i.id,
      tag:     i.featuredTag || '★ FEATURED',
      subline: stockSubline(i.featuredSubline || i.desc || ''),
    }));
  }

  // Returns a function(item) that formats the subline. Limited items get
  // "X of Y remaining" with sold-out detection; unlimited items fall back
  // to the descriptive default text.
  function stockSubline(defaultText) {
    return function (item) {
      if (item && item.stockLimit != null) {
        const left = item.stockRemaining;
        if (left <= 0) return 'SOLD OUT — no reprints';
        return `${left.toLocaleString()} of ${item.stockLimit.toLocaleString()} remaining`;
      }
      return defaultText;
    };
  }
  let featuredIdx = 0;

  // Active filter state (session-only, resets on tab switch)
  let activeCat = 'all';
  let activeFilter = 'all'; // all / owned / equipped / affordable
  let activeSort = 'tier';  // tier (cheap-to-pricey within each tier) | recent (newest first, flat list)

  // ── Renderers ─────────────────────────────────────────────────────────────

  function renderFeatured() {
    const FEATURED = buildFeatured();
    if (FEATURED.length === 0) return '';
    const f = FEATURED[featuredIdx % FEATURED.length];
    const item = catalog.find(i => i.id === f.id) || catalog[0];
    const ownedTag = item.equipped ? 'EQUIPPED' : (item.owned ? 'OWNED' : '');
    // Resolve the subline lazily so live stock numbers always reflect the
    // catalog's most recent fetch (after a buy, the catalog is mutated and
    // the next render shows the decremented count).
    const subline = (typeof f.subline === 'function') ? f.subline(item) : f.subline;

    // Reuse the same renderTileArt the store grid uses, so the hero shows
    // the FULL preview — animated effects with bg, borders with their cage
    // (lightning bolts / petals / runes / spikes), name colours with the
    // styled name. Wrapped in .hs-featured-art-big to scale it up.
    const heroArt = `<div class="hs-featured-art-big">${renderTileArt(item)}</div>`;

    return `
      <div class="hs-featured">
        <div class="hs-featured-art">${heroArt}</div>
        <div class="hs-featured-info">
          <div class="hs-featured-tag">${esc(f.tag)}</div>
          <div class="hs-featured-name">${esc(item.name.toUpperCase())}</div>
          <div class="hs-featured-desc">${esc(item.desc)}</div>
          <div class="hs-featured-foot">
            <div class="hs-featured-cost">${coinSvg(28)} ${item.cost.toLocaleString()}</div>
            <button class="hs-btn-preview" data-preview-id="${esc(item.id)}">PREVIEW</button>
            <button class="hs-btn-buy" data-buy-id="${esc(item.id)}">${ownedTag === 'OWNED' ? 'EQUIP' : ownedTag === 'EQUIPPED' ? 'UNEQUIP' : 'CLAIM NOW'}</button>
            <div class="hs-featured-stock">${esc(subline)}</div>
          </div>
        </div>
      </div>
      <div class="hs-dots">
        ${FEATURED.map((_, i) => `<div class="hs-dot ${i === featuredIdx % FEATURED.length ? 'active' : ''}" data-feat="${i}"></div>`).join('')}
      </div>`;
  }

  function fxLayerHTML(fx) {
    // Each effect is a stack of 5–8 spans the CSS animates. Snow has slight
    // sideways drift baked in via an extra inline-delay so neighbouring
    // sample cards don't tick in lockstep.
    if (fx === 'sparkles')
      return `<div class="hs-fx-layer hs-fx-sparkles">${'<span></span>'.repeat(8).split('<span>').map((_,i) => i ? `<span style="left:${i*12}%;animation-duration:${3+i*0.2}s;animation-delay:${i*0.3}s"></span>` : '').join('')}</div>`;
    if (fx === 'petals')
      return `<div class="hs-fx-layer hs-fx-petals">${[8,25,45,62,80,90].map((l,i) => `<span style="left:${l}%;animation-duration:${5+i*0.3}s;animation-delay:${i*0.5}s">🌸</span>`).join('')}</div>`;
    if (fx === 'embers')
      return `<div class="hs-fx-layer hs-fx-embers">${[10,25,40,55,70,85,95].map((l,i) => `<span style="left:${l}%;animation-duration:${2.5+i*0.15}s;animation-delay:${i*0.3}s"></span>`).join('')}</div>`;
    if (fx === 'snow')
      return `<div class="hs-fx-layer hs-fx-snow">${[5,18,35,48,62,78,90].map((l,i) => `<span style="left:${l}%;animation-duration:${5.5+i*0.25}s;animation-delay:${i*0.4}s"></span>`).join('')}</div>`;
    if (fx === 'prism')
      return `<div class="hs-fx-layer hs-fx-prism"></div>`;
    if (fx === 'confetti') {
      const colors = ['#ff5050','#50c8ff','#ffd050','#a855d6','#50d050','#ff80c0','#80d8ff'];
      return `<div class="hs-fx-layer hs-fx-confetti">${colors.map((c,i) => `<span style="left:${i*14+5}%;background:${c};animation-duration:${4+i*0.15}s;animation-delay:${i*0.3}s"></span>`).join('')}</div>`;
    }
    if (fx === 'hearts')
      return `<div class="hs-fx-layer hs-fx-hearts">${[10,30,50,70,88].map((l,i) => `<span style="left:${l}%;animation-duration:${5+i*0.3}s;animation-delay:${i*0.5}s">💗</span>`).join('')}</div>`;
    if (fx === 'glow')
      return `<div class="hs-fx-layer hs-fx-glow"></div>`;
    if (fx === 'shimmer')
      return `<div class="hs-fx-layer hs-fx-shimmer"></div>`;
    // ── Round 2 effects ─────────────────────────────────────────────
    // Pure-aura effects (no particles) — just the class on an empty layer.
    if (fx === 'radiation' || fx === 'holy_light' || fx === 'cyber_glitch' ||
        fx === 'toxic_smoke' || fx === 'twinkling' || fx === 'radiant_halo')
      return `<div class="hs-fx-layer hs-fx-${fx}"></div>`;
    // Particle effects — stagger position + duration + delay per span.
    if (fx === 'lightning')
      return `<div class="hs-fx-layer hs-fx-lightning">${[22,48,70,88].map((l,i) => `<span style="left:${l}%;height:${50+i*15}vh;animation-duration:${3+i*0.6}s;animation-delay:${i*0.7}s"></span>`).join('')}</div>`;
    if (fx === 'matrix') {
      const chars = ['0','1','｜','ﾊ','ﾐ','ﾌ','ｦ','ｱ','ｴ','ｵ','ﾑ','ﾒ','*','#'];
      let out = '';
      for (let i = 0; i < 14; i++) {
        const ch = chars[Math.floor(Math.random()*chars.length)];
        out += `<span style="left:${i*7+2}%;animation-duration:${5+Math.random()*4}s;animation-delay:${Math.random()*5}s">${ch}</span>`;
      }
      return `<div class="hs-fx-layer hs-fx-matrix">${out}</div>`;
    }
    if (fx === 'fireflies') {
      let out = '';
      for (let i = 0; i < 10; i++) out += `<span style="left:${i*10+5}%;animation-duration:${5+i*0.4}s;animation-delay:${i*0.6}s"></span>`;
      return `<div class="hs-fx-layer hs-fx-fireflies">${out}</div>`;
    }
    if (fx === 'bubbles') {
      const sizes = [10,14,8,16,12,18,10,14];
      let out = '';
      for (let i = 0; i < 8; i++) out += `<span style="left:${i*12+4}%;width:${sizes[i]}px;height:${sizes[i]}px;animation-duration:${6+i*0.5}s;animation-delay:${i*0.7}s"></span>`;
      return `<div class="hs-fx-layer hs-fx-bubbles">${out}</div>`;
    }
    if (fx === 'leaves') {
      const e = ['🍂','🍁','🍂','🍁','🍂'];
      return `<div class="hs-fx-layer hs-fx-leaves">${e.map((x,i) => `<span style="left:${i*22+5}%;animation-duration:${6+i*0.5}s;animation-delay:${i*0.8}s">${x}</span>`).join('')}</div>`;
    }
    if (fx === 'diamond_dust') {
      let out = '';
      for (let i = 0; i < 25; i++) {
        out += `<span style="left:${(Math.random()*100).toFixed(1)}%;top:${(Math.random()*100).toFixed(1)}%;animation-duration:${1.5+Math.random()*2}s;animation-delay:${Math.random()*3}s"></span>`;
      }
      return `<div class="hs-fx-layer hs-fx-diamond_dust">${out}</div>`;
    }
    if (fx === 'lava_bubbles') {
      let out = '';
      for (let i = 0; i < 8; i++) out += `<span style="left:${i*12+4}%;animation-duration:${5+i*0.4}s;animation-delay:${i*0.6}s"></span>`;
      return `<div class="hs-fx-layer hs-fx-lava_bubbles">${out}</div>`;
    }
    if (fx === 'ghost_wisps')
      return `<div class="hs-fx-layer hs-fx-ghost_wisps">${[20,45,70].map((t,i) => `<span style="top:${t}%;animation-duration:${10+i*2}s;animation-delay:${i*3}s">👻</span>`).join('')}</div>`;
    if (fx === 'bat_flock')
      return `<div class="hs-fx-layer hs-fx-bat_flock">${[15,37,60,82].map((t,i) => `<span style="top:${t}%;animation-duration:${6+i*0.8}s;animation-delay:${i*1.2}s">🦇</span>`).join('')}</div>`;
    // ── v3 particle effects — real spans with negative delays so they
    //    appear instantly mid-animation, not after a slow fade-in.
    if (fx === 'confetti_v3') {
      const colors = ['#ff3080','#30c0ff','#ffd030','#50ff80','#c050ff','#ff8040','#80c0ff','#ff60c0'];
      let out = '';
      for (let i = 0; i < 35; i++) {
        const x = (Math.random()*100).toFixed(1);
        const c = colors[i % colors.length];
        const dur = (2.5+Math.random()*2.5).toFixed(2);
        const delay = (-Math.random()*5).toFixed(2);
        const rot = Math.floor(Math.random()*360);
        out += `<span style="left:${x}%;background:${c};animation-duration:${dur}s;animation-delay:${delay}s;--r:${rot}deg"></span>`;
      }
      return `<div class="hs-fx-layer hs-fx-confetti_v3">${out}</div>`;
    }
    if (fx === 'cherry_storm_v3') {
      let out = '';
      for (let i = 0; i < 24; i++) {
        const x = (Math.random()*100).toFixed(1);
        const dur = (3+Math.random()*3).toFixed(2);
        const delay = (-Math.random()*6).toFixed(2);
        out += `<span style="left:${x}%;animation-duration:${dur}s;animation-delay:${delay}s">🌸</span>`;
      }
      return `<div class="hs-fx-layer hs-fx-cherry_storm_v3">${out}</div>`;
    }
    if (fx === 'deepsea_bubbles_v3') {
      let out = '';
      for (let i = 0; i < 28; i++) {
        const x = (Math.random()*100).toFixed(1);
        const sz = 4+Math.floor(Math.random()*10);
        const dur = (3+Math.random()*3).toFixed(2);
        const delay = (-Math.random()*6).toFixed(2);
        out += `<span style="left:${x}%;width:${sz}px;height:${sz}px;animation-duration:${dur}s;animation-delay:${delay}s"></span>`;
      }
      return `<div class="hs-fx-layer hs-fx-deepsea_bubbles_v3">${out}</div>`;
    }
    if (fx === 'snowglobe_v3') {
      let out = '';
      for (let i = 0; i < 30; i++) {
        const x = (Math.random()*100).toFixed(1);
        const dur = (3+Math.random()*4).toFixed(2);
        const delay = (-Math.random()*7).toFixed(2);
        const sz = 2+Math.floor(Math.random()*4);
        out += `<span style="left:${x}%;width:${sz}px;height:${sz}px;animation-duration:${dur}s;animation-delay:${delay}s"></span>`;
      }
      return `<div class="hs-fx-layer hs-fx-snowglobe_v3">${out}</div>`;
    }
    if (fx === 'galaxy_drift_v3') {
      const cols = ['#fff','#fff','#c0a0ff','#80c0ff','#ffe0b0','#fff'];
      let out = '';
      for (let i = 0; i < 40; i++) {
        const x = (Math.random()*100).toFixed(1);
        const y = (Math.random()*100).toFixed(1);
        const sz = 1+Math.floor(Math.random()*3);
        const dur = (1.5+Math.random()*2.5).toFixed(2);
        const delay = (-Math.random()*4).toFixed(2);
        out += `<span style="left:${x}%;top:${y}%;width:${sz}px;height:${sz}px;background:${cols[i%cols.length]};animation-duration:${dur}s;animation-delay:${delay}s"></span>`;
      }
      return `<div class="hs-fx-layer hs-fx-galaxy_drift_v3">${out}</div>`;
    }
    if (fx === 'constellation_v3') {
      // 12 stars at preset positions + 8 connecting lines
      const stars = [
        [20,15,-0.2],[35,30,-0.8],[25,50,-1.2],[50,65,-0.6],
        [40,80,-1.5],[65,20,-1.0],[75,42,-0.4],[80,60,-1.8],
        [60,85,-0.9],[15,75,-1.3],[55,10,-0.5],[90,30,-1.6],
      ];
      const lines = [
        [21,15,18,40,-0.5],[35,30,22,-22,-1.2],[25,50,18,60,-2.0],
        [50,65,18,-25,-0.8],[65,20,25,15,-1.5],[75,42,22,8,-2.2],
        [55,10,18,50,-1.0],[60,85,14,-110,-1.7],
      ];
      let out = '';
      for (const [t,l,d] of stars)
        out += `<span class="star" style="top:${t}%;left:${l}%;animation-delay:${d}s"></span>`;
      for (const [t,l,w,r,d] of lines)
        out += `<span class="line" style="top:${t}%;left:${l}%;width:${w}%;transform:rotate(${r}deg);animation-delay:${d}s"></span>`;
      return `<div class="hs-fx-layer hs-fx-constellation_v3">${out}</div>`;
    }
    if (fx === 'zarosian_void_v3') {
      const runes = [
        [18,18,-0.5,'Z',22],[30,78,-1.5,'⏣',18],
        [62,12,-2.5,'Z',22],[75,70,-1.0,'⏣',16],
        [48,50,-3.0,'Ƶ',28],
      ];
      const r = runes.map(([t,l,d,ch,sz]) =>
        `<span class="rune" style="top:${t}%;left:${l}%;animation-delay:${d}s;font-size:${sz}px">${ch}</span>`
      ).join('');
      return `<div class="hs-fx-layer hs-fx-zarosian_void_v3">${r}</div>`;
    }
    // Generic fallback — pure-CSS background effects (v3 reworks etc.)
    // need no particle spans, just the class on an empty layer.
    if (fx) return `<div class="hs-fx-layer hs-fx-${fx}"></div>`;
    return '';
  }

  function renderTileArt(item) {
    if (item.cat === 'themes') {
      // Mini-chrome preview: 3 stacked bars + a body fill, painted with
      // the theme's actual palette. Reads at-a-glance what swapping to
      // this theme would look like.
      const p = item.palette || {};
      const bg = p.bgColor || '#0d0a06';
      const titlebar = p.titlebarBg || '#1a1610';
      const sidebar = p.sidebarBg || 'linear-gradient(180deg, #241e12, #1a1610)';
      const accent = p.accent || '#c8a840';
      const accentHot = p.accentHot || '#ffd070';
      const border = p.sidebarBorder || '#5a4828';
      // Hand-rolled SVG-free preview: outer card = body bg, top strip =
      // titlebar, left strip = sidebar, accent dot for the active tab,
      // brighter accent badge bottom-right.
      // Overlay SVGs disabled — banner images now carry the art alone.
      const overlay = '';
      // Optional center image (Gemini/MJ banner). Painted under the overlay.
      // Centre-image URL is `url("https://...")` with double quotes inside —
      // strip them so they don't break the outer style="" attribute, then
      // re-wrap with single quotes inside url().
      let ci = '';
      if (p.centerImage) {
        const m = String(p.centerImage).match(/url\(\s*["']?([^"')]+)["']?\s*\)/);
        const src = m ? m[1] : p.centerImage;
        const filt = esc(p.centerImageFilter || 'brightness(0.9)');
        ci = `<div class="hs-theme-center-img" style="background-image:url('${esc(src)}');filter:${filt}"></div>`;
      }
      const hasBannerCls = ci ? ' has-banner' : '';
      return `
        <div class="hs-theme-preview${hasBannerCls}" style="background:${esc(bg)};border-color:${esc(border)}">
          ${ci}
          ${overlay}
          <div class="hs-theme-titlebar" style="background:${esc(titlebar)}"></div>
          <div class="hs-theme-body">
            <div class="hs-theme-sidebar" style="background:${esc(sidebar)};border-right-color:${esc(border)}">
              <span class="hs-theme-pip" style="background:${esc(accentHot)}"></span>
              <span class="hs-theme-pip dim" style="background:${esc(accent)}"></span>
              <span class="hs-theme-pip dim" style="background:${esc(accent)}"></span>
            </div>
            <div class="hs-theme-content">
              <div class="hs-theme-line" style="background:${esc(accentHot)};width:55%"></div>
              <div class="hs-theme-line" style="background:${esc(accent)};width:35%;opacity:0.5"></div>
              <div class="hs-theme-line" style="background:${esc(accent)};width:40%;opacity:0.4"></div>
            </div>
          </div>
        </div>`;
    }
    if (item.cat === 'effects') {
      // For effects: a live-animated mini profile card with the user's
      // real avatar so they see themselves in the preview.
      // Show the user's REAL equipped title in the mini preview (was
      // hardcoded "The Wanderer" — looked weird when the user had a
      // different title equipped). Falls back to nothing if untitled.
      const equippedTitle = catalog.find(i => i.cat === 'titles' && i.equipped);
      const titleText     = equippedTitle ? equippedTitle.name : '';
      const titleStyle    = equippedTitle?.nameStyle ? ` style="${esc(equippedTitle.nameStyle)}"` : '';
      return `
        <div class="hs-fx-preview">
          ${fxLayerHTML(item.fx)}
          <div class="hs-fx-card">
            <div class="hs-fx-av">${meAvatarHTML()}</div>
            <div class="hs-fx-info">
              <div class="nm">${esc(window.state?.user?.username || 'You')}</div>
              ${titleText ? `<div class="ttl"${titleStyle}>${esc(titleText)}</div>` : ''}
            </div>
          </div>
        </div>`;
    }
    if (item.cat === 'borders') {
      // Borders may render an extra cage of animated spans behind the
      // avatar (laser spikes, lightning, orbiting stars, etc). Mapped
      // by `borderType` to a shared HTML builder.
      const cage = borderCageHTML(item.borderType);
      return `<div class="hs-tile-art"><div class="hs-av-frame">
        ${cage}
        <div class="av" style="border:3px solid ${item.avBorder || '#a89878'};${item.avGlow ? `box-shadow:${item.avGlow}` : ''}">${meAvatarHTML()}</div>
      </div></div>`;
    }
    // Titles + name colors render the styled name in the art slot.
    // Per-letter colour items (Bouncing Letters, Domino Flip, etc) need
    // each glyph wrapped in its own span so the per-letter @keyframes
    // can animate them; single-element items just take the inline
    // nameStyle CSS.
    if (item.cat === 'colors' && item.splitLetters && item.ncClass) {
      const letters = String(item.name || '').split('').map(ch =>
        `<span>${esc(ch)}</span>`
      ).join('');
      return `<div class="hs-tile-art"><div class="name ${esc(item.ncClass)}" style="display:inline-block">${letters}</div></div>`;
    }
    return `<div class="hs-tile-art"><div class="name" style="${item.nameStyle || 'color:#a89878'}">${esc(item.name)}</div></div>`;
  }

  function renderTile(item) {
    const tierClass = item.tier === 'leg' ? 'legendary' : '';
    const eqClass   = item.equipped ? 'equipped' : '';
    const flare     = item.equipped ? `<div class="hs-equipped-flare">EQUIPPED</div>` : '';

    let costHTML;
    let buttonHTML;
    if (item.equipped) {
      costHTML  = `<div class="hs-tile-cost own">OWNED</div>`;
      buttonHTML = `<button class="hs-rs-btn" data-action="unequip" data-id="${esc(item.id)}">UNEQUIP</button>`;
    } else if (item.owned) {
      costHTML  = `<div class="hs-tile-cost own">OWNED</div>`;
      buttonHTML = `<button class="hs-rs-btn equip" data-action="equip" data-id="${esc(item.id)}">EQUIP</button>`;
    } else {
      const balance = window.state?.coins?.balance ?? 0;
      const canAfford = balance >= item.cost && !item.requirement;
      const costClass = canAfford ? '' : 'no';
      costHTML = `<div class="hs-tile-cost ${costClass}">${coinSvg(18)} ${item.cost.toLocaleString()}</div>`;
      if (item.requirement) {
        buttonHTML = `<button class="hs-rs-btn locked" disabled>${esc(item.requirement.toUpperCase())}</button>`;
      } else if (!canAfford) {
        const need = item.cost - balance;
        buttonHTML = `<button class="hs-rs-btn locked" disabled>NEED ${need.toLocaleString()}</button>`;
      } else {
        buttonHTML = `<button class="hs-rs-btn" data-action="buy" data-id="${esc(item.id)}">BUY</button>`;
      }
    }

    // Staff get an inline "Feature" toggle on each tile so they can pick
    // what shows in the carousel without leaving the store.
    const isStaff = !!(window.state?.user?.is_staff || window.state?.user?.isStaff);
    const featBtn = isStaff
      ? `<button class="hs-feat-btn ${item.featured ? 'on' : ''}" data-feat-toggle="${esc(item.id)}" title="${item.featured ? 'Un-feature' : 'Feature this item'}">${item.featured ? '★ FEATURED' : '☆ Feature'}</button>`
      : '';

    return `
      <div class="hs-tile ${tierClass} ${eqClass}" data-item-id="${esc(item.id)}">
        ${flare}
        ${featBtn}
        <span class="hs-tile-tier hs-tier-${item.tier}">${TIER_LABELS[item.tier]}</span>
        ${renderTileArt(item)}
        <div class="hs-tile-name">${esc(item.name)}</div>
        <div class="hs-tile-desc">${esc(item.desc)}</div>
        <div class="hs-tile-foot">
          ${costHTML}
          ${buttonHTML}
        </div>
      </div>`;
  }

  function applyFilters(items) {
    if (activeFilter === 'owned')      return items.filter(i => i.owned);
    if (activeFilter === 'equipped')   return items.filter(i => i.equipped);
    if (activeFilter === 'affordable') {
      const bal = window.state?.coins?.balance ?? 0;
      return items.filter(i => !i.owned && !i.requirement && i.cost <= bal);
    }
    return items;
  }

  function renderMain() {
    const cat = CATEGORIES.find(c => c.id === activeCat) || CATEGORIES[0];
    let items = activeCat === 'all' ? catalog : catalog.filter(i => i.cat === activeCat);
    items = applyFilters(items);

    if (!items.length) {
      return `
        <div class="hs-main-hdr">
          <div><h3>${esc(cat.titleHdr)}</h3><p>${esc(cat.titleSub)}</p></div>
        </div>
        <div class="hs-empty">Nothing matches this filter. Try "All" or change category.</div>`;
    }

    // ── Sort modes ────────────────────────────────────────
    //   'tier'   = group by tier, ascending cost within (default)
    //   'recent' = flat list, newest createdAt first (or id if missing)
    const headerHtml = `
      <div class="hs-main-hdr">
        <div><h3>${esc(cat.titleHdr)}</h3><p>${esc(cat.titleSub)}</p></div>
        <div class="hs-filters">
          <div class="hs-chip ${activeSort === 'tier'   ? 'active' : ''}" data-sort="tier">By Tier</div>
          <div class="hs-chip ${activeSort === 'recent' ? 'active' : ''}" data-sort="recent">Recently Added</div>
        </div>
      </div>`;

    if (activeSort === 'recent') {
      // Flat list, newest first. Fall back to id sort if createdAt is empty.
      const sorted = [...items].sort((a, b) => {
        const ta = a.createdAt || '';
        const tb = b.createdAt || '';
        if (ta && tb) return tb.localeCompare(ta);
        if (ta) return -1;
        if (tb) return 1;
        return (b.id || '').localeCompare(a.id || '');
      });
      return `${headerHtml}
        <div class="hs-banner">
          <h3>✦ RECENTLY ADDED</h3>
          <span class="ct">${sorted.length} item${sorted.length === 1 ? '' : 's'}</span>
          <div class="deco"></div>
        </div>
        <div class="hs-grid">
          ${sorted.map(renderTile).join('')}
        </div>`;
    }

    // Default: group by tier, ascending cost within (server already returns
    // this order; we re-sort client-side as a safety net).
    const grouped = TIER_ORDER.map(t => ({
      tier: t,
      items: items.filter(i => i.tier === t).sort((a, b) => (a.cost || 0) - (b.cost || 0)),
    })).filter(g => g.items.length);

    return `${headerHtml}
      ${grouped.map(g => `
        <div class="hs-banner">
          <h3>★ ${TIER_LABELS[g.tier]}</h3>
          <span class="ct">${g.items.length} item${g.items.length === 1 ? '' : 's'}</span>
          <div class="deco"></div>
        </div>
        <div class="hs-grid">
          ${g.items.map(renderTile).join('')}
        </div>
      `).join('')}`;
  }

  function renderSidebar() {
    const counts = {};
    catalog.forEach(i => { counts[i.cat] = (counts[i.cat] || 0) + 1; });
    const ownedCount     = catalog.filter(i => i.owned).length;
    const equippedCount  = catalog.filter(i => i.equipped).length;
    const bal = window.state?.coins?.balance ?? 0;
    const affordableCount = catalog.filter(i => !i.owned && !i.requirement && i.cost <= bal).length;

    return `
      <aside class="hs-sb">
        <div class="hs-sb-section">
          <div class="hs-sb-title">BROWSE</div>
          ${CATEGORIES.map(c => `
            <div class="hs-sb-item ${c.id === activeCat ? 'active' : ''}" data-cat="${c.id}">
              <span class="ico">${c.ico}</span>
              ${esc(c.name)}
              <span class="ct">${c.id === 'all' ? catalog.length : (counts[c.id] || 0)}</span>
            </div>`).join('')}
        </div>
        <div class="hs-sb-section">
          <div class="hs-sb-title">FILTER</div>
          <div class="hs-sb-item ${activeFilter === 'owned'      ? 'active' : ''}" data-filter="owned">      <span class="ico">✓</span> Owned       <span class="ct">${ownedCount}</span></div>
          <div class="hs-sb-item ${activeFilter === 'equipped'   ? 'active' : ''}" data-filter="equipped">   <span class="ico">⚡</span> Equipped    <span class="ct">${equippedCount}</span></div>
          <div class="hs-sb-item ${activeFilter === 'affordable' ? 'active' : ''}" data-filter="affordable"> <span class="ico">💰</span> Affordable  <span class="ct">${affordableCount}</span></div>
        </div>
      </aside>`;
  }

  // ── Top-level render ──────────────────────────────────────────────────────
  window.renderHubStore = async function renderHubStore(el) {
    if (!el) el = document.getElementById('alt-content');
    if (!el) return;

    const balance = window.state?.coins?.balance ?? 0;

    // Show shell + loading state while the catalog fetches. Without this the
    // user clicks HUB STORE and sees a blank panel for a few hundred ms.
    el.innerHTML = `
      <div class="hs-root">
        <div class="hs-header">
          <h2>HUB STORE <small>Spend Hub Coins on cosmetics that show up everywhere</small></h2>
          <div class="hs-balance">
            ${coinSvg(22)}
            <b id="hs-bal-num">${balance.toLocaleString()}</b>
            <span class="lbl">COINS</span>
          </div>
        </div>
        <div class="hs-empty">Loading store…</div>
      </div>`;

    await loadCatalog();
    // Refresh balance from /api/coins/me too (in case the user just earned
    // coins from achievements before opening the store).
    try {
      const coinsData = await window.hub.get('/api/coins/me');
      if (coinsData && typeof coinsData.balance === 'number') {
        window.state.coins = window.state.coins || {};
        window.state.coins.balance = coinsData.balance;
      }
    } catch {}

    drawAll(el);

    // Auto-rotate the featured banner every 8s while the store tab is open.
    // Cleared when renderHubStore is called again or the tab changes.
    // CRITICAL: re-bind events after each rotation, otherwise the new
    // CLAIM NOW button has no click handler and the dot indicators go dead.
    if (window._hsFeatTimer) clearInterval(window._hsFeatTimer);
    window._hsFeatTimer = setInterval(() => {
      const featLen = buildFeatured().length || 1;
      featuredIdx = (featuredIdx + 1) % featLen;
      const slot = document.getElementById('hs-featured-slot');
      if (slot) {
        slot.innerHTML = renderFeatured();
        bindEvents(el);
      } else {
        clearInterval(window._hsFeatTimer); window._hsFeatTimer = null;
      }
    }, 8000);
  };

  // Re-renders the store layout from current state. Used after buy/equip/
  // unequip so flags + balance reflect the server's response.
  function drawAll(el) {
    const balance = window.state?.coins?.balance ?? 0;
    el.innerHTML = `
      <div class="hs-root">
        <div class="hs-header">
          <h2>HUB STORE <small>Spend Hub Coins on cosmetics that show up everywhere</small></h2>
          <div class="hs-balance">
            ${coinSvg(22)}
            <b id="hs-bal-num">${balance.toLocaleString()}</b>
            <span class="lbl">COINS</span>
          </div>
        </div>
        <div id="hs-featured-slot">${renderFeatured()}</div>
        <div class="hs-layout">
          <div id="hs-sidebar-slot">${renderSidebar()}</div>
          <div class="hs-main" id="hs-main-slot">${renderMain()}</div>
        </div>
      </div>`;
    bindEvents(el);
  }

  // Apply the server's response to local catalog so the next render reflects
  // the new owned/equipped state without a full refetch.
  function applyBuyResult(result) {
    if (!result || !result.success) return;
    const item = catalog.find(i => i.id === result.item_id);
    if (item) {
      item.owned = true;
      // Decrement live stock for limited items so the featured banner +
      // tile show "99 of 100 remaining" right away. Server is the source
      // of truth on next fetch; this is just a snappier UI.
      if (typeof item.stockRemaining === 'number') {
        item.stockRemaining = Math.max(0, item.stockRemaining - 1);
      }
    }
    if (typeof result.balance === 'number') {
      window.state.coins = window.state.coins || {};
      window.state.coins.balance = result.balance;
    }
  }
  function applyEquipResult(result) {
    if (!result || !result.success) return;
    const slot = result.slot;
    const newId = result.item_id;
    // Only one item per slot may be equipped — clear all in this slot first.
    const slotToCat = { title:'titles', color:'colors', border:'borders', effect:'effects', background:'backgrounds', theme:'themes' };
    const cat = slotToCat[slot] || null;
    catalog.forEach(i => {
      if ((cat && i.cat === cat) || (!cat && false)) i.equipped = (i.id === newId);
    });
  }
  function applyUnequipResult(result) {
    if (!result || !result.success) return;
    const slot = result.slot;
    const slotToCat = { title:'titles', color:'colors', border:'borders', effect:'effects', background:'backgrounds', theme:'themes' };
    const cat = slotToCat[slot] || null;
    if (cat) catalog.forEach(i => { if (i.cat === cat) i.equipped = false; });
  }

  function bindEvents(el) {
    // Sidebar category clicks
    el.querySelectorAll('.hs-sb-item[data-cat]').forEach(item => {
      item.addEventListener('click', () => {
        activeCat = item.dataset.cat;
        const main = document.getElementById('hs-main-slot');
        if (main) main.innerHTML = renderMain();
        document.getElementById('hs-sidebar-slot').innerHTML = renderSidebar();
        bindEvents(el); // re-bind after re-render
      });
    });

    // Sidebar filter clicks (toggle — click active to clear)
    el.querySelectorAll('.hs-sb-item[data-filter]').forEach(item => {
      item.addEventListener('click', () => {
        activeFilter = activeFilter === item.dataset.filter ? 'all' : item.dataset.filter;
        const main = document.getElementById('hs-main-slot');
        if (main) main.innerHTML = renderMain();
        document.getElementById('hs-sidebar-slot').innerHTML = renderSidebar();
        bindEvents(el);
      });
    });

    // Top-bar filter chips
    el.querySelectorAll('.hs-chip[data-filter]').forEach(chip => {
      chip.addEventListener('click', () => {
        activeFilter = chip.dataset.filter;
        const main = document.getElementById('hs-main-slot');
        if (main) main.innerHTML = renderMain();
        document.getElementById('hs-sidebar-slot').innerHTML = renderSidebar();
        bindEvents(el);
      });
    });

    // Top-bar sort chips (Tier vs Recently Added)
    el.querySelectorAll('.hs-chip[data-sort]').forEach(chip => {
      chip.addEventListener('click', () => {
        activeSort = chip.dataset.sort;
        const main = document.getElementById('hs-main-slot');
        if (main) main.innerHTML = renderMain();
        bindEvents(el);
      });
    });

    // Featured carousel dots
    el.querySelectorAll('.hs-dot[data-feat]').forEach(d => {
      d.addEventListener('click', () => {
        featuredIdx = parseInt(d.dataset.feat, 10) || 0;
        const slot = document.getElementById('hs-featured-slot');
        if (slot) slot.innerHTML = renderFeatured();
        bindEvents(el);
      });
    });

    // Buy / Equip / Unequip — live API
    el.querySelectorAll('.hs-rs-btn[data-action]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const item = catalog.find(i => i.id === id);
        if (!item || btn.disabled) return;
        await runAction(el, action, item, btn);
      });
    });

    // Staff "Feature this item" toggle. Uses sensible defaults — no
    // browser prompt() (Electron blocks it). Tag = "★ FEATURED · <TIER>",
    // subline = the item's description. Edit later via a future admin
    // panel if needed.
    el.querySelectorAll('[data-feat-toggle]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        e.preventDefault();
        const id = btn.dataset.featToggle;
        const item = catalog.find(i => i.id === id);
        if (!item) return;
        const turningOn = !item.featured;
        const tag = turningOn ? (item.featuredTag || '★ FEATURED') : '';
        const subline = turningOn
          ? (item.featuredSubline || item.desc || '')
          : '';
        // Optimistic UI — disable button while in flight
        btn.disabled = true;
        btn.textContent = '…';
        try {
          const res = await window.hub.post('/api/admin/store/feature', {
            item_id: id, featured: turningOn ? 1 : 0, tag, subline,
          });
          if (res && res.error) {
            alert('Feature failed: ' + res.error);
            btn.disabled = false;
            btn.textContent = item.featured ? '★ FEATURED' : '☆ Feature';
            return;
          }
          item.featured = !!turningOn;
          item.featuredTag = tag;
          item.featuredSubline = subline;
          const featSlot = document.getElementById('hs-featured-slot');
          if (featSlot) featSlot.innerHTML = renderFeatured();
          const main = document.getElementById('hs-main-slot');
          if (main) main.innerHTML = renderMain();
          bindEvents(el);
        } catch (err) {
          alert('Feature failed: ' + (err && err.message || err));
          btn.disabled = false;
          btn.textContent = item.featured ? '★ FEATURED' : '☆ Feature';
        }
      });
    });

    // Featured banner PREVIEW button — opens the same modal as clicking a tile
    el.querySelectorAll('.hs-btn-preview[data-preview-id]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.previewId;
        const item = catalog.find(i => i.id === id);
        if (item) openPreviewModal(item);
      });
    });

    // Featured banner CLAIM button — same as a tile button
    el.querySelectorAll('.hs-btn-buy[data-buy-id]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const id = btn.dataset.buyId;
        const item = catalog.find(i => i.id === id);
        if (!item || btn.disabled) return;
        // Featured button text decides whether this is buy / equip / unequip
        const action = item.equipped ? 'unequip' : (item.owned ? 'equip' : 'buy');
        await runAction(el, action, item, btn);
      });
    });

    // Tile CLICK (anywhere on the card except the action button) opens a
    // preview of the user's stats page with this item temporarily equipped.
    // Lets players see how a cosmetic actually looks before spending coins.
    el.querySelectorAll('.hs-tile').forEach(tile => {
      tile.addEventListener('click', e => {
        if (e.target.closest('.hs-rs-btn')) return;  // button click handled separately
        if (e.target.closest('.hs-feat-btn')) return;  // staff feature toggle
        const itemId = tile.dataset.itemId;
        if (!itemId) return;
        const item = catalog.find(i => i.id === itemId);
        if (item) openPreviewModal(item);
      });
    });
  }

  // Calls the backend, applies the result to local state, re-renders the
  // store, and shows a toast. Centralised so buy/equip/unequip share the
  // same failure-handling + UI-refresh path.
  async function runAction(el, action, item, btn) {
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = '...';
    try {
      let result;
      if (action === 'buy') {
        result = await window.hub.post('/api/store/buy', { item_id: item.id });
      } else if (action === 'equip') {
        result = await window.hub.post('/api/store/equip', { item_id: item.id });
      } else if (action === 'unequip') {
        result = await window.hub.post('/api/store/unequip', { item_id: item.id });
      }
      if (result && result.error) {
        toast(result.error, 'error');
        // Restore the button label + state immediately so it doesn't sit
        // stuck on "..." until the 8s rotation kicks in. Easy to trip on
        // a requirement-locked item like Firstborn (Req. Hub Lv 99).
        btn.disabled = false;
        btn.textContent = originalLabel;
        return;
      }
      if (action === 'buy')      { applyBuyResult(result);     toast(`Purchased "${item.name}" for ${item.cost.toLocaleString()} coins.`, 'success'); }
      if (action === 'equip')    { applyEquipResult(result);   toast(`Equipped "${item.name}".`, 'success'); }
      if (action === 'unequip')  { applyUnequipResult(result); toast(`Unequipped "${item.name}".`, 'info'); }
      // Themes need a live repaint of the launcher chrome on equip/unequip.
      if (item.cat === 'themes') {
        if (action === 'equip' && item.palette && typeof window.applyTheme === 'function') {
          window.applyTheme(item.palette, item.overlayHtml, item.overlayCss);
        } else if (action === 'unequip' && typeof window.clearTheme === 'function') {
          window.clearTheme();
        }
      }
      // Invalidate the stats cache so the next time the user opens their
      // stats modal it pulls fresh equipped data — without this the modal
      // shows cached "Title: None" even after a successful equip.
      if (window.DATA_CACHE && window.DATA_CACHE.stats) {
        window.DATA_CACHE.stats.data = null;
        window.DATA_CACHE.stats.at   = 0;
      }
      drawAll(el);
    } catch (err) {
      console.error('[hubstore] action failed:', action, err);
      toast(`Could not ${action}: ${err?.message || 'network error'}`, 'error');
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  function toast(msg, kind) {
    if (typeof window.showToast === 'function') window.showToast(msg, kind || 'info');
    else console.log('[hubstore]', kind, msg);
  }

  // ── Preview modal ─────────────────────────────────────────────────────────
  // Opens the stats modal with the given item temporarily equipped. The
  // user's real equipped state is unchanged. They see how the item actually
  // looks on their profile (title under name, name color applied, avatar
  // border, profile effect playing) before deciding to buy.
  function openPreviewModal(item) {
    // Themes preview at the launcher-chrome level, not the stats modal.
    // Apply the palette live + show a top banner the user can dismiss to
    // revert to their actual equipped theme.
    if (item.cat === 'themes') {
      previewTheme(item);
      return;
    }
    if (typeof window.openStatsModal !== 'function') {
      toast('Preview not available, stats module did not load.', 'error');
      return;
    }
    // Build an override object the stats modal will apply on top of the
    // user's real data. Stats modal reads previewItem from the second arg.
    const slotToCat = { titles:'title', colors:'color', borders:'border', effects:'effect' };
    const slot = slotToCat[item.cat] || null;
    if (!slot) {
      toast('This item type does not have a preview yet.', 'info');
      return;
    }
    window.openStatsModal(null, { previewItem: item, previewSlot: slot });
  }

  // Theme preview: apply the palette to the live launcher chrome + show
  // a dismiss-banner pinned to the top. Closing or pressing Escape reverts
  // back to the user's actual equipped theme (or default if none equipped).
  function previewTheme(item) {
    if (!item?.palette || typeof window.applyTheme !== 'function') return;
    // Snapshot current equipped so we can restore exactly that on close.
    const restore = () => {
      const equipped = catalog.find(i => i.cat === 'themes' && i.equipped);
      if (equipped?.palette) window.applyTheme(equipped.palette, equipped.overlayHtml, equipped.overlayCss);
      else                   window.clearTheme?.();
      document.getElementById('theme-preview-banner')?.remove();
      document.removeEventListener('keydown', onEsc);
    };
    const onEsc = (e) => { if (e.key === 'Escape') restore(); };

    window.applyTheme(item.palette, item.overlayHtml, item.overlayCss);
    document.getElementById('theme-preview-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'theme-preview-banner';
    banner.innerHTML = `
      <span>👁️&nbsp; Previewing theme: <b>${esc(item.name)}</b>. Your actual theme is unchanged.</span>
      <button id="theme-preview-close">CLOSE PREVIEW</button>`;
    document.body.appendChild(banner);
    banner.querySelector('#theme-preview-close').addEventListener('click', restore);
    document.addEventListener('keydown', onEsc);
  }

  // Pre-load the catalog as soon as the launcher window finishes booting.
  // Stats Modal -> Coin Activity formatter looks items up via
  // window.HUB_STORE_BY_ID to render "Bought: Frost (Name Color)" instead
  // of the raw "Bought: c_frost". Without this preload, the lookup is
  // empty until the user actually clicks the HUB STORE tab.
  if (typeof window.hub?.get === 'function') {
    // Defer one tick so the auto-login flow gets to set sessionToken first.
    setTimeout(() => { loadCatalog().catch(() => {}); }, 1500);
  }
})();
