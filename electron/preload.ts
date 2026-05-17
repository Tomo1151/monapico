import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  readdir: (path: string) => ipcRenderer.invoke('fs:readdir', path),
  readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('fs:writeFile', path, content),
  getBasename: (path: string) => ipcRenderer.invoke('path:getBasename', path),
  getAppPath: () => ipcRenderer.invoke('app:getAppPath'),
  showSaveDialog: (defaultPath?: string) => ipcRenderer.invoke('dialog:showSaveDialog', defaultPath),
  showOpenDialog: () => ipcRenderer.invoke('dialog:showOpenDialog'),
  onMainMessage: (callback: (message: string) => void) => {
    ipcRenderer.on('main-process-message', (_event, message) => callback(message))
  }
})
