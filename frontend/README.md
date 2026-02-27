# Misty Isle Frontend

基于 React + Vite 的视频上传和播放前端应用。

## 功能特性

- ✅ 视频上传（直传 R2，预签名 URL）
- ✅ 实时进度通知（WebSocket）
- ✅ HLS 视频播放（hls.js）
- ✅ 边传边播（m3u8_prepared 状态即可播放）
- ✅ 视频列表管理
- ✅ 自动重连（WebSocket 断线重连）
- ✅ 响应式设计

## 技术栈

- **React 18** - UI 框架
- **Vite** - 构建工具
- **hls.js** - HLS 视频播放
- **WebSocket** - 实时通知

## 快速开始

### 1. 安装依赖

```bash
cd frontend
npm install
```

### 2. 配置环境变量

编辑 `.env.development`:

```bash
# 后端 API 地址
VITE_API_BASE_URL=http://localhost:8080

# WebSocket 地址
VITE_WS_BASE_URL=ws://localhost:8080

# CDN 基础 URL（你的 R2 公开域名）
VITE_CDN_BASE_URL=https://cdn.yourdomain.com
```

### 3. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000

### 4. 构建生产版本

```bash
npm run build
```

构建产物在 `dist/` 目录。

## 项目结构

```
frontend/
├── src/
│   ├── components/          # 组件
│   │   ├── VideoPlayer.jsx  # HLS 播放器
│   │   ├── VideoUploader.jsx # 上传组件
│   │   └── VideoCard.jsx    # 视频卡片
│   ├── pages/
│   │   └── VideoPage.jsx    # 视频页面
│   ├── services/
│   │   └── api.js           # API 调用
│   ├── hooks/
│   │   └── useWebSocket.js  # WebSocket Hook
│   ├── utils/
│   │   └── config.js        # 配置
│   ├── App.jsx
│   ├── App.css
│   └── main.jsx
├── index.html
├── vite.config.js
├── package.json
└── README.md
```

## 核心组件

### VideoPlayer

HLS 视频播放器，支持：
- hls.js（现代浏览器）
- 原生 HLS（Safari）
- 自动错误恢复

```jsx
<VideoPlayer
  hlsPath="videos/123/index.m3u8"  // 相对路径
  autoplay={false}
  controls={true}
/>
```

### VideoUploader

视频上传组件，流程：
1. 初始化上传 → 获取预签名 URL
2. 直传 R2（带进度条）
3. 触发后端处理

```jsx
<VideoUploader
  onUploadComplete={(video) => {
    console.log('上传完成', video);
  }}
/>
```

### useWebSocket Hook

WebSocket 连接管理：
- 自动重连（指数退避）
- 消息解析
- 错误处理

```jsx
const { isConnected, send } = useWebSocket(
  'user_1',  // 房间ID
  (data) => {
    // 处理消息
    console.log(data);
  },
  { autoReconnect: true }
);
```

## 视频状态流转

```
pending          等待上传
   ↓
user_upload      已上传，等待处理
   ↓
modal_download   下载中 (10%)
   ↓
modal_slice      转换中 (25%)
   ↓
m3u8_prepared    可以播放 (40%) ← 边传边播
   ↓
modal_upload     上传切片中 (50-90%)
   ↓
ready            完成 (100%)
```

## WebSocket 消息格式

### 视频状态通知

```json
{
  "user_id": "1",
  "type": "video_status",
  "data": {
    "video_id": 123,
    "status": "m3u8_prepared",
    "progress": 40,
    "playlist_path": "videos/123/index.m3u8",
    "message": "Playlist ready"
  }
}
```

## API 接口

### 初始化上传

```javascript
POST /video/init
{
  "title": "我的视频",
  "description": "描述",
  "file_size": 104857600,
  "file_ext": ".mp4"
}

Response:
{
  "code": 0,
  "data": {
    "video_id": 123,
    "presigned_url": "https://...",
    "r2_key": "uploads/raw/123.mp4",
    "expires_in": 900
  }
}
```

### 触发处理

```javascript
POST /video/process
{
  "video_id": 123
}
```

### 获取视频列表

```javascript
GET /video/list

Response:
{
  "code": 0,
  "data": {
    "list": [
      {
        "video_id": 123,
        "title": "我的视频",
        "status": "ready",
        "progress": 100,
        "hls_path": "videos/123/index.m3u8",
        "duration": 120,
        "expires_at": "2026-03-02T10:00:00Z",
        "created_at": "2026-02-27T10:00:00Z"
      }
    ]
  }
}
```

### 查询视频状态

```javascript
GET /video/:id/status

Response:
{
  "code": 0,
  "data": {
    "video_id": 123,
    "status": "m3u8_prepared",
    "progress": 40,
    "hls_path": "videos/123/index.m3u8"
  }
}
```

## CDN 配置

前端从后端获取**相对路径**（如 `videos/123/index.m3u8`），然后拼接 CDN 域名：

```javascript
const CDN_BASE_URL = 'https://cdn.yourdomain.com';
const playUrl = `${CDN_BASE_URL}/videos/123/index.m3u8`;
```

### Cloudflare R2 配置

1. **绑定自定义域名**
   - R2 控制台 → Bucket → Settings → Public Access
   - 添加自定义域名（如 `cdn.yourdomain.com`）

2. **配置 CORS**
   ```json
   [
     {
       "AllowedOrigins": ["https://yourdomain.com"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

## 开发调试

### 查看 WebSocket 连接

打开浏览器开发者工具 → Network → WS，可以看到：
- 连接状态
- 实时消息

### 查看视频播放日志

打开浏览器 Console，可以看到：
- HLS manifest 加载
- 切片下载
- 错误信息

### 本地测试不同 CDN

修改 `.env.development` 中的 `VITE_CDN_BASE_URL`：

```bash
# 使用本地 R2 模拟器
VITE_CDN_BASE_URL=http://localhost:9000

# 使用开发环境 CDN
VITE_CDN_BASE_URL=https://dev-cdn.yourdomain.com
```

## 常见问题

### 1. 视频无法播放

**检查**：
- CDN 域名是否配置正确
- R2 CORS 是否配置
- hls_path 是否存在
- 浏览器 Console 是否有错误

### 2. WebSocket 连接失败

**检查**：
- 后端 WebSocket 服务是否启动
- Vite proxy 配置是否正确
- 房间ID格式（推荐 `user_${userId}`）

### 3. 上传进度不显示

**检查**：
- 预签名 URL 是否过期
- R2 凭证是否正确
- 文件大小是否超过限制

### 4. 实时通知收不到

**检查**：
- WebSocket 是否连接成功
- 房间ID是否正确
- 后端 Webhook 是否调用 NotifyUser

## 生产部署

### 使用 Nginx

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    root /path/to/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /video {
        proxy_pass http://localhost:8080;
    }

    location /ws {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 使用 Cloudflare Pages

```bash
npm run build
# 上传 dist/ 目录到 Cloudflare Pages
```

配置环境变量：
- `VITE_API_BASE_URL`: https://api.yourdomain.com
- `VITE_WS_BASE_URL`: wss://api.yourdomain.com
- `VITE_CDN_BASE_URL`: https://cdn.yourdomain.com

## License

MIT
