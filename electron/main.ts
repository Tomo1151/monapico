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

const PICO_PATH_PREFIX = "pico:";
const PICO_ROOT_PATH = "pico:/";
const RAW_REPL_ENTER = "\x01";
const RAW_REPL_EXIT = "\x02";
const RAW_REPL_INTERRUPT = "\x03";
const RAW_REPL_EOT = "\x04";
const RAW_REPL_READY_TOKEN = "raw REPL; CTRL-B to exit";
const RAW_REPL_DEFAULT_TIMEOUT_MS = 4000;

type SerialCapture = {
  buffer: string;
  match: (buffer: string) => boolean;
  resolve: (data: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

let serialCapture: SerialCapture | null = null;
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

const isPicoPath = (value: string) => value.startsWith(PICO_PATH_PREFIX);

const toDevicePath = (picoPath: string) => {
  const stripped = picoPath.replace(/^pico:\/*/i, "");
  const normalized = `/${stripped}`.replace(/\/+$/g, "");
  return normalized === "" ? "/" : normalized.replace(/\/+/g, "/");
};

const toPicoPath = (devicePath: string) => {
  const normalized = devicePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized ? `${PICO_PATH_PREFIX}/${normalized}` : PICO_ROOT_PATH;
};

const escapePyString = (value: string) => {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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

const detectPicoConnection = async (ports?: DetectedPortInfo[]) => {
  const serialFound = ports
    ? ports.some(isPicoSerialPort)
    : await detectPicoSerialConnection();
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

const resolveSerialCapture = (data: string) => {
  if (!serialCapture) return;
  clearTimeout(serialCapture.timer);
  const { resolve } = serialCapture;
  serialCapture = null;
  resolve(data);
};

const rejectSerialCapture = (error: Error) => {
  if (!serialCapture) return;
  clearTimeout(serialCapture.timer);
  const { reject } = serialCapture;
  serialCapture = null;
  reject(error);
};

const awaitSerialOutput = (
  match: (buffer: string) => boolean,
  timeoutMs: number,
) => {
  const port = picoSerialPort;
  if (!port?.isOpen) {
    return Promise.reject(new Error("Serial port is not open"));
  }
  if (serialCapture) {
    return Promise.reject(new Error("Serial capture already in progress"));
  }

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      rejectSerialCapture(new Error("Serial read timeout"));
    }, timeoutMs);

    serialCapture = {
      buffer: "",
      match,
      resolve,
      reject,
      timer,
    };
  });
};

const handleSerialData = (data: Buffer) => {
  const text = data.toString("utf-8");
  if (serialCapture) {
    serialCapture.buffer += text;
    if (serialCapture.match(serialCapture.buffer)) {
      resolveSerialCapture(serialCapture.buffer);
    }
    return;
  }

  sendToRenderer("pico:serial-data", text);
};

const writeToPort = async (data: string | Buffer) => {
  const port = picoSerialPort;
  if (!port?.isOpen) return false;
  return await new Promise<boolean>((resolve) => {
    port.write(data, (error) => {
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

const sanitizeRawReplOutput = (data: string) => {
  const eotIndex = data.indexOf(RAW_REPL_EOT);
  const trimmed = (eotIndex >= 0 ? data.slice(0, eotIndex) : data)
    .replace(/\r/g, "")
    .replace(/^OK\n?/, "")
    .trim();
  return trimmed;
};

const runRawReplCommand = async (script: string, timeoutMs?: number) => {
  const port = picoSerialPort;
  if (!port?.isOpen) {
    throw new Error("Serial port is not open");
  }

  await writeToPort(RAW_REPL_INTERRUPT + RAW_REPL_INTERRUPT);
  await writeToPort(RAW_REPL_ENTER);
  await awaitSerialOutput(
    (buffer) => buffer.includes(RAW_REPL_READY_TOKEN),
    1000,
  ).catch(() => "");

  await writeToPort(script);
  await writeToPort(RAW_REPL_EOT);

  const output = await awaitSerialOutput(
    (buffer) => buffer.includes(RAW_REPL_EOT),
    timeoutMs ?? RAW_REPL_DEFAULT_TIMEOUT_MS,
  );

  await writeToPort(RAW_REPL_EXIT);
  return sanitizeRawReplOutput(output);
};

const ensurePicoSerialConnected = async () => {
  if (picoSerialPort?.isOpen) return true;
  const ports = await listSerialPorts();
  const picoPorts = ports.filter(isPicoSerialPort);
  if (picoPorts.length === 0) return false;
  return await openPicoSerialPort(picoPorts[0].path, DEFAULT_BAUD_RATE);
};

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
  port.on("data", handleSerialData);
  port.on("error", (error: Error) => {
    sendToRenderer("pico:serial-error", error.message);
  });
  port.on("close", () => {
    rejectSerialCapture(new Error("Serial port closed"));
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

const picoFsList = async (picoPath: string) => {
  const connected = await ensurePicoSerialConnected();
  if (!connected) return [];

  const devicePath = toDevicePath(picoPath);
  const safePath = escapePyString(devicePath);
  const script =
    "import ujson, uos\n" +
    "def _list(path):\n" +
    "    result = []\n" +
    "    try:\n" +
    "        names = uos.listdir(path)\n" +
    "    except Exception as e:\n" +
    "        print('ERR:' + repr(e))\n" +
    "        return\n" +
    "    for name in names:\n" +
    "        full = (path.rstrip('/') + '/' + name) if path not in ('', '/') else '/' + name\n" +
    "        try:\n" +
    "            mode = uos.stat(full)[0]\n" +
    "            is_dir = (mode & 0x4000) != 0\n" +
    "        except Exception:\n" +
    "            is_dir = False\n" +
    "        result.append((name, is_dir))\n" +
    "    print(ujson.dumps(result))\n" +
    `_list('${safePath}')\n`;

  try {
    const output = await runRawReplCommand(script, 5000);
    if (!output || output.startsWith("ERR:")) return [];
    const entries = JSON.parse(output) as [string, boolean][];
    return entries.map(([name, isDirectory]) => ({
      name,
      isDirectory,
      path: toPicoPath(path.posix.join(devicePath, name)),
    }));
  } catch (error) {
    return [];
  }
};

const picoReadFile = async (picoPath: string) => {
  const connected = await ensurePicoSerialConnected();
  if (!connected) throw new Error("Pico not connected");

  const devicePath = toDevicePath(picoPath);
  const safePath = escapePyString(devicePath);
  const script =
    "import ubinascii\n" +
    `with open('${safePath}', 'rb') as f:\n` +
    "    data = f.read()\n" +
    "print(ubinascii.b2a_base64(data).decode().strip())\n";

  const output = await runRawReplCommand(script, 5000);
  if (output.startsWith("ERR:")) {
    throw new Error("Failed to read Pico file");
  }
  const trimmed = output.trim();
  if (!trimmed) {
    return "";
  }
  return Buffer.from(trimmed, "base64").toString("utf-8");
};

const picoWriteFile = async (picoPath: string, content: string) => {
  const connected = await ensurePicoSerialConnected();
  if (!connected) return false;

  const devicePath = toDevicePath(picoPath);
  const safePath = escapePyString(devicePath);
  const base64 = Buffer.from(content, "utf-8").toString("base64");
  const chunks = base64.match(/.{1,512}/g) ?? [""];

  for (let i = 0; i < chunks.length; i += 1) {
    const mode = i === 0 ? "wb" : "ab";
    const chunk = chunks[i];
    const script =
      "import ubinascii\n" +
      `_f = open('${safePath}', '${mode}')\n` +
      `_f.write(ubinascii.a2b_base64('${chunk}'))\n` +
      "_f.close()\n" +
      "print('OK')\n";
    try {
      const output = await runRawReplCommand(script, 5000);
      if (!output.includes("OK")) return false;
    } catch (error) {
      return false;
    }
  }

  return true;
};

const picoMkdir = async (picoPath: string) => {
  const connected = await ensurePicoSerialConnected();
  if (!connected) return false;

  const devicePath = toDevicePath(picoPath);
  const safePath = escapePyString(devicePath);
  const script =
    "import uos\n" + `uos.mkdir('${safePath}')\n` + "print('OK')\n";
  try {
    const output = await runRawReplCommand(script, 5000);
    return output.includes("OK");
  } catch (error) {
    return false;
  }
};

const picoRm = async (picoPath: string) => {
  const connected = await ensurePicoSerialConnected();
  if (!connected) return false;

  const devicePath = toDevicePath(picoPath);
  const safePath = escapePyString(devicePath);
  const script =
    "import uos\n" +
    "def _rm(path):\n" +
    "    try:\n" +
    "        mode = uos.stat(path)[0]\n" +
    "        if mode & 0x4000:\n" +
    "            for name in uos.listdir(path):\n" +
    "                child = (path.rstrip('/') + '/' + name) if path not in ('', '/') else '/' + name\n" +
    "                _rm(child)\n" +
    "            uos.rmdir(path)\n" +
    "        else:\n" +
    "            uos.remove(path)\n" +
    "    except Exception as e:\n" +
    "        print('ERR:' + repr(e))\n" +
    "_rm('" +
    safePath +
    "')\n" +
    "print('OK')\n";
  try {
    const output = await runRawReplCommand(script, 6000);
    return output.includes("OK");
  } catch (error) {
    return false;
  }
};

const startPicoWatcher = () => {
  if (picoWatchTimer) return;
  const poll = async () => {
    if (picoPollInFlight) return;
    picoPollInFlight = true;
    try {
      const ports = await listSerialPorts();
      const picoPorts = ports.filter(isPicoSerialPort);
      const serialFound = picoPorts.length > 0;
      const bootFound = await detectPicoBootVolume();
      const isConnected = serialFound || bootFound;

      if (serialFound && !picoSerialPort?.isOpen) {
        await openPicoSerialPort(picoPorts[0].path, DEFAULT_BAUD_RATE);
      }
      if (isConnected !== picoConnected) {
        picoConnected = isConnected;
        sendToRenderer("pico:connection-changed", picoConnected);
      }
      if (!serialFound && picoSerialPort?.isOpen) {
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
  if (isPicoPath(dirPath)) {
    return await picoFsList(dirPath);
  }
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
  if (isPicoPath(filePath)) {
    return await picoReadFile(filePath);
  }
  return await fs.readFile(filePath, "utf-8");
});

ipcMain.handle("fs:writeFile", async (_, filePath: string, content: string) => {
  if (isPicoPath(filePath)) {
    return await picoWriteFile(filePath, content);
  }
  await fs.writeFile(filePath, content, "utf-8");
  return true;
});

ipcMain.handle("fs:mkdir", async (_, dirPath: string) => {
  if (isPicoPath(dirPath)) {
    return await picoMkdir(dirPath);
  }
  await fs.mkdir(dirPath, { recursive: true });
  return true;
});

ipcMain.handle("fs:rm", async (_, targetPath: string) => {
  if (isPicoPath(targetPath)) {
    return await picoRm(targetPath);
  }
  await fs.rm(targetPath, { recursive: true, force: true });
  return true;
});

ipcMain.handle("path:getBasename", (_, filePath: string) => {
  if (isPicoPath(filePath)) {
    const devicePath = toDevicePath(filePath);
    if (devicePath === "/") return "Pico";
    return path.posix.basename(devicePath);
  }
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
  const defaultPath =
    defaultDir && !isPicoPath(defaultDir)
      ? path.join(defaultDir, "main.py")
      : path.join(process.cwd(), "main.py");
  const { filePath, canceled } = await dialog.showSaveDialog(parentWin!, {
    defaultPath,
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
