"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  readdir: (path) => electron.ipcRenderer.invoke("fs:readdir", path),
  readFile: (path) => electron.ipcRenderer.invoke("fs:readFile", path),
  writeFile: (path, content) => electron.ipcRenderer.invoke("fs:writeFile", path, content),
  getBasename: (path) => electron.ipcRenderer.invoke("path:getBasename", path),
  getAppPath: () => electron.ipcRenderer.invoke("app:getAppPath"),
  showSaveDialog: () => electron.ipcRenderer.invoke("dialog:showSaveDialog"),
  onMainMessage: (callback) => {
    electron.ipcRenderer.on("main-process-message", (_event, message) => callback(message));
  }
});
