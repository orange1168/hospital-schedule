const { app, Tray, Menu, BrowserWindow, shell } = require('electron')
const path = require('path')

let tray = null

// 创建系统托盘图标
function createTray(mainWindow) {
  // Windows/macOS/Linux 使用不同的图标
  const iconPath = path.join(__dirname, '../build/icon.png')

  tray = new Tray(iconPath)

  // 托盘菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        mainWindow.show()
        mainWindow.focus()
      }
    },
    {
      label: '隐藏窗口',
      click: () => {
        mainWindow.hide()
      }
    },
    { type: 'separator' },
    {
      label: '打开后端日志',
      click: () => {
        shell.openExternal('https://railway.app/project/new')
      }
    },
    { type: 'separator' },
    {
      label: '关于医院排班系统',
      click: () => {
        // 可以添加关于对话框
        app.showAboutPanel()
      }
    },
    {
      label: '退出应用',
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setToolTip('医院排班系统 - 点击显示/隐藏')
  tray.setContextMenu(contextMenu)

  // 点击托盘图标显示/隐藏窗口
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

module.exports = { createTray }
