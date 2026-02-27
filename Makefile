.PHONY: help test test-coverage test-db test-handler test-websocket test-utils test-clean bench run build

# 默认目标
help:
	@echo "MistyIsle - 开发命令"
	@echo ""
	@echo "测试命令:"
	@echo "  make test              - 运行所有测试"
	@echo "  make test-coverage     - 运行测试并生成覆盖率报告"
	@echo "  make test-db           - 只运行数据库测试"
	@echo "  make test-handler      - 只运行 Handler 测试"
	@echo "  make test-websocket    - 只运行 WebSocket 测试"
	@echo "  make test-utils        - 只运行工具类测试"
	@echo "  make test-clean        - 清理测试数据库"
	@echo "  make bench             - 运行性能基准测试"
	@echo ""
	@echo "开发命令:"
	@echo "  make run               - 运行开发服务器"
	@echo "  make build             - 编译项目"
	@echo "  make fmt               - 格式化代码"
	@echo "  make lint              - 运行 linter"

# 运行所有测试
test:
	@echo "🧪 Running all tests..."
	go test ./... -v -timeout 30s

# 测试覆盖率
test-coverage:
	@echo "📊 Generating coverage report..."
	go test ./... -coverprofile=coverage.out -covermode=atomic
	go tool cover -html=coverage.out -o coverage.html
	@echo "✅ Coverage report generated: coverage.html"

# 数据库测试
test-db:
	@echo "🗄️ Running database tests..."
	go test ./db -v -timeout 30s

# Handler 测试
test-handler:
	@echo "🌐 Running handler tests..."
	go test ./handler -v -timeout 30s

# WebSocket 测试
test-websocket:
	@echo "🔌 Running WebSocket tests..."
	go test ./websocket -v -timeout 30s

# 工具类测试
test-utils:
	@echo "🔧 Running utils tests..."
	go test ./utils -v -timeout 30s

# 清理测试数据库
test-clean:
	@echo "🧹 Cleaning test database..."
	-psql -U postgres -c "DROP DATABASE IF EXISTS misty_isle_test;"
	psql -U postgres -c "CREATE DATABASE misty_isle_test;"
	@echo "✅ Test database recreated"

# 性能基准测试
bench:
	@echo "⚡ Running benchmarks..."
	go test ./... -bench=. -benchmem -run=^$$

# 运行开发服务器
run:
	@echo "🚀 Starting development server..."
	go run cmd/main.go

# 编译项目
build:
	@echo "🔨 Building project..."
	go build -o bin/misty-isle cmd/main.go
	@echo "✅ Build complete: bin/misty-isle"

# 格式化代码
fmt:
	@echo "🎨 Formatting code..."
	go fmt ./...
	@echo "✅ Code formatted"

# 运行 linter
lint:
	@echo "🔍 Running linter..."
	@if command -v golangci-lint > /dev/null; then \
		golangci-lint run; \
	else \
		echo "❌ golangci-lint not installed. Install it with:"; \
		echo "   brew install golangci-lint"; \
	fi

# 安装依赖
deps:
	@echo "📦 Installing dependencies..."
	go mod download
	go get github.com/stretchr/testify/assert
	go get github.com/stretchr/testify/require
	go get github.com/stretchr/testify/mock
	@echo "✅ Dependencies installed"

# 运行快速测试（跳过慢速测试）
test-quick:
	@echo "⚡ Running quick tests..."
	go test ./... -v -short -timeout 10s

# 清理编译文件
clean:
	@echo "🧹 Cleaning build files..."
	rm -rf bin/
	rm -f coverage.out coverage.html
	@echo "✅ Clean complete"
