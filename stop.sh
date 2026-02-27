#!/bin/bash

# Misty Isle 停止所有服务脚本
# ========================================

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🛑 Stopping Misty Isle Services"
echo "================================================"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# 停止后端
if [ -f ".backend.pid" ]; then
    BACKEND_PID=$(cat .backend.pid)
    if kill -0 $BACKEND_PID 2> /dev/null; then
        kill $BACKEND_PID
        log_success "Backend stopped (PID: $BACKEND_PID)"
    else
        log_warning "Backend process not found"
    fi
    rm .backend.pid
else
    log_warning "Backend PID file not found"
fi

# 停止前端
if [ -f ".frontend.pid" ]; then
    FRONTEND_PID=$(cat .frontend.pid)
    if kill -0 $FRONTEND_PID 2> /dev/null; then
        kill $FRONTEND_PID
        log_success "Frontend stopped (PID: $FRONTEND_PID)"
    else
        log_warning "Frontend process not found"
    fi
    rm .frontend.pid
else
    log_warning "Frontend PID file not found"
fi

# 停止 Redis Docker 容器（可选）
read -p "Stop Redis Docker container? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if docker ps --filter "name=misty-isle-redis" --filter "status=running" | grep -q misty-isle-redis; then
        docker stop misty-isle-redis
        log_success "Redis container stopped"
    else
        log_warning "Redis container not running"
    fi
fi

echo ""
log_success "All services stopped"
