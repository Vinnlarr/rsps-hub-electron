const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron');
const { spawn, execSync } = require('child_process');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const http = require('http');
const fs   = require('fs');
const os   = require('os');

const RSPS_DIR      = path.join(os.homedir(), '.rsps_hub');
const PROFILE_PATH  = path.join(RSPS_DIR, 'profile.json');
// Persisted launcher-update preference. Read on startup BEFORE
// electron-updater fires so toggling it actually takes effect.
const UPDATER_PREF_PATH = path.join(RSPS_DIR, 'auto_update_launcher.json');
function readAutoUpdateLauncher() {
  try {
    const raw = fs.readFileSync(UPDATER_PREF_PATH, 'utf8');
    const j = JSON.parse(raw);
    return typeof j.enabled === 'boolean' ? j.enabled : true; // default: on
  } catch { return true; }
}
function writeAutoUpdateLauncher(enabled) {
  try {
    fs.mkdirSync(RSPS_DIR, { recursive: true });
    fs.writeFileSync(UPDATER_PREF_PATH, JSON.stringify({ enabled: !!enabled }));
  } catch (e) { console.error('[updater] failed saving pref:', e?.message); }
}
const AVATAR_PATH   = path.join(RSPS_DIR, 'avatar.png');
const PLAYTIME_PATH = path.join(RSPS_DIR, 'playtime.json');
// Legacy (pre-per-user) paths — still read as a fallback and auto-migrated to
// the first user who logs in after this release.
const LEGACY_MESSAGES_PATH    = path.join(RSPS_DIR, 'messages.json');
const LEGACY_MUSIC_PREFS_PATH = path.join(RSPS_DIR, 'music_prefs.json');

// Tracks which user is currently logged in. Renderer updates this via
// set-active-user on login/register/session-restore/logout.
let activeUser = null;

function safeUsername(u) {
  return String(u || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}
function userDir(username) {
  const dir = path.join(RSPS_DIR, 'users', safeUsername(username));
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}
function messagesPath()   { return activeUser ? path.join(userDir(activeUser), 'messages.json')    : null; }
function musicPrefsPath() { return activeUser ? path.join(userDir(activeUser), 'music_prefs.json') : null; }

// One-shot migration: when a user first logs in after the upgrade, move any
// existing legacy top-level files into their user directory. Keeps current
// Vinnlarr's DMs + music favs intact on upgrade, everyone else starts fresh.
function migrateLegacyFor(username) {
  const udir = userDir(username);
  const pairs = [
    [LEGACY_MESSAGES_PATH,    path.join(udir, 'messages.json')],
    [LEGACY_MUSIC_PREFS_PATH, path.join(udir, 'music_prefs.json')],
  ];
  for (const [src, dst] of pairs) {
    try {
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.renameSync(src, dst);
        console.log('[migrate] moved', src, '->', dst);
      }
    } catch (e) { console.warn('[migrate] failed', src, e.message); }
  }
}

const JAVA_PORT = 7890;
// Generated fresh each launch — never stored in code or on disk
const API_SECRET = require('crypto').randomBytes(32).toString('hex');
let mainWindow;
let javaProcess;

// ── JAVA BACKEND ─────────────────────────────────────────────────────────────

function killPortIfBusy(port) {
  try {
    if (process.platform === 'win32') {
      const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
      const match = result.match(/\s+(\d+)\s*$/m);
      if (match) execSync(`taskkill /F /PID ${match[1]}`, { stdio: 'ignore' });
    } else {
      // macOS and Linux ship lsof. Find any PID listening on `port` and kill
      // it so a stale backend from a previous crash doesn't block startup.
      try {
        const out = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8' }).trim();
        if (out) {
          for (const pid of out.split(/\s+/)) {
            try { process.kill(parseInt(pid, 10), 'SIGKILL'); } catch (_) {}
          }
        }
      } catch (_) { /* lsof returns non-zero when nothing matches, that's fine */ }
    }
  } catch (_) {}
}

function startJavaBackend() {
  killPortIfBusy(JAVA_PORT);
  const isDev = !app.isPackaged;
  const javaBackendRoot = isDev
    ? path.join(__dirname, 'java-backend')
    : path.join(process.resourcesPath, 'java-backend');
  const javaBackendPath = path.join(javaBackendRoot, 'bin');

  // On Windows use the .bat, on Unix use the shell script
  const scriptName = process.platform === 'win32' ? 'RSPSHub.bat' : 'RSPSHub';
  const scriptPath = path.join(javaBackendPath, scriptName);

  // Bundled JRE so users don't need Java installed (fixes Wine/Linux and no-java Windows users)
  const bundledJreHome = path.join(javaBackendRoot, 'jre');
  const hasBundledJre = fs.existsSync(path.join(bundledJreHome, 'bin',
    process.platform === 'win32' ? 'java.exe' : 'java'));

  const childEnv = {
    ...process.env,
    RSPS_HUB_API_MODE: 'true',
    // API secret via env, not argv — argv is visible in `tasklist /v` to any local process
    RSPS_HUB_API_KEY: API_SECRET,
    // Launcher version so the Java backend can tag every API request with
    // X-Launcher-Version. The hub API uses this to refuse old launchers
    // and force them through the auto-updater.
    RSPS_HUB_LAUNCHER_VERSION: app.getVersion(),
  };
  if (hasBundledJre) childEnv.JAVA_HOME = bundledJreHome;

  // Note: --api-key is kept as a fallback while in-flight Java versions roll out.
  //
  // IMPORTANT: on Windows we quote scriptPath manually and pass via `shell:
  // true` as a single command string. Node's child_process doesn't reliably
  // quote spaces when `shell: true` is set with separate args, which silently
  // breaks for any user whose Windows username contains a space (e.g.
  // "C:\Users\John Smith\AppData\..." → cmd parses as `C:\Users\John` →
  // "is not recognized" error → Java never starts → ECONNREFUSED on /api/auth.
  if (process.platform === 'win32') {
    const cmdLine = `"${scriptPath}" --api-mode --port ${JAVA_PORT}`;
    javaProcess = spawn(cmdLine, [], {
      env: childEnv,
      windowsHide: true,
      shell: true,
    });
  } else {
    javaProcess = spawn(scriptPath, ['--api-mode', '--port', String(JAVA_PORT)], {
      env: childEnv,
      windowsHide: true,
    });
  }

  javaProcess.stdout.on('data', d => console.log('[Java]', d.toString().trim()));
  javaProcess.stderr.on('data', d => console.error('[Java]', d.toString().trim()));
  javaProcess.on('exit', code => console.log('[Java] exited with code', code));
}

// Poll until Java backend is up, then open the window
// 120 retries * 500ms = 60s (slow systems / Wine can take 30s+ to start JVM)
function waitForBackend(callback, retries = 120) {
  http.get(`http://localhost:${JAVA_PORT}/api/ping`, res => {
    if (res.statusCode === 200) callback();
    else retry();
  }).on('error', retry);

  function retry() {
    if (retries <= 0) { callback(); return; } // open anyway after timeout
    setTimeout(() => waitForBackend(callback, retries - 1), 500);
  }
}

// Shared: check if backend is alive right now
function isBackendAlive() {
  return new Promise(resolve => {
    const r = http.get(`http://localhost:${JAVA_PORT}/api/ping`, res => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    r.on('error', () => resolve(false));
    r.setTimeout(1000, () => { r.destroy(); resolve(false); });
  });
}

// ── WINDOW ───────────────────────────────────────────────────────────────────

function createWindow() {
  // macOS gets the native "traffic light" close/min/max buttons positioned
  // inside our custom title-bar area via hiddenInset. On Windows + Linux we
  // keep the fully frameless window with our own custom buttons. Mixing the
  // two on the wrong platform looks broken (duplicate close buttons, or
  // missing window controls).
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1100,
    minHeight: 650,
    frame: false,          // custom title bar everywhere
    titleBarStyle: isMac ? 'hiddenInset' : 'default', // shows native traffic lights on Mac
    trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
    transparent: false,
    backgroundColor: '#0f1115',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Production builds disable DevTools entirely. Users shouldn't be able
      // to open the renderer console to inspect auth tokens, edit UI state,
      // or tamper with the API layer. Dev builds keep it enabled.
      devTools: !app.isPackaged,
      // Enable <webview> so the BlueMoon tab can embed bmtcg.com/play
      // (plain iframe is blocked by their X-Frame-Options: SAMEORIGIN).
      webviewTag: true,
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));

  // Defense-in-depth: even though devTools:false blocks openDevTools(), also
  // intercept the keyboard shortcuts (F12, Ctrl+Shift+I/J/C, Cmd+Opt+I)
  // in packaged builds so the UI doesn't flash a DevTools window attempt.
  if (app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const key = (input.key || '').toLowerCase();
      const ctrlShift = (input.control || input.meta) && input.shift;
      const blocked =
        key === 'f12' ||
        (ctrlShift && (key === 'i' || key === 'j' || key === 'c')) ||
        (input.meta && input.alt && key === 'i'); // Cmd+Option+I on macOS
      if (blocked) event.preventDefault();
    });
  }

  // Lock the renderer down: no external navigation, no popups
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(parsed.href);
      }
    } catch (_) {}
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Only allow file:// (our own index.html); everything else opens externally
    if (!url.startsWith('file://')) {
      event.preventDefault();
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          shell.openExternal(parsed.href);
        }
      } catch (_) {}
    }
  });

  // Open DevTools in dev mode
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// Lock down every <webview> the renderer creates. Today the BlueMoon TCG tab
// is the only one (src=https://bmtcg.com/play/), but we apply a strict policy
// to any future webview by default:
//   - strip preload, nodeIntegration, and the contextBridge so injected
//     scripts inside the webview can't reach IPC or filesystem
//   - pin navigation to the original host; a compromised page can't redirect
//     the embedded view to an attacker origin
//   - deny window.open() from inside the webview entirely
//
// Webview policy is enforced from the main process because the renderer
// can't be trusted to set its own <webview> attributes correctly.
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;
  // Pin navigation to whatever host the webview originally loaded.
  let pinnedHost = null;
  try {
    pinnedHost = new URL(contents.getURL()).host;
  } catch { /* set on first did-navigate below */ }
  contents.on('did-navigate', (_e, url) => {
    if (!pinnedHost) {
      try { pinnedHost = new URL(url).host; } catch {}
    }
  });
  contents.on('will-navigate', (e, url) => {
    try {
      const host = new URL(url).host;
      if (pinnedHost && host !== pinnedHost) {
        console.warn('[webview] blocked navigation to', host, '(pinned to', pinnedHost + ')');
        e.preventDefault();
      }
    } catch {
      e.preventDefault();
    }
  });
  // Deny window.open from inside the webview. Send normal http(s) links
  // to the system browser, drop anything else.
  contents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(parsed.href);
      }
    } catch {}
    return { action: 'deny' };
  });
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (_e, webPreferences, params) => {
    // Strip anything that could give the embedded page access to Electron
    // primitives. We only want a plain sandboxed browser tab.
    delete webPreferences.preload;
    delete webPreferences.preloadURL;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    // Block popups regardless of whether the renderer set allowpopups.
    params.allowpopups = false;
  });
});

// ── IPC HANDLERS ─────────────────────────────────────────────────────────────

// Window controls
ipcMain.on('window-minimize', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize(); });
ipcMain.on('window-maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  }
});
ipcMain.on('window-close', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close(); });

// Open external links in browser (Discord, website etc.)
// Allowlist http/https only — prevents file:// RCE via malicious server discordUrl/websiteUrl
ipcMain.on('open-external', (_, url) => {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      shell.openExternal(parsed.href);
    } else {
      console.warn('[open-external] blocked non-http(s) protocol:', parsed.protocol);
    }
  } catch (_) {
    console.warn('[open-external] blocked invalid URL:', url);
  }
});

// Internal helper to call our Java backend from main process code (not from
// the renderer). Used by the web-server launch path below. Same auth + retry
// semantics as the ipcMain api-call handler, but callable directly without
// going through IPC.
function callJavaBackend(method, apiPath, body) {
  return new Promise(resolve => {
    const options = {
      hostname: 'localhost',
      port: JAVA_PORT,
      path: apiPath,
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_SECRET },
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', err => resolve({ error: err.message || 'request failed' }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// API proxy — renderer asks main to call Java backend
// Auto-retries on ECONNREFUSED (Java still starting) up to ~15s before giving up
ipcMain.handle('api-call', async (_, { method, path: apiPath, body }) => {
  const attempt = (triesLeft) => new Promise(resolve => {
    const options = {
      hostname: 'localhost',
      port: JAVA_PORT,
      path: apiPath,
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_SECRET }
    };

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); }
        catch { parsed = { raw: data }; }

        // Hub API returns 426 + {error:"launcher_update_required",...} when
        // the launcher is below the configured min version. Broadcast that
        // to every renderer window so the blocking "Update Required" modal
        // can fire from one place instead of every callsite checking.
        if (parsed && parsed.error === 'launcher_update_required') {
          try {
            const { BrowserWindow } = require('electron');
            BrowserWindow.getAllWindows().forEach(w => {
              if (!w.isDestroyed()) w.webContents.send('launcher-update-required', parsed);
            });
          } catch (_) {}
        }

        resolve(parsed);
      });
    });

    req.on('error', (err) => {
      // Backend still coming up — retry with backoff
      const recoverable = err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
      if (recoverable && triesLeft > 0) {
        console.log(`[api-call] ${err.code}, retrying (${triesLeft} left)...`);
        setTimeout(() => attempt(triesLeft - 1).then(resolve), 500);
        return;
      }
      console.error('[api-call] Backend connection error:', err.code, err.message);
      // Generic restart advice doesn't help if the cause is AV killing
      // Java. Give actually-useful next steps.
      const code = err.code || err.message || 'UNKNOWN';
      const friendly =
        'The launcher backend isn\'t responding (' + code + ').\n' +
        'Try these in order:\n' +
        '1. Fully close the launcher (both windows), then reopen it.\n' +
        '2. Check your antivirus / Windows Defender \u2014 it may have blocked Java. ' +
        'Add an exception for the RSPS Hub install folder.\n' +
        '3. Reinstall from https://therspshub.com if the issue persists.';
      resolve({ error: friendly });
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });

  return attempt(30); // 30 retries * 500ms = 15s
});

// Username sanitization — must match server-side regex ^[a-zA-Z0-9_]{3,32}$
// Prevents path traversal, backslash injection, and Windows reserved names
function safeUsername(u) {
  if (typeof u !== 'string') return null;
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(u)) return null;
  return u;
}

// Ensures a resolved path stays within RSPS_DIR after joining — belt-and-braces defense
function insideHub(resolved) {
  const root = path.resolve(RSPS_DIR) + path.sep;
  return path.resolve(resolved).startsWith(root);
}

// Profile — read/write ~/.rsps_hub/{username}/profile.json (per-user)
ipcMain.handle('profile-get', (_, username) => {
  const DEFAULT = { displayName: '', bio: '', visibility: 'online', avatarPath: null };
  try {
    const u = safeUsername(username);
    if (!u) return DEFAULT;
    const p = path.join(RSPS_DIR, u, 'profile.json');
    if (!insideHub(p)) return DEFAULT;
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {}
  return DEFAULT;
});

ipcMain.handle('profile-save', (_, data) => {
  try {
    const u = safeUsername(data?.username);
    if (!u) return { error: 'Invalid username' };
    const dir = path.join(RSPS_DIR, u);
    const file = path.join(dir, 'profile.json');
    if (!insideHub(dir) || !insideHub(file)) return { error: 'Invalid path' };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
});

// Local playtime — read/write ~/.rsps_hub/playtime.json { "ServerName": minutesPlayed }
ipcMain.handle('playtime-get', () => {
  try {
    if (fs.existsSync(PLAYTIME_PATH))
      return JSON.parse(fs.readFileSync(PLAYTIME_PATH, 'utf8'));
  } catch (_) {}
  return {};
});

ipcMain.handle('playtime-save', (_, data) => {
  try {
    fs.mkdirSync(RSPS_DIR, { recursive: true });
    fs.writeFileSync(PLAYTIME_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch (_) { return false; }
});

// Renderer calls this on login/register/session-restore/logout so the file
// paths below lock to the current user's directory. Pass null/empty on logout
// to isolate the unauthed state (no reads/writes).
ipcMain.handle('set-active-user', (_, username) => {
  activeUser = username ? String(username) : null;
  if (activeUser) migrateLegacyFor(activeUser);
  return { user: activeUser };
});

// Messages — stored per-user under ~/.rsps_hub/users/<name>/messages.json
ipcMain.handle('messages-get', () => {
  const p = messagesPath();
  if (!p) return {}; // not logged in — never surface legacy/other users' data
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {}
  return {};
});

ipcMain.handle('messages-save', (_, data) => {
  const p = messagesPath();
  if (!p) return false;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
    return true;
  } catch (_) { return false; }
});

// Music prefs: favorites, volume, shuffle, repeat, last track — per-user.
const MUSIC_DEFAULTS = { favorites: [], volume: 0.6, shuffle: false, repeat: 'off', lastTrackId: null };
ipcMain.handle('music-prefs-get', () => {
  const p = musicPrefsPath();
  if (!p) return MUSIC_DEFAULTS;
  try {
    if (fs.existsSync(p)) {
      return { ...MUSIC_DEFAULTS, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
    }
  } catch (_) {}
  return MUSIC_DEFAULTS;
});
ipcMain.handle('music-prefs-save', (_, data) => {
  const p = musicPrefsPath();
  if (!p) return false;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const merged = { ...MUSIC_DEFAULTS, ...(data || {}) };
    fs.writeFileSync(p, JSON.stringify(merged, null, 2));
    return true;
  } catch (_) { return false; }
});

// Avatar flow — picked path stays in MAIN process memory. Never trust renderer-supplied paths.
let _pickedAvatarPath = null;
const ALLOWED_IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

ipcMain.handle('pick-avatar', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Avatar',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) { _pickedAvatarPath = null; return null; }
  const picked = result.filePaths[0];
  const ext = path.extname(picked).toLowerCase();
  if (!ALLOWED_IMG_EXT.has(ext)) { _pickedAvatarPath = null; return null; }
  try {
    const stat = fs.statSync(picked);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) { _pickedAvatarPath = null; return null; }
  } catch { _pickedAvatarPath = null; return null; }
  _pickedAvatarPath = picked;
  // Return a display-only path; not used for any file op
  return picked;
});

// Copy the MOST RECENTLY PICKED avatar to the hub folder. Ignores any renderer-supplied path.
ipcMain.handle('save-avatar', () => {
  try {
    if (!_pickedAvatarPath) return null;
    fs.mkdirSync(RSPS_DIR, { recursive: true });
    fs.copyFileSync(_pickedAvatarPath, AVATAR_PATH);
    _pickedAvatarPath = null; // single-use
    return AVATAR_PATH;
  } catch (_) { return null; }
});

// Read a file as base64 — STRICT: only reads the avatar path, or the most-recently-picked avatar.
// Previously took an arbitrary path, which was a full filesystem read vulnerability.
ipcMain.handle('read-file-base64', (_, filePath) => {
  try {
    const resolved = path.resolve(String(filePath || ''));
    const isAvatar = resolved === path.resolve(AVATAR_PATH);
    const isPicked = _pickedAvatarPath && resolved === path.resolve(_pickedAvatarPath);
    if (!isAvatar && !isPicked) return null;
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return null;
    return fs.readFileSync(resolved).toString('base64');
  } catch { return null; }
});

// Settings — pick a download folder
ipcMain.handle('select-folder', async (_, defaultPath) => {
  const opts = {
    title: 'Choose Download Folder',
    properties: ['openDirectory']
  };
  if (defaultPath) opts.defaultPath = defaultPath;
  const result = await dialog.showOpenDialog(mainWindow, opts);
  return result.canceled ? null : result.filePaths[0];
});

// ── AUTO UPDATER ─────────────────────────────────────────────────────────────

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  // Honour the user's "Auto-Update Launcher" setting. When OFF we still
  // CHECK for updates (so the renderer can show "update available, click
  // to download" if we want to surface that later), but we don't auto-pull
  // the installer in the background.
  autoUpdater.autoDownload = readAutoUpdateLauncher();
  autoUpdater.autoInstallOnAppQuit = false; // handled manually via install-update
  autoUpdater.logger = require('electron-log');
  autoUpdater.logger.transports.file.level = 'info';

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Checking for update...');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-checking');
    }
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[updater] Already up to date.');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-not-available');
    }
  });
  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err?.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-error', err?.message || 'unknown error');
    }
  });
  autoUpdater.on('download-progress', (p) => console.log(`[updater] Downloaded ${Math.round(p.percent)}%`));

  autoUpdater.on('update-available', () => {
    console.log('[updater] Update available, downloading...');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available');
    }
  });

  autoUpdater.on('update-downloaded', () => {
    console.log('[updater] Update downloaded, ready to install.');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded');
    }
  });

  // Initial check, 5 seconds after launch so the renderer is ready.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => console.error('[updater] checkForUpdates error:', err?.message));
  }, 5000);

  // Periodic re-check every hour. The original single-shot check at boot
  // meant launchers left open for days never picked up new releases, which
  // is the main reason we have so many users still on v1.0.50. This loop
  // makes sure long-running launchers eventually see new versions without
  // requiring the user to restart.
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => console.error('[updater] periodic check error:', err?.message));
  }, 60 * 60 * 1000);
}

// Renderer-triggered manual check (the "Check for updates" button in
// the sidebar). We always reply with one of: update-checking, update-
// not-available, update-available, update-error so the UI can give
// concrete feedback instead of going silent.
ipcMain.on('check-for-update', () => {
  if (!app.isPackaged) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-not-available');
    }
    return;
  }
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[updater] manual check error:', err?.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-error', err?.message || 'check failed');
    }
  });
});

ipcMain.handle('app-version', () => app.getVersion());

ipcMain.on('install-update', () => {
  killJava();
  // Wait for Java process tree to fully die before handing off to NSIS
  setTimeout(() => autoUpdater.quitAndInstall(true, true), 1000);
});

// Renderer toggles the launcher auto-update preference. Persists to disk
// AND updates the live electron-updater config in this session, so the
// change takes effect immediately without a relaunch.
ipcMain.handle('set-auto-update-launcher', (_e, enabled) => {
  writeAutoUpdateLauncher(!!enabled);
  try { autoUpdater.autoDownload = !!enabled; } catch {}
  return true;
});
ipcMain.handle('get-auto-update-launcher', () => readAutoUpdateLauncher());

// ── CHAT POPOUT WINDOWS ──────────────────────────────────────
// One floating BrowserWindow per chat surface (Hub or DM with a specific
// user). Always-on-top by default so they stay visible while the user has
// a game client focused. Each popout uses fetch() against the local Java
// backend on 127.0.0.1:7890 — Java auth is in-process state so no auth
// plumbing is needed beyond running on the same machine.
const chatPopouts = new Map(); // key (`hub` or `dm:<user>`) -> BrowserWindow

// ── WEB-CLIENT SERVERS ────────────────────────────────────────────────────
// Some RSPS run entirely in the browser (LostCity, Xternium, BlueMoon-style
// servers). For these the launcher opens a dedicated BrowserWindow loading
// the play URL and tracks playtime via the same session_* endpoints JAR
// servers use, just driven by window lifecycle instead of a child process.
//
// Map of serverId -> { window, pingInterval, name }
const webSessions = new Map();

function endWebSessionTracking(serverId) {
  const sess = webSessions.get(serverId);
  if (!sess) return;
  clearInterval(sess.pingInterval);
  webSessions.delete(serverId);
  callJavaBackend('POST', '/api/session/end', { server_id: serverId })
    .catch(() => { /* reaper cleans up if this fails */ });
  // Tell every renderer that the web session has ended so it can hide
  // chips, refresh playtime, etc.
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.isDestroyed()) w.webContents.send('web-session-ended', { serverId });
  });
}

ipcMain.handle('launch-web-server', async (_e, { serverId, name, url }) => {
  if (!serverId || !url) return { error: 'missing serverId or url' };
  // If a window for this server is already open, just focus it.
  const existing = webSessions.get(serverId);
  if (existing && !existing.window.isDestroyed()) {
    existing.window.show();
    existing.window.focus();
    return { reused: true };
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: `${name || 'Web Client'} — RSPS Hub`,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Browser-style permissions: site can persist its own cookies / storage
      // so the user stays logged in to the game between launches.
      partition: `persist:webserver-${serverId}`,
    },
  });
  // Hide the OS menu entirely. The web client is the only thing in here.
  win.setMenuBarVisibility(false);
  win.loadURL(url);

  // Kick off session tracking. We don't await — if the API is briefly
  // unreachable we still want the game window to open promptly. The reaper
  // and subsequent pings will reconcile.
  callJavaBackend('POST', '/api/session/start', { server_id: serverId })
    .catch(() => {});

  const pingInterval = setInterval(() => {
    if (win.isDestroyed()) return;
    // Don't count time when the user has minimized or hidden the window.
    // Matches the JAR-side rule: no fake playtime when nobody is at the keyboard.
    if (!win.isVisible() || win.isMinimized()) return;
    callJavaBackend('POST', '/api/session/ping', { server_id: serverId })
      .catch(() => {});
  }, 60 * 1000);

  webSessions.set(serverId, { window: win, pingInterval, name });

  win.on('closed', () => endWebSessionTracking(serverId));

  return { opened: true };
});

// On full app quit we end every open web session synchronously so playtime
// is accurate up to the moment of quit. The reaper still covers cases where
// the launcher crashes before this runs.
app.on('before-quit', () => {
  for (const serverId of Array.from(webSessions.keys())) {
    endWebSessionTracking(serverId);
  }
});

ipcMain.handle('chat-popout-open', (_e, opts) => {
  const { type = 'hub', user = '' } = opts || {};
  const key = type === 'dm' ? `dm:${user}` : 'hub';
  const existing = chatPopouts.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return true;
  }
  // Pre-bake the current user's username so own-message styling works
  // without an extra round-trip on popout boot.
  const me = activeUser || '';
  const win = new BrowserWindow({
    width: 380,
    height: 520,
    minWidth: 320,
    minHeight: 360,
    frame: false,
    transparent: false,
    backgroundColor: '#12100a',
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: true,
    show: false,
    title: type === 'dm' ? `RSPS Hub — DM ${user}` : 'RSPS Hub — Hub Chat',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenu(null);
  const url = `chat-popout.html?type=${encodeURIComponent(type)}` +
              (type === 'dm' ? `&user=${encodeURIComponent(user)}` : '') +
              `&me=${encodeURIComponent(me)}`;
  win.loadFile(path.join(__dirname, 'ui', 'chat-popout.html'), {
    search: url.split('?')[1],
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => chatPopouts.delete(key));
  chatPopouts.set(key, win);
  return true;
});

// Popout asks main to toggle its own always-on-top.
ipcMain.on('chat-popout-aot', (e, enabled) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!enabled);
});
// Popout asks main to close it.
ipcMain.on('chat-popout-close', e => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && !win.isDestroyed()) win.close();
});
// Renderer asks main to close every chat popout — used on logout so the
// next user doesn't inherit the previous account's open conversations.
ipcMain.handle('chat-popout-close-all', () => {
  for (const w of chatPopouts.values()) {
    if (w && !w.isDestroyed()) w.close();
  }
  chatPopouts.clear();
  return true;
});

// ── MUSIC POPOUT WINDOW ──────────────────────────────────────
// A small always-on-top window that mirrors the Music tab's mini player.
// It is a remote control + display: audio plays in the main window.
let musicPopout = null;

ipcMain.handle('music-popout-open', () => {
  if (musicPopout && !musicPopout.isDestroyed()) {
    musicPopout.focus();
    return true;
  }
  musicPopout = new BrowserWindow({
    width: 420,
    height: 150,
    minWidth: 360,
    minHeight: 150,
    maxWidth: 640,
    maxHeight: 200,
    frame: false,
    transparent: false,
    backgroundColor: '#12100a',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  musicPopout.setMenu(null);
  musicPopout.loadFile(path.join(__dirname, 'ui', 'music-popout.html'));
  musicPopout.once('ready-to-show', () => musicPopout.show());
  musicPopout.on('closed', () => {
    musicPopout = null;
    // Tell the main renderer so it re-shows the docked mini
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('music-popout-cmd', { cmd: 'closed' });
    }
  });
  return true;
});

// Popout → main: a command (play/pause/prev/next/seek/close)
ipcMain.on('music-popout-cmd', (_e, payload) => {
  if (payload?.cmd === 'close' && musicPopout && !musicPopout.isDestroyed()) {
    musicPopout.close();
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('music-popout-cmd', payload);
  }
});

// Main renderer → popout: state broadcast
ipcMain.on('music-state', (_e, state) => {
  if (musicPopout && !musicPopout.isDestroyed()) {
    musicPopout.webContents.send('music-state', state);
  }
});

// ── APP LIFECYCLE ─────────────────────────────────────────────────────────────

// macOS expects an application menu (About, Quit, Edit copy/paste, Window),
// otherwise Cmd+C, Cmd+V, Cmd+Q etc. silently do nothing. On Windows + Linux
// we keep the menu hidden because all controls live in our custom title bar.
function buildApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const appName = 'RSPS Hub';
  const template = [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: `Quit ${appName}`, accelerator: 'Cmd+Q' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildApplicationMenu();
  startJavaBackend();
  waitForBackend(() => {
    createWindow();
    setupAutoUpdater();
  });
});

// Standard macOS behavior: clicking the dock icon when no windows are open
// should re-create the main window instead of leaving the app stranded.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

function killJava() {
  if (!javaProcess) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /T /PID ${javaProcess.pid}`, { stdio: 'ignore' });
    } else {
      javaProcess.kill('SIGKILL');
    }
  } catch (_) {}
  javaProcess = null;
}

app.on('window-all-closed', () => {
  killJava();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  killJava();
});
