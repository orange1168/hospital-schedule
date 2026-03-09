#!/bin/bash
set -e

# 获取脚本所在目录的父目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🔴 Starting Vercel build..."
echo "🔴 Script directory: $SCRIPT_DIR"
echo "🔴 Project root: $PROJECT_ROOT"
echo "🔴 Current directory: $(pwd)"
echo "🔴 Node version: $(node --version)"
echo "🔴 PNPM version: $(pnpm --version)"

# 切换到项目根目录
cd "$PROJECT_ROOT"

echo "🔴 Changed to project root: $(pwd)"
echo "🔴 Listing files in root:"
ls -la

# 确保 Taro 找到配置文件
export TARO_CONFIG_FILE="$PROJECT_ROOT/config/index.ts"

# 构建
npx taro build --type h5 --config "$PROJECT_ROOT/config/index.ts"

echo "✅ Build completed successfully"
