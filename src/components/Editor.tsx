import React, { useEffect } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { File } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface EditorProps {
  filePath: string | null;
  content: string;
  onChange: (value: string | undefined) => void;
  onSave: () => void;
}

export const Editor: React.FC<EditorProps> = ({ filePath, content, onChange, onSave }) => {
  const language = filePath?.endsWith('.py') ? 'python' : 'python'; // Default to python for MicroPython focus
  const onSaveRef = React.useRef(onSave);
  
  // Update the ref on every render to ensure we have the latest callback
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => {
        onSaveRef.current();
      }
    );
  };

  const displayPath = filePath || 'Untitled';

  return (
    <div className="h-full flex flex-col">
      <div className="h-9 bg-[#2d2d2d] flex items-center px-4 border-b border-[#1e1e1e]">
        <span className={cn(
          "text-xs truncate",
          filePath ? "text-[#cccccc] italic" : "text-[#969696]"
        )}>
          {displayPath}
        </span>
      </div>
      <div className="flex-1">
        <MonacoEditor
          theme="vs-dark"
          language={language}
          value={content}
          onChange={onChange}
          onMount={handleEditorDidMount}
          options={{
            fontSize: 14,
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            padding: { top: 10 },
          }}
        />
      </div>
    </div>
  );
};
