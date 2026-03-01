import { API_BASE_URL } from '../utils/config';
import type { ApiResponse, LoginResponse, User, Room, Video } from '../types';

// 获取 token
function getAuthToken(): string {
  return localStorage.getItem('auth_token') || '';
}

// 保存 token
export function setAuthToken(token: string): void {
  localStorage.setItem('auth_token', token);
}

// 清除 token
export function clearAuthToken(): void {
  localStorage.removeItem('auth_token');
}

// 通用请求函数
async function request<T = any>(url: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const token = getAuthToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>)
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

// 用户相关 API
export const userApi = {
  // 发送验证码
  async sendVerifyCode(email: string): Promise<ApiResponse<{ message: string }>> {
    return request<{ message: string }>('/user/verify-code', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
  },

  // 注册
  async register(data: { username: string; email: string; password: string; code: string }): Promise<ApiResponse<LoginResponse>> {
    return request<LoginResponse>('/user/register', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // 登录
  async login(data: { email: string; password: string }): Promise<ApiResponse<LoginResponse>> {
    return request<LoginResponse>('/user/login', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // 获取个人信息
  async profile(): Promise<ApiResponse<User>> {
    return request<User>('/user/profile');
  },

  // 更新个人信息
  async updateProfile(data: { username?: string; avatar?: string }): Promise<ApiResponse<User>> {
    return request<User>('/user/profile', {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  // 上传头像
  async uploadAvatar(file: File): Promise<ApiResponse<{ avatar_url: string }>> {
    const formData = new FormData();
    formData.append('avatar', file);

    const token = getAuthToken();
    const response = await fetch(`${API_BASE_URL}/user/avatar`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }
};

// 视频相关 API
export const videoApi = {
  // 初始化上传
  async init(data: { title: string; file_size: number; file_ext: string; description?: string }): Promise<ApiResponse<any>> {
    return request('/video/init', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // 上传到 R2（使用预签名 URL）
  async uploadToR2(presignedUrl: string, file: File, onProgress?: (progress: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const progress = Math.round((e.loaded / e.total) * 100);
          onProgress(progress);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Upload failed'));
      });

      xhr.open('PUT', presignedUrl);
      xhr.setRequestHeader('Content-Type', file.type);
      xhr.send(file);
    });
  },

  // 触发处理
  async process(videoId: string): Promise<ApiResponse<any>> {
    return request('/video/process', {
      method: 'POST',
      body: JSON.stringify({ video_id: videoId })
    });
  },

  // 获取视频列表
  async list(): Promise<ApiResponse<{ list: Video[] }>> {
    return request<{ list: Video[] }>('/video/list');
  },

  // 获取视频状态
  async status(videoId: string): Promise<ApiResponse<Video>> {
    return request<Video>(`/video/${videoId}/status`);
  },

  // 获取视频详情
  async detail(videoId: string): Promise<ApiResponse<Video>> {
    return request<Video>(`/video/${videoId}`);
  }
};

// 房间相关 API
export const roomApi = {
  // 创建房间
  async create(data: { name: string; description?: string }): Promise<ApiResponse<{ room_id: string }>> {
    return request<{ room_id: string }>('/room/create', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  // 获取房间列表
  async list(): Promise<ApiResponse<{ list: Room[] }>> {
    return request<{ list: Room[] }>('/room/list');
  },

  // 获取房间详情
  async get(roomId: string): Promise<ApiResponse<Room>> {
    return request<Room>(`/room/${roomId}`);
  },

  // 播放视频（房主）
  async playVideo(roomId: string, videoId: string | number): Promise<ApiResponse<any>> {
    return request(`/room/${roomId}/play`, {
      method: 'POST',
      body: JSON.stringify({ video_id: String(videoId) })
    });
  },

  // 移交房主权限
  async transferHost(roomId: string, userId: string): Promise<ApiResponse<any>> {
    return request(`/room/${roomId}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ to_user_id: userId })
    });
  }
};
