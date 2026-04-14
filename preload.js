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
  selectFolder:    ()           => ipcRenderer.invoke('select-folder'),
  readFileBase64:  (filePath)   => ipcRenderer.invoke('read-file-base64', filePath),

  // Auto updater
  installUpdate: () => ipcRenderer.send('install-update'),
  onUpdateAvailable:  (cb) => ipcRenderer.on('update-available',  () => cb()),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', () => cb()),
});
