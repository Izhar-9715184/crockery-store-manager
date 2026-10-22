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
  mobileStatus: () => ipcRenderer.invoke('sys:mobileStatus'),
  mobileApply: (opts) => ipcRenderer.invoke('sys:mobileApply', opts),
  cloudStatus: () => ipcRenderer.invoke('sys:cloudStatus'),
  cloudConnect: () => ipcRenderer.invoke('sys:cloudConnect'),
  cloudBackupNow: () => ipcRenderer.invoke('sys:cloudBackupNow'),
  cloudList: () => ipcRenderer.invoke('sys:cloudList'),
  cloudRestore: (id) => ipcRenderer.invoke('sys:cloudRestore', id),
  cloudKeep: () => ipcRenderer.invoke('sys:cloudKeep'),
  cloudDisconnect: () => ipcRenderer.invoke('sys:cloudDisconnect'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_e, s) => cb(s)),
});
