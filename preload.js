const { contextBridge, ipcRenderer } = require('electron');

// Expose a clean, safe API to the renderer (UI)
contextBridge.exposeInMainWorld('hub', {

  // Window controls
  minimize: ()        => ipcRenderer.send('window-minimize'),
  maximize: ()        => ipcRenderer.send('window-maximize'),
  close:    ()        => ipcRenderer.send('window-close'),
  openExternal: (url) => ipcRenderer.send('open-external', url),

  // Call the Java backend
  api: (method, path, body) =>
    ipcRenderer.invoke('api-call', { method, path, body }),

  // Convenience wrappers
  get:  (path)        => ipcRenderer.invoke('api-call', { method: 'GET',    path }),
  post: (path, body)  => ipcRenderer.invoke('api-call', { method: 'POST',   path, body }),
  del:  (path)        => ipcRenderer.invoke('api-call', { method: 'DELETE', path }),

  // Profile
  getProfile:    (username) => ipcRenderer.invoke('profile-get', username),
  saveProfile:   (data)    => ipcRenderer.invoke('profile-save', data),
  pickAvatar:    ()        => ipcRenderer.invoke('pick-avatar'),
  saveAvatar:    (srcPath) => ipcRenderer.invoke('save-avatar', srcPath),
  getPlaytime:   ()        => ipcRenderer.invoke('playtime-get'),
  savePlaytime:  (data)    => ipcRenderer.invoke('playtime-save', data),
  getMessages:   ()        => ipcRenderer.invoke('messages-get'),
  saveMessages:  (data)    => ipcRenderer.invoke('messages-save', data),
  setActiveUser: (username)=> ipcRenderer.invoke('set-active-user', username),
  getMusicPrefs:  ()       => ipcRenderer.invoke('music-prefs-get'),
  saveMusicPrefs: (data)   => ipcRenderer.invoke('music-prefs-save', data),
  // Music popout window
  openMusicPopout: ()      => ipcRenderer.invoke('music-popout-open'),
  pushMusicState:  (s)     => ipcRenderer.send('music-state', s),
  sendMusicCmd:    (cmd, value) => ipcRenderer.send('music-popout-cmd', { cmd, value }),
  onMusicState:    (cb)    => ipcRenderer.on('music-state', (_e, s) => cb(s)),
  onMusicPopoutCmd:(cb)    => ipcRenderer.on('music-popout-cmd', (_e, p) => cb(p?.cmd, p?.value)),
  selectFolder:    (defaultPath) => ipcRenderer.invoke('select-folder', defaultPath),
  getVersion:      ()            => ipcRenderer.invoke('app-version'),
  readFileBase64:  (filePath)   => ipcRenderer.invoke('read-file-base64', filePath),

  // Auto updater
  installUpdate: () => ipcRenderer.send('install-update'),
  onUpdateAvailable:  (cb) => ipcRenderer.on('update-available',  () => cb()),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', () => cb()),
  setAutoUpdateLauncher: (enabled) => ipcRenderer.invoke('set-auto-update-launcher', enabled),
  getAutoUpdateLauncher: ()        => ipcRenderer.invoke('get-auto-update-launcher'),

  // Chat popouts — main launcher calls openChatPopout(type, user) to spawn
  // a floating window. The popout itself uses chatPopout.* methods.
  openChatPopout:        (type, user) => ipcRenderer.invoke('chat-popout-open', { type, user }),
  closeAllChatPopouts:   ()           => ipcRenderer.invoke('chat-popout-close-all'),
});

// Exposed only inside the chat popout window (uses the same preload but
// these hooks are no-ops elsewhere).
contextBridge.exposeInMainWorld('chatPopout', {
  setAlwaysOnTop: (enabled) => ipcRenderer.send('chat-popout-aot', !!enabled),
  close:          ()        => ipcRenderer.send('chat-popout-close'),
});
