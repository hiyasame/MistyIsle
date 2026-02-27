#!/bin/bash

# Misty Isle 开发环境一键启动脚本
# ========================================

set -e  # 遇到错误立即退出

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🚀 Starting Misty Isle Development Environment"
echo "================================================"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# 检查 Docker
check_docker() {
    log_info "Checking Docker..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker not found. Please install Docker first:"
        echo "  https://www.docker.com/products/docker-desktop"
        exit 1
    fi

    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running. Please start Docker Desktop."
        exit 1
    fi

    log_success "Docker is ready"
}

# 启动 Redis (Docker)
start_redis() {
    log_info "Starting Redis (Docker)..."

    # 检查 Redis 容器是否已经在运行
    if docker ps --filter "name=misty-isle-redis" --filter "status=running" | grep -q misty-isle-redis; then
        log_success "Redis container is already running"
        return 0
    fi

    # 检查是否有停止的容器
    if docker ps -a --filter "name=misty-isle-redis" | grep -q misty-isle-redis; then
        log_info "Starting existing Redis container..."
        docker start misty-isle-redis
    else
        log_info "Creating new Redis container..."
        log_info "Using registry mirror: docker.1ms.run"

        # 使用 1ms 镜像加速
        docker run -d \
            --name misty-isle-redis \
            -p 6379:6379 \
            docker.1ms.run/redis:7-alpine \
            redis-server --appendonly yes
    fi

    # 等待 Redis 启动
    sleep 2

    # 验证 Redis 是否可访问
    if docker exec misty-isle-redis redis-cli ping | grep -q PONG; then
        log_success "Redis started successfully on port 6379"
    else
        log_error "Failed to start Redis"
        exit 1
    fi
}

# 检查 PostgreSQL (跳过 - 用户使用 Docker)
check_postgres() {
    log_info "Skipping PostgreSQL check (assuming Docker container is running)"
    log_info "Make sure your PostgreSQL Docker container is running:"
    echo "  docker ps | grep postgres"
}

# 检查前端依赖
check_frontend_deps() {
    log_info "Checking frontend dependencies..."

    if [ ! -d "frontend/node_modules" ]; then
        log_warning "Frontend dependencies not installed. Installing..."
        cd frontend
        npm install
        cd ..
        log_success "Frontend dependencies installed"
    else
        log_success "Frontend dependencies already installed"
    fi
}

# 启动后端
start_backend() {
    log_info "Starting Backend (Go)..."

    # 检查 .env 文件
    if [ ! -f ".env" ]; then
        log_error ".env file not found"
        exit 1
    fi

    # 创建日志目录
    mkdir -p logs

    # 启动后端（后台运行）
    go run cmd/main.go > logs/backend.log 2>&1 &
    BACKEND_PID=$!
    echo $BACKEND_PID > .backend.pid

    # 等待后端启动
    sleep 3

    if kill -0 $BACKEND_PID 2> /dev/null; then
        log_success "Backend started (PID: $BACKEND_PID) - http://localhost:8080"
    else
        log_error "Failed to start backend. Check logs/backend.log"
        cat logs/backend.log
        exit 1
    fi
}

# 启动前端
start_frontend() {
    log_info "Starting Frontend (Vite)..."

    cd frontend
    npm run dev > ../logs/frontend.log 2>&1 &
    FRONTEND_PID=$!
    cd ..
    echo $FRONTEND_PID > .frontend.pid

    sleep 2

    if kill -0 $FRONTEND_PID 2> /dev/null; then
        log_success "Frontend started (PID: $FRONTEND_PID) - http://localhost:3000"
    else
        log_error "Failed to start frontend. Check logs/frontend.log"
        cat logs/frontend.log
        exit 1
    fi
}

# 显示状态
show_status() {
    echo ""
    echo "================================================"
    log_success "All services started successfully!"
    echo "================================================"
    echo ""
    echo "📊 Service Status:"
    echo "  • Redis:    redis://localhost:6379 (Docker)"
    echo "  • Backend:  http://localhost:8080"
    echo "  • Frontend: http://localhost:3000"
    echo ""
    echo "📝 Logs:"
    echo "  • Backend:  tail -f logs/backend.log"
    echo "  • Frontend: tail -f logs/frontend.log"
    echo "  • Redis:    docker logs -f misty-isle-redis"
    echo ""
    echo "🛑 Stop services:"
    echo "  ./stop.sh"
    echo ""
    echo "🔍 Check services:"
    echo "  • Backend:  curl http://localhost:8080/health"
    echo "  • Redis:    docker exec misty-isle-redis redis-cli ping"
    echo ""
}

# 创建日志目录
mkdir -p logs

# 主流程
main() {
    check_docker
    start_redis
    check_postgres
    check_frontend_deps
    start_backend
    start_frontend
    show_status
}

# 捕获 Ctrl+C
trap 'echo ""; log_warning "Interrupted. Services are still running. Use ./stop.sh to stop them."; exit 0' INT

main
