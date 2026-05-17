export interface FileEntry {
  name: string;
  isDirectory: boolean;
  path: string;
}

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
  pnpId?: string;
}

export interface IElectronAPI {
  readdir: (path: string) => Promise<FileEntry[]>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<boolean>;
  mkdir: (path: string) => Promise<boolean>;
  rm: (path: string) => Promise<boolean>;
  getBasename: (path: string) => Promise<string>;
  getAppPath: () => Promise<string>;
  getPicoConnectionState: () => Promise<boolean>;
  listSerialPorts: () => Promise<SerialPortInfo[]>;
  connectPicoSerial: (path: string, baudRate?: number) => Promise<boolean>;
  disconnectPicoSerial: () => Promise<boolean>;
  writePicoSerial: (data: string) => Promise<boolean>;
  showSaveDialog: (defaultPath?: string) => Promise<string | null>;
  showOpenDialog: () => Promise<string | null>;
  showExplorerContextMenu: (
    path: string,
    isDirectory: boolean,
    canDelete?: boolean,
  ) => void;
  onCreateNewFile: (
    callback: (data: { path: string; isDirectory: boolean }) => void,
  ) => () => void;
  onCreateNewFolder: (
    callback: (data: { path: string; isDirectory: boolean }) => void,
  ) => () => void;
  onDeleteItem: (
    callback: (data: { path: string; isDirectory: boolean }) => void,
  ) => () => void;
  onMainMessage: (callback: (message: string) => void) => () => void;
  onPicoConnectionChange: (
    callback: (isConnected: boolean) => void,
  ) => () => void;
  onPicoSerialData: (callback: (data: string) => void) => () => void;
  onPicoSerialError: (callback: (message: string) => void) => () => void;
  onPicoSerialOpen: (callback: (path: string) => void) => () => void;
  onPicoSerialClose: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
