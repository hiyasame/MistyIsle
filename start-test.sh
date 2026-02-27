#!/bin/bash

# Misty Isle 测试环境一键启动脚本
# ========================================
# 1. 启动 Docker 容器 (PostgreSQL / Redis / SRS)
# 2. 等待所有服务就绪
# 3. 启动 Go 后端
# ========================================

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error()   { echo -e "${RED}❌ $1${NC}"; }

# ==============================
# Step 0: 前置检查
# ==============================
log_info "Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    log_error "Docker not found. Please install Docker Desktop first."
    exit 1
fi

if ! docker info &> /dev/null; then
    log_error "Docker daemon is not running. Please start Docker Desktop."
    exit 1
fi

if ! command -v go &> /dev/null; then
    log_error "Go not found. Please install Go first."
    exit 1
fi

log_success "Prerequisites OK (Docker + Go)"

# ==============================
# Step 1: 启动 Docker 容器
# ==============================
echo ""
echo "================================================"
echo "🐳 Starting Docker services..."
echo "================================================"

# 注意：SRS 的 8080 端口和后端的 8080 端口冲突
# 这里后端会使用 .env 里配置的 SERVER_PORT
# 如果 SRS 占用了 8080，你可能需要修改其中一个的端口
# 下面会检查这个问题

docker compose -f docker-compose.test.yml up -d

# ==============================
# Step 2: 等待服务就绪
# ==============================
echo ""
log_info "Waiting for services to be healthy..."

# 等待 PostgreSQL
echo -n "  PostgreSQL: "
for i in $(seq 1 30); do
    if docker exec misty-isle-postgres pg_isready -U postgres &> /dev/null; then
        echo -e "${GREEN}ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}timeout${NC}"
        log_error "PostgreSQL failed to start. Check: docker logs misty-isle-postgres"
        exit 1
    fi
    echo -n "."
    sleep 1
done

# 等待 Redis
echo -n "  Redis:      "
for i in $(seq 1 15); do
    if docker exec misty-isle-redis redis-cli ping 2>/dev/null | grep -q PONG; then
        echo -e "${GREEN}ready${NC}"
        break
    fi
    if [ $i -eq 15 ]; then
        echo -e "${RED}timeout${NC}"
        log_error "Redis failed to start. Check: docker logs misty-isle-redis"
        exit 1
    fi
    echo -n "."
    sleep 1
done

# 等待 SRS
echo -n "  SRS:        "
for i in $(seq 1 15); do
    if curl -sf http://localhost:8080/api/v1/versions &> /dev/null; then
        echo -e "${GREEN}ready${NC}"
        break
    fi
    if [ $i -eq 15 ]; then
        echo -e "${YELLOW}timeout (non-critical)${NC}"
        log_warning "SRS may not be ready yet, but continuing..."
        break
    fi
    echo -n "."
    sleep 1
done

echo ""
log_success "Docker services are up!"

# ==============================
# Step 3: 启动 Go 后端
# ==============================
echo ""
echo "================================================"
echo "🚀 Starting Go Backend..."
echo "================================================"

# 检查 .env
if [ ! -f ".env" ]; then
    log_error ".env file not found. Copy from .env.example:"
    echo "  cp .env.example .env"
    exit 1
fi

# 创建日志目录
mkdir -p logs

# 检查后端端口是否和 SRS 冲突
BACKEND_PORT=$(grep "^SERVER_PORT=" .env | cut -d= -f2)
BACKEND_PORT=${BACKEND_PORT:-8080}

if [ "$BACKEND_PORT" = "8080" ]; then
    log_warning "Backend port (${BACKEND_PORT}) conflicts with SRS!"
    log_warning "SRS is already using port 8080."
    log_info "Options:"
    echo "  1. Change SERVER_PORT in .env to another port (e.g., 8081)"
    echo "  2. Change SRS port in docker-compose.test.yml"
    echo ""
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# 启动后端（前台运行，方便看日志）
log_info "Running: go run cmd/main.go"
echo ""

exec go run cmd/main.go
