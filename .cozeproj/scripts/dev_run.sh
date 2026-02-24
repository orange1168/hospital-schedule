#!/bin/bash

echo "⚙️ dev_run.sh 开始运行"
set -Eeuo pipefail

cd "${COZE_WORKSPACE_PATH}"

echo "📦 Installing dependencies..."
pnpm install
echo "✅ Dependencies installed successfully!"

kill_port_if_listening() {
    local port=$1
    local pids
    pids=$(ss -H -lntp 2>/dev/null | awk -v port="${port}" '$4 ~ ":"port"$"' | grep -o 'pid=[0-9]*' | cut -d= -f2 | paste -sd' ' - || true)
    if [[ -z "${pids}" ]]; then
      echo "Port ${port} is free."
      return
    fi
    echo "Port ${port} in use by PIDs: ${pids}"
    for pid in ${pids}; do
      kill_process_tree "${pid}"
    done
    sleep 1
    pids=$(ss -H -lntp 2>/dev/null | awk -v port="${port}" '$4 ~ ":"port"$"' | grep -o 'pid=[0-9]*' | cut -d= -f2 | paste -sd' ' - || true)
    if [[ -n "${pids}" ]]; then
      echo "Warning: port ${port} still busy after cleanup, PIDs: ${pids}"
    else
      echo "Port ${port} cleared."
    fi
}

kill_process_tree() {
    local pid=$1
    local children
    children=$(pgrep -P "${pid}" 2>/dev/null || true)
    for child in ${children}; do
      kill_process_tree "${child}"
    done
    if kill -0 "${pid}" 2>/dev/null; then
      echo "Killing PID ${pid}"
      kill -9 "${pid}" 2>/dev/null || true
    fi
}

start_service() {
    cd "${COZE_WORKSPACE_PATH}"

    # ---------------------------------------------------------
    # 0. 动态注入环境变量
    # ---------------------------------------------------------
    if [ -n "$COZE_PROJECT_DOMAIN_DEFAULT" ]; then
        export PROJECT_DOMAIN="$COZE_PROJECT_DOMAIN_DEFAULT"
        echo "✅ 环境变量已动态注入: PROJECT_DOMAIN=$PROJECT_DOMAIN"
    else
        echo "⚠️  警告: COZE_PROJECT_DOMAIN_DEFAULT 未设置，使用 .env.local 中的配置"
    fi

    # ---------------------------------------------------------
    # 启动 Taro H5 和 NestJS Server
    # ---------------------------------------------------------
    echo "Starting Taro H5 Dev Server and NestJS Server..."

    # ⚠️ 重要：为了让 Taro 使用平台动态分配的端口
    export PORT=${DEPLOY_RUN_PORT}

    rm -f /tmp/coze-logs/dev.log
    mkdir -p /tmp/coze-logs

    exec pnpm dev 2>&1 | tee /tmp/coze-logs/dev.log
}

SERVER_PORT=3000

echo "Clearing port ${DEPLOY_RUN_PORT} (web) before start."
kill_port_if_listening "${DEPLOY_RUN_PORT}"
echo "Clearing port ${SERVER_PORT} (server) before start."
kill_port_if_listening "${SERVER_PORT}"
echo "Starting HTTP services on port ${DEPLOY_RUN_PORT} (web) and ${SERVER_PORT} (server)..."
start_service
