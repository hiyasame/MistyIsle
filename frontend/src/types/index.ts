// 用户类型
export interface User {
  user_id: string;
  username: string;
  email: string;
  avatar?: string;
  bio?: string;
  created_at: string;
}

// 登录响应
export interface LoginResponse {
  token: string;
  user: User;
}

// 房间类型
export interface Room {
  room_id: string;
  name: string;
  desc?: string;
  host_id: string;
  user_count: number;
  is_live: boolean;
  current_video?: Video;
  created_at?: string;
  status?: string;
  video_url?: string;
  live_hls_url?: string;
  stream_path?: string; // 推流相对路径
  stream_key?: string;
  player_count?: number;
  players?: string[];
}

// 视频类型
export interface Video {
  video_id: string;
  title: string;
  description?: string;
  status: VideoStatus;
  progress: number;
  hls_path: string;
  duration: number;
  thumbnail?: string;
  created_at: string;
  expires_at?: string;
  error_msg?: string;
  is_live?: boolean;
}

// 视频状态
export type VideoStatus =
  | 'pending'
  | 'user_upload'
  | 'modal_download'
  | 'modal_slice'
  | 'm3u8_prepared'
  | 'modal_upload'
  | 'ready'
  | 'failed';

// 房间用户
export interface RoomUser {
  user_id: string;
  username: string;
  avatar?: string;
  bio?: string;
  is_host: boolean;
}

// 聊天消息回复引用
export interface ChatReplyTo {
  id: string;
  username: string;
  content: string;
  image_url?: string;
}

// 聊天消息
export interface ChatMessage {
  id: string;
  room_id: string;
  user_id: string;
  username: string;
  avatar?: string;
  content: string;
  image_url?: string;
  reply_to?: ChatReplyTo;
  mentions?: string[];
  created_at: string;
}

// WebSocket 消息数据类型
export interface PlaybackData {
  time?: number;
  playing?: boolean;
}

export interface PeopleChangeData {
  users: RoomUser[];
}

export interface ChangeVideoData {
  video?: Video;
  video_id?: string;
  video_name?: string;
  video_path?: string;
}

export interface HostTransferData {
  old_host_id?: string;
  new_host_id: string;
}

export interface LiveData {
  stream?: string;
  url?: string;
  path?: string;
}

// WebSocket 消息
export interface RoomMessage {
  room_id?: string;
  action: RoomAction;
  data?: PlaybackData | PeopleChangeData | ChangeVideoData | HostTransferData | LiveData | ChatMessage;
  from?: string;
  is_host?: boolean;
}

export type RoomAction =
  | 'connected'
  | 'play'
  | 'pause'
  | 'seek'
  | 'sync'
  | 'people_change'
  | 'request_sync'
  | 'change_video'
  | 'host_transfer'
  | 'live_started'
  | 'live_ended'
  | 'stop_playback'
  | 'chat';

// API 响应
export interface ApiResponse<T = Record<string, unknown>> {
  code: number;
  error?: string;
  data: T;
}
