/**
 * Force-update modal. Fires when the hub API returns 426 (launcher too
 * old). Blocks the entire UI behind a fullscreen overlay until the user
 * triggers the auto-updater and restarts.
 *
 * Listens for the 'launcher-update-required' IPC event broadcast by
 * main.js whenever any /api/* call comes back with that payload.
 *
 * Self-contained: no library, lives in its own script, only depends on
 * window.hub.* (preload bridge).
 */
(function () {
  'use strict';

  let shown      = false;
  let stateLabel = 'idle'; // idle | checking | downloading | downloaded | error
  let overlayEl  = null;

  function show(data) {
    if (shown) {
      // Already up — just refresh the version info in case it changed.
      updateContent(data);
      return;
    }
    shown = true;
    injectStyles();
    render(data);
    hookUpdaterEvents();
  }

  function injectStyles() {
    if (document.getElementById('forceupd-styles')) return;
    const css = `
      .forceupd-overlay {
        position: fixed; inset: 0; z-index: 10000;
        background: rgba(8, 6, 4, 0.94);
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(4px);
        font-family: 'Inter', sans-serif;
        color: #cdc0a0;
      }
      .forceupd-modal {
        max-width: 520px; width: 90%;
        background: linear-gradient(180deg, #1e1a10, #14100a);
        border: 1px solid #c8a840;
        border-radius: 8px;
        padding: 32px 36px;
        box-shadow: 0 24px 70px rgba(0,0,0,0.8);
        text-align: center;
      }
      .forceupd-modal .forceupd-icon {
        font-size: 2.4rem;
        margin-bottom: 14px;
      }
      .forceupd-modal h1 {
        font-family: 'Cinzel', serif;
        color: #f4d77c;
        font-size: 1.6rem;
        font-weight: 700;
        letter-spacing: 2px;
        margin-bottom: 10px;
      }
      .forceupd-modal .forceupd-body {
        color: #cdc0a0;
        font-size: 0.95rem;
        line-height: 1.55;
        margin-bottom: 20px;
      }
      .forceupd-modal .forceupd-versions {
        background: #0e0c08;
        border: 1px solid #2e2410;
        border-radius: 4px;
        padding: 10px 14px;
        font-family: 'JetBrains Mono', 'Consolas', monospace;
        font-size: 0.82rem;
        color: #a89a72;
        margin-bottom: 22px;
        text-align: left;
      }
      .forceupd-modal .forceupd-versions .row {
        display: flex; justify-content: space-between; padding: 3px 0;
      }
      .forceupd-modal .forceupd-versions .row b {
        color: #f4d77c; font-weight: 600;
      }
      .forceupd-modal button {
        font-family: 'Cinzel', serif;
        font-weight: 700;
        letter-spacing: 1.8px;
        font-size: 0.84rem;
        padding: 12px 30px;
        border-radius: 4px;
        cursor: pointer;
        text-transform: uppercase;
        transition: all 0.15s;
        background: linear-gradient(180deg, #ff981f, #d97a10);
        border: 1px solid #ff981f;
        color: #0a0807;
        box-shadow: 0 4px 14px rgba(255,152,31,0.3);
      }
      .forceupd-modal button:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 6px 18px rgba(255,152,31,0.45);
      }
      .forceupd-modal button:disabled {
        opacity: 0.55;
        cursor: default;
      }
      .forceupd-modal .forceupd-status {
        margin-top: 12px;
        color: #8a7a5a;
        font-size: 0.82rem;
        min-height: 18px;
      }
      .forceupd-modal .forceupd-spinner {
        display: inline-block;
        width: 12px; height: 12px;
        border: 2px solid #5a4828;
        border-top-color: #ffd070;
        border-radius: 50%;
        animation: forceupd-spin 0.9s linear infinite;
        margin-right: 8px;
        vertical-align: -2px;
      }
      @keyframes forceupd-spin { to { transform: rotate(360deg); } }
    `;
    const style = document.createElement('style');
    style.id = 'forceupd-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  }

  function render(data) {
    overlayEl = document.createElement('div');
    overlayEl.className = 'forceupd-overlay';
    overlayEl.id = 'forceupd-overlay';
    overlayEl.innerHTML = `
      <div class="forceupd-modal" onclick="event.stopPropagation()">
        <div class="forceupd-icon">⚠️</div>
        <h1>Update Required</h1>
        <div class="forceupd-body" id="forceupd-msg"></div>
        <div class="forceupd-versions">
          <div class="row"><span>Your version</span><b id="forceupd-you">…</b></div>
          <div class="row"><span>Minimum required</span><b id="forceupd-min">…</b></div>
        </div>
        <button id="forceupd-btn" type="button">Download update</button>
        <div class="forceupd-status" id="forceupd-status"></div>
      </div>
    `;
    document.body.appendChild(overlayEl);
    updateContent(data);

    document.getElementById('forceupd-btn').addEventListener('click', () => {
      triggerUpdate();
    });
  }

  function updateContent(data) {
    const msgEl = document.getElementById('forceupd-msg');
    const youEl = document.getElementById('forceupd-you');
    const minEl = document.getElementById('forceupd-min');
    if (msgEl) msgEl.textContent = data?.message || 'Your launcher is out of date. Please update to continue using RSPS Hub.';
    if (youEl) youEl.textContent = data?.detected_version || 'unknown';
    if (minEl) minEl.textContent = data?.min_version || '—';
  }

  function setStatus(label, text, disable) {
    stateLabel = label;
    const statusEl = document.getElementById('forceupd-status');
    const btn      = document.getElementById('forceupd-btn');
    if (!statusEl || !btn) return;
    if (text) {
      const spin = (label === 'checking' || label === 'downloading') ? '<span class="forceupd-spinner"></span>' : '';
      statusEl.innerHTML = spin + escHtml(text);
    } else {
      statusEl.textContent = '';
    }
    btn.disabled = !!disable;
  }

  function triggerUpdate() {
    if (!window.hub?.checkForUpdate) {
      setStatus('error', 'Updater not available. Reinstall from therspshub.com.', true);
      return;
    }
    setStatus('checking', 'Checking for update…', true);
    window.hub.checkForUpdate();
  }

  let hooked = false;
  function hookUpdaterEvents() {
    if (hooked || !window.hub) return;
    hooked = true;

    if (window.hub.onUpdateChecking) {
      window.hub.onUpdateChecking(() => setStatus('checking', 'Checking for update…', true));
    }
    if (window.hub.onUpdateAvailable) {
      window.hub.onUpdateAvailable(() => setStatus('downloading', 'Downloading update…', true));
    }
    if (window.hub.onUpdateNotAvailable) {
      window.hub.onUpdateNotAvailable(() => {
        // Very rare: server says we're too old but electron-updater says no
        // update exists. Likely a deploy timing issue. Tell user to retry.
        const btn = document.getElementById('forceupd-btn');
        if (btn) btn.textContent = 'Retry';
        setStatus('idle', 'No update found yet. The new release may be propagating, retry in a minute.', false);
      });
    }
    if (window.hub.onUpdateDownloaded) {
      window.hub.onUpdateDownloaded(() => {
        const btn = document.getElementById('forceupd-btn');
        if (btn) btn.textContent = 'Install and restart';
        setStatus('downloaded', 'Update downloaded. Click to install and restart.', false);
        // Swap click handler from "download" to "install"
        btn.onclick = () => {
          setStatus('downloaded', 'Restarting…', true);
          try { window.hub.installUpdate(); } catch (_) {}
        };
      });
    }
    if (window.hub.onUpdateError) {
      window.hub.onUpdateError((err) => {
        const btn = document.getElementById('forceupd-btn');
        if (btn) btn.textContent = 'Retry';
        setStatus('error', 'Update failed: ' + (err || 'unknown error') + '. Reinstall from therspshub.com if this keeps happening.', false);
      });
    }
  }

  // Public API. app.js calls window.RspsHubForceUpdate.init() once at
  // startup so the IPC listener is wired before any API call could fire.
  window.RspsHubForceUpdate = {
    init() {
      if (window.hub?.onForceUpdate) {
        window.hub.onForceUpdate((data) => show(data));
      }
    },
    show, // for manual testing from devtools
  };
})();
