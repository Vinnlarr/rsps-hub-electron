/*
 * videos.js — Creator Videos tab. A YouTube-style feed of community-submitted
 * videos. Anyone logged in can submit a YouTube / Twitch / Kick link; the grid
 * shows them newest-first. YouTube plays inline (CSP frame-src + main.js Referer
 * shim make file:// embeds work). Twitch / Kick can't embed from file:// — they
 * require a matching parent domain — so those open in the external browser.
 *
 * Renders into #alt-content when the user clicks the VIDEOS nav tab.
 */
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Server timestamps are UTC-ish "YYYY-MM-DD HH:MM:SS". Best-effort relative.
  function timeAgo(iso) {
    if (!iso) return '';
    const then = Date.parse(String(iso).replace(' ', 'T') + 'Z');
    if (isNaN(then)) return '';
    const s = Math.max(0, (Date.now() - then) / 1000);
    if (s < 60) return 'just now';
    const m = s / 60; if (m < 60) return Math.floor(m) + 'm ago';
    const h = m / 60; if (h < 24) return Math.floor(h) + 'h ago';
    const d = h / 24; if (d < 30) return Math.floor(d) + 'd ago';
    const mo = d / 30; if (mo < 12) return Math.floor(mo) + 'mo ago';
    return Math.floor(mo / 12) + 'y ago';
  }

  let videos = [];
  let creatorChannels = [];   // live-capable channels {creator, platform, channel_id}
  let filterCreator = null;   // null = all creators
  let filterShorts  = false;  // true = shorts only
  let sortMode = 'recent';    // 'recent' | 'likes' | 'views' — server re-orders
  let loadError = false;      // true when the last fetch failed (vs genuinely empty)
  let liveMode = false;       // true = showing the Live viewer instead of the grid
  let liveCreator = null;     // which creator's stream is loaded in Live mode
  let hostEl = null;          // the #alt-content host, for repaints

  function isStaff() { return !!(window.state && window.state.user && (window.state.user.isStaff || window.state.user.is_staff)); }

  // Fetch with a few quick retries so a transient server blip (e.g. a backend
  // restart) doesn't strand the tab on an empty state. Only after all attempts
  // fail do we flag loadError, which paintGrid turns into a Retry prompt rather
  // than the misleading "No videos yet" message.
  async function fetchVideos() {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const data = await window.hub.get('/api/videos/list?limit=50&sort=' + encodeURIComponent(sortMode));
        videos = (data && Array.isArray(data.videos)) ? data.videos : [];
        creatorChannels = (data && Array.isArray(data.creators)) ? data.creators : [];
        loadError = false;
        return;
      } catch (e) {
        console.warn('[videos] list failed (attempt ' + (attempt + 1) + '/3)', e);
        if (attempt < 2) await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
      }
    }
    // All retries failed — keep any videos we already had on screen, but flag
    // the error so the user sees a Retry option instead of an empty feed.
    loadError = true;
    creatorChannels = creatorChannels || [];
  }

  function thumbHtml(v) {
    const badge = `<span class="vid-plat vid-plat-${esc(v.platform)}">${esc(v.platform)}</span>`;
    if (v.thumb) {
      return `<div class="vid-thumb">
                <img src="${esc(v.thumb)}" alt="" loading="lazy" onerror="this.style.display='none'">
                <span class="vid-play">&#9654;</span>${badge}
              </div>`;
    }
    // Twitch / Kick have no key-free thumbnail — show a branded placeholder.
    return `<div class="vid-thumb vid-thumb-ph vid-ph-${esc(v.platform)}">
              <span class="vid-ph-label">${esc(v.platform).toUpperCase()}</span>
              <span class="vid-play">&#9654;</span>${badge}
            </div>`;
  }

  function myName() { return (window.state && window.state.user && window.state.user.username) || ''; }

  function cardHtml(v) {
    const server = v.server_name
      ? `<span class="vid-server">${esc(v.server_name)}</span>` : '';
    // Owner-only backup control: upload a Hub-hosted copy that survives a
    // takedown. Verified-creator gating is enforced server-side.
    const mine = myName() && String(v.submitter).toLowerCase() === myName().toLowerCase();
    // Staff can back up ANY video (these creator videos are staff-curated, and
    // they're the ones most at risk of takedown). Uploader can back up their own.
    const canBackup = mine || isStaff();
    const backupCtl = canBackup
      ? (v.has_fallback
          ? `<button class="vid-backup-ctl done" disabled data-tip="Backup copy is stored on the Hub">&#10003; Backup</button>`
          : `<button class="vid-backup-ctl" data-backup="${v.id}" data-tip="Upload a backup copy in case the original is removed">&#11014; Add backup</button>`)
      : '';
    // Staff (or the uploader) can edit or remove a video.
    const manageBtns = (isStaff() || mine)
      ? `<div class="vid-manage">
           <button class="vid-edit" data-edit="${v.id}" title="Edit video">&#9998;</button>
           <button class="vid-remove" data-remove="${v.id}" title="Remove video">&#10005;</button>
         </div>` : '';
    return `<div class="vid-card" data-id="${v.id}">
      ${manageBtns}
      ${thumbHtml(v)}
      <div class="vid-meta">
        <div class="vid-title" title="${esc(v.title || v.source_url)}">${esc(v.title || v.source_url)}</div>
        <div class="vid-sub">${esc(v.submitter)}${server ? ' &bull; ' : ''}${server}</div>
        <div class="vid-sub vid-time">${timeAgo(v.created_at)}</div>
        <div class="vid-stats">
          <button class="vid-like${v.liked ? ' liked' : ''}" data-like="${v.id}" title="Like">
            <span class="vid-like-ic">&#9829;</span><span class="vid-like-n">${v.likes || 0}</span>
          </button>
          <span class="vid-views" title="Views">&#128065; ${v.views || 0}</span>
          <span class="vid-cbtn" title="Comments">&#128172; ${v.comment_count || 0}</span>
          ${isStaff() && v.report_count > 0
            ? `<span class="vid-flag" title="${v.report_count} report${v.report_count === 1 ? '' : 's'} — review">&#9873; ${v.report_count}</span>`
            : ''}
        </div>
        ${backupCtl}
      </div>
    </div>`;
  }

  // Direct multipart upload to the VPS (a 250MB video shouldn't route through
  // the JSON/Java path). Bearer auth; CORS allows file:// via ACAO:*.
  function uploadBackup(videoId, file, btn) {
    const token = window.state && window.state.user && window.state.user.token;
    if (!token) { if (window.showToast) window.showToast('Not logged in.', 'error'); return; }
    const fd = new FormData();
    fd.append('video_id', videoId);
    fd.append('video', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://api.therspshub.com/api/videos/upload-fallback.php');
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) btn.textContent = 'Uploading ' + Math.round((e.loaded / e.total) * 100) + '%';
    };
    xhr.onload = () => {
      let res = {}; try { res = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300 && res.success) {
        if (window.showToast) window.showToast('Backup uploaded!', 'success');
        const host = document.getElementById('alt-content');
        if (host) render(host);
      } else {
        if (window.showToast) window.showToast(res.error || 'Upload failed.', 'error');
        btn.textContent = '⬆ Add backup'; btn.disabled = false;
      }
    };
    xhr.onerror = () => {
      if (window.showToast) window.showToast('Upload failed (network).', 'error');
      btn.textContent = '⬆ Add backup'; btn.disabled = false;
    };
    btn.disabled = true; btn.textContent = 'Uploading 0%';
    xhr.send(fd);
  }

  function pickAndUpload(videoId, btn) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/mp4,video/webm,video/quicktime,video/x-matroska';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (file) {
        if (file.size > 262144000) {
          if (window.showToast) window.showToast('File too large (max 250MB).', 'error');
        } else {
          uploadBackup(videoId, file, btn);
        }
      }
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  }

  function applyFilters() {
    let list = videos;
    if (filterCreator) list = list.filter(v => String(v.submitter).toLowerCase() === filterCreator.toLowerCase());
    if (filterShorts)  list = list.filter(v => v.is_short);
    return list;
  }

  // The creator + Shorts filter bar. Creators are derived from the loaded feed.
  function buildFilters(el) {
    const bar = el.querySelector('#vid-filters');
    if (!bar) return;
    const creators = Array.from(new Set(videos.map(v => v.submitter))).sort((a, b) => a.localeCompare(b));
    const chip = (label, active, attrs, extra) =>
      `<button class="vid-chip${active ? ' active' : ''}${extra ? ' ' + extra : ''}" ${attrs}>${esc(label)}</button>`;
    let html = chip('All Creators', !filterCreator && !liveMode, 'data-creator=""');
    creators.forEach(c => { html += chip(c, !liveMode && filterCreator === c, `data-creator="${esc(c)}"`); });
    html += `<span class="vid-chip-sep"></span>` + chip('▶ Shorts', !liveMode && filterShorts, 'data-shorts="1"', 'vid-chip-shorts');
    if (creatorChannels.length) html += chip('🔴 Live', liveMode, 'data-live-mode="1"', 'vid-chip-live');
    // Sort control, pushed to the far right. Hidden in Live mode (no feed there).
    if (!liveMode) {
      html += `<select class="vid-sort" id="vid-sort" title="Sort videos">
          <option value="recent"${sortMode === 'recent' ? ' selected' : ''}>Newest</option>
          <option value="likes"${sortMode === 'likes' ? ' selected' : ''}>Most Liked</option>
          <option value="views"${sortMode === 'views' ? ' selected' : ''}>Most Viewed</option>
        </select>`;
    }
    bar.innerHTML = html;
    const sortSel = bar.querySelector('#vid-sort');
    if (sortSel) sortSel.addEventListener('change', async () => {
      sortMode = sortSel.value;
      await fetchVideos();
      buildFilters(el);
      paintGrid(el);
    });
    bar.querySelectorAll('[data-creator]').forEach(b => b.addEventListener('click', () => {
      liveMode = false; filterCreator = b.dataset.creator || null; buildFilters(el); paintGrid(el);
    }));
    bar.querySelector('[data-shorts]').addEventListener('click', () => {
      liveMode = false; filterShorts = !filterShorts; buildFilters(el); paintGrid(el);
    });
    const liveBtn = bar.querySelector('[data-live-mode]');
    if (liveBtn) liveBtn.addEventListener('click', () => { liveMode = !liveMode; buildFilters(el); paintGrid(el); });
  }

  // Build the embed URL for a live channel. YouTube embeds directly (the
  // Referer shim in main.js makes its file:// embed play). Kick and Twitch
  // reject the launcher's file:// origin, so they route through a tiny wrapper
  // page served from therspshub.com (a real https origin) which holds their
  // player. That makes them play reliably without the file:// limitation.
  function liveEmbedUrl(c) {
    if (c.platform === 'youtube') {
      return `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(c.channel_id)}&origin=https://therspshub.com&autoplay=1`;
    }
    return `https://therspshub.com/live-embed.php?platform=${encodeURIComponent(c.platform)}&channel=${encodeURIComponent(c.channel_id)}`;
  }
  function platformDot(p) { return p === 'kick' ? '🟢' : p === 'twitch' ? '🟣' : '🔴'; }

  // The Live viewer: creator tabs + an embed of the picked channel's current
  // live stream. No live-detection needed; the platform's embed plays the
  // active stream or shows an offline screen.
  function renderLive(grid) {
    // Break out of the card-grid layout so the player can fill the page.
    grid.style.display = 'block';
    const live = creatorChannels;   // youtube, kick, twitch all supported now
    if (!live.length) { grid.innerHTML = `<div class="vid-empty">No live channels set up yet.</div>`; return; }
    if (!liveCreator || !live.some(c => c.creator === liveCreator)) liveCreator = live[0].creator;
    const cur = live.find(c => c.creator === liveCreator);
    const embed = liveEmbedUrl(cur);
    grid.innerHTML = `
      <div class="vid-live">
        <div class="vid-live-tabs">
          ${live.map(c => `<button class="vid-live-tab${c.creator === liveCreator ? ' active' : ''}" data-live-pick="${esc(c.creator)}">${platformDot(c.platform)} ${esc(c.creator)}</button>`).join('')}
        </div>
        <div class="vid-live-stage">
          <iframe src="${esc(embed)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
        </div>
        <div class="vid-live-note">Streams play automatically when a creator goes live. If you see an offline message, they are not streaming right now, try another creator above.</div>
      </div>`;
    grid.querySelectorAll('[data-live-pick]').forEach(t => t.addEventListener('click', () => {
      liveCreator = t.dataset.livePick; renderLive(grid);
    }));
  }

  function removeVideo(id) {
    const doRemove = () => {
      const token = window.state && window.state.user && window.state.user.token;
      fetch('https://api.therspshub.com/api/videos/remove.php', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: Number(id) })
      }).then(r => r.json()).then(res => {
        if (res && res.success) {
          videos = videos.filter(v => String(v.id) !== String(id));
          if (hostEl) { buildFilters(hostEl); paintGrid(hostEl); }
          if (window.showToast) window.showToast('Video removed.', 'info');
        } else if (window.showToast) window.showToast((res && res.error) || 'Remove failed.', 'error');
      }).catch(() => { if (window.showToast) window.showToast('Remove failed.', 'error'); });
    };
    if (typeof window.confirmThemed === 'function') {
      window.confirmThemed('Remove this video from the feed?').then(ok => { if (ok) doRemove(); });
    } else if (confirm('Remove this video from the feed?')) {
      doRemove();
    }
  }

  // Flag a video for staff review. One report per user; the button locks after.
  function reportVideo(v, btn) {
    const send = () => {
      const token = window.state && window.state.user && window.state.user.token;
      if (!token) { if (window.showToast) window.showToast('Log in to report.', 'error'); return; }
      btn.disabled = true;
      fetch('https://api.therspshub.com/api/videos/report.php', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: Number(v.id) })
      }).then(r => r.json()).then(res => {
        if (res && res.success) {
          btn.innerHTML = '&#9873; Reported';
          if (window.showToast) window.showToast('Reported. Thanks — staff will review it.', 'success');
        } else {
          btn.disabled = false;
          if (window.showToast) window.showToast((res && res.error) || 'Could not report.', 'error');
        }
      }).catch(() => { btn.disabled = false; if (window.showToast) window.showToast('Could not report.', 'error'); });
    };
    if (typeof window.confirmThemed === 'function') {
      window.confirmThemed('Report this video to staff for review?').then(ok => { if (ok) send(); });
    } else if (confirm('Report this video to staff for review?')) {
      send();
    }
  }

  // Paint the like state onto every button for this video (the grid card and
  // the open player share data-like="<id>"), with a pop animation on the heart.
  function applyLikeUI(id, liked, count, pop) {
    document.querySelectorAll('.vid-like[data-like="' + id + '"]').forEach(b => {
      b.classList.toggle('liked', !!liked);
      const n = b.querySelector('.vid-like-n'); if (n) n.textContent = count;
      const ic = b.querySelector('.vid-like-ic');
      if (pop && ic) { ic.classList.remove('pop'); void ic.offsetWidth; ic.classList.add('pop'); }
    });
  }

  // Toggle the caller's like. Optimistic: the heart flips and the count moves
  // instantly, then we reconcile with the server (reverting if it rejects).
  function toggleLike(id, btn) {
    const token = window.state && window.state.user && window.state.user.token;
    if (!token) { if (window.showToast) window.showToast('Log in to like videos.', 'error'); return; }
    const v = videos.find(x => String(x.id) === String(id));
    const wasLiked = v ? !!v.liked : btn.classList.contains('liked');
    const baseCount = v ? (v.likes || 0)
      : (parseInt((btn.querySelector('.vid-like-n') || {}).textContent, 10) || 0);
    const optLiked = !wasLiked;
    const optCount = Math.max(0, baseCount + (optLiked ? 1 : -1));
    if (v) { v.liked = optLiked; v.likes = optCount; }
    applyLikeUI(id, optLiked, optCount, optLiked);  // pop only when liking

    fetch('https://api.therspshub.com/api/videos/like.php', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_id: Number(id) })
    }).then(r => r.json()).then(res => {
      if (res && res.success) {
        if (v) { v.liked = res.liked; v.likes = res.likes; }
        applyLikeUI(id, res.liked, res.likes, false);  // reconcile, no re-pop
      } else {
        if (v) { v.liked = wasLiked; v.likes = baseCount; }
        applyLikeUI(id, wasLiked, baseCount, false);
        if (window.showToast) window.showToast((res && res.error) || 'Could not like.', 'error');
      }
    }).catch(() => {
      if (v) { v.liked = wasLiked; v.likes = baseCount; }
      applyLikeUI(id, wasLiked, baseCount, false);
      if (window.showToast) window.showToast('Could not like.', 'error');
    });
  }

  // Record a view when a video is opened. Deduped per user server-side, so
  // replays don't inflate the count. Fire-and-forget; updates the visible count.
  function recordView(v) {
    const token = window.state && window.state.user && window.state.user.token;
    if (!token) return;
    fetch('https://api.therspshub.com/api/videos/view.php', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_id: Number(v.id) })
    }).then(r => r.json()).then(res => {
      if (res && res.success) {
        v.views = res.views;
        document.querySelectorAll('.vid-card[data-id="' + v.id + '"] .vid-views').forEach(e =>
          e.innerHTML = '\u{1F441} ' + res.views);
        const pv = document.querySelector('.vid-player-views');
        if (pv) pv.innerHTML = '\u{1F441} ' + res.views + ' views';
      }
    }).catch(() => {});
  }

  function paintGrid(el) {
    const grid = el.querySelector('#vid-grid');
    if (!grid) return;
    if (liveMode) { renderLive(grid); return; }
    grid.style.display = '';  // restore the card-grid layout after Live mode
    const list = applyFilters();
    if (!list.length) {
      if (loadError && !videos.length) {
        grid.innerHTML = `<div class="vid-empty">Couldn't reach the server. <button class="vid-retry" id="vid-retry">Retry</button></div>`;
        const rb = grid.querySelector('#vid-retry');
        if (rb) rb.addEventListener('click', () => render(hostEl));
        return;
      }
      grid.innerHTML = `<div class="vid-empty">${videos.length ? 'No videos match this filter.' : 'No videos yet. Be the first to submit one!'}</div>`;
      return;
    }
    grid.innerHTML = list.map(cardHtml).join('');
    grid.querySelectorAll('.vid-card').forEach(card => {
      card.addEventListener('click', () => {
        const v = videos.find(x => String(x.id) === card.dataset.id);
        if (v) playVideo(v);
      });
    });
    grid.querySelectorAll('.vid-backup-ctl[data-backup]').forEach(b => {
      b.addEventListener('click', (e) => { e.stopPropagation(); pickAndUpload(b.dataset.backup, b); });
    });
    grid.querySelectorAll('.vid-like[data-like]').forEach(b => {
      b.addEventListener('click', (e) => { e.stopPropagation(); toggleLike(b.dataset.like, b); });
    });
    grid.querySelectorAll('.vid-remove[data-remove]').forEach(b => {
      b.addEventListener('click', (e) => { e.stopPropagation(); removeVideo(b.dataset.remove); });
    });
    grid.querySelectorAll('.vid-edit[data-edit]').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const v = videos.find(x => String(x.id) === b.dataset.edit);
        if (v) openEditModal(v);
      });
    });
  }

  function openEditModal(v) {
    const servers = (window.state && Array.isArray(window.state.servers)) ? window.state.servers : [];
    const ov = document.createElement('div');
    ov.className = 'vid-modal-overlay';
    ov.innerHTML = `
      <div class="vid-modal">
        <div class="vid-modal-head">
          <h3>Edit Video</h3>
          <button class="vid-modal-close" title="Close">&#10005;</button>
        </div>
        <label class="vid-field">
          <span>Title</span>
          <input id="ved-title" type="text" maxlength="200" value="${esc(v.title || '')}">
        </label>
        <label class="vid-field">
          <span>Server <em>(optional &mdash; clear to unlink)</em></span>
          <input id="ved-server" type="text" list="ved-server-list" placeholder="No server" value="${esc(v.server_name || '')}">
          <datalist id="ved-server-list">
            ${servers.map(s => `<option value="${esc(s.name)}"></option>`).join('')}
          </datalist>
        </label>
        <label class="vid-check"><input id="ved-short" type="checkbox" ${v.is_short ? 'checked' : ''}> Mark as a Short</label>
        <div class="vid-modal-err" id="ved-err"></div>
        <div class="vid-modal-actions">
          <button class="vid-btn-cancel">Cancel</button>
          <button class="vid-btn-submit">Save</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    const close = () => { document.removeEventListener('keydown', onKey); ov.remove(); };
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('.vid-modal-close').addEventListener('click', close);
    ov.querySelector('.vid-btn-cancel').addEventListener('click', close);
    document.addEventListener('keydown', onKey);

    ov.querySelector('.vid-btn-submit').addEventListener('click', async () => {
      const title = ov.querySelector('#ved-title').value.trim();
      const serverName = ov.querySelector('#ved-server').value.trim();
      const isShort = ov.querySelector('#ved-short').checked;
      const match = servers.find(s => s.name === serverName);
      const serverId = match ? match.id : null;  // empty or invalid name -> unlink
      const errEl = ov.querySelector('#ved-err');
      const btn = ov.querySelector('.vid-btn-submit');
      btn.disabled = true; btn.textContent = 'Saving...';
      try {
        const token = window.state && window.state.user && window.state.user.token;
        const res = await fetch('https://api.therspshub.com/api/videos/edit.php', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_id: v.id, title, server_id: serverId, is_short: isShort ? 1 : 0 })
        }).then(r => r.json());
        if (res && res.success) {
          v.title = title || v.source_url;
          v.is_short = isShort ? 1 : 0;
          v.server_id = serverId;
          v.server_name = match ? match.name : null;
          close();
          if (window.showToast) window.showToast('Video updated.', 'success');
          if (hostEl) { buildFilters(hostEl); paintGrid(hostEl); }
        } else {
          errEl.textContent = (res && res.error) || 'Update failed.';
          btn.disabled = false; btn.textContent = 'Save';
        }
      } catch (e) {
        errEl.textContent = 'Update failed. Check your connection.';
        btn.disabled = false; btn.textContent = 'Save';
      }
    });
  }

  function openExternal(url) {
    if (window.hub && window.hub.openExternal) window.hub.openExternal(url);
    else window.open(url, '_blank', 'noopener');
  }

  function playVideo(v) {
    // YouTube and Rumble embed inline; Twitch/Kick can't from file://.
    const canEmbed = (v.platform === 'youtube' || v.platform === 'rumble') && v.embed;
    // No inline option AND no backup → just open the source in the browser.
    if (!canEmbed && !v.fallback_url) { openExternal(v.source_url); return; }

    const ov = document.createElement('div');
    ov.className = 'vid-player-overlay';
    ov.innerHTML = `
      <div class="vid-player-box">
        <button class="vid-player-close" title="Close">&#10005;</button>
        <div class="vid-player-frame" id="vid-pframe"></div>
        <div class="vid-player-info">
          <div class="vid-player-title">${esc(v.title || '')}</div>
          <div class="vid-player-sub">${esc(v.submitter)}${v.server_name ? ' &bull; ' + esc(v.server_name) : ''}</div>
          <div class="vid-player-stats">
            <button class="vid-like vid-like-lg${v.liked ? ' liked' : ''}" data-like="${v.id}" title="Like">
              <span class="vid-like-ic">&#9829;</span><span class="vid-like-n">${v.likes || 0}</span>
            </button>
            <span class="vid-views vid-player-views">&#128065; ${v.views || 0} views</span>
            <button class="vid-cbtn vid-cbtn-lg" id="vid-cmt-jump" title="Jump to comments">&#128172; ${v.comment_count || 0}</button>
            ${myName() && String(v.submitter).toLowerCase() !== myName().toLowerCase()
              ? `<button class="vid-report-btn" id="vid-report" title="Report this video">&#9873; Report</button>`
              : ''}
          </div>
          <div class="vid-player-actions" id="vid-pactions"></div>
        </div>
        <div class="vid-comments">
          <div class="vid-comments-head" id="vid-comments-head">Comments</div>
          <div class="vid-comment-form">
            <input class="vid-comment-input" id="vid-comment-input" type="text" placeholder="Add a comment…" maxlength="1000">
            <button class="vid-comment-post" id="vid-comment-post">Post</button>
          </div>
          <div class="vid-comment-list" id="vid-comment-list"><div class="vid-comment-empty">Loading comments…</div></div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    const close = () => { document.removeEventListener('keydown', onKey); ov.remove(); };
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('.vid-player-close').addEventListener('click', close);
    document.addEventListener('keydown', onKey);

    const frame   = ov.querySelector('#vid-pframe');
    const actions = ov.querySelector('#vid-pactions');

    const showEmbed = () => {
      // YouTube needs the ?origin param (must match the Referer main.js injects)
      // for the file:// embed to play. Rumble embeds as-is.
      let src = v.embed;
      if (v.platform === 'youtube') {
        src += (v.embed.includes('?') ? '&' : '?') + 'origin=https://therspshub.com&autoplay=1';
      }
      frame.innerHTML = `<iframe src="${esc(src)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    };
    const showBackup = () => {
      frame.innerHTML = `<video src="${esc(v.fallback_url)}" controls autoplay playsinline></video>`;
    };

    if (canEmbed) {
      showEmbed();
      if (v.fallback_url) {
        // The original may have been pulled from YouTube — let the viewer
        // fall back to the Hub-hosted backup copy with one click.
        const btn = document.createElement('button');
        btn.className = 'vid-backup-btn';
        btn.textContent = 'Not playing? Watch the Hub backup';
        btn.addEventListener('click', () => { showBackup(); btn.remove(); });
        actions.appendChild(btn);
      }
    } else {
      // Twitch / Kick can't embed from file:// — but we have a backup copy.
      showBackup();
      const a = document.createElement('button');
      a.className = 'vid-backup-btn';
      a.textContent = 'Open original on ' + v.platform;
      a.addEventListener('click', () => openExternal(v.source_url));
      actions.appendChild(a);
    }

    // Like button (in the player) + record a view on open.
    ov.querySelectorAll('.vid-like[data-like]').forEach(b =>
      b.addEventListener('click', () => toggleLike(b.dataset.like, b)));
    recordView(v);

    // Jump to the comment box.
    const cmtJump = ov.querySelector('#vid-cmt-jump');
    if (cmtJump) cmtJump.addEventListener('click', () => {
      const input = ov.querySelector('#vid-comment-input');
      if (input) { input.scrollIntoView({ behavior: 'smooth', block: 'center' }); input.focus(); }
    });

    // Report this video for staff review.
    const reportBtn = ov.querySelector('#vid-report');
    if (reportBtn) reportBtn.addEventListener('click', () => reportVideo(v, reportBtn));

    // Comments
    loadComments(v.id, ov);
    const cPost = ov.querySelector('#vid-comment-post');
    const cInput = ov.querySelector('#vid-comment-input');
    if (cPost) cPost.addEventListener('click', () => postComment(v.id, ov));
    if (cInput) cInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); postComment(v.id, ov); } });
    // GIF picker — same one Hub Chat uses, gated on the f_gif_support unlock.
    // attachGifPicker self-gates: non-owners get no button.
    if (typeof window.attachGifPicker === 'function') {
      const form = ov.querySelector('.vid-comment-form');
      if (form && cInput) window.attachGifPicker(form, cInput);
    }
  }

  // ── Comments ───────────────────────────────────────────────────────────
  function loadComments(videoId, ov) {
    const listEl = ov.querySelector('#vid-comment-list');
    const headEl = ov.querySelector('#vid-comments-head');
    if (!listEl) return;
    fetch('https://api.therspshub.com/api/videos/comments/list.php?video_id=' + videoId)
      .then(r => r.json())
      .then(data => {
        const comments = (data && data.comments) || [];
        if (headEl) headEl.textContent = comments.length ? `Comments (${comments.length})` : 'Comments';
        renderComments(listEl, comments, videoId, ov);
      })
      .catch(() => { listEl.innerHTML = '<div class="vid-comment-empty">Could not load comments.</div>'; });
  }

  function renderComments(listEl, comments, videoId, ov) {
    const mine2 = (window.state && window.state.user && window.state.user.username) || '';
    const staff = isStaff();
    if (!comments.length) { listEl.innerHTML = '<div class="vid-comment-empty">No comments yet. Be the first.</div>'; return; }
    listEl.innerHTML = comments.map(c => {
      const canDel = staff || (mine2 && String(c.username).toLowerCase() === mine2.toLowerCase());
      const av = c.avatar
        ? `<img class="vid-cmt-av" src="${esc(c.avatar)}" onerror="this.style.display='none'">`
        : `<div class="vid-cmt-av vid-cmt-av-ph">${esc((String(c.username)[0] || '?').toUpperCase())}</div>`;
      const badge = c.is_staff ? '<span class="vid-cmt-staff">STAFF</span>' : '';
      const del = canDel ? `<button class="vid-cmt-del" data-del="${c.id}" title="Delete">&#10005;</button>` : '';
      return `<div class="vid-cmt">
        ${av}
        <div class="vid-cmt-main">
          <div class="vid-cmt-top"><span class="vid-cmt-name">${esc(c.username)}</span>${badge}<span class="vid-cmt-time">${timeAgo(c.created_at)}</span>${del}</div>
          <div class="vid-cmt-text">${typeof window.renderChatBody === 'function' ? window.renderChatBody(c.body) : esc(c.body)}</div>
        </div>
      </div>`;
    }).join('');
    listEl.querySelectorAll('.vid-cmt-del[data-del]').forEach(b =>
      b.addEventListener('click', () => deleteComment(b.dataset.del, videoId, ov)));
  }

  function postComment(videoId, ov) {
    const input = ov.querySelector('#vid-comment-input');
    const text = input.value.trim();
    if (!text) return;
    const token = window.state && window.state.user && window.state.user.token;
    if (!token) { if (window.showToast) window.showToast('Log in to comment.', 'error'); return; }
    const btn = ov.querySelector('#vid-comment-post');
    btn.disabled = true;
    fetch('https://api.therspshub.com/api/videos/comments/post.php', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_id: videoId, body: text })
    }).then(r => r.json()).then(res => {
      btn.disabled = false;
      if (res && res.success) { input.value = ''; loadComments(videoId, ov); }
      else if (window.showToast) window.showToast((res && res.error) || 'Could not post.', 'error');
    }).catch(() => { btn.disabled = false; if (window.showToast) window.showToast('Could not post comment.', 'error'); });
  }

  function deleteComment(commentId, videoId, ov) {
    const token = window.state && window.state.user && window.state.user.token;
    fetch('https://api.therspshub.com/api/videos/comments/delete.php', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment_id: Number(commentId) })
    }).then(r => r.json()).then(res => { if (res && res.success) loadComments(videoId, ov); }).catch(() => {});
  }

  function openSubmitModal(el) {
    const servers = (window.state && Array.isArray(window.state.servers)) ? window.state.servers : [];
    const ov = document.createElement('div');
    ov.className = 'vid-modal-overlay';
    ov.innerHTML = `
      <div class="vid-modal">
        <div class="vid-modal-head">
          <h3>Submit Video</h3>
          <button class="vid-modal-close" title="Close">&#10005;</button>
        </div>
        <p class="vid-modal-hint">Paste a YouTube, Twitch, Kick, or Rumble video link</p>
        <label class="vid-field">
          <span>Video URL</span>
          <input id="vid-url" type="text" placeholder="youtube.com/watch?v=… · twitch.tv/videos/… · rumble.com/v…">
        </label>
        <label class="vid-field">
          <span>Title <em>(optional, auto-detected for YouTube &amp; Rumble)</em></span>
          <input id="vid-title" type="text" maxlength="200" placeholder="Leave blank to auto-detect">
        </label>
        <label class="vid-field">
          <span>Description <em>(optional)</em></span>
          <textarea id="vid-desc" maxlength="2000" placeholder="Add a description..."></textarea>
        </label>
        <label class="vid-field">
          <span>Server <em>(optional)</em></span>
          <input id="vid-server" type="text" list="vid-server-list" placeholder="Search for a server...">
          <datalist id="vid-server-list">
            ${servers.map(s => `<option value="${esc(s.name)}"></option>`).join('')}
          </datalist>
        </label>
        <label class="vid-check"><input id="vid-short" type="checkbox"> This is a Short <em>(vertical clip, usually under a minute)</em></label>
        <div class="vid-modal-err" id="vid-err"></div>
        <div class="vid-modal-actions">
          <button class="vid-btn-cancel">Cancel</button>
          <button class="vid-btn-submit">Submit Video</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    const close = () => { document.removeEventListener('keydown', onKey); ov.remove(); };
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('.vid-modal-close').addEventListener('click', close);
    ov.querySelector('.vid-btn-cancel').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    setTimeout(() => ov.querySelector('#vid-url')?.focus(), 30);

    ov.querySelector('.vid-btn-submit').addEventListener('click', async () => {
      const url = ov.querySelector('#vid-url').value.trim();
      const title = ov.querySelector('#vid-title').value.trim();
      const desc = ov.querySelector('#vid-desc').value.trim();
      const serverName = ov.querySelector('#vid-server').value.trim();
      const isShort = ov.querySelector('#vid-short').checked;
      const errEl = ov.querySelector('#vid-err');
      errEl.textContent = '';
      if (!url) { errEl.textContent = 'Paste a video URL.'; return; }
      const match = servers.find(s => s.name === serverName);
      const body = { url, title, description: desc };
      if (match) body.server_id = match.id;
      if (isShort) body.is_short = 1;
      const btn = ov.querySelector('.vid-btn-submit');
      btn.disabled = true; btn.textContent = 'Submitting...';
      try {
        const res = await window.hub.post('/api/videos/submit', body);
        if (res && res.error) {
          errEl.textContent = res.error;
          btn.disabled = false; btn.textContent = 'Submit Video';
          return;
        }
        close();
        if (window.showToast) window.showToast('Video submitted!', 'success');
        const host = document.getElementById('alt-content');
        if (host) render(host);
      } catch (e) {
        errEl.textContent = 'Submit failed. Check your connection and try again.';
        btn.disabled = false; btn.textContent = 'Submit Video';
      }
    });
  }

  async function render(el) {
    if (!el) el = document.getElementById('alt-content');
    if (!el) return;
    hostEl = el;
    el.innerHTML = `
      <div class="vid-page">
        <div class="vid-header">
          <h2>VIDEOS <small>Streams &amp; videos from the community</small></h2>
          <div class="vid-header-actions">
            ${isStaff() ? `<button class="vid-reports-btn" id="vid-reports-open" title="Review reported videos">&#9873; Reports</button>` : ''}
            <button class="vid-submit-btn" id="vid-submit-open">+ Submit Video</button>
          </div>
        </div>
        <div class="vid-filters" id="vid-filters"></div>
        <div class="vid-grid" id="vid-grid"><div class="vid-loading">Loading videos&hellip;</div></div>
      </div>`;
    el.querySelector('#vid-submit-open').addEventListener('click', () => openSubmitModal(el));
    const repOpen = el.querySelector('#vid-reports-open');
    if (repOpen) repOpen.addEventListener('click', () => openReportsModal());
    await fetchVideos();
    buildFilters(el);
    paintGrid(el);
    if (isStaff()) refreshReportCount();
  }

  // Staff: keep the "Reports" button's badge in sync with the pending queue.
  function refreshReportCount() {
    const token = window.state && window.state.user && window.state.user.token;
    if (!token) return;
    fetch('https://api.therspshub.com/api/videos/reports.php', {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(r => r.json()).then(data => {
      const n = (data && data.count) || 0;
      const btn = document.getElementById('vid-reports-open');
      if (!btn) return;
      btn.innerHTML = n > 0 ? `&#9873; Reports <span class="vid-reports-badge">${n}</span>` : '&#9873; Reports';
      btn.classList.toggle('has-pending', n > 0);
    }).catch(() => {});
  }

  function openReportsModal() {
    const token = window.state && window.state.user && window.state.user.token;
    const ov = document.createElement('div');
    ov.className = 'vid-modal-overlay';
    ov.innerHTML = `
      <div class="vid-modal vid-reports-modal">
        <div class="vid-modal-head">
          <h3>&#9873; Reported Videos</h3>
          <button class="vid-modal-close" title="Close">&#10005;</button>
        </div>
        <div class="vid-reports-list" id="vid-reports-list"><div class="vid-comment-empty">Loading…</div></div>
      </div>`;
    document.body.appendChild(ov);
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    const close = () => { document.removeEventListener('keydown', onKey); ov.remove(); };
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('.vid-modal-close').addEventListener('click', close);
    document.addEventListener('keydown', onKey);

    const listEl = ov.querySelector('#vid-reports-list');
    const load = () => {
      fetch('https://api.therspshub.com/api/videos/reports.php', {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(r => r.json()).then(data => {
        const reps = (data && data.reports) || [];
        if (!reps.length) { listEl.innerHTML = `<div class="vid-comment-empty">No reported videos. All clear. &#10003;</div>`; return; }
        listEl.innerHTML = reps.map(reportRowHtml).join('');
        listEl.querySelectorAll('[data-rep-open]').forEach(b =>
          b.addEventListener('click', () => openExternal(b.dataset.repOpen)));
        listEl.querySelectorAll('[data-dismiss]').forEach(b =>
          b.addEventListener('click', () => resolveReport(b.dataset.dismiss, 'dismiss', load)));
        listEl.querySelectorAll('[data-remove]').forEach(b =>
          b.addEventListener('click', () => resolveReport(b.dataset.remove, 'remove', load)));
      }).catch(() => { listEl.innerHTML = `<div class="vid-comment-empty">Could not load reports.</div>`; });
    };
    load();
  }

  function reportRowHtml(r) {
    const hidden = r.status === 'flagged'
      ? `<span class="vid-rep-hidden" title="Auto-hidden after reaching the report threshold">auto-hidden</span>` : '';
    const reporters = (r.reporters || []).map(rep =>
      `<span class="vid-rep-who">${esc(rep.username)}${rep.reason ? ': ' + esc(rep.reason) : ''}</span>`).join('');
    const thumb = r.thumb
      ? `<img class="vid-rep-thumb" src="${esc(r.thumb)}" onerror="this.style.display='none'">`
      : `<div class="vid-rep-thumb"></div>`;
    return `<div class="vid-rep-item">
      ${thumb}
      <div class="vid-rep-info">
        <div class="vid-rep-title">${esc(r.title)} ${hidden}</div>
        <div class="vid-rep-meta">by ${esc(r.submitter)} &bull; ${esc(r.platform)} &bull; <span class="vid-rep-count">&#9873; ${r.report_count} report${r.report_count === 1 ? '' : 's'}</span></div>
        <div class="vid-rep-reasons">${reporters || '<em>no reason given</em>'}</div>
        <button class="vid-rep-watch" data-rep-open="${esc(r.source_url)}">Watch on ${esc(r.platform)} &#8599;</button>
      </div>
      <div class="vid-rep-actions">
        <button class="vid-rep-keep" data-dismiss="${r.id}" title="Clear reports and keep the video">Keep</button>
        <button class="vid-rep-del" data-remove="${r.id}" title="Remove the video from the feed">Remove</button>
      </div>
    </div>`;
  }

  function resolveReport(id, action, reload) {
    const token = window.state && window.state.user && window.state.user.token;
    const verb = action === 'remove' ? 'Remove this video from the feed?' : 'Clear reports and keep this video?';
    const go = () => {
      fetch('https://api.therspshub.com/api/videos/report-resolve.php', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: Number(id), action })
      }).then(r => r.json()).then(res => {
        if (res && res.success) {
          if (window.showToast) window.showToast(action === 'remove' ? 'Video removed.' : 'Reports cleared.', 'info');
          if (typeof reload === 'function') reload();
          refreshReportCount();
          // The feed may have changed (a removed video, or a restored one) — refresh it.
          fetchVideos().then(() => { if (hostEl) { buildFilters(hostEl); paintGrid(hostEl); } });
        } else if (window.showToast) window.showToast((res && res.error) || 'Action failed.', 'error');
      }).catch(() => { if (window.showToast) window.showToast('Action failed.', 'error'); });
    };
    if (typeof window.confirmThemed === 'function') window.confirmThemed(verb).then(ok => { if (ok) go(); });
    else if (confirm(verb)) go();
  }

  window.renderVideos = render;
})();
