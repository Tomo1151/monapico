export interface FileEntry {
  name: string;
  isDirectory: boolean;
  path: string;
}

export interface IElectronAPI {
  readdir: (path: string) => Promise<FileEntry[]>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<boolean>;
  getBasename: (path: string) => Promise<string>;
  getAppPath: () => Promise<string>;
  showSaveDialog: () => Promise<string | null>;
  onMainMessage: (callback: (message: string) => void) => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
