# 🎉 Electron 桌面应用已配置完成！

## ✅ 已完成的工作

1. **Electron 配置文件**
   - `electron/main.js` - 主进程入口
   - `electron/preload.js` - 安全隔离层
   - `electron/loading.html` - 加载页面

2. **构建配置**
   - `package.json` - 添加 Electron 依赖和脚本
   - `build/electron-build.sh` - 自动化构建脚本

3. **文档**
   - `ELECTRON_GUIDE.md` - 详细使用指南

4. **H5 编译**
   - 已成功编译 H5 版本到 `dist-web` 目录

## 🚀 在你的本地环境完成打包

### 步骤 1：拉取最新代码

```bash
cd hospital-schedule
git pull origin main
```

### 步骤 2：设置 Electron 镜像（推荐，加速下载）

**Windows (PowerShell):**
```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
```

**macOS/Linux:**
```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
```

### 步骤 3：安装依赖

```bash
pnpm install
```

⚠️ **注意**：首次安装会下载 Electron 运行时（约 100MB），请耐心等待。

### 步骤 4：开发模式运行（可选）

```bash
# 终端 1：启动 H5 开发服务器
pnpm dev

# 终端 2：启动 Electron
pnpm dev:electron
```

### 步骤 5：打包应用

#### 方式 1：使用构建脚本（推荐）

```bash
chmod +x build/electron-build.sh
./build/electron-build.sh
```

#### 方式 2：手动构建

```bash
# 步骤 1：编译 H5 版本
pnpm build:web

# 步骤 2：打包 Electron（不压缩，快速测试）
pnpm build:electron:dir

# 或：打包为安装程序（压缩，最终发布）
pnpm build:electron
```

## 📦 打包后的应用位置

### 不压缩版本（用于测试）
```
dist/electron/unpacked/
├── 医院排班系统.exe (Windows)
├── 医院排班系统.app (macOS)
└── 医院排班系统 (Linux)
```

### 压缩版本（用于发布）
```
dist/electron/
├── 医院排班系统 Setup 1.0.0.exe (Windows 安装程序)
├── 医院排班系统-1.0.0.dmg (macOS 安装包)
└── 医院排班系统-1.0.0.AppImage (Linux 便携版)
```

## 🎯 使用方法

### Windows
1. 双击 `医院排班系统.exe` 运行
2. 或安装 `医院排班系统 Setup 1.0.0.exe`

### macOS
1. 双击 `医院排班系统.app` 运行
2. 或安装 `医院排班系统-1.0.0.dmg`

### Linux
1. 双击 `医院排班系统` 运行
2. 或赋予执行权限：`chmod +x 医院排班系统-1.0.0.AppImage`

## 🔧 配置说明

### 窗口大小

修改 `electron/main.js`：

```javascript
new BrowserWindow({
  width: 1400,        // 窗口宽度
  height: 900,        // 窗口高度
  minWidth: 1200,     // 最小宽度
  minHeight: 800,     // 最小高度
})
```

### 应用名称

修改 `package.json`：

```json
{
  "build": {
    "productName": "医院排班系统"
  }
}
```

### 应用图标

1. 准备一个 `512x512` 的 PNG 图标
2. 保存为 `build/icon.png`
3. 重新打包应用

## ⚠️ 常见问题

### 1. Electron 下载失败

**问题**：安装 Electron 时提示超时

**解决方案**：
```bash
# 设置国内镜像
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

# 重新安装
pnpm install
```

### 2. 打包后应用无法启动

**问题**：点击应用图标后没有反应

**解决方案**：
- 检查 H5 版本是否正确编译：`ls dist-web/`
- 查看 Electron 日志：
  - Windows: 运行时右键 → 查看开发者工具
  - macOS/Linux: 启动时按 `Ctrl+Shift+I`（Windows）或 `Cmd+Option+I`（Mac）

### 3. 网络请求失败

**问题**：应用无法连接到后端 API

**解决方案**：
- 确保后端服务器正在运行：`pnpm dev`
- 检查 `.env.production` 中的 `PROJECT_DOMAIN` 配置
- 打开开发者工具查看网络请求

## 📊 应用特性

✅ **跨平台支持**：Windows / macOS / Linux  
✅ **独立运行**：无需安装 Node.js 或浏览器  
✅ **自动更新**：可选支持自动更新功能  
✅ **安全隔离**：使用 Context Isolation 防止脚本注入  
✅ **文件导出**：支持导出 Word 文档  
✅ **离线可用**：纯前端功能可离线使用  

## 🎨 自定义

### 添加应用图标
```bash
# 准备图标
mkdir -p build
# 将 512x512 的 PNG 图标保存为 build/icon.png

# 重新打包
pnpm build:electron
```

### 添加托盘图标（可选）
```javascript
// electron/main.js
const { Tray } = require('electron')

const tray = new Tray('build/icon.png')
tray.setToolTip('医院排班系统')
```

## 📞 获取帮助

- 详细文档：`ELECTRON_GUIDE.md`
- Electron 官方文档：https://www.electronjs.org/docs
- electron-builder 文档：https://www.electron.build/

---

**下一步：在你的本地环境按照上述步骤完成打包！**

如有问题，请查看 `ELECTRON_GUIDE.md` 获取更多详细信息。
