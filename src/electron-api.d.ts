export interface FileEntry {
  name: string;
  isDirectory: boolean;
  path: string;
}

export interface IElectronAPI {
  readdir: (path: string) => Promise<FileEntry[]>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<boolean>;
  mkdir: (path: string) => Promise<boolean>;
  rm: (path: string) => Promise<boolean>;
  getBasename: (path: string) => Promise<string>;
  getAppPath: () => Promise<string>;
  showSaveDialog: (defaultPath?: string) => Promise<string | null>;
  showOpenDialog: () => Promise<string | null>;
  showExplorerContextMenu: (path: string, isDirectory: boolean, canDelete?: boolean) => void;
  onCreateNewFile: (callback: (data: { path: string, isDirectory: boolean }) => void) => (() => void);
  onCreateNewFolder: (callback: (data: { path: string, isDirectory: boolean }) => void) => (() => void);
  onDeleteItem: (callback: (data: { path: string, isDirectory: boolean }) => void) => (() => void);
  onMainMessage: (callback: (message: string) => void) => (() => void);
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
