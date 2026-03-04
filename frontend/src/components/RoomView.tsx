import {useCallback, useEffect, useRef, useState} from 'react';
import {useParams} from 'react-router-dom';
import {roomApi, videoApi} from '../services/api';
import {useRoomWebSocket} from '../hooks/useRoomWebSocket';
import {getLiveUrl, getPlayUrl, getStreamUrl} from '../utils/config';
import SyncPlayer from '../components/SyncPlayer';
import FlvPlayer from '../components/FlvPlayer';
import {useAuth} from '../contexts/AuthContext';
import {Room, RoomMessage, RoomUser, Video} from '../types';

/**
 * 房间视图组件 - Discord 风格
 * 显示在主内容区，包含视频播放器和聊天区域（预留）
 */
export default function RoomView() {
  const { id: roomId } = useParams();
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
  const [hoveredUser, setHoveredUser] = useState<RoomUser | null>(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });

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

  const sendMessageRef = useRef<(action: string, data?: any) => boolean>(() => false);

  // 处理 WebSocket 消息
  const handleWebSocketMessage = useCallback((data: RoomMessage) => {
    console.log(`[RoomView] Received action: ${data.action}`, data.data);

    switch (data.action) {
      case 'connected':
        console.log('Successfully connected to WebSocket hub');
        break;

      case 'people_change':
        if (data.data && 'users' in data.data) {
          const { users: newUsers } = data.data as { users: RoomUser[] };
          setUsers(newUsers);

          const me = newUsers.find(u => String(u.user_id) === String(userId));
          if (me && me.is_host !== isHost) {
            console.log('[RoomView] Host status synced from list:', me.is_host);
            setIsHost(me.is_host);
          }
        }
        break;

      case 'request_sync':
        if (isHost && playerRef.current) {
          const videoElement = document.querySelector('video');
          if (videoElement) {
            sendMessageRef.current('sync', { time: videoElement.currentTime });
          }
        }
        break;

      case 'play':
      case 'pause':
      case 'seek':
      case 'sync':
        if (playerRef.current && 'handleRemoteAction' in playerRef.current) {
          const playbackData = (data.data && 'time' in data.data) ? data.data as { time: number } : { time: 0 };
          (playerRef.current as any).handleRemoteAction(data.action, playbackData);
        }
        break;

      case 'change_video':
        if (data.data && 'video' in data.data && data.data.video) {
          setCurrentVideo(data.data.video);
        }
        break;

      case 'host_transfer':
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
        setCurrentVideo(null);
        break;

      default:
        console.warn('Unknown action:', data.action);
    }
  }, [userId, isHost]);

  // 连接 WebSocket
  const { isConnected, sendMessage } = useRoomWebSocket(
    roomId || '',
    handleWebSocketMessage,
    { autoReconnect: true }
  );

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  // 房主操作：播放控制
  const handleHostAction = useCallback((action: string, data: { time?: number }) => {
    if (!isHost) return;
    sendMessage(action, data);
  }, [isHost, sendMessage]);

  // 切换视频（任何人都可以操作）
  const handleChangeVideo = useCallback(async (video: Video) => {
    try {
      await roomApi.playVideo(roomId || '', video.video_id);
      setCurrentVideo(video);
      setShowVideoLibrary(false);
    } catch (err) {
      console.error('Failed to play video:', err);
      alert(`切换视频失败: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }, [roomId]);

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
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#36393f',
        color: '#dcddde'
      }}>
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '1rem',
        backgroundColor: '#36393f',
        color: '#dcddde'
      }}>
        <p style={{ fontSize: '1.25rem', color: '#f23f43' }}>加载失败: {error}</p>
      </div>
    );
  }

  return (
    <>
      {/* 顶部栏：房间信息 */}
      <div style={{
        height: '48px',
        backgroundColor: '#36393f',
        borderBottom: '1px solid #202225',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: '16px',
        flexShrink: 0
      }}>
        <div style={{
          fontSize: '1rem',
          fontWeight: '700',
          color: '#fff'
        }}>
          # {room?.name}
        </div>

        {room?.desc && (
          <>
            <div style={{
              width: '1px',
              height: '24px',
              backgroundColor: '#42454a'
            }} />
            <div style={{
              fontSize: '0.875rem',
              color: '#b9bbbe'
            }}>
              {room.desc}
            </div>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{
            fontSize: '0.75rem',
            color: isConnected ? '#23a55a' : '#f23f43',
            fontWeight: '600'
          }}>
            {isConnected ? '● 已连接' : '● 断开'}
          </div>

          <button
            onClick={() => setShowVideoLibrary(!showVideoLibrary)}
            style={{
              padding: '6px 12px',
              backgroundColor: '#4752c4',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '0.875rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#3c45a3'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#4752c4'}
          >
            📹 选择视频
          </button>
        </div>
      </div>

      {/* 主内容区 */}
      <div style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden'
      }}>
        {/* 视频播放器区域 */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#000'
        }}>
          {/* 视频播放器 */}
          <div style={{
            flex: 1,
            backgroundColor: '#000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {currentVideo ? (
              currentVideo.is_live ? (
                <FlvPlayer
                  flvPath={getLiveUrl(currentVideo.hls_path) || ''}
                  autoplay={true}
                  controls={true}
                />
              ) : (
                <SyncPlayer
                  ref={playerRef}
                  hlsPath={getPlayUrl(currentVideo.hls_path) || ''}
                  isHost={isHost}
                  onHostAction={handleHostAction}
                  autoplay={true}
                  controls={true}
                />
              )
            ) : (
              <div style={{
                textAlign: 'center',
                color: '#b9bbbe',
                padding: '3rem',
                width: '100%',
                maxWidth: '1000px',
                margin: '0 auto'
              }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎬</div>
                <p style={{ fontSize: '1.125rem', marginBottom: '0.5rem' }}>
                  {room?.name}
                </p>
                <p style={{ fontSize: '0.875rem', color: '#72767d', lineHeight: '1.6' }}>
                  点击"选择视频"开始观影，也可以使用 OBS 推流直播<br />
                  或者等待其他人这么做
                </p>

                {/* 推流信息 */}
                {room?.stream_path && (
                  <div style={{
                    marginTop: '2rem',
                    padding: '1.5rem',
                    backgroundColor: '#2f3136',
                    borderRadius: '8px',
                    textAlign: 'left',
                    width: '100%',
                    boxSizing: 'border-box'
                  }}>
                    <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: '#faa81a', fontWeight: '700' }}>
                      🔴 直播推流信息
                    </h3>

                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.75rem', color: '#b9bbbe', textTransform: 'uppercase', fontWeight: '700' }}>
                        推流地址（Server URL）
                      </label>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <input
                          type="text"
                          value={getStreamUrl(room.stream_path || '') || ''}
                          readOnly
                          style={{
                            flex: 1,
                            padding: '8px',
                            backgroundColor: '#202225',
                            border: 'none',
                            borderRadius: '4px',
                            color: '#dcddde',
                            fontSize: '0.875rem',
                            fontFamily: 'monospace'
                          }}
                        />
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(getStreamUrl(room.stream_path || '') || '');
                            alert('已复制到剪贴板');
                          }}
                          style={{
                            padding: '8px 12px',
                            backgroundColor: '#4752c4',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            fontWeight: '600'
                          }}
                        >
                          复制
                        </button>
                      </div>
                    </div>

                    {room?.stream_key && (
                      <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.75rem', color: '#b9bbbe', textTransform: 'uppercase', fontWeight: '700' }}>
                          推流密钥（Stream Key）
                        </label>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <input
                            type="text"
                            value={room.stream_key}
                            readOnly
                            style={{
                              flex: 1,
                              padding: '8px',
                              backgroundColor: '#202225',
                              border: 'none',
                              borderRadius: '4px',
                              color: '#dcddde',
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
                              padding: '8px 12px',
                              backgroundColor: '#4752c4',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.875rem',
                              fontWeight: '600'
                            }}
                          >
                            复制
                          </button>
                        </div>
                      </div>
                    )}

                    <div style={{ fontSize: '0.75rem', color: '#96989d', lineHeight: '1.5' }}>
                      <p>• 使用 OBS 等推流软件，分别填入推流地址和密钥</p>
                      <p>• 开始推流后，房间内所有人将自动收到直播</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 右侧：用户列表 */}
        <div style={{
          width: '280px',
          backgroundColor: '#2f3136',
          borderLeft: '1px solid #202225',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0
        }}>
          <div style={{
            padding: '16px',
            borderBottom: '1px solid #202225'
          }}>
            <h3 style={{
              fontSize: '0.75rem',
              fontWeight: '700',
              color: '#96989d',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              在线成员 — {users.length}
            </h3>
          </div>

          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px'
          }}>
            {users.map((user) => (
              <div
                key={user.user_id}
                style={{
                  padding: '8px',
                  marginBottom: '2px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  transition: 'background-color 0.1s',
                  cursor: 'pointer',
                  position: 'relative'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#36393f';
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoverPosition({ x: rect.left, y: rect.top + rect.height / 2 });
                  setHoveredUser(user);
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  setHoveredUser(null);
                }}
              >
                {/* 头像 */}
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: user.avatar ? 'transparent' : '#5865f2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.875rem',
                  fontWeight: '700',
                  color: 'white',
                  flexShrink: 0,
                  overflow: 'hidden'
                }}>
                  {user.avatar ? (
                    <img
                      src={user.avatar}
                      alt={user.username}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover'
                      }}
                    />
                  ) : (
                    user.username?.charAt(0).toUpperCase() || '?'
                  )}
                </div>

                {/* 用户信息 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    color: user.is_host ? '#faa81a' : '#dcddde',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {user.username || `用户${user.user_id}`}
                    {user.is_host && ' 👑'}
                  </div>
                </div>

                {/* 移交按钮 */}
                {isHost && !user.is_host && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTransferHost(user.user_id);
                    }}
                    style={{
                      padding: '4px 8px',
                      backgroundColor: '#4752c4',
                      color: 'white',
                      border: 'none',
                      borderRadius: '3px',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#3c45a3'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#4752c4'}
                  >
                    移交
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 视频库侧边栏 */}
      {showVideoLibrary && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          display: 'flex',
          justifyContent: 'flex-end',
          zIndex: 1000
        }} onClick={() => setShowVideoLibrary(false)}>
          <div style={{
            width: '400px',
            backgroundColor: '#2f3136',
            padding: '24px',
            overflowY: 'auto'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: '700', color: '#fff' }}>视频库</h3>
              <button
                onClick={() => setShowVideoLibrary(false)}
                style={{
                  padding: '8px',
                  backgroundColor: 'transparent',
                  color: '#b9bbbe',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '1.25rem',
                  lineHeight: 1
                }}
              >
                ✕
              </button>
            </div>

            {videos.length === 0 ? (
              <p style={{ color: '#96989d', textAlign: 'center', padding: '2rem' }}>
                暂无可用视频
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {videos.map((video) => (
                  <div
                    key={video.video_id}
                    onClick={() => handleChangeVideo(video)}
                    style={{
                      padding: '12px',
                      backgroundColor: '#36393f',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#42454a'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#36393f'}
                  >
                    <div style={{ fontSize: '0.875rem', fontWeight: '600', marginBottom: '4px', color: '#dcddde' }}>
                      {video.title}
                    </div>
                    {video.duration > 0 && (
                      <div style={{ fontSize: '0.75rem', color: '#96989d' }}>
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

      {/* 用户名片悬停卡片 - Discord 风格 */}
      {hoveredUser && (
        <div style={{
          position: 'fixed',
          left: `${hoverPosition.x - 320}px`,
          top: `${hoverPosition.y}px`,
          transform: 'translateY(-50%)',
          width: '300px',
          backgroundColor: '#18191c',
          borderRadius: '8px',
          boxShadow: '0 8px 16px rgba(0, 0, 0, 0.4)',
          overflow: 'hidden',
          zIndex: 2000,
          pointerEvents: 'none'
        }}>
          {/* 顶部背景色块 */}
          <div style={{
            height: '60px',
            backgroundColor: hoveredUser.is_host ? '#faa81a' : '#5865f2'
          }} />

          {/* 头像 */}
          <div style={{
            position: 'absolute',
            top: '16px',
            left: '16px',
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            border: '6px solid #18191c',
            backgroundColor: hoveredUser.avatar ? 'transparent' : '#5865f2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '2rem',
            fontWeight: '700',
            color: 'white',
            overflow: 'hidden'
          }}>
            {hoveredUser.avatar ? (
              <img
                src={hoveredUser.avatar}
                alt={hoveredUser.username}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
              />
            ) : (
              hoveredUser.username?.charAt(0).toUpperCase() || '?'
            )}
          </div>

          {/* 内容区域 */}
          <div style={{
            padding: '16px',
            paddingTop: '48px',
            backgroundColor: '#2b2d31'
          }}>
            {/* 用户名 */}
            <div style={{
              fontSize: '1.25rem',
              fontWeight: '700',
              color: '#fff',
              marginBottom: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              {hoveredUser.username || `用户${hoveredUser.user_id}`}
              {hoveredUser.is_host && (
                <span style={{
                  fontSize: '1rem',
                  color: '#faa81a'
                }}>
                  👑
                </span>
              )}
            </div>

            {/* 房主标签 */}
            {hoveredUser.is_host && (
              <div style={{
                display: 'inline-block',
                padding: '4px 8px',
                backgroundColor: '#faa81a',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontWeight: '700',
                color: '#fff',
                textTransform: 'uppercase',
                marginBottom: '12px'
              }}>
                房主
              </div>
            )}

            {/* Bio */}
            {hoveredUser.bio && (
              <div style={{
                marginTop: '12px',
                padding: '12px',
                backgroundColor: '#1e1f22',
                borderRadius: '4px',
                fontSize: '0.875rem',
                color: '#b5bac1',
                lineHeight: '1.5'
              }}>
                {hoveredUser.bio}
              </div>
            )}

            {/* 无 Bio 占位 */}
            {!hoveredUser.bio && (
              <div style={{
                marginTop: '12px',
                fontSize: '0.875rem',
                color: '#6d6f78',
                fontStyle: 'italic'
              }}>
                这个用户很懒，什么都没写~
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
