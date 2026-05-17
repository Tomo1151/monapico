"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  readdir: (path) => electron.ipcRenderer.invoke("fs:readdir", path),
  readFile: (path) => electron.ipcRenderer.invoke("fs:readFile", path),
  writeFile: (path, content) => electron.ipcRenderer.invoke("fs:writeFile", path, content),
  mkdir: (path) => electron.ipcRenderer.invoke("fs:mkdir", path),
  rm: (path) => electron.ipcRenderer.invoke("fs:rm", path),
  getBasename: (path) => electron.ipcRenderer.invoke("path:getBasename", path),
  getAppPath: () => electron.ipcRenderer.invoke("app:getAppPath"),
  getPicoConnectionState: () => electron.ipcRenderer.invoke("pico:get-connection-state"),
  listSerialPorts: () => electron.ipcRenderer.invoke("serial:list"),
  connectPicoSerial: (path, baudRate) => electron.ipcRenderer.invoke("pico:serial-connect", path, baudRate),
  disconnectPicoSerial: () => electron.ipcRenderer.invoke("pico:serial-disconnect"),
  writePicoSerial: (data) => electron.ipcRenderer.invoke("pico:serial-write", data),
  showSaveDialog: (defaultPath) => electron.ipcRenderer.invoke("dialog:showSaveDialog", defaultPath),
  showOpenDialog: () => electron.ipcRenderer.invoke("dialog:showOpenDialog"),
  showExplorerContextMenu: (path, isDirectory, canDelete = true) => electron.ipcRenderer.send("explorer:showContextMenu", path, isDirectory, canDelete),
  onCreateNewFile: (callback) => {
    const listener = (_event, data) => callback(data);
    electron.ipcRenderer.on("explorer:create-new-file", listener);
    return () => {
      electron.ipcRenderer.removeListener("explorer:create-new-file", listener);
    };
  },
  onCreateNewFolder: (callback) => {
    const listener = (_event, data) => callback(data);
    electron.ipcRenderer.on("explorer:create-new-folder", listener);
    return () => {
      electron.ipcRenderer.removeListener("explorer:create-new-folder", listener);
    };
  },
  onDeleteItem: (callback) => {
    const listener = (_event, data) => callback(data);
    electron.ipcRenderer.on("explorer:delete-item", listener);
    return () => {
      electron.ipcRenderer.removeListener("explorer:delete-item", listener);
    };
  },
  onPicoConnectionChange: (callback) => {
    const listener = (_event, isConnected) => callback(isConnected);
    electron.ipcRenderer.on("pico:connection-changed", listener);
    return () => {
      electron.ipcRenderer.removeListener("pico:connection-changed", listener);
    };
  },
  onPicoSerialData: (callback) => {
    const listener = (_event, data) => callback(data);
    electron.ipcRenderer.on("pico:serial-data", listener);
    return () => {
      electron.ipcRenderer.removeListener("pico:serial-data", listener);
    };
  },
  onPicoSerialError: (callback) => {
    const listener = (_event, message) => callback(message);
    electron.ipcRenderer.on("pico:serial-error", listener);
    return () => {
      electron.ipcRenderer.removeListener("pico:serial-error", listener);
    };
  },
  onPicoSerialOpen: (callback) => {
    const listener = (_event, path) => callback(path);
    electron.ipcRenderer.on("pico:serial-open", listener);
    return () => {
      electron.ipcRenderer.removeListener("pico:serial-open", listener);
    };
  },
  onPicoSerialClose: (callback) => {
    const listener = () => callback();
    electron.ipcRenderer.on("pico:serial-close", listener);
    return () => {
      electron.ipcRenderer.removeListener("pico:serial-close", listener);
    };
  },
  onMainMessage: (callback) => {
    const listener = (_event, message) => callback(message);
    electron.ipcRenderer.on("main-process-message", listener);
    return () => {
      electron.ipcRenderer.removeListener("main-process-message", listener);
    };
  }
});
