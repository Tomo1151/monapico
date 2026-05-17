import React, { useState, useEffect } from 'react';
import { FileTree } from './components/FileTree';
import { Editor } from './components/Editor';

function App() {
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [isDirty, setIsDirty] = useState(false);

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Load a blank file on startup
  useEffect(() => {
    setSelectedFilePath(null);
    setFileContent('');
    setIsDirty(false);
  }, []);

  const handleFileSelect = async (path: string) => {
    if (isDirty) {
      const confirm = window.confirm('You have unsaved changes. Do you want to discard them?');
      if (!confirm) return;
    }
    
    try {
      const content = await window.electronAPI.readFile(path);
      setSelectedFilePath(path);
      setFileContent(content);
      setIsDirty(false);
    } catch (error) {
      console.error('Failed to read file:', error);
      alert('Failed to read file');
    }
  };

  const handleContentChange = (value: string | undefined) => {
    if (value !== undefined) {
      setFileContent(value);
      setIsDirty(true);
    }
  };

  const handleSave = async () => {
    let targetPath = selectedFilePath;
    
    if (!targetPath) {
      targetPath = await window.electronAPI.showSaveDialog();
      if (!targetPath) return; // User canceled
    }

    try {
      await window.electronAPI.writeFile(targetPath, fileContent);
      setSelectedFilePath(targetPath);
      setIsDirty(false);
      setRefreshTrigger(prev => prev + 1);
      console.log('File saved successfully');
    } catch (error) {
      console.error('Failed to save file:', error);
      alert('Failed to save file');
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#1e1e1e]">
      <aside className="w-64 border-r border-[#333333] flex-shrink-0">
        <FileTree 
          onFileSelect={handleFileSelect} 
          selectedFilePath={selectedFilePath} 
          refreshTrigger={refreshTrigger}
        />
      </aside>
      <main className="flex-1 overflow-hidden">
        <Editor
          filePath={selectedFilePath}
          content={fileContent}
          onChange={handleContentChange}
          onSave={handleSave}
        />
      </main>
      {isDirty && (
        <div className="fixed bottom-4 right-4 bg-yellow-600 text-white px-3 py-1 rounded text-xs shadow-lg animate-pulse">
          Unsaved Changes
        </div>
      )}
    </div>
  );
}

export default App;
