import { app, BrowserWindow, ipcMain, dialog, Menu } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.DIST = path.join(__dirname$1, "../dist");
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, "../public");
let win;
let picoConnected = false;
let picoWatchTimer = null;
const PICO_DEVICE_PATTERNS = {
  darwin: [
    /^tty\.usbmodem/i,
    /^cu\.usbmodem/i,
    /^tty\.usbserial/i,
    /^cu\.usbserial/i
  ],
  linux: [/^ttyACM\d+$/i, /^ttyUSB\d+$/i]
};
const hasMatchingDevice = (entries, patterns) => {
  return entries.some((name) => patterns.some((pattern) => pattern.test(name)));
};
const detectPicoConnection = async () => {
  if (process.platform === "darwin") {
    try {
      const devEntries = await fs.readdir("/dev");
      const volumeEntries = await fs.readdir("/Volumes").catch(() => []);
      const serialFound = hasMatchingDevice(
        devEntries,
        PICO_DEVICE_PATTERNS.darwin
      );
      const volumeFound = volumeEntries.some(
        (name) => name.toLowerCase() === "rpi-rp2"
      );
      return serialFound || volumeFound;
    } catch (error) {
      return false;
    }
  }
  if (process.platform === "linux") {
    try {
      const devEntries = await fs.readdir("/dev");
      return hasMatchingDevice(devEntries, PICO_DEVICE_PATTERNS.linux);
    } catch (error) {
      return false;
    }
  }
  return false;
};
const startPicoWatcher = () => {
  if (picoWatchTimer) return;
  const poll = async () => {
    const isConnected = await detectPicoConnection();
    if (isConnected !== picoConnected) {
      picoConnected = isConnected;
      win == null ? void 0 : win.webContents.send("pico:connection-changed", picoConnected);
    }
  };
  poll();
  picoWatchTimer = setInterval(poll, 1e3);
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
ipcMain.on("explorer:showContextMenu", (event, path2, isDirectory, canDelete = true) => {
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
        event.sender.send("explorer:create-new-folder", { path: path2, isDirectory });
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
});
