# Railway 全栈部署指南

## 部署架构
- **前端**：Taro H5 应用，构建后由 NestJS 静态文件服务
- **后端**：NestJS API 服务
- **部署方式**：Railway 统一部署前后端，NestJS 提供静态文件服务 + API

## 构建流程

### 1. Railway 检测
- Railway 检测到 `pnpm` 包管理器
- 执行构建命令：`cd server && pnpm run build`

### 2. 构建脚本执行
`server/package.json` 中的 `build` 脚本：
```bash
cd .. && pnpm install && pnpm build:vercel && cd server && npx nest build && cp -r ../dist-web dist/
```

详细步骤：
1. **回到根目录**：`cd ..`
2. **安装依赖**：`pnpm install`
3. **构建前端**：`pnpm build:vercel`
   - 执行 `taro build --type h5`
   - 生成 `dist-web/` 目录（H5 构建产物）
   - 更新 `VERSION` 文件
4. **回到 server 目录**：`cd server`
5. **构建后端**：`npx nest build`
   - 生成 `server/dist/` 目录（NestJS 构建产物）
6. **复制前端文件**：`cp -r ../dist-web dist/`
   - 源：`../dist-web` = `/workspace/projects/dist-web`
   - 目标：`dist/` = `/workspace/projects/server/dist/`
   - 结果：`/workspace/projects/server/dist/dist-web/`

### 3. Railway 启动
执行启动命令：`cd server && node dist/main`

## 静态文件服务

### NestJS 配置（server/src/main.ts）
```typescript
const frontendDistPath = path.join(__dirname, 'dist-web');
console.log('📁 Frontend path:', frontendDistPath);
console.log('📁 Exists:', require('fs').existsSync(frontendDistPath));

// 静态文件服务
app.use(express.static(frontendDistPath));

// SPA 路由支持
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});
```

### 路径解析
- **`__dirname`**：`/workspace/projects/server/dist/`
- **`frontendDistPath`**：`path.join(__dirname, 'dist-web')` = `/workspace/projects/server/dist/dist-web/`
- **静态文件**：从 `server/dist/dist-web/` 提供
- **index.html**：`server/dist/dist-web/index.html`

## 监控与重部署

### VERSION 文件监控
`railway.json` 配置：
```json
{
  "build": {
    "builder": "NIXPACKS",
    "watchPatterns": ["VERSION"]
  }
}
```

**工作原理**：
- Railway 监控根目录的 `VERSION` 文件
- 当 `VERSION` 文件内容变化时，自动触发重新部署
- 每次代码修改后更新 `VERSION` 文件即可强制重新部署

**更新版本**：
```bash
echo "2.4.1 - 修复某个问题" > VERSION
```

## 验证清单

部署前检查：
- [ ] `server/package.json` 的 `build` 脚本正确
- [ ] `server/src/main.ts` 恢复静态文件服务
- [ ] `railway.json` 配置 `watchPatterns`
- [ ] `VERSION` 文件已更新
- [ ] 前端构建到 `dist-web/` 目录
- [ ] 后端构建到 `server/dist/` 目录
- [ ] 前端文件复制到 `server/dist/dist-web/`

部署后验证：
- [ ] 访问 Railway URL 能看到前端页面
- [ ] 前端页面滚动功能正常
- [ ] API 请求正常（`/api/health` 等）
- [ ] 医生排班表功能正常
- [ ] 科室选择弹窗滚动正常

## 常见问题

### 问题 1：前端文件 404
**症状**：访问页面返回 "Cannot GET /"

**原因**：`dist-web` 目录不存在或路径错误

**检查**：
```typescript
console.log('📁 Frontend path:', frontendDistPath);
console.log('📁 Exists:', require('fs').existsSync(frontendDistPath));
```

**解决**：
1. 确认 `pnpm build:vercel` 正常执行
2. 确认 `cp -r ../dist-web dist/` 正确复制
3. 检查 Railway 日志中的路径输出

### 问题 2：API 请求失败
**症状**：前端无法调用后端 API

**原因**：CORS 或路径错误

**检查**：
- 确认 `app.enableCors()` 已配置
- 确认前端使用相对路径 `/api/xxx`
- 检查 Network 面板中的请求 URL

### 问题 3：构建失败
**症状**：Railway 构建日志显示错误

**常见原因**：
1. 依赖安装失败 → 检查 `pnpm install` 输出
2. 构建脚本错误 → 检查 `pnpm run build` 输出
3. 端口配置错误 → 检查 `process.env.PORT`

**解决**：
- 查看 Railway 构建日志
- 本地测试构建脚本：`cd server && pnpm run build`
- 确保所有依赖在 `package.json` 中

### 问题 4：版本不更新
**症状**：修改代码后部署还是旧版本

**原因**：Railway 没有检测到变化

**解决**：
```bash
# 强制触发重新部署
echo "2.4.1 - 强制重新部署" > VERSION
git commit -am "update version"
git push
```

## 下一步

1. **提交代码**：
   ```bash
   git add .
   git commit -m "feat: 配置 Railway 全栈部署，移除 nixpacks.toml"
   git push
   ```

2. **监控部署**：
   - 访问 Railway Dashboard
   - 查看构建日志
   - 等待部署完成

3. **验证功能**：
   - 访问 Railway URL
   - 测试医生排班表
   - 测试科室选择弹窗滚动

4. **优化建议**：
   - 添加健康检查端点 `/api/health`
   - 配置自动重启策略
   - 监控错误日志
