import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  readdir: (path: string) => ipcRenderer.invoke("fs:readdir", path),
  readFile: (path: string) => ipcRenderer.invoke("fs:readFile", path),
  writeFile: (path: string, content: string) =>
    ipcRenderer.invoke("fs:writeFile", path, content),
  mkdir: (path: string) => ipcRenderer.invoke("fs:mkdir", path),
  rm: (path: string) => ipcRenderer.invoke("fs:rm", path),
  getBasename: (path: string) => ipcRenderer.invoke("path:getBasename", path),
  getAppPath: () => ipcRenderer.invoke("app:getAppPath"),
  getPicoConnectionState: () => ipcRenderer.invoke("pico:get-connection-state"),
  listSerialPorts: () => ipcRenderer.invoke("serial:list"),
  connectPicoSerial: (path: string, baudRate?: number) =>
    ipcRenderer.invoke("pico:serial-connect", path, baudRate),
  disconnectPicoSerial: () => ipcRenderer.invoke("pico:serial-disconnect"),
  writePicoSerial: (data: string) =>
    ipcRenderer.invoke("pico:serial-write", data),
  showSaveDialog: (defaultPath?: string) =>
    ipcRenderer.invoke("dialog:showSaveDialog", defaultPath),
  showOpenDialog: () => ipcRenderer.invoke("dialog:showOpenDialog"),
  showOpenFileDialog: () => ipcRenderer.invoke("dialog:showOpenFileDialog"),
  showExplorerContextMenu: (
    path: string,
    isDirectory: boolean,
    canDelete: boolean = true,
  ) =>
    ipcRenderer.send("explorer:showContextMenu", path, isDirectory, canDelete),

  onCreateNewFile: (
    callback: (data: { path: string; isDirectory: boolean }) => void,
  ) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on("explorer:create-new-file", listener);
    return () => {
      ipcRenderer.removeListener("explorer:create-new-file", listener);
    };
  },
  onCreateNewFolder: (
    callback: (data: { path: string; isDirectory: boolean }) => void,
  ) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on("explorer:create-new-folder", listener);
    return () => {
      ipcRenderer.removeListener("explorer:create-new-folder", listener);
    };
  },
  onDeleteItem: (
    callback: (data: { path: string; isDirectory: boolean }) => void,
  ) => {
    const listener = (_event: any, data: any) => callback(data);
    ipcRenderer.on("explorer:delete-item", listener);
    return () => {
      ipcRenderer.removeListener("explorer:delete-item", listener);
    };
  },
  onPicoConnectionChange: (callback: (isConnected: boolean) => void) => {
    const listener = (_event: any, isConnected: boolean) =>
      callback(isConnected);
    ipcRenderer.on("pico:connection-changed", listener);
    return () => {
      ipcRenderer.removeListener("pico:connection-changed", listener);
    };
  },
  onPicoSerialData: (callback: (data: string) => void) => {
    const listener = (_event: any, data: string) => callback(data);
    ipcRenderer.on("pico:serial-data", listener);
    return () => {
      ipcRenderer.removeListener("pico:serial-data", listener);
    };
  },
  onPicoSerialError: (callback: (message: string) => void) => {
    const listener = (_event: any, message: string) => callback(message);
    ipcRenderer.on("pico:serial-error", listener);
    return () => {
      ipcRenderer.removeListener("pico:serial-error", listener);
    };
  },
  onPicoSerialOpen: (callback: (path: string) => void) => {
    const listener = (_event: any, path: string) => callback(path);
    ipcRenderer.on("pico:serial-open", listener);
    return () => {
      ipcRenderer.removeListener("pico:serial-open", listener);
    };
  },
  onPicoSerialClose: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("pico:serial-close", listener);
    return () => {
      ipcRenderer.removeListener("pico:serial-close", listener);
    };
  },
  onMainMessage: (callback: (message: string) => void) => {
    const listener = (_event: any, message: any) => callback(message);
    ipcRenderer.on("main-process-message", listener);
    return () => {
      ipcRenderer.removeListener("main-process-message", listener);
    };
  },
});
