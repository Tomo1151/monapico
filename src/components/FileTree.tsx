import React, { useEffect, useState } from "react";
import {
  Folder,
  File,
  ChevronRight,
  ChevronDown,
  FolderPlus,
} from "lucide-react";
import { FileEntry } from "../electron-api";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface FileTreeProps {
  onFileSelect: (path: string) => void;
  selectedFilePath: string | null;
  refreshTrigger?: number;
  workspacePath: string;
  onWorkspaceChange: (path: string) => void;
}

export const FileTree: React.FC<FileTreeProps> = ({
  onFileSelect,
  selectedFilePath,
  refreshTrigger,
  workspacePath,
  onWorkspaceChange,
}) => {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [workspaceName, setWorkspaceName] = useState<string>("");
  const [newInput, setNewInput] = useState<{
    parentPath: string;
    level: number;
    isDirectory: boolean;
  } | null>(null);

  const loadRoot = async () => {
    if (!workspacePath) return;
    try {
      const name = await window.electronAPI.getBasename(workspacePath);
      setWorkspaceName(name);
      const entries = await window.electronAPI.readdir(workspacePath);
      setFiles(
        entries.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        }),
      );
    } catch (error) {
      console.error("Failed to load workspace:", error);
    }
  };

  useEffect(() => {
    loadRoot();
  }, [workspacePath, refreshTrigger]);

  useEffect(() => {
    const handleCreateNew = (
      data: { path: string; isDirectory: boolean },
      isCreatingDirectory: boolean,
    ) => {
      let parentPath = data.path;
      if (!data.isDirectory) {
        parentPath = data.path.substring(
          0,
          Math.max(data.path.lastIndexOf("/"), data.path.lastIndexOf("\\")),
        );
      }

      const relPath = parentPath.replace(workspacePath, "");
      const level = relPath.split(/[\/\\]/).filter(Boolean).length;

      setNewInput({ parentPath, level, isDirectory: isCreatingDirectory });
    };

    const unsubNewFile = window.electronAPI.onCreateNewFile((data) =>
      handleCreateNew(data, false),
    );
    const unsubNewFolder = window.electronAPI.onCreateNewFolder((data) =>
      handleCreateNew(data, true),
    );

    const unsubDelete = window.electronAPI.onDeleteItem(async (data) => {
      const name = await window.electronAPI.getBasename(data.path);
      if (window.confirm(`本当に「${name}」を削除しますか？`)) {
        try {
          await window.electronAPI.rm(data.path);
          loadRoot();
        } catch (error) {
          alert("削除に失敗しました");
        }
      }
    });

    return () => {
      unsubNewFile();
      unsubNewFolder();
      unsubDelete();
    };
  }, [workspacePath]);

  const handleInputSubmit = async (name: string) => {
    if (!name || !newInput) {
      setNewInput(null);
      return;
    }

    const fullPath = `${newInput.parentPath}/${name}`.replace(/\/\//g, "/");
    try {
      if (newInput.isDirectory) {
        await window.electronAPI.mkdir(fullPath);
      } else {
        await window.electronAPI.writeFile(fullPath, "");
      }
      setNewInput(null);
      await loadRoot();
      if (!newInput.isDirectory) {
        onFileSelect(fullPath);
      }
    } catch (error) {
      alert(
        newInput.isDirectory
          ? "フォルダの作成に失敗しました"
          : "ファイルの作成に失敗しました",
      );
      setNewInput(null);
    }
  };

  const handleOpenFolder = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const path = await window.electronAPI.showOpenDialog();
      if (path) {
        onWorkspaceChange(path);
      }
    } catch (error: any) {
      alert(
        "Failed to open folder dialog: " + (error.message || "Unknown error"),
      );
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    window.electronAPI.showExplorerContextMenu(workspacePath, true, false); // canDelete: false for workspace root
  };

  return (
    <div
      className="h-full bg-panel text-text-primary flex flex-col overflow-hidden"
      onContextMenu={handleContextMenu}
    >
      <div className="p-2 text-[10px] font-bold uppercase tracking-wider text-text-muted flex justify-between items-center border-b border-border">
        <span>Explorer</span>
        <button
          onClick={handleOpenFolder}
          className="hover:bg-selection p-1 rounded transition-colors"
          title="Open Folder"
          onContextMenu={(e) => e.stopPropagation()}
        >
          <Folder size={14} />
        </button>
      </div>
      {workspaceName && (
        <div className="px-4 py-2 text-xs font-bold text-text-primary bg-panel-alt flex items-center shadow-sm">
          <Folder size={14} className="mr-2 text-text-muted" />
          <span className="truncate uppercase tracking-tight">
            {workspaceName}
          </span>
        </div>
      )}
      <div className="flex-1 overflow-y-auto py-1">
        {files.length === 0 && !newInput && (
          <div className="p-4 text-xs text-center text-text-subtle">
            No folder opened
          </div>
        )}
        {files.map((file) => (
          <FileItem
            key={file.path}
            file={file}
            level={0}
            onFileSelect={onFileSelect}
            selectedFilePath={selectedFilePath}
            newInput={newInput}
            onInputSubmit={handleInputSubmit}
          />
        ))}
        {newInput && newInput.parentPath === workspacePath && (
          <NewInputItem
            level={0}
            isDirectory={newInput.isDirectory}
            onSubmit={handleInputSubmit}
            onCancel={() => setNewInput(null)}
          />
        )}
      </div>
    </div>
  );
};

interface FileItemProps {
  file: FileEntry;
  level: number;
  onFileSelect: (path: string) => void;
  selectedFilePath: string | null;
  newInput: { parentPath: string; level: number; isDirectory: boolean } | null;
  onInputSubmit: (name: string) => void;
}

const FileItem: React.FC<FileItemProps> = ({
  file,
  level,
  onFileSelect,
  selectedFilePath,
  newInput,
  onInputSubmit,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const isSelected = selectedFilePath === file.path;

  const loadChildren = async () => {
    const entries = await window.electronAPI.readdir(file.path);
    setChildren(
      entries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      }),
    );
  };

  useEffect(() => {
    if (isOpen) {
      loadChildren();
    }
  }, [isOpen]);

  const toggleFolder = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (file.isDirectory) {
      setIsOpen(!isOpen);
    } else {
      onFileSelect(file.path);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.electronAPI.showExplorerContextMenu(file.path, file.isDirectory);
  };

  return (
    <div>
      <div
        className={cn(
          "flex items-center py-0.5 px-2 cursor-pointer hover:bg-panel-hover select-none",
          isSelected && "bg-selection text-white",
          file.isDirectory ? "text-text-primary" : "text-text-primary",
        )}
        style={{ paddingLeft: `${(level + 1) * 12}px` }}
        onClick={toggleFolder}
        onContextMenu={handleContextMenu}
      >
        <span className="mr-1.5 flex-shrink-0">
          {file.isDirectory ? (
            isOpen ? (
              <ChevronDown size={16} />
            ) : (
              <ChevronRight size={16} />
            )
          ) : (
            <File size={16} className="text-accent-blue" />
          )}
        </span>
        <span className="truncate text-sm">{file.name}</span>
      </div>
      {isOpen && file.isDirectory && (
        <div>
          {children.map((child) => (
            <FileItem
              key={child.path}
              file={child}
              level={level + 1}
              onFileSelect={onFileSelect}
              selectedFilePath={selectedFilePath}
              newInput={newInput}
              onInputSubmit={onInputSubmit}
            />
          ))}
          {newInput && newInput.parentPath === file.path && (
            <NewInputItem
              level={level + 1}
              isDirectory={newInput.isDirectory}
              onSubmit={onInputSubmit}
              onCancel={() => onInputSubmit("")}
            />
          )}
        </div>
      )}
    </div>
  );
};

const NewInputItem: React.FC<{
  level: number;
  isDirectory: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}> = ({ level, isDirectory, onSubmit, onCancel }) => {
  const [value, setValue] = useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Check if the user is currently composing text (IME)
    if (e.nativeEvent.isComposing) {
      return;
    }

    if (e.key === "Enter") {
      onSubmit(value);
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div
      className="flex items-center py-0.5 px-2 bg-selection"
      style={{ paddingLeft: `${(level + 1) * 12}px` }}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="mr-1.5 flex-shrink-0">
        {isDirectory ? (
          <Folder size={16} className="text-accent-warn" />
        ) : (
          <File size={16} className="text-accent-blue" />
        )}
      </span>
      <input
        ref={inputRef}
        type="text"
        className="bg-input text-white text-sm outline-none border border-accent-focus w-full px-1 py-0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => onSubmit(value)}
      />
    </div>
  );
};
