// Chat popout — runs inside its own Electron BrowserWindow.
// Uses the SAME `window.hub.get/post` IPC path as the main launcher so
// auth, error handling, and CORS all work identically. Raw fetch from a
// file:// page to http://127.0.0.1:7890 is blocked by Electron's default
// security model, hence the IPC route.
//
// URL params:
//   ?type=hub                     -> Hub Chat
//   ?type=dm&user=<username>     -> DM with <username>
//   ?me=<username>                -> caller's own username (for own-message styling)

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const type   = params.get('type') || 'hub';
  const target = params.get('user') || '';
  const me     = params.get('me')   || '';

  // ── DOM ─────────────────────────────────────────────────
  const iconEl  = document.getElementById('pop-icon');
  const nameEl  = document.getElementById('pop-name');
  const subEl   = document.getElementById('pop-sub');
  const msgsEl  = document.getElementById('pop-msgs');
  const inputEl = document.getElementById('pop-input');
  const sendBtn = document.getElementById('pop-send');
  const pinBtn  = document.getElementById('pop-pin');
  const closeBtn= document.getElementById('pop-close');

  if (type === 'hub') {
    iconEl.textContent = '🌐';
    nameEl.textContent = 'Hub Chat';
    subEl.textContent  = 'GLOBAL';
    document.title     = 'RSPS Hub — Hub Chat';
    inputEl.placeholder = `Message Hub Chat…`;
  } else {
    iconEl.textContent = '💬';
    nameEl.textContent = target || 'DM';
    subEl.textContent  = 'DIRECT';
    document.title     = `RSPS Hub — DM ${target}`;
    inputEl.placeholder = `Message ${target}…`;
  }

  // ── Helpers ─────────────────────────────────────────────
  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function fmtTs(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'));
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return String(iso).slice(11, 16) || ''; }
  }
  function isAtBottom() { return msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 60; }
  function scrollToBottom() { msgsEl.scrollTop = msgsEl.scrollHeight; }

  function renderMsg(m, append = true) {
    // Hub chat returns {username, message, created_at}; DMs return
    // {sender, content, sent_at}. Normalise both.
    const sender = m.username || m.sender || '?';
    const body   = m.content  || m.message || '';
    const ts     = m.created_at || m.createdAt || m.sent_at || m.sentAt || '';
    const own    = (sender === me);
    const html = `
      <div class="pop-msg ${own ? 'own' : 'other'}">
        ${!own ? `<span class="pop-sender">${escHtml(sender)}</span>` : ''}
        <div class="pop-bubble">${escHtml(body)}</div>
        <span class="pop-ts">${fmtTs(ts)}</span>
      </div>`;
    if (append) msgsEl.insertAdjacentHTML('beforeend', html);
    else msgsEl.insertAdjacentHTML('afterbegin', html);
  }

  // ── Polling loops ───────────────────────────────────────
  let lastId = 0;
  let timer  = null;

  async function pollHub() {
    try {
      const data = await window.hub.get(`/api/chat/hub?since=${lastId}`);
      const list = data?.messages || [];
      if (list.length) {
        if (lastId === 0) msgsEl.innerHTML = '';
        const wasBottom = isAtBottom();
        for (const m of list) {
          renderMsg(m);
          lastId = Math.max(lastId, m.id || 0);
        }
        if (wasBottom) scrollToBottom();
      } else if (lastId === 0) {
        msgsEl.innerHTML = `<p class="pop-empty">No messages yet — say something!</p>`;
      }
    } catch (e) {
      if (lastId === 0) msgsEl.innerHTML = `<p class="pop-empty">Couldn't load chat.<br>${escHtml(e?.message || e)}</p>`;
      console.error('[chat-popout] hub poll failed:', e);
    }
    timer = setTimeout(pollHub, 3000);
  }

  async function pollDm() {
    try {
      const data = await window.hub.get(`/api/messages/${encodeURIComponent(target)}`);
      const list = data?.messages || (Array.isArray(data) ? data : []);
      msgsEl.innerHTML = '';
      if (!list.length) {
        msgsEl.innerHTML = `<p class="pop-empty">No messages yet.</p>`;
      } else {
        for (const m of list) renderMsg(m);
        scrollToBottom();
      }
    } catch (e) {
      if (!msgsEl.children.length) {
        msgsEl.innerHTML = `<p class="pop-empty">Couldn't load chat.<br>${escHtml(e?.message || e)}</p>`;
      }
      console.error('[chat-popout] dm poll failed:', e);
    }
    timer = setTimeout(pollDm, 4000);
  }

  // ── Send ────────────────────────────────────────────────
  // Guard against the "message sent twice" bug — fast Enter presses, or an
  // Enter keydown bubbling through the same tick that fires the SEND click,
  // could otherwise queue two POSTs before the first finished.
  let sending = false;
  async function doSend() {
    if (sending) return;
    const content = inputEl.value.trim();
    if (!content) return;
    sending = true;
    sendBtn.disabled = true;
    inputEl.value = '';
    try {
      if (type === 'hub') {
        await window.hub.post('/api/chat/hub', { message: content });
        clearTimeout(timer); pollHub();
      } else {
        await window.hub.post(`/api/messages/${encodeURIComponent(target)}`, { content });
        clearTimeout(timer); pollDm();
      }
    } catch (e) {
      console.error('[chat-popout] send failed:', e);
      inputEl.value = content; // restore so user can retry
    }
    sending = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }

  sendBtn.addEventListener('click', doSend);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); doSend(); }
  });
  inputEl.focus();

  // ── Pin (always-on-top toggle) ──────────────────────────
  let pinned = true;
  pinBtn.classList.add('active');
  pinBtn.addEventListener('click', () => {
    pinned = !pinned;
    pinBtn.classList.toggle('active', pinned);
    if (window.chatPopout?.setAlwaysOnTop) window.chatPopout.setAlwaysOnTop(pinned);
  });

  closeBtn.addEventListener('click', () => {
    if (window.chatPopout?.close) window.chatPopout.close();
    else window.close();
  });

  // ── Boot ────────────────────────────────────────────────
  if (type === 'hub') pollHub();
  else                pollDm();
})();
