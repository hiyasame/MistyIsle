// API 和 CDN 配置
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';
export const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:8080';
export const CDN_BASE_URL = import.meta.env.VITE_CDN_BASE_URL || 'https://cdn.yourdomain.com';

// 构建完整的 HLS URL
export function getPlayUrl(hlsPath: string): string | null {
  if (!hlsPath) return null;
  return `${CDN_BASE_URL}/${hlsPath}`;
}

// 视频状态文本映射
export const VIDEO_STATUS_TEXT = {
  'pending': '等待上传',
  'user_upload': '已上传，等待处理',
  'modal_download': '下载中',
  'modal_slice': '转换中',
  'm3u8_prepared': '可以播放',
  'modal_upload': '上传切片中',
  'ready': '完成',
  'failed': '失败'
};

// 视频状态对应的进度颜色
export const VIDEO_STATUS_COLOR = {
  'pending': '#9ca3af',
  'user_upload': '#3b82f6',
  'modal_download': '#3b82f6',
  'modal_slice': '#3b82f6',
  'm3u8_prepared': '#22c55e',
  'modal_upload': '#22c55e',
  'ready': '#10b981',
  'failed': '#ef4444'
};
