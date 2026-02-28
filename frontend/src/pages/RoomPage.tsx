import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { roomApi, videoApi } from '../services/api';
import { useRoomWebSocket } from '../hooks/useRoomWebSocket';
import { getPlayUrl, getLiveUrl } from '../utils/config';
import SyncPlayer from '../components/SyncPlayer';
import FlvPlayer from '../components/FlvPlayer';
import { useAuth } from '../contexts/AuthContext';
import {Room, Video, RoomUser, RoomMessage} from '../types';

/**
 * 房间页面 - 同步观影/直播核心页面
 */
export default function RoomPage() {
  const { id: roomId } = useParams();
  const navigate = useNavigate();
  const playerRef = useRef(null);

  const { user } = useAuth();
  const [room, setRoom] = useState<Room | null>(null);
  const [currentVideo, setCurrentVideo] = useState<Video | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showVideoLibrary, setShowVideoLibrary] = useState(false);

  const userId = user?.user_id || '';

  // 加载房间信息
  const loadRoom = useCallback(async () => {
    try {
      setLoading(true);
      const res = await roomApi.get(roomId || '');
      if (res.code === 0) {
        setRoom(res.data);
        setCurrentVideo(res.data.current_video || null);
        setIsHost(res.data.host_id === userId);
        // 用户列表由 WebSocket 连接后更新，初始为空
        setUsers([]);
      } else {
        throw new Error(res.error || 'Failed to load room');
      }
    } catch (err) {
      console.error('Failed to load room:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [roomId, userId]);

  // 加载视频库
  const loadVideos = useCallback(async () => {
    try {
      const res = await videoApi.list();
      if (res.code === 0) {
        // 只显示已就绪的视频
        const readyVideos = (res.data.list || []).filter(v =>
          ['ready', 'm3u8_prepared'].includes(v.status) && v.hls_path
        );
        setVideos(readyVideos);
      }
    } catch (err) {
      console.error('Failed to load videos:', err);
    }
  }, []);

  useEffect(() => {
    loadRoom();
    loadVideos();
  }, [loadRoom, loadVideos]);

  // 处理 WebSocket 消息
  const handleWebSocketMessage = useCallback((data: RoomMessage) => {
    console.log('Room WebSocket message:', data);

    switch (data.action) {
      case 'connected':
        // WebSocket 连接成功，添加自己到用户列表
        if (user) {
          setUsers([{
            user_id: user.user_id,
            username: user.username,
            avatar: user.avatar,
            is_host: isHost
          }]);
        }
        break;

      case 'join':
        // 用户加入（包括自己）
        if (data.data && 'user_id' in data.data) {
          const joinData = data.data as { user_id: string; username?: string; is_host?: boolean };
          // 如果是自己加入且后端认定为房主，则更新本地 isHost 状态
          if (joinData.user_id === userId && joinData.is_host) {
            setIsHost(true);
          }

          setUsers(prev => {
            // 避免重复添加
            if (prev.find(u => u.user_id === joinData.user_id)) {
              // 已经是用户列表里的人了，我们也可以考虑更新TA的信息
              return prev.map(u =>
                u.user_id === joinData.user_id ? { ...u, is_host: joinData.is_host || false } : u
              );
            }
            return [...prev, {
              user_id: joinData.user_id,
              username: joinData.user_id === userId ? (user?.username || joinData.user_id) : (joinData.username || `用户${joinData.user_id}`),
              is_host: joinData.is_host || false
            }];
          });
        }
        break;

      case 'leave':
        // 用户离开
        if (data.data && 'user_id' in data.data) {
          const leaveData = data.data as { user_id: string };
          setUsers(prev => prev.filter(u => u.user_id !== leaveData.user_id));
        }
        break;

      case 'play':
      case 'pause':
      case 'seek':
        // 同步播放控制
        if (playerRef.current && 'handleRemoteAction' in playerRef.current) {
          const playbackData = (data.data && 'time' in data.data) ? data.data : { time: 0 };
          (playerRef.current as any).handleRemoteAction(data.action, playbackData);
        }
        break;

      case 'change_video':
        // 切换视频
        if (data.data && 'video' in data.data && data.data.video) {
          setCurrentVideo(data.data.video);
        }
        break;

      case 'host_transfer':
        // 房主变更
        if (data.data && 'new_host_id' in data.data) {
          const transferData = data.data;
          setIsHost(transferData.new_host_id === userId);
          setUsers(prev => prev.map(u => ({
            ...u,
            is_host: u.user_id === transferData.new_host_id
          })));
        }
        break;

      case 'live_started':
        // 直播开始
        if (data.data && 'path' in data.data && data.data.path) {
          setCurrentVideo({
            video_id: 'live',
            title: '直播中',
            hls_path: data.data.path as string,
            status: 'ready',
            progress: 100,
            duration: 0,
            created_at: new Date().toISOString(),
            is_live: true
          });
        }
        break;

      case 'live_ended':
        // 直播结束
        setCurrentVideo(null);
        break;

      default:
        console.warn('Unknown action:', data.action);
    }
  }, [userId, users]);

  // 连接 WebSocket
  const { isConnected, sendMessage } = useRoomWebSocket(
    roomId || '',
    handleWebSocketMessage,
    { autoReconnect: true }
  );

  // 房主操作：播放控制
  const handleHostAction = useCallback((action: string, data: { time?: number }) => {
    if (!isHost) return;
    sendMessage(action, data);
  }, [isHost, sendMessage]);

  // 房主操作：切换视频
  const handleChangeVideo = useCallback(async (video: Video) => {
    if (!isHost) return;

    try {
      await roomApi.playVideo(roomId || '', video.video_id);
      setCurrentVideo(video);
      setShowVideoLibrary(false);
    } catch (err) {
      console.error('Failed to play video:', err);
      alert(`切换视频失败: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [isHost, roomId]);

  // 房主操作：移交权限
  const handleTransferHost = useCallback(async (targetUserId: string) => {
    if (!isHost || targetUserId === userId) return;

    if (!confirm(`确定要将房主权限移交给该用户吗？`)) return;

    try {
      await roomApi.transferHost(roomId || '', targetUserId);
      setIsHost(false);
    } catch (err) {
      console.error('Failed to transfer host:', err);
      alert(`移交权限失败: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [isHost, userId, roomId]);

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#0f172a',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#0f172a',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '1rem'
      }}>
        <p style={{ fontSize: '1.25rem', color: '#ef4444' }}>加载失败: {error}</p>
        <button
          onClick={() => navigate('/')}
          style={{
            padding: '0.75rem 1.5rem',
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer'
          }}
        >
          返回首页
        </button>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(to bottom right, #0f172a, #1e293b)',
      color: 'white',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* 顶部导航栏 */}
      <header style={{
        backgroundColor: '#1e293b',
        padding: '1rem 2rem',
        borderBottom: '1px solid #334155',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            onClick={() => navigate('/')}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#475569',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.875rem'
            }}
          >
            ← 返回
          </button>
          <div>
            <h1 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>{room?.name}</h1>
            <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
              <span style={{ marginRight: '1rem' }}>
                WebSocket: {isConnected ? '✓ 已连接' : '✗ 未连接'}
              </span>
              {isHost && <span style={{ color: '#fbbf24' }}>👑 房主</span>}
            </div>
          </div>
        </div>

        {isHost && (
          <button
            onClick={() => setShowVideoLibrary(!showVideoLibrary)}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '1rem'
            }}
          >
            {showVideoLibrary ? '关闭视频库' : '选择视频'}
          </button>
        )}
      </header>

      {/* 主内容区 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 播放器区域 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '2rem' }}>
          {currentVideo ? (
            <>
              <div style={{ marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
                  {currentVideo.title}
                  {currentVideo.is_live && <span style={{ marginLeft: '0.5rem', color: '#ef4444' }}>🔴 直播中</span>}
                </h2>
              </div>
              <div style={{ flex: 1, backgroundColor: '#000', borderRadius: '12px', overflow: 'hidden' }}>
                {currentVideo.is_live ? (
                  // 直播流使用 FLV 播放器
                  <FlvPlayer
                    flvPath={getLiveUrl(currentVideo.hls_path) || ''}
                    autoplay={true}
                    controls={true}
                  />
                ) : (
                  // VOD 视频使用 HLS 同步播放器
                  <SyncPlayer
                    ref={playerRef}
                    hlsPath={getPlayUrl(currentVideo.hls_path) || ''}
                    isHost={isHost}
                    onHostAction={handleHostAction}
                    autoplay={true}
                    controls={true}
                  />
                )}
              </div>
            </>
          ) : (
            <div style={{
              flex: 1,
              backgroundColor: '#1e293b',
              borderRadius: '12px',
              padding: '3rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '2rem'
            }}>
              <div style={{ textAlign: 'center' }}>
                <h2 style={{ fontSize: '2rem', marginBottom: '1rem', color: '#f1f5f9' }}>
                  {room?.name}
                </h2>
                {room?.desc && (
                  <p style={{ fontSize: '1rem', color: '#94a3b8', marginBottom: '2rem' }}>
                    {room.desc}
                  </p>
                )}
                <p style={{ fontSize: '1.125rem', color: '#cbd5e1', marginBottom: '1.5rem' }}>
                  {isHost ? '房间已准备就绪' : '等待房主操作...'}
                </p>
                {isHost && (
                  <button
                    onClick={() => setShowVideoLibrary(true)}
                    style={{
                      padding: '0.875rem 2rem',
                      backgroundColor: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '1.125rem',
                      fontWeight: '600',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2563eb'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#3b82f6'}
                  >
                    📹 选择视频开始观影
                  </button>
                )}
              </div>

              {/* 推流信息 */}
              {isHost && room?.stream_url && (
                <div style={{
                  backgroundColor: '#334155',
                  padding: '1.5rem',
                  borderRadius: '8px',
                  border: '1px solid #475569'
                }}>
                  <h3 style={{ fontSize: '1.125rem', marginBottom: '1rem', color: '#fbbf24' }}>
                    🔴 直播推流信息
                  </h3>

                  {/* 推流地址 */}
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: '#94a3b8' }}>
                      推流地址（Server URL）
                    </label>
                    <div style={{
                      display: 'flex',
                      gap: '0.5rem',
                      alignItems: 'center'
                    }}>
                      <input
                        type="text"
                        value={room.stream_url}
                        readOnly
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          backgroundColor: '#1e293b',
                          border: '1px solid #475569',
                          borderRadius: '4px',
                          color: '#e2e8f0',
                          fontSize: '0.875rem',
                          fontFamily: 'monospace'
                        }}
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(room.stream_url || '');
                          alert('已复制到剪贴板');
                        }}
                        style={{
                          padding: '0.5rem 1rem',
                          backgroundColor: '#475569',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '0.875rem'
                        }}
                      >
                        复制
                      </button>
                    </div>
                  </div>

                  {/* 推流密钥 */}
                  {room?.stream_key && (
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: '#94a3b8' }}>
                        推流密钥（Stream Key）
                      </label>
                      <div style={{
                        display: 'flex',
                        gap: '0.5rem',
                        alignItems: 'center'
                      }}>
                        <input
                          type="text"
                          value={room.stream_key}
                          readOnly
                          style={{
                            flex: 1,
                            padding: '0.5rem',
                            backgroundColor: '#1e293b',
                            border: '1px solid #475569',
                            borderRadius: '4px',
                            color: '#e2e8f0',
                            fontSize: '0.875rem',
                            fontFamily: 'monospace'
                          }}
                        />
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(room.stream_key || '');
                            alert('已复制到剪贴板');
                          }}
                          style={{
                            padding: '0.5rem 1rem',
                            backgroundColor: '#475569',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.875rem'
                          }}
                        >
                          复制
                        </button>
                      </div>
                    </div>
                  )}

                  <div style={{ fontSize: '0.875rem', color: '#94a3b8', lineHeight: '1.5' }}>
                    <p>• 使用 OBS 等推流软件，分别填入推流地址和密钥</p>
                    <p>• 开始推流后，房间内所有人将自动收到直播</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 右侧用户列表 */}
        <aside style={{
          width: '280px',
          backgroundColor: '#1e293b',
          borderLeft: '1px solid #334155',
          padding: '1.5rem',
          overflowY: 'auto'
        }}>
          <h3 style={{ fontSize: '1.125rem', marginBottom: '1rem' }}>
            在线用户 ({users.length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {users.map((user) => (
              <div
                key={user.user_id}
                style={{
                  padding: '0.75rem',
                  backgroundColor: '#334155',
                  borderRadius: '8px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: '500' }}>
                    {user.username || `用户${user.user_id}`}
                  </div>
                  {user.is_host && (
                    <div style={{ fontSize: '0.75rem', color: '#fbbf24', marginTop: '0.25rem' }}>
                      👑 房主
                    </div>
                  )}
                </div>
                {isHost && !user.is_host && (
                  <button
                    onClick={() => handleTransferHost(user.user_id)}
                    style={{
                      padding: '0.25rem 0.5rem',
                      backgroundColor: '#475569',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      cursor: 'pointer'
                    }}
                  >
                    移交
                  </button>
                )}
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* 视频库侧边栏 */}
      {showVideoLibrary && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          justifyContent: 'flex-end',
          zIndex: 1000
        }}>
          <div style={{
            width: '400px',
            backgroundColor: '#1e293b',
            padding: '2rem',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.5rem' }}>视频库</h3>
              <button
                onClick={() => setShowVideoLibrary(false)}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: '#475569',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                关闭
              </button>
            </div>

            {videos.length === 0 ? (
              <p style={{ color: '#94a3b8', textAlign: 'center', padding: '2rem' }}>
                暂无可用视频
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {videos.map((video) => (
                  <div
                    key={video.video_id}
                    onClick={() => handleChangeVideo(video)}
                    style={{
                      padding: '1rem',
                      backgroundColor: '#334155',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#475569'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#334155'}
                  >
                    <div style={{ fontSize: '1rem', fontWeight: '500', marginBottom: '0.5rem' }}>
                      {video.title}
                    </div>
                    {video.duration > 0 && (
                      <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
                        时长: {Math.floor(video.duration / 60)}:{String(video.duration % 60).padStart(2, '0')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
