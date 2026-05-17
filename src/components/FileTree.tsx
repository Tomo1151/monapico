import React, { useEffect, useState } from 'react';
import { Folder, File, ChevronRight, ChevronDown } from 'lucide-react';
import { FileEntry } from '../electron-api';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

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
  onWorkspaceChange
}) => {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [workspaceName, setWorkspaceName] = useState<string>('');

  const loadRoot = async () => {
    if (!workspacePath) return;
    try {
      const name = await window.electronAPI.getBasename(workspacePath);
      setWorkspaceName(name);
      const entries = await window.electronAPI.readdir(workspacePath);
      setFiles(entries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      }));
    } catch (error) {
      console.error('Failed to load workspace:', error);
    }
  };

  useEffect(() => {
    loadRoot();
  }, [workspacePath, refreshTrigger]);

  const handleOpenFolder = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Renderer: Requesting open folder dialog');
    try {
      if (!window.electronAPI || !window.electronAPI.showOpenDialog) {
        throw new Error('electronAPI.showOpenDialog is not available');
      }
      const path = await window.electronAPI.showOpenDialog();
      console.log('Renderer: Open folder dialog result:', path);
      if (path) {
        onWorkspaceChange(path);
      }
    } catch (error: any) {
      console.error('Renderer: Failed to open folder dialog:', error);
      alert('Failed to open folder dialog: ' + (error.message || 'Unknown error'));
    }
  };

  return (
    <div className="h-full bg-[#252526] text-[#cccccc] flex flex-col overflow-hidden">
      <div className="p-2 text-[10px] font-bold uppercase tracking-wider text-[#969696] flex justify-between items-center border-b border-[#333333]">
        <span>Explorer</span>
        <button 
          onClick={handleOpenFolder}
          className="hover:bg-[#37373d] p-1 rounded transition-colors"
          title="Open Folder"
        >
          <Folder size={14} />
        </button>
      </div>
      {workspaceName && (
        <div className="px-4 py-2 text-xs font-bold text-[#cccccc] bg-[#2d2d2d] flex items-center shadow-sm">
          <Folder size={14} className="mr-2 text-[#969696]" />
          <span className="truncate uppercase tracking-tight">{workspaceName}</span>
        </div>
      )}
      <div className="flex-1 overflow-y-auto py-1">
        {files.length === 0 && (
          <div className="p-4 text-xs text-center text-[#666666]">
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
          />
        ))}
      </div>
    </div>
  );
};

interface FileItemProps {
  file: FileEntry;
  level: number;
  onFileSelect: (path: string) => void;
  selectedFilePath: string | null;
}

const FileItem: React.FC<FileItemProps> = ({ file, level, onFileSelect, selectedFilePath }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);
  const isSelected = selectedFilePath === file.path;

  const toggleFolder = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (file.isDirectory) {
      if (!isOpen) {
        const entries = await window.electronAPI.readdir(file.path);
        setChildren(entries.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        }));
      }
      setIsOpen(!isOpen);
    } else {
      onFileSelect(file.path);
    }
  };

  return (
    <div>
      <div
        className={cn(
          "flex items-center py-0.5 px-2 cursor-pointer hover:bg-[#2a2d2e] select-none",
          isSelected && "bg-[#37373d] text-white",
          file.isDirectory ? "text-[#cccccc]" : "text-[#cccccc]"
        )}
        style={{ paddingLeft: `${(level + 1) * 12}px` }}
        onClick={toggleFolder}
      >
        <span className="mr-1.5 flex-shrink-0">
          {file.isDirectory ? (
            isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />
          ) : (
            <File size={16} className="text-[#519aba]" />
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
            />
          ))}
        </div>
      )}
    </div>
  );
};
