import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.DIST = path.join(__dirname$1, "../dist");
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, "../public");
let win;
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
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(process.env.DIST, "index.html"));
  }
}
app.on("window-all-closed", () => {
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
ipcMain.handle("path:getBasename", (_, filePath) => {
  return path.basename(filePath);
});
ipcMain.handle("app:getAppPath", () => {
  return process.cwd();
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
