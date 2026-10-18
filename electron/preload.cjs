const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kabalAPI', {
  loadOrders: () => ipcRenderer.invoke('load-orders'),
  claimOrder: (data) => ipcRenderer.invoke('claim-order', data),
  unclaimOrder: (data) => ipcRenderer.invoke('unclaim-order', data),
  completeOrder: (data) => ipcRenderer.invoke('complete-order', data),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  printOrderDocument: (data) => ipcRenderer.invoke('print-order-document', data),
  getUpdateState: () => ipcRenderer.invoke('get-update-state'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  getAppVersion: () => ipcRenderer.invoke('app-version'),
  onUpdateStatus: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
});
