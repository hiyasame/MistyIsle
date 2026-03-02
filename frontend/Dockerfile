# Frontend Dockerfile (Multi-stage build)
FROM node:18-alpine AS builder

WORKDIR /app

# 构建参数（环境变量）
ARG VITE_API_BASE_URL
ARG VITE_WS_BASE_URL
ARG VITE_CDN_BASE_URL
ARG VITE_SRS_PUBLIC_HTTP_URL
ARG VITE_SRS_PUBLIC_RTMP_URL

# 复制 package.json 和 lock 文件
COPY frontend/package*.json ./

# 安装依赖
RUN npm ci

# 复制源代码
COPY frontend/ ./

# 构建生产版本（Vite 会自动读取 ARG 传入的环境变量）
RUN npm run build

# Nginx 镜像用于服务静态文件
FROM nginx:alpine

# 复制构建好的静态文件
COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx 会使用网关的配置，这里不需要额外配置
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
