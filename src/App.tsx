import React, { useState, useEffect, useRef, useCallback } from "react";
import { FileTree } from "./components/FileTree";
import { Editor } from "./components/Editor";
import { X, Plus, Play, Save, FolderOpen, Square } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Tab {
  id: string; // File path or 'untitled-X'
  path: string | null;
  name: string;
  content: string;
  isDirty: boolean;
}

function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [workspacePath, setWorkspacePath] = useState<string>("");
  const [lastLocalWorkspacePath, setLastLocalWorkspacePath] =
    useState<string>("");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [picoConnected, setPicoConnected] = useState(false);
  const [picoSerialReady, setPicoSerialReady] = useState(false);
  const [shellOutput, setShellOutput] = useState("");
  const [shellInput, setShellInput] = useState("");
  const [shellPrompt, setShellPrompt] = useState(">>> ");
  const [showReplPrompt, setShowReplPrompt] = useState(false);
  const [shellHistory, setShellHistory] = useState<string[]>([]);
  const [shellHistoryIndex, setShellHistoryIndex] = useState<number | null>(
    null,
  );
  const [isExecuting, setIsExecuting] = useState(false);

  const PICO_WORKSPACE_PATH = "pico:/";
  const SHELL_PRIMARY_PROMPT = ">>> ";
  const SHELL_CONTINUATION_PROMPT = "... ";
  const shellScrollRef = useRef<HTMLDivElement | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) || null;
  const hasOpenFile = activeTab !== null;
  const isRunnablePicoFile =
    picoSerialReady &&
    Boolean(activeTab?.path) &&
    activeTab!.path!.startsWith("pico:/") &&
    activeTab!.path!.endsWith(".py");

  const toPicoDevicePath = (picoPath: string) => {
    const stripped = picoPath.replace(/^pico:\/*/i, "");
    return `/${stripped}`.replace(/\/+/g, "/");
  };

  const createNewUntitledTab = () => {
    const untitledId = `untitled-${Date.now()}`;
    const newTab: Tab = {
      id: untitledId,
      path: null,
      name: "Untitled",
      content: "",
      isDirty: false,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(untitledId);
  };

  const handleFileSelect = async (path: string) => {
    // Check if file is already open
    const existingTab = tabs.find((t) => t.path === path);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }

    try {
      const content = await window.electronAPI.readFile(path);
      const name = await window.electronAPI.getBasename(path);
      const newTab: Tab = {
        id: path,
        path,
        name,
        content,
        isDirty: false,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(path);
    } catch (error) {
      console.error("Failed to read file:", error);
      alert("Failed to read file");
    }
  };

  // Initialize workspace and a blank tab
  useEffect(() => {
    const init = async () => {
      const path = await window.electronAPI.getAppPath();
      setWorkspacePath(path);

      const untitledId = `untitled-${Date.now()}`;
      const newTab: Tab = {
        id: untitledId,
        path: null,
        name: "Untitled",
        content: "",
        isDirty: false,
      };
      setTabs([newTab]);
      setActiveTabId(untitledId);
    };
    init();
  }, []);

  useEffect(() => {
    let isActive = true;

    window.electronAPI
      .getPicoConnectionState()
      .then((isConnected) => {
        if (isActive) setPicoConnected(isConnected);
      })
      .catch(() => {});

    const unsubscribe = window.electronAPI.onPicoConnectionChange(
      (isConnected) => {
        if (isActive) setPicoConnected(isConnected);
      },
    );
    return () => {
      isActive = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const unsubOpen = window.electronAPI.onPicoSerialOpen(() => {
      setPicoSerialReady(true);
      setShellOutput((prev) => `${prev}\n[Serial connected]\n`);
      void window.electronAPI.writePicoSerial("\r");
    });
    const unsubClose = window.electronAPI.onPicoSerialClose(() => {
      setPicoSerialReady(false);
      setIsExecuting(false);
      setShowReplPrompt(false);
      setShellOutput((prev) => `${prev}\n[Serial disconnected]\n`);
    });
    const unsubData = window.electronAPI.onPicoSerialData((data) => {
      const normalizedChunk = data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

      setShellOutput((prev) => {
        const next = `${prev}${normalizedChunk}`;
        const tail = next.slice(-256);
        const promptMatch = tail.match(/(?:^|\n)(>>> |\.\.\. )$/);

        if (promptMatch?.[1] === SHELL_PRIMARY_PROMPT) {
          setShellPrompt(SHELL_PRIMARY_PROMPT);
          setShowReplPrompt(true);
          setIsExecuting(false);
        } else if (promptMatch?.[1] === SHELL_CONTINUATION_PROMPT) {
          setShellPrompt(SHELL_CONTINUATION_PROMPT);
          setShowReplPrompt(true);
        } else {
          setShowReplPrompt(false);
        }

        return next;
      });
    });
    const unsubError = window.electronAPI.onPicoSerialError((message) => {
      setShellOutput((prev) => `${prev}\n[Serial error] ${message}\n`);
    });
    return () => {
      unsubOpen();
      unsubClose();
      unsubData();
      unsubError();
    };
  }, []);

  useEffect(() => {
    const container = shellScrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [shellOutput]);

  useEffect(() => {
    if (workspacePath && !workspacePath.startsWith("pico:")) {
      setLastLocalWorkspacePath(workspacePath);
    }
  }, [workspacePath]);

  useEffect(() => {
    if (picoSerialReady) {
      if (!workspacePath.startsWith("pico:")) {
        setLastLocalWorkspacePath(workspacePath);
      }
      setWorkspacePath(PICO_WORKSPACE_PATH);
      return;
    }

    if (workspacePath.startsWith("pico:") && lastLocalWorkspacePath) {
      setWorkspacePath(lastLocalWorkspacePath);
    }
  }, [picoSerialReady]);

  const handleCloseTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const tabToClose = tabs.find((t) => t.id === id);
    if (tabToClose?.isDirty) {
      if (
        !window.confirm(`${tabToClose.name} has unsaved changes. Close anyway?`)
      ) {
        return;
      }
    }

    const newTabs = tabs.filter((t) => t.id !== id);
    setTabs(newTabs);

    if (activeTabId === id) {
      if (newTabs.length > 0) {
        setActiveTabId(newTabs[newTabs.length - 1].id);
      } else {
        setActiveTabId(null);
      }
    }
  };

  const handleContentChange = (value: string | undefined) => {
    if (value !== undefined && activeTabId) {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId ? { ...t, content: value, isDirty: true } : t,
        ),
      );
    }
  };

  const handleSave = async () => {
    if (!activeTab) return;

    let targetPath = activeTab.path;
    if (!targetPath) {
      if (workspacePath.startsWith("pico:")) {
        const suggestedName =
          activeTab.name && activeTab.name !== "Untitled"
            ? activeTab.name
            : "main.py";
        const inputName = window.prompt(
          "Picoへ保存するファイル名を入力してください",
          suggestedName,
        );
        if (!inputName) return;

        const normalizedName = inputName
          .trim()
          .replace(/\\/g, "/")
          .replace(/^\/+/, "");

        if (!normalizedName) {
          alert("ファイル名を入力してください");
          return;
        }

        const basePath = workspacePath.replace(/\/+$/, "");
        targetPath = `${basePath}/${normalizedName}`;
      } else {
        targetPath = await window.electronAPI.showSaveDialog(workspacePath);
        if (!targetPath) return;
      }
    }

    try {
      await window.electronAPI.writeFile(targetPath, activeTab.content);
      const name = await window.electronAPI.getBasename(targetPath);

      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id
            ? { ...t, id: targetPath!, path: targetPath!, name, isDirty: false }
            : t,
        ),
      );
      setActiveTabId(targetPath);
      setRefreshTrigger((prev) => prev + 1);
    } catch (error) {
      console.error("Failed to save file:", error);
      alert("Failed to save file");
    }
  };

  const handleShellSubmit = useCallback(async () => {
    if (!picoSerialReady) return;

    const line = shellInput;
    setShellInput("");
    setShellHistoryIndex(null);
    setShowReplPrompt(false);

    if (line.length > 0) {
      setShellHistory((prev) => [...prev, line]);
    }

    const ok = await window.electronAPI.writePicoSerial(`${line}\r`);
    if (!ok) {
      setShellOutput((prev) => `${prev}\n[Write failed]\n`);
    }
  }, [picoSerialReady, shellInput]);

  const handleShellKeyDown = async (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Enter") {
      event.preventDefault();
      await handleShellSubmit();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (shellHistory.length === 0) return;

      if (shellHistoryIndex === null) {
        const nextIndex = shellHistory.length - 1;
        setShellHistoryIndex(nextIndex);
        setShellInput(shellHistory[nextIndex]);
        return;
      }

      const nextIndex = Math.max(0, shellHistoryIndex - 1);
      setShellHistoryIndex(nextIndex);
      setShellInput(shellHistory[nextIndex]);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (shellHistory.length === 0 || shellHistoryIndex === null) return;

      const nextIndex = shellHistoryIndex + 1;
      if (nextIndex >= shellHistory.length) {
        setShellHistoryIndex(null);
        setShellInput("");
        return;
      }

      setShellHistoryIndex(nextIndex);
      setShellInput(shellHistory[nextIndex]);
    }
  };

  const handleRunActiveFile = useCallback(async () => {
    if (!activeTab?.path) return;

    if (
      !activeTab.path.startsWith("pico:/") ||
      !activeTab.path.endsWith(".py")
    ) {
      alert("Pico上の .py ファイルを開いている時のみ実行できます");
      return;
    }

    if (!picoSerialReady) {
      alert("Picoのシリアル接続を確認してください");
      return;
    }

    if (activeTab.isDirty) {
      await handleSave();
    }

    const devicePath = toPicoDevicePath(activeTab.path);
    const escapedPath = devicePath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

    setShowReplPrompt(false);
    setIsExecuting(true);
    setShellOutput((prev) => `${prev}\n# Running ${activeTab.name}\n`);

    const command = `exec(open('${escapedPath}').read(), globals())\r`;
    const ok = await window.electronAPI.writePicoSerial(command);
    if (!ok) {
      setIsExecuting(false);
      setShellOutput((prev) => `${prev}\n[Run failed]\n`);
    }
  }, [activeTab, handleSave, picoSerialReady]);

  const handleStopExecution = useCallback(async () => {
    if (!picoSerialReady || !isExecuting) return;

    const ok = await window.electronAPI.writePicoSerial("\u0003");
    if (!ok) {
      setShellOutput((prev) => `${prev}\n[Stop failed]\n`);
    }
  }, [isExecuting, picoSerialReady]);

  const handleOpenFileFromStatus = useCallback(async () => {
    const selectedPath = await window.electronAPI.showOpenFileDialog();
    if (!selectedPath) return;
    await handleFileSelect(selectedPath);
  }, [handleFileSelect]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-app relative">
      <aside className="w-64 border-r border-border flex-shrink-0">
        <FileTree
          onFileSelect={handleFileSelect}
          selectedFilePath={activeTab?.path || null}
          refreshTrigger={refreshTrigger}
          workspacePath={workspacePath}
          onWorkspaceChange={setWorkspacePath}
        />
      </aside>
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Tab Bar */}
        <div className="h-9 bg-panel flex items-center overflow-hidden border-b border-border-subtle">
          <div className="flex-1 flex overflow-x-auto no-scrollbar h-full">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={cn(
                  "flex items-center px-3 min-w-[120px] max-w-[200px] h-full cursor-pointer border-r border-border-subtle select-none text-xs transition-colors",
                  activeTabId === tab.id
                    ? "bg-app text-white"
                    : "bg-panel-alt text-text-muted hover:bg-panel-hover",
                )}
              >
                <span
                  className={cn(
                    "truncate flex-1",
                    tab.isDirty && "font-bold italic",
                  )}
                >
                  {tab.name}
                  {tab.isDirty && "*"}
                </span>
                <button
                  onClick={(e) => handleCloseTab(e, tab.id)}
                  className="ml-2 p-0.5 hover:bg-selection rounded text-text-muted hover:text-white"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={createNewUntitledTab}
            className="px-3 h-full flex items-center justify-center text-text-muted hover:text-white hover:bg-panel-alt border-l border-border-subtle transition-colors"
            title="New Untitled File"
            type="button"
          >
            <Plus size={16} />
          </button>

          <div className="h-full border-l border-border-subtle px-2 flex items-center gap-1.5 bg-panel-alt/40">
            <button
              onClick={() => void handleSave()}
              className="h-6 px-2 rounded text-[11px] text-text-primary hover:text-white hover:bg-panel transition-colors flex items-center gap-1"
              title="Save current file"
              disabled={!hasOpenFile}
              type="button"
            >
              <Save size={12} />
              Save
            </button>
            <button
              onClick={() => void handleOpenFileFromStatus()}
              className="h-6 px-2 rounded text-[11px] text-text-primary hover:text-white hover:bg-panel transition-colors flex items-center gap-1"
              title="Open file"
              type="button"
            >
              <FolderOpen size={12} />
              Open
            </button>
            {picoConnected && hasOpenFile && (
              <>
                <button
                  onClick={() => void handleRunActiveFile()}
                  className={cn(
                    "h-6 px-2 rounded flex items-center gap-1 text-[11px] transition-colors",
                    isRunnablePicoFile && !isExecuting
                      ? "text-emerald-300 hover:text-white hover:bg-panel"
                      : "text-text-faint cursor-not-allowed",
                  )}
                  title={
                    isRunnablePicoFile
                      ? "Run current file on Raspberry Pi Pico"
                      : "Open a .py file on pico:/ to run"
                  }
                  disabled={!isRunnablePicoFile || isExecuting}
                  type="button"
                >
                  <Play size={12} />
                  Run
                </button>
                <button
                  onClick={() => void handleStopExecution()}
                  className={cn(
                    "h-6 px-2 rounded text-[11px] transition-colors flex items-center gap-1",
                    isExecuting
                      ? "text-rose-300 hover:text-white hover:bg-panel"
                      : "text-text-faint cursor-not-allowed",
                  )}
                  title="Stop running program (Ctrl+C)"
                  disabled={!isExecuting}
                  type="button"
                >
                  <Square size={11} />
                  Stop
                </button>
              </>
            )}
            <span className="ml-1 text-[10px] text-text-muted uppercase tracking-wide">
              {isExecuting ? "Executing" : "Idle"}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 overflow-hidden">
            {activeTab ? (
              <Editor
                filePath={activeTab.path}
                content={activeTab.content}
                onChange={handleContentChange}
                onSave={handleSave}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-text-faint">
                No files open
              </div>
            )}
          </div>

          <section className="h-56 border-t border-border bg-[#0f1115] flex flex-col">
            <div className="h-8 px-3 border-b border-border-subtle flex items-center justify-between">
              <span className="text-xs text-text-muted tracking-wide uppercase">
                Raspberry Pi Pico Shell
              </span>
              <button
                className="text-xs text-text-muted hover:text-white transition-colors"
                onClick={() => setShellOutput("")}
                type="button"
              >
                Clear
              </button>
            </div>

            <div
              ref={shellScrollRef}
              className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-5 text-[#d6deeb] whitespace-pre-wrap break-words"
            >
              {shellOutput || "Waiting for serial output..."}
            </div>

            <div className="h-9 border-t border-border-subtle px-3 flex items-center gap-2 bg-[#121722]">
              <span className="font-mono text-[12px] text-[#8aa2c6] min-w-[32px]">
                {showReplPrompt ? shellPrompt : ""}
              </span>
              <input
                className="flex-1 bg-transparent outline-none border-none font-mono text-[12px] text-[#d6deeb] placeholder:text-[#5f6f86]"
                value={shellInput}
                onChange={(event) => setShellInput(event.target.value)}
                onKeyDown={handleShellKeyDown}
                placeholder={
                  picoSerialReady
                    ? "Type Python expression or input data and press Enter"
                    : "Connect Pico to start REPL"
                }
                disabled={!picoSerialReady}
              />
            </div>
          </section>
        </div>
      </main>
      <div
        className="absolute bottom-3 right-3 flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-1.5 text-xs shadow-lg pointer-events-none"
        role="status"
        aria-live="polite"
      >
        <span
          className={cn(
            "h-2.5 w-2.5 rounded-full",
            picoConnected
              ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.9)]"
              : "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.9)]",
          )}
        />
        <span className={picoConnected ? "text-emerald-400" : "text-rose-400"}>
          Pico {picoConnected ? "Connected" : "Disconnected"}
        </span>
      </div>
    </div>
  );
}

export default App;
