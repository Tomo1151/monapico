import { app, BrowserWindow, ipcMain, dialog, Menu } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SerialPort } from "serialport";
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.DIST = path.join(__dirname$1, "../dist");
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, "../public");
const execFileAsync = promisify(execFile);
let win;
let picoConnected = false;
let picoWatchTimer = null;
let picoPollInFlight = false;
let picoSerialPort = null;
let picoSerialPath = null;
const PICO_USB_VID = "2E8A";
const PICO_VOLUME_LABEL = "RPI-RP2";
const DEFAULT_BAUD_RATE = 115200;
const PICO_WATCH_INTERVAL_MS = process.platform === "win32" ? 2e3 : 1e3;
const runPowerShell = async (command) => {
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", command],
      { windowsHide: true }
    );
    return stdout.trim();
  } catch (error) {
    return "";
  }
};
const hasLinuxMountWithLabel = async (label) => {
  const target = label.toLowerCase();
  const roots = ["/media", "/run/media"];
  for (const root of roots) {
    const entries = await fs.readdir(root).catch(() => []);
    for (const entry of entries) {
      if (entry.toLowerCase() === target) return true;
      const nested = await fs.readdir(path.join(root, entry)).catch(() => []);
      if (nested.some((name) => name.toLowerCase() === target)) return true;
    }
  }
  return false;
};
const isPicoSerialPort = (port) => {
  var _a, _b;
  const vendorId = (_a = port.vendorId) == null ? void 0 : _a.toLowerCase();
  if (vendorId === PICO_USB_VID.toLowerCase()) return true;
  const pnpId = ((_b = port.pnpId) == null ? void 0 : _b.toLowerCase()) ?? "";
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
    return [];
  }
};
const detectPicoSerialConnection = async () => {
  const ports = await listSerialPorts();
  return ports.some(isPicoSerialPort);
};
const detectPicoBootVolume = async () => {
  if (process.platform === "darwin") {
    const volumeEntries = await fs.readdir("/Volumes").catch(() => []);
    return volumeEntries.some(
      (name) => name.toLowerCase() === PICO_VOLUME_LABEL.toLowerCase()
    );
  }
  if (process.platform === "linux") {
    return await hasLinuxMountWithLabel(PICO_VOLUME_LABEL);
  }
  if (process.platform === "win32") {
    const volumeOutput = await runPowerShell(
      `Get-CimInstance Win32_LogicalDisk | Where-Object { $_.VolumeName -eq '${PICO_VOLUME_LABEL}' } | Select-Object -First 1 -ExpandProperty DeviceID`
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
const sendToRenderer = (channel, ...args) => {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, ...args);
};
const serializePortInfo = (port) => ({
  path: port.path,
  manufacturer: port.manufacturer,
  serialNumber: port.serialNumber,
  vendorId: port.vendorId,
  productId: port.productId,
  pnpId: port.pnpId
});
const closePicoSerialPort = async () => {
  if (!picoSerialPort) return true;
  const port = picoSerialPort;
  const closed = await new Promise((resolve) => {
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
const openPicoSerialPort = async (portPath, baudRate) => {
  if ((picoSerialPort == null ? void 0 : picoSerialPort.isOpen) && picoSerialPath === portPath) {
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
  port.on("data", (data) => {
    sendToRenderer("pico:serial-data", data.toString("utf-8"));
  });
  port.on("error", (error) => {
    sendToRenderer("pico:serial-error", error.message);
  });
  port.on("close", () => {
    sendToRenderer("pico:serial-close");
  });
  const opened = await new Promise((resolve) => {
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
const writePicoSerial = async (data) => {
  const port = picoSerialPort;
  if (!(port == null ? void 0 : port.isOpen)) return false;
  return await new Promise((resolve) => {
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
      if (!isConnected && (picoSerialPort == null ? void 0 : picoSerialPort.isOpen)) {
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
    icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs")
    },
    width: 1200,
    height: 800,
    backgroundColor: "#1e1e1e"
  });
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
    startPicoWatcher();
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(process.env.DIST, "index.html"));
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
ipcMain.handle("fs:readdir", async (_, dirPath) => {
  const absolutePath = path.isAbsolute(dirPath) ? dirPath : path.join(process.cwd(), dirPath);
  const entries = await fs.readdir(absolutePath, { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
    path: path.join(absolutePath, entry.name)
  }));
});
ipcMain.handle("fs:readFile", async (_, filePath) => {
  return await fs.readFile(filePath, "utf-8");
});
ipcMain.handle("fs:writeFile", async (_, filePath, content) => {
  await fs.writeFile(filePath, content, "utf-8");
  return true;
});
ipcMain.handle("fs:mkdir", async (_, dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
  return true;
});
ipcMain.handle("fs:rm", async (_, targetPath) => {
  await fs.rm(targetPath, { recursive: true, force: true });
  return true;
});
ipcMain.handle("path:getBasename", (_, filePath) => {
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
  async (_, portPath, baudRate) => {
    return await openPicoSerialPort(portPath, baudRate ?? DEFAULT_BAUD_RATE);
  }
);
ipcMain.handle("pico:serial-disconnect", async () => {
  return await closePicoSerialPort();
});
ipcMain.handle("pico:serial-write", async (_, data) => {
  return await writePicoSerial(data);
});
ipcMain.handle("dialog:showSaveDialog", async (_, defaultDir) => {
  console.log("IPC: dialog:showSaveDialog called with defaultDir:", defaultDir);
  const parentWin = BrowserWindow.getFocusedWindow() || win;
  const { filePath, canceled } = await dialog.showSaveDialog(parentWin, {
    defaultPath: defaultDir ? path.join(defaultDir, "main.py") : path.join(process.cwd(), "main.py"),
    filters: [
      { name: "Python Files", extensions: ["py"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });
  if (canceled) return null;
  return filePath;
});
ipcMain.handle("dialog:showOpenDialog", async () => {
  console.log("IPC: dialog:showOpenDialog called");
  const parentWin = BrowserWindow.getFocusedWindow() || win;
  const { filePaths, canceled } = await dialog.showOpenDialog(parentWin, {
    properties: ["openDirectory"]
  });
  console.log("IPC: dialog:showOpenDialog result:", { canceled, filePaths });
  if (canceled) return null;
  return filePaths[0];
});
ipcMain.on(
  "explorer:showContextMenu",
  (event, path2, isDirectory, canDelete = true) => {
    const template = [
      {
        label: "新しいファイルを作成",
        click: () => {
          event.sender.send("explorer:create-new-file", { path: path2, isDirectory });
        }
      },
      {
        label: "新しいフォルダを作成",
        click: () => {
          event.sender.send("explorer:create-new-folder", {
            path: path2,
            isDirectory
          });
        }
      }
    ];
    if (canDelete) {
      template.push({ type: "separator" });
      template.push({
        label: "削除",
        click: () => {
          event.sender.send("explorer:delete-item", { path: path2, isDirectory });
        }
      });
    }
    const menu = Menu.buildFromTemplate(template);
    menu.popup({
      window: BrowserWindow.fromWebContents(event.sender)
    });
  }
);
