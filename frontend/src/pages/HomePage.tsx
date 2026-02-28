import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { roomApi } from '../services/api';
import { UserMenu } from '../components/UserMenu';
import type { Room } from '../types';

export default function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [roomDesc, setRoomDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const lastPathRef = useRef(location.pathname);

  const loadRooms = useCallback(async () => {
    try {
      setLoading(true);
      const res = await roomApi.list();
      if (res.code === 0) {
        setRooms(res.data.list || []);
      } else {
        throw new Error(res.error || 'Failed to load rooms');
      }
    } catch (err: any) {
      console.error('Failed to load rooms:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // 监听路由变化，从其他页面返回时刷新列表
  useEffect(() => {
    if (lastPathRef.current !== location.pathname) {
      loadRooms();
      lastPathRef.current = location.pathname;
    }
  }, [location.pathname, loadRooms]);

  // 首次加载和页面可见时刷新列表
  useEffect(() => {
    loadRooms();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadRooms();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadRooms]);

  const handleCreateRoom = async () => {
    if (!roomName.trim()) {
      alert('请输入房间名称');
      return;
    }

    try {
      setCreating(true);
      const res = await roomApi.create({
        name: roomName,
        description: roomDesc
      });
      if (res.code === 0) {
        const roomId = res.data.room_id;
        navigate(`/room/${roomId}`);
      } else {
        throw new Error(res.error || 'Failed to create room');
      }
    } catch (err: any) {
      console.error('Failed to create room:', err);
      alert(`创建房间失败: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleJoinRoom = (roomId: string) => {
    navigate(`/room/${roomId}`);
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(to bottom right, #0f172a, #1e293b)',
      color: 'white',
      padding: '2rem'
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem'
        }}>
          <div>
            <h1 style={{ fontSize: '2.25rem', marginBottom: '0.5rem' }}>雾屿花间</h1>
            <p style={{ color: '#94a3b8', fontSize: '1rem' }}>和朋友一起看视频、看直播</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              onClick={() => setShowCreateModal(true)}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '1rem',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2563eb'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#3b82f6'}
            >
              + 创建房间
            </button>
            <UserMenu />
          </div>
        </div>

        <div>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>在线房间</h2>

          {loading && (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
              加载中...
            </div>
          )}

          {error && (
            <div style={{
              padding: '1rem',
              backgroundColor: '#7f1d1d',
              borderRadius: '8px',
              marginBottom: '1rem'
            }}>
              加载失败: {error}
            </div>
          )}

          {!loading && !error && rooms.length === 0 && (
            <div style={{
              textAlign: 'center',
              padding: '3rem',
              color: '#64748b',
              backgroundColor: '#1e293b',
              borderRadius: '8px'
            }}>
              <p style={{ fontSize: '1.125rem', marginBottom: '0.5rem' }}>暂无房间</p>
              <p style={{ fontSize: '0.875rem' }}>创建第一个房间，邀请朋友一起看吧！</p>
            </div>
          )}

          {!loading && !error && rooms.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '1rem'
            }}>
              {rooms.map((room) => (
                <RoomCard
                  key={room.room_id}
                  room={room}
                  onJoin={handleJoinRoom}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: '#1e293b',
            padding: '2rem',
            borderRadius: '12px',
            width: '90%',
            maxWidth: '400px'
          }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>创建房间</h3>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: '#cbd5e1' }}>
                房间名称 *
              </label>
              <input
                type="text"
                placeholder="输入房间名称"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  backgroundColor: '#334155',
                  border: '1px solid #475569',
                  borderRadius: '6px',
                  color: 'white',
                  fontSize: '1rem',
                  outline: 'none'
                }}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: '#cbd5e1' }}>
                房间描述
              </label>
              <textarea
                placeholder="添加房间描述（可选）"
                value={roomDesc}
                onChange={(e) => setRoomDesc(e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  backgroundColor: '#334155',
                  border: '1px solid #475569',
                  borderRadius: '6px',
                  color: 'white',
                  fontSize: '1rem',
                  outline: 'none',
                  resize: 'vertical',
                  fontFamily: 'inherit'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setRoomName('');
                  setRoomDesc('');
                }}
                disabled={creating}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  backgroundColor: '#475569',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '1rem',
                  cursor: creating ? 'not-allowed' : 'pointer',
                  opacity: creating ? 0.5 : 1
                }}
              >
                取消
              </button>
              <button
                onClick={handleCreateRoom}
                disabled={creating || !roomName.trim()}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '1rem',
                  cursor: (creating || !roomName.trim()) ? 'not-allowed' : 'pointer',
                  opacity: (creating || !roomName.trim()) ? 0.5 : 1
                }}
              >
                {creating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RoomCard({ room, onJoin }: { room: Room; onJoin: (roomId: string) => void }) {
  return (
    <div
      onClick={() => onJoin(room.room_id)}
      style={{
        backgroundColor: '#1e293b',
        padding: '1.5rem',
        borderRadius: '12px',
        cursor: 'pointer',
        transition: 'all 0.2s',
        border: '1px solid #334155',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = '#334155';
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.3), 0 4px 6px -2px rgba(0, 0, 0, 0.2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = '#1e293b';
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)';
      }}
    >
      <h3 style={{
        fontSize: '1.25rem',
        marginBottom: '0.5rem',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}>
        {room.name}
      </h3>

      {room.desc && (
        <p style={{
          fontSize: '0.875rem',
          color: '#94a3b8',
          marginBottom: '0.75rem',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          lineHeight: '1.4'
        }}>
          {room.desc}
        </p>
      )}

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '0.875rem',
        color: '#94a3b8'
      }}>
        <div>
          <span style={{ marginRight: '1rem' }}>👤 {room.user_count || 0} 人</span>
          {room.is_live && <span>🔴 直播中</span>}
          {room.current_video && !room.is_live && <span>▶️ 观影中</span>}
        </div>
      </div>

      {room.current_video && (
        <div style={{
          marginTop: '0.75rem',
          padding: '0.5rem',
          backgroundColor: '#0f172a',
          borderRadius: '6px',
          fontSize: '0.875rem',
          color: '#cbd5e1',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          正在播放: {room.current_video.title || '未命名视频'}
        </div>
      )}
    </div>
  );
}
