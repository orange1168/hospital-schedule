# 医院排班系统 - Electron 桌面应用

## 📦 快速开始

### 前置要求
- Node.js 18+
- pnpm

### 安装依赖

```bash
# 设置 Electron 镜像（可选，提高下载速度）
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

# 安装依赖
pnpm install
```

### 开发模式运行

```bash
# 启动 H5 开发服务器
pnpm dev

# 新开一个终端，启动 Electron
pnpm dev:electron
```

### 打包应用

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

### 运行打包后的应用

**Windows:**
```bash
# 进入输出目录
cd dist/electron/unpacked

# 运行应用
./医院排班系统.exe
```

**macOS:**
```bash
# 进入输出目录
cd dist/electron/unpacked

# 运行应用
open 医院排班系统.app
```

**Linux:**
```bash
# 进入输出目录
cd dist/electron/unpacked

# 运行应用
./医院排班系统
```

## 📝 配置说明

### 窗口配置
文件：`electron/main.js`

```javascript
new BrowserWindow({
  width: 1400,        // 窗口宽度
  height: 900,        // 窗口高度
  minWidth: 1200,     // 最小宽度
  minHeight: 800,     // 最小高度
  // ... 其他配置
})
```

### 应用信息
文件：`package.json`

```json
{
  "build": {
    "appId": "com.hospital.schedule",
    "productName": "医院排班系统"
  }
}
```

## 🔧 常见问题

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
- 检查 H5 版本是否正确编译
- 检查 `dist/h5/index.html` 是否存在
- 查看 Electron 日志：`打开应用 → 右键菜单 → 查看开发者工具`

### 3. 网络请求失败

**问题**：应用无法连接到后端 API

**解决方案**：
- 确认后端服务器正在运行
- 检查 `PROJECT_DOMAIN` 环境变量是否正确
- 确认防火墙没有阻止应用访问网络

### 4. 文件导出失败

**问题**：导出 Word 文档时失败

**解决方案**：
- Electron 支持直接使用浏览器的文件导出功能
- 确保应用有写入权限
- 检查下载目录是否可访问

## 🎨 自定义图标

1. 准备一个 `512x512` 的 PNG 图标
2. 保存为 `build/icon.png`
3. 重新打包应用

## 📦 分发应用

### Windows 安装程序
```bash
pnpm build:electron
# 输出：dist/electron/医院排班系统 Setup 1.0.0.exe
```

### macOS DMG
```bash
# 需要在 macOS 上打包
pnpm build:electron
# 输出：dist/electron/医院排班系统-1.0.0.dmg
```

### Linux AppImage
```bash
pnpm build:electron
# 输出：dist/electron/医院排班系统-1.0.0.AppImage
```

## 🔒 安全注意事项

1. **不要启用 Node.js 集成**：已在 `electron/main.js` 中禁用
2. **使用 Context Isolation**：已启用，防止脚本注入
3. **限制外部链接**：已在 `main.js` 中拦截，用默认浏览器打开

## 📊 性能优化

- 使用 `pnpm build:electron:dir` 进行快速测试
- 使用 `pnpm build:electron` 进行最终发布
- 压缩后的应用大小约 100-200MB

## 🚀 自动更新（可选）

如需添加自动更新功能，可以使用 `electron-updater`：

```bash
pnpm add -D electron-updater
```

然后在 `electron/main.js` 中添加更新检查逻辑。

## 📞 技术支持

如有问题，请检查：
1. Electron 官方文档：https://www.electronjs.org/docs
2. electron-builder 文档：https://www.electron.build/

---

**提示**：首次打包可能需要下载 Electron 运行时，请耐心等待。
