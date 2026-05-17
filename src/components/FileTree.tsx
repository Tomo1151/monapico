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
}

export const FileTree: React.FC<FileTreeProps> = ({ onFileSelect, selectedFilePath, refreshTrigger }) => {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [rootPath, setRootPath] = useState<string>('');

  const loadRoot = async () => {
    const path = await window.electronAPI.getAppPath();
    setRootPath(path);
    const entries = await window.electronAPI.readdir(path);
    // Sort: folders first, then alphabetical
    setFiles(entries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    }));
  };

  useEffect(() => {
    loadRoot();
  }, [refreshTrigger]);

  return (
    <div className="h-full bg-[#252526] text-[#cccccc] flex flex-col overflow-hidden">
      <div className="p-2 text-xs font-bold uppercase tracking-wider text-[#969696]">
        Explorer
      </div>
      <div className="flex-1 overflow-y-auto py-1">
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
