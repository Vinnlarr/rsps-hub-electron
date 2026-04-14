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
  const javaBackendPath = isDev
    ? path.join(__dirname, '..', 'RSPS-Hub-Launcher-main', 'build', 'install', 'RSPSHub', 'bin')
    : path.join(process.resourcesPath, 'java-backend', 'bin');

  // On Windows use the .bat, on Unix use the shell script
  const scriptName = process.platform === 'win32' ? 'RSPSHub.bat' : 'RSPSHub';
  const scriptPath = path.join(javaBackendPath, scriptName);

  javaProcess = spawn(scriptPath, ['--api-mode', '--port', String(JAVA_PORT), '--api-key', API_SECRET], {
    env: { ...process.env, RSPS_HUB_API_MODE: 'true' },
    windowsHide: true,
    shell: process.platform === 'win32'
  });

  javaProcess.stdout.on('data', d => console.log('[Java]', d.toString().trim()));
  javaProcess.stderr.on('data', d => console.error('[Java]', d.toString().trim()));
  javaProcess.on('exit', code => console.log('[Java] exited with code', code));
}

// Poll until Java backend is up, then open the window
function waitForBackend(callback, retries = 30) {
  http.get(`http://localhost:${JAVA_PORT}/api/ping`, res => {
    if (res.statusCode === 200) callback();
    else retry();
  }).on('error', retry);

  function retry() {
    if (retries <= 0) { callback(); return; } // open anyway after timeout
    setTimeout(() => waitForBackend(callback, retries - 1), 500);
  }
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
      allowRunningInsecureContent: true,
      webSecurity: false   // allow HTTP banner images from the API
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));

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
ipcMain.on('open-external', (_, url) => shell.openExternal(url));

// API proxy — renderer asks main to call Java backend
ipcMain.handle('api-call', async (_, { method, path: apiPath, body }) => {
  return new Promise((resolve, reject) => {
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

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
});

// Profile — read/write ~/.rsps_hub/{username}/profile.json (per-user)
ipcMain.handle('profile-get', (_, username) => {
  try {
    if (!username) return { displayName: '', bio: '', visibility: 'online', avatarPath: null };
    const p = path.join(RSPS_DIR, username, 'profile.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {}
  return { displayName: '', bio: '', visibility: 'online', avatarPath: null };
});

ipcMain.handle('profile-save', (_, data) => {
  try {
    if (!data.username) return { error: 'No username' };
    const dir = path.join(RSPS_DIR, data.username);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(data, null, 2));
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

// Avatar — step 1: open file picker, return chosen path (no copy yet)
ipcMain.handle('pick-avatar', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Avatar',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// Avatar — step 2: copy confirmed path to ~/.rsps_hub/avatar.png
ipcMain.handle('save-avatar', (_, srcPath) => {
  try {
    fs.mkdirSync(RSPS_DIR, { recursive: true });
    fs.copyFileSync(srcPath, AVATAR_PATH);
    return AVATAR_PATH;
  } catch (e) {
    return null;
  }
});

// Read a file as base64 (for image uploads)
ipcMain.handle('read-file-base64', (_, filePath) => {
  try { return fs.readFileSync(filePath).toString('base64'); }
  catch (e) { return null; }
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

  autoUpdater.checkForUpdates().catch((err) => console.error('[updater] checkForUpdates error:', err?.message));
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
