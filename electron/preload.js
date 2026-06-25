const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  settingsGet: () => ipcRenderer.invoke("settings:get"),
  settingsSelectDownloadDir: () => ipcRenderer.invoke("settings:select-download-dir"),
  settingsSetCookieBrowser: (value) => ipcRenderer.invoke("settings:set-cookie-browser", value),
  settingsSetCookiesTxtOnlyMode: (value) => ipcRenderer.invoke("settings:set-cookies-txt-only-mode", value),
  settingsSelectCookiesFile: () => ipcRenderer.invoke("settings:select-cookies-file"),
  settingsClearCookiesFile: () => ipcRenderer.invoke("settings:clear-cookies-file"),
  settingsOpenCookiesFileDir: () => ipcRenderer.invoke("settings:open-cookies-file-dir"),
  settingsGetCookiesHealth: () => ipcRenderer.invoke("settings:get-cookies-health"),
  checkCookieLogin: (payload) => ipcRenderer.invoke("downloads:check-cookie-login", payload),
  simulateProbe: (payload) => ipcRenderer.invoke("downloads:simulate-probe", payload),
  listTasks: () => ipcRenderer.invoke("tasks:list"),
  addBatch: (inputText) => ipcRenderer.invoke("tasks:add-batch", inputText),
  clearCompleted: () => ipcRenderer.invoke("tasks:clear-completed"),
  clearQueued: () => ipcRenderer.invoke("tasks:clear-queued"),
  startQueued: () => ipcRenderer.invoke("downloads:start-queued"),
  stopDownloads: () => ipcRenderer.invoke("downloads:stop"),
  retryTask: (taskId) => ipcRenderer.invoke("tasks:retry", taskId),
  openDownloadDir: (taskId) => ipcRenderer.invoke("tasks:open-download-dir", taskId),
  readClipboardText: () => ipcRenderer.invoke("clipboard:read-text"),
  getTaskMediaPreview: (taskId) => ipcRenderer.invoke("tasks:get-media-preview", taskId),
  onTasksUpdated: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("tasks:updated", handler);
    return () => ipcRenderer.removeListener("tasks:updated", handler);
  },
  onDownloadLog: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("downloads:log", handler);
    return () => ipcRenderer.removeListener("downloads:log", handler);
  },
  onTaskProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("tasks:progress", handler);
    return () => ipcRenderer.removeListener("tasks:progress", handler);
  }
});
