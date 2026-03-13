const { contextBridge, ipcRenderer } = require('electron')

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 这里可以添加需要暴露给前端的 API
  platform: process.platform,
  versions: process.versions
})

// 阻止 Node.js 集成
window.nodeRequire = undefined
