const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { spawn, execSync } = require('child_process');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const http = require('http');
const fs   = require('fs');
const os   = require('os');

const RSPS_DIR      = path.join(os.homedir(), '.rsps_hub');
const PROFILE_PATH  = path.join(RSPS_DIR, 'profile.json');
const AVATAR_PATH   = path.join(RSPS_DIR, 'avatar.png');
const PLAYTIME_PATH = path.join(RSPS_DIR, 'playtime.json');
const MESSAGES_PATH = path.join(RSPS_DIR, 'messages.json');
const MUSIC_PREFS_PATH = path.join(RSPS_DIR, 'music_prefs.json');

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
  };
  if (hasBundledJre) childEnv.JAVA_HOME = bundledJreHome;

  // Note: --api-key is kept as a fallback while in-flight Java versions roll out
  javaProcess = spawn(scriptPath, ['--api-mode', '--port', String(JAVA_PORT)], {
    env: childEnv,
    windowsHide: true,
    shell: process.platform === 'win32'
  });

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
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1100,
    minHeight: 650,
    frame: false,          // custom title bar
    transparent: false,
    backgroundColor: '#0f1115',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));

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
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
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
      resolve({ error: 'Connection failed (' + (err.code || err.message) + '). Please restart the launcher.' });
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

// Messages — read/write ~/.rsps_hub/messages.json { "Username": [...msgs] }
ipcMain.handle('messages-get', () => {
  try {
    if (fs.existsSync(MESSAGES_PATH))
      return JSON.parse(fs.readFileSync(MESSAGES_PATH, 'utf8'));
  } catch (_) {}
  return {};
});

ipcMain.handle('messages-save', (_, data) => {
  try {
    fs.mkdirSync(RSPS_DIR, { recursive: true });
    fs.writeFileSync(MESSAGES_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch (_) { return false; }
});

// Music prefs: favorites, volume, shuffle, repeat, last track
const MUSIC_DEFAULTS = { favorites: [], volume: 0.6, shuffle: false, repeat: 'off', lastTrackId: null };
ipcMain.handle('music-prefs-get', () => {
  try {
    if (fs.existsSync(MUSIC_PREFS_PATH)) {
      return { ...MUSIC_DEFAULTS, ...JSON.parse(fs.readFileSync(MUSIC_PREFS_PATH, 'utf8')) };
    }
  } catch (_) {}
  return MUSIC_DEFAULTS;
});
ipcMain.handle('music-prefs-save', (_, data) => {
  try {
    fs.mkdirSync(RSPS_DIR, { recursive: true });
    const merged = { ...MUSIC_DEFAULTS, ...(data || {}) };
    fs.writeFileSync(MUSIC_PREFS_PATH, JSON.stringify(merged, null, 2));
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

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // handled manually via install-update
  autoUpdater.logger = require('electron-log');
  autoUpdater.logger.transports.file.level = 'info';

  autoUpdater.on('checking-for-update', () => console.log('[updater] Checking for update...'));
  autoUpdater.on('update-not-available', () => console.log('[updater] Already up to date.'));
  autoUpdater.on('error', (err) => console.error('[updater] Error:', err?.message));
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

  // Delay so renderer has time to register its IPC listeners before update-downloaded fires
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => console.error('[updater] checkForUpdates error:', err?.message));
  }, 5000);
}

ipcMain.handle('app-version', () => app.getVersion());

ipcMain.on('install-update', () => {
  killJava();
  // Wait for Java process tree to fully die before handing off to NSIS
  setTimeout(() => autoUpdater.quitAndInstall(true, true), 1000);
});

// ── APP LIFECYCLE ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  startJavaBackend();
  waitForBackend(() => {
    createWindow();
    setupAutoUpdater();
  });
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
