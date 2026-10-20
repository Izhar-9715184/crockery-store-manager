'use strict';
// Safe bridge between the screens (renderer) and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // call('createSale', {...}) -> runs the matching function of src/core/service.js
  call: async (name, ...args) => {
    const r = await ipcRenderer.invoke('api', name, args);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  },
});

contextBridge.exposeInMainWorld('sys', {
  info: () => ipcRenderer.invoke('sys:info'),
  checkUpdate: () => ipcRenderer.invoke('sys:checkUpdate'),
  installUpdate: () => ipcRenderer.invoke('sys:installUpdate'),
  backupTo: () => ipcRenderer.invoke('sys:backupTo'),
  restore: () => ipcRenderer.invoke('sys:restore'),
  openBackups: () => ipcRenderer.invoke('sys:openBackups'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_e, s) => cb(s)),
});
