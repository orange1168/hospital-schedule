#!/bin/bash
set -e
echo "🔴 Starting Vercel build..."
echo "🔴 Current directory: $(pwd)"
echo "🔴 Node version: $(node --version)"
echo "🔴 PNPM version: $(pnpm --version)"

# 确保 Taro 找到配置文件
export TARO_CONFIG_FILE=$(pwd)/config/index.ts

# 构建
npx taro build --type h5 --config $(pwd)/config/index.ts

echo "✅ Build completed successfully"
