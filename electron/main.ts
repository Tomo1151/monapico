import { app, BrowserWindow, ipcMain, dialog, Menu } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SerialPort } from "serialport";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.js
// │
process.env.DIST = path.join(__dirname, "../dist");
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, "../public");

const execFileAsync = promisify(execFile);

let win: BrowserWindow | null;
let picoConnected = false;
let picoWatchTimer: NodeJS.Timeout | null = null;
let picoPollInFlight = false;
let picoSerialPort: SerialPort | null = null;
let picoSerialPath: string | null = null;

type DetectedPortInfo = Awaited<ReturnType<typeof SerialPort.list>>[number];

const PICO_USB_VID = "2E8A";
const PICO_VOLUME_LABEL = "RPI-RP2";
const DEFAULT_BAUD_RATE = 115200;
const PICO_WATCH_INTERVAL_MS = process.platform === "win32" ? 2000 : 1000;

const runPowerShell = async (command: string) => {
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", command],
      { windowsHide: true },
    );
    return stdout.trim();
  } catch (error) {
    return "";
  }
};

const hasLinuxMountWithLabel = async (label: string) => {
  const target = label.toLowerCase();
  const roots = ["/media", "/run/media"];
  for (const root of roots) {
    const entries = await fs.readdir(root).catch(() => [] as string[]);
    for (const entry of entries) {
      if (entry.toLowerCase() === target) return true;
      const nested = await fs
        .readdir(path.join(root, entry))
        .catch(() => [] as string[]);
      if (nested.some((name) => name.toLowerCase() === target)) return true;
    }
  }
  return false;
};

const isPicoSerialPort = (port: DetectedPortInfo) => {
  const vendorId = port.vendorId?.toLowerCase();
  if (vendorId === PICO_USB_VID.toLowerCase()) return true;

  const pnpId = port.pnpId?.toLowerCase() ?? "";
  if (pnpId.includes(`vid_${PICO_USB_VID.toLowerCase()}`)) return true;

  const manufacturer = (port.manufacturer ?? "").toLowerCase();
  if (manufacturer.includes("raspberry")) {
    return true;
  }

  return false;
};

const listSerialPorts = async () => {
  try {
    return await SerialPort.list();
  } catch (error) {
    return [] as DetectedPortInfo[];
  }
};

const detectPicoSerialConnection = async () => {
  const ports = await listSerialPorts();
  return ports.some(isPicoSerialPort);
};

const detectPicoBootVolume = async () => {
  if (process.platform === "darwin") {
    const volumeEntries = await fs
      .readdir("/Volumes")
      .catch(() => [] as string[]);
    return volumeEntries.some(
      (name) => name.toLowerCase() === PICO_VOLUME_LABEL.toLowerCase(),
    );
  }

  if (process.platform === "linux") {
    return await hasLinuxMountWithLabel(PICO_VOLUME_LABEL);
  }

  if (process.platform === "win32") {
    const volumeOutput = await runPowerShell(
      `Get-CimInstance Win32_LogicalDisk | Where-Object { $_.VolumeName -eq '${PICO_VOLUME_LABEL}' } | Select-Object -First 1 -ExpandProperty DeviceID`,
    );
    return volumeOutput.length > 0;
  }

  return false;
};

const detectPicoConnection = async () => {
  const serialFound = await detectPicoSerialConnection();
  if (serialFound) return true;
  return await detectPicoBootVolume();
};

const sendToRenderer = (channel: string, ...args: unknown[]) => {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, ...args);
};

const serializePortInfo = (port: DetectedPortInfo) => ({
  path: port.path,
  manufacturer: port.manufacturer,
  serialNumber: port.serialNumber,
  vendorId: port.vendorId,
  productId: port.productId,
  pnpId: port.pnpId,
});

const closePicoSerialPort = async () => {
  if (!picoSerialPort) return true;
  const port = picoSerialPort;
  const closed = await new Promise<boolean>((resolve) => {
    port.close((error) => {
      if (error) {
        sendToRenderer("pico:serial-error", error.message);
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
  port.removeAllListeners();
  picoSerialPort = null;
  picoSerialPath = null;
  return closed;
};

const openPicoSerialPort = async (portPath: string, baudRate: number) => {
  if (picoSerialPort?.isOpen && picoSerialPath === portPath) {
    return true;
  }
  if (picoSerialPort) {
    await closePicoSerialPort();
  }

  const port = new SerialPort({ path: portPath, baudRate, autoOpen: false });
  picoSerialPort = port;
  picoSerialPath = portPath;

  port.on("open", () => {
    sendToRenderer("pico:serial-open", portPath);
  });
  port.on("data", (data: Buffer) => {
    sendToRenderer("pico:serial-data", data.toString("utf-8"));
  });
  port.on("error", (error: Error) => {
    sendToRenderer("pico:serial-error", error.message);
  });
  port.on("close", () => {
    sendToRenderer("pico:serial-close");
  });

  const opened = await new Promise<boolean>((resolve) => {
    port.open((error) => {
      if (error) {
        sendToRenderer("pico:serial-error", error.message);
        resolve(false);
        return;
      }
      resolve(true);
    });
  });

  if (!opened) {
    port.removeAllListeners();
    picoSerialPort = null;
    picoSerialPath = null;
  }

  return opened;
};

const writePicoSerial = async (data: string) => {
  const port = picoSerialPort;
  if (!port?.isOpen) return false;
  return await new Promise<boolean>((resolve) => {
    port.write(data, "utf-8", (error) => {
      if (error) {
        sendToRenderer("pico:serial-error", error.message);
        resolve(false);
        return;
      }
      port.drain((drainError) => {
        if (drainError) {
          sendToRenderer("pico:serial-error", drainError.message);
          resolve(false);
          return;
        }
        resolve(true);
      });
    });
  });
};

const startPicoWatcher = () => {
  if (picoWatchTimer) return;
  const poll = async () => {
    if (picoPollInFlight) return;
    picoPollInFlight = true;
    try {
      const isConnected = await detectPicoConnection();
      if (isConnected !== picoConnected) {
        picoConnected = isConnected;
        sendToRenderer("pico:connection-changed", picoConnected);
      }
      if (!isConnected && picoSerialPort?.isOpen) {
        await closePicoSerialPort();
      }
    } finally {
      picoPollInFlight = false;
    }
  };
  poll();
  picoWatchTimer = setInterval(poll, PICO_WATCH_INTERVAL_MS);
};

const stopPicoWatcher = () => {
  if (!picoWatchTimer) return;
  clearInterval(picoWatchTimer);
  picoWatchTimer = null;
};

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC!, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
    width: 1200,
    height: 800,
    backgroundColor: "#1e1e1e",
  });

  // Test active push message to Renderer-process.
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", new Date().toLocaleString());
    startPicoWatcher();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(process.env.DIST!, "index.html"));
  }
}

app.on("window-all-closed", () => {
  stopPicoWatcher();
  void closePicoSerialPort();
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(createWindow);

// IPC Handlers
ipcMain.handle("fs:readdir", async (_, dirPath: string) => {
  const absolutePath = path.isAbsolute(dirPath)
    ? dirPath
    : path.join(process.cwd(), dirPath);
  const entries = await fs.readdir(absolutePath, { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
    path: path.join(absolutePath, entry.name),
  }));
});

ipcMain.handle("fs:readFile", async (_, filePath: string) => {
  return await fs.readFile(filePath, "utf-8");
});

ipcMain.handle("fs:writeFile", async (_, filePath: string, content: string) => {
  await fs.writeFile(filePath, content, "utf-8");
  return true;
});

ipcMain.handle("fs:mkdir", async (_, dirPath: string) => {
  await fs.mkdir(dirPath, { recursive: true });
  return true;
});

ipcMain.handle("fs:rm", async (_, targetPath: string) => {
  await fs.rm(targetPath, { recursive: true, force: true });
  return true;
});

ipcMain.handle("path:getBasename", (_, filePath: string) => {
  return path.basename(filePath);
});

ipcMain.handle("app:getAppPath", () => {
  return process.cwd();
});

ipcMain.handle("pico:get-connection-state", async () => {
  const isConnected = await detectPicoConnection();
  picoConnected = isConnected;
  return isConnected;
});

ipcMain.handle("serial:list", async () => {
  const ports = await listSerialPorts();
  return ports.map(serializePortInfo);
});

ipcMain.handle(
  "pico:serial-connect",
  async (_, portPath: string, baudRate?: number) => {
    return await openPicoSerialPort(portPath, baudRate ?? DEFAULT_BAUD_RATE);
  },
);

ipcMain.handle("pico:serial-disconnect", async () => {
  return await closePicoSerialPort();
});

ipcMain.handle("pico:serial-write", async (_, data: string) => {
  return await writePicoSerial(data);
});

ipcMain.handle("dialog:showSaveDialog", async (_, defaultDir?: string) => {
  console.log("IPC: dialog:showSaveDialog called with defaultDir:", defaultDir);
  const parentWin = BrowserWindow.getFocusedWindow() || win;
  const { filePath, canceled } = await dialog.showSaveDialog(parentWin!, {
    defaultPath: defaultDir
      ? path.join(defaultDir, "main.py")
      : path.join(process.cwd(), "main.py"),
    filters: [
      { name: "Python Files", extensions: ["py"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (canceled) return null;
  return filePath;
});

ipcMain.handle("dialog:showOpenDialog", async () => {
  console.log("IPC: dialog:showOpenDialog called");
  const parentWin = BrowserWindow.getFocusedWindow() || win;
  const { filePaths, canceled } = await dialog.showOpenDialog(parentWin!, {
    properties: ["openDirectory"],
  });
  console.log("IPC: dialog:showOpenDialog result:", { canceled, filePaths });
  if (canceled) return null;
  return filePaths[0];
});

ipcMain.on(
  "explorer:showContextMenu",
  (event, path: string, isDirectory: boolean, canDelete: boolean = true) => {
    const template: any[] = [
      {
        label: "新しいファイルを作成",
        click: () => {
          event.sender.send("explorer:create-new-file", { path, isDirectory });
        },
      },
      {
        label: "新しいフォルダを作成",
        click: () => {
          event.sender.send("explorer:create-new-folder", {
            path,
            isDirectory,
          });
        },
      },
    ];

    if (canDelete) {
      template.push({ type: "separator" });
      template.push({
        label: "削除",
        click: () => {
          event.sender.send("explorer:delete-item", { path, isDirectory });
        },
      });
    }

    const menu = Menu.buildFromTemplate(template);
    menu.popup({
      window: BrowserWindow.fromWebContents(event.sender)!,
    });
  },
);
