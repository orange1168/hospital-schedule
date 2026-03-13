# 🎉 Linux 版桌面应用打包完成！

## ✅ 打包成功

**压缩包**：`dist/electron/hospital-schedule-linux.tar.gz` (107 MB)

**应用目录**：`dist/electron/linux-unpacked/`

**主程序**：`hospital-schedule` (177 MB)

**平台**：Linux (x64)

---

## 📦 下载与解压

### 下载压缩包

```bash
# 从项目目录复制
cp dist/electron/hospital-schedule-linux.tar.gz ~/Desktop/

# 或使用 git lfs（如果已配置）
```

### 解压

```bash
cd ~/Desktop
tar -xzf hospital-schedule-linux.tar.gz
cd linux-unpacked
```

---

## 🚀 运行应用

### 方法 1：直接运行

```bash
cd ~/Desktop/linux-unpacked
./hospital-schedule
```

### 方法 2：赋予执行权限后运行

```bash
cd ~/Desktop/linux-unpacked
chmod +x hospital-schedule
./hospital-schedule
```

---

## 📋 系统依赖

### Ubuntu/Debian

```bash
sudo apt-get install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0 libuuid1 libappindicator3-1 libsecret-1-0
```

### Fedora

```bash
sudo dnf install gtk3 libnotify nss libXScrnSaver libXtst xdg-utils at-spi2-core libappindicator-gtk3 libsecret
```

### Arch Linux

```bash
sudo pacman -S gtk3 libnotify nss libxss libxtst xdg-utils at-spi2-core libindicator libsecret
```

---

## 🎯 应用特性

✅ **完整功能**：
- 医生排班表管理
- 科室排班表管理
- 自动填充排班
- 导出 Word 文档

✅ **独立运行**：
- 无需安装 Node.js
- 无需安装浏览器
- 包含 Electron 运行时

✅ **窗口配置**：
- 尺寸：1400x900
- 最小：1200x800

---

## ⚙️ 配置说明

### 后端 API 地址

应用会自动使用 `.env.production` 中配置的 `PROJECT_DOMAIN`：

```
https://server-production-41cd.up.railway.app
```

### 如需修改后端地址

编辑 `.env.production`：

```bash
PROJECT_DOMAIN=https://your-backend-domain.com
```

然后重新打包：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
pnpm build:web && node node_modules/.pnpm/electron-builder@*/node_modules/electron-builder/out/cli/cli.js --dir
```

---

## 🐛 故障排除

### 应用无法启动

**错误**：`error while loading shared libraries`

**解决**：安装系统依赖（见上方"系统依赖"部分）

**错误**：`Permission denied`

**解决**：
```bash
chmod +x hospital-schedule
./hospital-schedule
```

### 网络连接失败

**检查后端是否运行**：
```bash
curl https://server-production-41cd.up.railway.app/api/schedule/status
```

**检查防火墙设置**：
```bash
sudo ufw status
```

### 文件导出失败

**检查下载目录权限**：
```bash
ls -la ~/Downloads/
```

**检查磁盘空间**：
```bash
df -h
```

---

## 🔄 重新打包

如需重新打包应用：

```bash
# 设置 Electron 镜像（加速下载）
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

# 编译 H5 版本
pnpm build:web

# 打包 Electron（Linux 版）
node node_modules/.pnpm/electron-builder@*/node_modules/electron-builder/out/cli/cli.js --dir

# 创建压缩包
cd dist/electron
tar -czf hospital-schedule-linux.tar.gz linux-unpacked/
```

---

## 📊 文件大小

| 文件 | 大小 |
|------|------|
| hospital-schedule | 177 MB |
| hospital-schedule-linux.tar.gz | 107 MB |
| 完整目录 | 217 MB |

---

## 💡 使用建议

1. **首次运行**：确保后端服务器正在运行
2. **网络连接**：应用需要访问后端 API
3. **文件导出**：确保有足够的磁盘空间
4. **定期更新**：关注项目更新，及时升级

---

## 📚 技术信息

- **Electron 版本**：28.3.3
- **Node.js 版本**：包含在 Electron 中
- **平台**：Linux x64
- **打包工具**：electron-builder 24.13.3

---

## 📞 获取帮助

- **详细文档**：`ELECTRON_GUIDE.md`
- **项目仓库**：https://github.com/orange1168/hospital-schedule
- **Electron 官方文档**：https://www.electronjs.org/docs

---

**打包完成时间**：2024-03-13  
**提交版本**：781f55d

---

**🎉 恭喜！Linux 版桌面应用已准备就绪！**
