import React, { useState, useEffect } from "react";
import { FileTree } from "./components/FileTree";
import { Editor } from "./components/Editor";
import { X, Plus } from "lucide-react";
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

  const PICO_WORKSPACE_PATH = "pico:/";

  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

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
    });
    const unsubClose = window.electronAPI.onPicoSerialClose(() => {
      setPicoSerialReady(false);
    });
    return () => {
      unsubOpen();
      unsubClose();
    };
  }, []);

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
      targetPath = await window.electronAPI.showSaveDialog(workspacePath);
      if (!targetPath) return;
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
          >
            <Plus size={16} />
          </button>
        </div>

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
