# Backend Dockerfile
FROM golang:1.25-alpine AS builder

# 安装必要的构建工具
RUN apk add --no-cache git make

WORKDIR /app

# 复制 go mod 文件
COPY go.mod go.sum ./
RUN go mod download

# 复制源代码
COPY . .

# 构建应用
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o misty-isle ./cmd/main.go

# 运行时镜像
FROM alpine:latest

RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

# 复制编译好的二进制文件
COPY --from=builder /app/misty-isle .

# 暴露端口
EXPOSE 8081

# 运行应用
CMD ["./misty-isle"]
