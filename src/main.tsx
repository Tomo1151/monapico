import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Use contextBridge
const unsub = window.electronAPI.onMainMessage((_message) => {
  console.log(_message)
})

// Note: In a real app, you might want to call unsub() when the root is unmounted
// but for the main entry point, it's usually fine.
