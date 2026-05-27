/**
 * First-launch onboarding tour. Fires once per account on first sign-in
 * (or any time via Settings → "Show me around"). Walks the user through
 * the 6 things they need to know to actually use the app.
 *
 * Mechanics:
 *  - Single fullscreen overlay with a hole punched over the targeted
 *    element (CSS box-shadow trick — no SVG mask needed)
 *  - Speech bubble positioned next to the target using getBoundingClientRect
 *  - Next / Skip-tour buttons; arrow keys + Esc also work
 *  - Completion saved to localStorage so refreshes don't re-trigger
 *  - User can re-run via Settings panel anytime
 *
 * Designed to be self-contained: no library, no external CSS file, no
 * dependencies on the rest of app.js beyond reading state.user (and even
 * that's optional — runs fine on the login screen if needed).
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'rspshub_onboarding_done_v1';
  const SKIP_ON_LOGIN = false; // set true to hold the tour until after sign-in

  // Each step:
  //   target:   CSS selector for the element to highlight (null = center modal)
  //   title:    short headline
  //   body:     paragraph(s) of explanation. Plain text, no HTML.
  //   align:    'top' | 'bottom' | 'left' | 'right' (which side of target)
  //   pad:      extra pixels around the spotlight (default 8)
  //   preStep:  optional () => void run before painting (e.g. open the tab
  //             we're highlighting so the target exists)
  const STEPS = [
    {
      target: null,
      title: 'Welcome to RSPS Hub',
      body:  "Quick tour, under a minute. You can skip with Esc or the Skip button at any time. Use the arrow keys to navigate.",
      align: 'center',
    },
    {
      target: '.nav-tab[data-tab="store"]',
      title: 'Servers',
      body:  "Your starting point. Browse 60+ RuneScape private servers, click any card to read the detail page, then Install + Play. Most users live here.",
      align: 'bottom',
      preStep: () => { try { setActiveNavTab && setActiveNavTab('store'); } catch (_) {} },
    },
    {
      target: '.nav-tab[data-tab="library"]',
      title: 'Library',
      body:  "Installed servers can be found here, you can easily uninstall at the click of a button.",
      align: 'bottom',
    },
    {
      target: '.nav-tab[data-tab="hubstore"]',
      title: 'Hub Store',
      body:  "Cosmetics like name colors, titles, profile borders, and animated effects. Hub Coins can only be earned by playing on hub servers and claiming daily rewards. You spend them here, never buy them.",
      align: 'bottom',
    },
    {
      target: '.rs-tab[data-panel="stats"]',
      title: 'Stats & Skill Levels',
      body:  "Every server you play is its own skill that levels from 1 to 99. 1000 hours equals max level. Check your playtime breakdown, top servers, and per-server progression here.",
      align: 'right',
    },
    {
      target: ['.rs-tab[data-panel="friends"]', '.rs-tab[data-panel="chat"]', '.rs-tab[data-panel="groupchat"]'],
      title: 'Friends + Chat',
      body:  "Add friends to see what they're playing in real time. Direct messages live in CHAT, and the HUB tab (globe icon) is a worldwide channel for everyone on RSPS Hub.",
      align: 'right',
    },
    {
      target: '.rs-tab[data-panel="music"]',
      title: 'Music Player',
      body:  "Built-in background music for grinding. Click to open the player and it can pop out into its own little window if you want it pinned somewhere on screen.",
      align: 'right',
    },
    {
      target: '.user-chip',
      title: 'Your Account',
      body:  "Click your name (top-right) to change your avatar. The bell icon next to it shows hub notifications when you have any.",
      align: 'bottom-left',
    },
    {
      target: null,
      title: "You're all set",
      body:  "That's the whole tour. Click Servers to find one to play. You can re-run this any time from Settings → Show me around.",
      align: 'center',
      finalStep: true,
    },
  ];

  let stepIndex = 0;
  let backdropEl = null;
  let bubbleEl = null;
  let onKeydown = null;

  function injectStyles() {
    if (document.getElementById('onb-styles')) return;
    const css = `
      /* When a step has a spotlight, the spotlight's huge outward box-shadow
         IS the backdrop dim. So this backdrop only kicks in for center-screen
         steps that have no target to highlight. */
      .onb-backdrop {
        position: fixed; inset: 0; z-index: 9000;
        background: transparent;
        pointer-events: auto;
      }
      .onb-backdrop.center-only {
        background: rgba(8, 6, 4, 0.78);
        transition: background 0.18s;
      }
      .onb-spotlight {
        position: fixed; z-index: 9001; pointer-events: none;
        border-radius: 6px;
        /* Huge outward box-shadow creates the dim around the spotlight while
           leaving the inside completely clean so the highlighted UI stays at
           its normal brightness, not dimmed. */
        box-shadow: 0 0 0 9999px rgba(8, 6, 4, 0.78),
                    0 0 0 2px #c8a840 inset,
                    0 0 24px 4px rgba(200, 168, 64, 0.45);
        transition: top 0.22s cubic-bezier(0.2,0,0,1), left 0.22s cubic-bezier(0.2,0,0,1),
                    width 0.22s, height 0.22s;
      }
      .onb-bubble {
        position: fixed; z-index: 9002;
        background: linear-gradient(180deg, #1e1a10, #14100a);
        border: 1px solid #c8a840;
        border-radius: 6px;
        padding: 18px 20px;
        max-width: 380px;
        min-width: 280px;
        box-shadow: 0 18px 50px rgba(0,0,0,0.7);
        font-family: 'Inter', sans-serif;
        color: #cdc0a0;
        transition: top 0.22s cubic-bezier(0.2,0,0,1), left 0.22s cubic-bezier(0.2,0,0,1);
      }
      .onb-bubble .onb-title {
        font-family: 'Cinzel', serif;
        color: #f4d77c;
        font-size: 1.1rem;
        font-weight: 700;
        letter-spacing: 1.5px;
        margin-bottom: 8px;
      }
      .onb-bubble .onb-body {
        color: #cdc0a0;
        font-size: 0.88rem;
        line-height: 1.5;
        margin-bottom: 14px;
      }
      .onb-bubble .onb-progress {
        color: #6b5228;
        font-size: 0.7rem;
        font-family: 'JetBrains Mono', 'Consolas', monospace;
        letter-spacing: 0.5px;
        margin-bottom: 10px;
        text-transform: uppercase;
      }
      .onb-bubble .onb-actions {
        display: flex; align-items: center; justify-content: space-between;
        gap: 10px; margin-top: 4px;
      }
      .onb-bubble button {
        font-family: 'Cinzel', serif;
        font-weight: 700;
        letter-spacing: 1.3px;
        font-size: 0.74rem;
        padding: 8px 14px;
        border-radius: 3px;
        cursor: pointer;
        transition: all 0.12s;
        text-transform: uppercase;
      }
      .onb-bubble .onb-skip {
        background: transparent;
        border: 1px solid #2e2410;
        color: #8a7a5a;
      }
      .onb-bubble .onb-skip:hover { color: #c8a840; border-color: #6b5228; }
      .onb-bubble .onb-next {
        background: linear-gradient(180deg, #ff981f, #d97a10);
        border: 1px solid #ff981f;
        color: #0a0807;
        box-shadow: 0 4px 12px rgba(255,152,31,0.25);
      }
      .onb-bubble .onb-next:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(255,152,31,0.4); }
      .onb-bubble .onb-back {
        background: transparent;
        border: 1px solid #5a4828;
        color: #a89a72;
      }
      .onb-bubble .onb-back:hover { color: #ffd070; border-color: #c8a840; }
      .onb-bubble.center {
        left: 50%; top: 50%;
        transform: translate(-50%, -50%);
        max-width: 460px;
        padding: 24px 28px;
      }
      .onb-bubble .onb-arrow {
        position: absolute; width: 14px; height: 14px;
        background: linear-gradient(180deg, #1e1a10, #1e1a10);
        border: 1px solid #c8a840;
        transform: rotate(45deg);
      }
      .onb-bubble.align-top    .onb-arrow { bottom: -8px;  left: 32px;  border-top: none;    border-left: none; }
      .onb-bubble.align-bottom .onb-arrow { top: -8px;     left: 32px;  border-bottom: none; border-right: none; }
      .onb-bubble.align-right  .onb-arrow { left: -8px;    top: 26px;   border-top: none;    border-right: none; }
      .onb-bubble.align-left   .onb-arrow { right: -8px;   top: 26px;   border-bottom: none; border-left: none; }
      .onb-bubble.align-bottom-left .onb-arrow { top: -8px; right: 32px; left: auto; border-bottom: none; border-right: none; }
    `;
    const style = document.createElement('style');
    style.id = 'onb-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function render() {
    const step = STEPS[stepIndex];
    if (!step) { finish(); return; }

    if (step.preStep) {
      try { step.preStep(); } catch (_) {}
    }

    // Backdrop
    if (!backdropEl) {
      backdropEl = document.createElement('div');
      backdropEl.className = 'onb-backdrop';
      backdropEl.addEventListener('click', () => {}); // swallow clicks
      document.body.appendChild(backdropEl);
    }

    // Remove old spotlight + bubble
    document.querySelectorAll('.onb-spotlight, .onb-bubble').forEach(n => n.remove());

    // Bubble
    bubbleEl = document.createElement('div');
    bubbleEl.className = 'onb-bubble';
    const isFirst = stepIndex === 0;
    const isLast  = !!step.finalStep;
    bubbleEl.innerHTML = `
      <div class="onb-progress">Step ${stepIndex + 1} of ${STEPS.length}</div>
      <div class="onb-title">${escapeHtml(step.title)}</div>
      <div class="onb-body">${escapeHtml(step.body)}</div>
      <div class="onb-actions">
        <button class="onb-skip" data-act="skip">${isLast ? 'Close' : 'Skip tour'}</button>
        <div style="display:flex;gap:8px">
          ${isFirst ? '' : '<button class="onb-back" data-act="back">Back</button>'}
          <button class="onb-next" data-act="next">${isLast ? 'Got it' : 'Next ›'}</button>
        </div>
      </div>
      ${step.target && step.align !== 'center' ? '<div class="onb-arrow"></div>' : ''}
    `;
    bubbleEl.addEventListener('click', (e) => {
      const act = e.target.dataset?.act;
      if (act === 'next') next();
      else if (act === 'back') back();
      else if (act === 'skip') finish();
    });
    document.body.appendChild(bubbleEl);

    if (step.target) {
      // Spotlight + position bubble around target. Supports a single
      // selector or an array of selectors. When given an array, the
      // spotlight covers the union of all of their bounding boxes so
      // multi-element groups (Friends + Chat + Hub) light up together.
      const selectors = Array.isArray(step.target) ? step.target : [step.target];
      const targets   = selectors.map(s => document.querySelector(s)).filter(Boolean);
      if (!targets.length) {
        backdropEl.classList.add('center-only');
        bubbleEl.classList.add('center');
        return;
      }
      backdropEl.classList.remove('center-only'); // spotlight handles the dim
      targets[0].scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      setTimeout(() => positionAroundTarget(targets, step), 80);
    } else {
      // No target: just a centered welcome / outro modal. Use the backdrop
      // to dim the whole screen since there's no spotlight to do it.
      backdropEl.classList.add('center-only');
      bubbleEl.classList.add('center');
    }
  }

  function positionAroundTarget(targets, step) {
    // Compute the union bounding rect across every target.
    const rects = targets.map(t => t.getBoundingClientRect());
    const rect = {
      top:    Math.min(...rects.map(r => r.top)),
      left:   Math.min(...rects.map(r => r.left)),
      right:  Math.max(...rects.map(r => r.right)),
      bottom: Math.max(...rects.map(r => r.bottom)),
    };
    rect.width  = rect.right  - rect.left;
    rect.height = rect.bottom - rect.top;
    const pad  = step.pad ?? 8;

    // Spotlight
    const spot = document.createElement('div');
    spot.className = 'onb-spotlight';
    spot.style.top    = (rect.top    - pad) + 'px';
    spot.style.left   = (rect.left   - pad) + 'px';
    spot.style.width  = (rect.width  + pad * 2) + 'px';
    spot.style.height = (rect.height + pad * 2) + 'px';
    document.body.appendChild(spot);

    // Bubble position
    const bubbleRect = bubbleEl.getBoundingClientRect();
    const align = step.align || 'bottom';
    const offset = 18;
    let top, left;

    switch (align) {
      case 'top':
        top  = rect.top - bubbleRect.height - offset;
        left = rect.left + rect.width / 2 - bubbleRect.width / 2;
        break;
      case 'bottom':
        top  = rect.bottom + offset;
        left = rect.left + rect.width / 2 - bubbleRect.width / 2;
        break;
      case 'left':
        top  = rect.top + rect.height / 2 - bubbleRect.height / 2;
        left = rect.left - bubbleRect.width - offset;
        break;
      case 'right':
        top  = rect.top + rect.height / 2 - bubbleRect.height / 2;
        left = rect.right + offset;
        break;
      case 'bottom-left':
        top  = rect.bottom + offset;
        left = rect.right - bubbleRect.width;
        break;
      default:
        top  = rect.bottom + offset;
        left = rect.left;
    }

    // Clamp into viewport
    const margin = 12;
    if (left < margin) left = margin;
    if (top  < margin) top  = margin;
    if (left + bubbleRect.width  > window.innerWidth  - margin) left = window.innerWidth  - bubbleRect.width  - margin;
    if (top  + bubbleRect.height > window.innerHeight - margin) top  = window.innerHeight - bubbleRect.height - margin;

    bubbleEl.style.top  = top  + 'px';
    bubbleEl.style.left = left + 'px';
    bubbleEl.classList.add('align-' + align);
  }

  function next() {
    stepIndex++;
    if (stepIndex >= STEPS.length) { finish(); return; }
    render();
  }
  function back() {
    if (stepIndex > 0) { stepIndex--; render(); }
  }
  function finish() {
    // Persist to BOTH localStorage and the settings.json file (via /api/settings).
    // localStorage was getting wiped by the auto-update process on Windows
    // (Chromium localStorage db corruption when the launcher gets force-killed
    // mid-write during the NSIS upgrade), making the tour re-fire after every
    // update. The settings.json file lives in ~/.rsps_hub/ which the installer
    // explicitly preserves + has restore logic for, so it's the durable home
    // for this flag. localStorage stays as a fast-path so we don't have to
    // round-trip on every launcher boot.
    try { localStorage.setItem(STORAGE_KEY, 'true'); } catch (_) {}
    try {
      if (window.hub && window.hub.post) {
        window.hub.post('/api/settings', { hasCompletedOnboarding: true })
                  .catch(() => {});
      }
    } catch (_) {}
    if (backdropEl) backdropEl.remove();
    document.querySelectorAll('.onb-spotlight, .onb-bubble').forEach(n => n.remove());
    if (onKeydown) document.removeEventListener('keydown', onKeydown);
    backdropEl = null; bubbleEl = null;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  }

  function start() {
    injectStyles();
    stepIndex = 0;
    onKeydown = (e) => {
      if (e.key === 'Escape')              finish();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft')      back();
    };
    document.addEventListener('keydown', onKeydown);
    render();
  }

  // Public API
  window.RspsHubOnboarding = {
    start,
    isDone() {
      // localStorage is the fast-path check used by autoStart on launcher boot.
      // The durable source of truth is settings.json (see autoStart below which
      // rehydrates localStorage from settings if the file says we're done).
      try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch (_) { return false; }
    },
    reset()  {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      // Clear the durable flag too so the "Start tour" button in Settings
      // actually replays the tour on next boot even if the user fully quits.
      try {
        if (window.hub && window.hub.post) {
          window.hub.post('/api/settings', { hasCompletedOnboarding: false }).catch(() => {});
        }
      } catch (_) {}
    },
    /** Called from app.js after the renderer + state.user are ready. Will
     *  auto-launch the tour on first run, no-op afterwards. */
    autoStart() {
      // Tiny delay so the DOM has settled (nav tabs rendered, etc.)
      setTimeout(async () => {
        // Fast path: localStorage already says done, bail.
        if (this.isDone()) return;
        // Slow path: localStorage might have been wiped by an auto-update
        // (Chromium localStorage db corruption when launcher is force-killed
        // mid-write during NSIS upgrade). Check the durable settings.json
        // flag via /api/settings before deciding to show the tour. If it
        // says done, rehydrate localStorage so future boots take the fast
        // path again.
        try {
          if (window.hub && window.hub.get) {
            const s = await window.hub.get('/api/settings');
            if (s && s.hasCompletedOnboarding === true) {
              try { localStorage.setItem(STORAGE_KEY, 'true'); } catch (_) {}
              return;
            }
          }
        } catch (_) {}
        if (SKIP_ON_LOGIN && !window.state?.user) return;
        start();
      }, 600);
    },
  };
})();
