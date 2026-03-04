import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { roomApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import type { Room } from '../types';

/**
 * 左侧边栏 - Discord 风格
 * 顶部：用户头像按钮
 * 中间：房间列表（圆形图标 + 首字母）
 * 底部：创建房间按钮
 */
export default function Sidebar() {
  const navigate = useNavigate();
  const { id: currentRoomId } = useParams();
  const { user } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [roomDesc, setRoomDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [showTooltip, setShowTooltip] = useState<string | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  const loadRooms = useCallback(async () => {
    try {
      const res = await roomApi.list();
      if (res.code === 0) {
        setRooms(res.data.list || []);
      }
    } catch (err) {
      console.error('Failed to load rooms:', err);
    }
  }, []);

  useEffect(() => {
    loadRooms();
    // 定期刷新房间列表
    const interval = setInterval(loadRooms, 10000);
    return () => clearInterval(interval);
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
        setShowCreateModal(false);
        setRoomName('');
        setRoomDesc('');
        loadRooms();
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

  const getInitial = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  return (
    <>
      <div style={{
        width: '72px',
        backgroundColor: '#202225',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 0',
        gap: '8px',
        overflowY: 'auto',
        overflowX: 'hidden',
        flexShrink: 0
      }}>
        {/* 用户头像按钮 */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => navigate('/')}
            onMouseEnter={() => setShowTooltip('user-settings')}
            onMouseLeave={() => setShowTooltip(null)}
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: '#5865f2',
              color: 'white',
              fontSize: '1.25rem',
              fontWeight: 'bold',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              padding: 0
            }}
            onMouseOver={(e) => e.currentTarget.style.borderRadius = '16px'}
            onMouseOut={(e) => e.currentTarget.style.borderRadius = '50%'}
          >
            {user?.avatar ? (
              <img src={user.avatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              user?.username?.charAt(0).toUpperCase() || '?'
            )}
          </button>

          {/* Tooltip */}
          {showTooltip === 'user-settings' && (
            <div style={{
              position: 'absolute',
              left: '60px',
              top: '50%',
              transform: 'translateY(-50%)',
              backgroundColor: '#18191c',
              color: 'white',
              padding: '8px 12px',
              borderRadius: '8px',
              fontSize: '0.875rem',
              fontWeight: '600',
              whiteSpace: 'nowrap',
              boxShadow: '0 8px 16px rgba(0, 0, 0, 0.4)',
              zIndex: 1000,
              pointerEvents: 'none'
            }}>
              {user?.username || '用户设置'}
              <div style={{
                position: 'absolute',
                left: '-4px',
                top: '50%',
                transform: 'translateY(-50%)',
                width: 0,
                height: 0,
                borderTop: '4px solid transparent',
                borderBottom: '4px solid transparent',
                borderRight: '4px solid #18191c'
              }} />
            </div>
          )}
        </div>

        {/* 分隔线 */}
        <div style={{
          width: '32px',
          height: '2px',
          backgroundColor: '#36393f',
          borderRadius: '1px'
        }} />

        {/* 房间列表 */}
        {rooms.map((room) => (
          <div key={room.room_id} style={{ position: 'relative' }}>
            {/* 活动指示器 */}
            {currentRoomId === room.room_id && (
              <div style={{
                position: 'absolute',
                left: '-12px',
                top: '50%',
                transform: 'translateY(-50%)',
                width: '8px',
                height: '40px',
                backgroundColor: 'white',
                borderRadius: '0 4px 4px 0'
              }} />
            )}

            <button
              onClick={() => navigate(`/room/${room.room_id}`)}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const cardHeight = 280; // 估算卡片高度
                let targetY = rect.top + rect.height / 2;

                // 避免超出顶部（留16px边距）
                if (targetY - cardHeight / 2 < 16) {
                  targetY = cardHeight / 2 + 16;
                }

                // 避免超出底部（留16px边距）
                if (targetY + cardHeight / 2 > window.innerHeight - 16) {
                  targetY = window.innerHeight - cardHeight / 2 - 16;
                }

                setTooltipPosition({ x: rect.right + 8, y: targetY });
                setShowTooltip(room.room_id);
              }}
              onMouseLeave={() => setShowTooltip(null)}
              style={{
                width: '48px',
                height: '48px',
                borderRadius: currentRoomId === room.room_id ? '16px' : '50%',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: currentRoomId === room.room_id ? '#5865f2' : '#36393f',
                color: 'white',
                fontSize: '1.25rem',
                fontWeight: 'bold',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative'
              }}
              onMouseOver={(e) => {
                if (currentRoomId !== room.room_id) {
                  e.currentTarget.style.borderRadius = '16px';
                  e.currentTarget.style.backgroundColor = '#5865f2';
                }
              }}
              onMouseOut={(e) => {
                if (currentRoomId !== room.room_id) {
                  e.currentTarget.style.borderRadius = '50%';
                  e.currentTarget.style.backgroundColor = '#36393f';
                }
              }}
            >
              {getInitial(room.name)}

              {/* 在线人数指示器 */}
              {room.user_count > 0 && (
                <div style={{
                  position: 'absolute',
                  bottom: '-2px',
                  right: '-2px',
                  backgroundColor: '#23a55a',
                  color: 'white',
                  fontSize: '0.65rem',
                  fontWeight: 'bold',
                  padding: '2px 4px',
                  borderRadius: '8px',
                  border: '2px solid #202225',
                  minWidth: '18px',
                  textAlign: 'center'
                }}>
                  {room.user_count}
                </div>
              )}

              {/* 直播指示器 */}
              {room.is_live && (
                <div style={{
                  position: 'absolute',
                  top: '-2px',
                  right: '-2px',
                  width: '12px',
                  height: '12px',
                  backgroundColor: '#f23f43',
                  borderRadius: '50%',
                  border: '2px solid #202225'
                }} />
              )}
            </button>

            {/* 房间详情卡片 - Discord 风格 */}
            {showTooltip === room.room_id && (
              <div style={{
                position: 'fixed',
                left: `${tooltipPosition.x}px`,
                top: `${tooltipPosition.y}px`,
                transform: 'translateY(-50%)',
                width: '280px',
                backgroundColor: '#18191c',
                borderRadius: '8px',
                boxShadow: '0 8px 16px rgba(0, 0, 0, 0.4)',
                overflow: 'hidden',
                zIndex: 9999,
                pointerEvents: 'none'
              }}>
                {/* 顶部背景色块 */}
                <div style={{
                  height: '60px',
                  backgroundColor: room.is_live ? '#f23f43' : '#5865f2',
                  position: 'relative'
                }}>
                  {room.is_live && (
                    <div style={{
                      position: 'absolute',
                      top: '8px',
                      right: '8px',
                      backgroundColor: 'rgba(0, 0, 0, 0.4)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      color: 'white'
                    }}>
                      🔴 直播中
                    </div>
                  )}
                </div>

                {/* 房间图标 */}
                <div style={{
                  position: 'absolute',
                  top: '16px',
                  left: '16px',
                  width: '64px',
                  height: '64px',
                  borderRadius: '16px',
                  border: '6px solid #18191c',
                  backgroundColor: currentRoomId === room.room_id ? '#5865f2' : '#36393f',
                  color: 'white',
                  fontSize: '1.75rem',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {getInitial(room.name)}
                </div>

                {/* 内容区域 */}
                <div style={{
                  padding: '16px',
                  paddingTop: '40px',
                  backgroundColor: '#2b2d31'
                }}>
                  {/* 房间名称 */}
                  <div style={{
                    fontSize: '1.125rem',
                    fontWeight: '700',
                    color: '#fff',
                    marginBottom: '8px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    # {room.name}
                  </div>

                  {/* 房间描述 */}
                  {room.desc && (
                    <div style={{
                      padding: '12px',
                      backgroundColor: '#1e1f22',
                      borderRadius: '4px',
                      fontSize: '0.875rem',
                      color: '#b5bac1',
                      lineHeight: '1.5',
                      marginBottom: '12px',
                      maxHeight: '60px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical'
                    }}>
                      {room.desc}
                    </div>
                  )}

                  {/* 统计信息 */}
                  <div style={{
                    display: 'flex',
                    gap: '12px',
                    fontSize: '0.75rem',
                    color: '#b9bbbe'
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <div style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: room.user_count > 0 ? '#23a55a' : '#80848e'
                      }} />
                      <span style={{ fontWeight: '600' }}>{room.user_count}</span> 人在线
                    </div>
                  </div>

                  {/* 点击提示 */}
                  <div style={{
                    marginTop: '12px',
                    fontSize: '0.75rem',
                    color: '#6d6f78',
                    fontStyle: 'italic'
                  }}>
                    点击加入房间
                  </div>
                </div>

                {/* 左侧箭头 */}
                <div style={{
                  position: 'absolute',
                  left: '-4px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 0,
                  height: 0,
                  borderTop: '6px solid transparent',
                  borderBottom: '6px solid transparent',
                  borderRight: '6px solid #18191c'
                }} />
              </div>
            )}
          </div>
        ))}

        {/* 底部：创建房间按钮 */}
        <div style={{ marginTop: 'auto', position: 'relative' }}>
          <button
            onClick={() => setShowCreateModal(true)}
            onMouseEnter={() => setShowTooltip('create-room')}
            onMouseLeave={() => setShowTooltip(null)}
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: '#36393f',
              color: '#23a55a',
              fontSize: '2rem',
              fontWeight: 'bold',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderRadius = '16px';
              e.currentTarget.style.backgroundColor = '#23a55a';
              e.currentTarget.style.color = 'white';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderRadius = '50%';
              e.currentTarget.style.backgroundColor = '#36393f';
              e.currentTarget.style.color = '#23a55a';
            }}
          >
            +
          </button>

          {/* Tooltip */}
          {showTooltip === 'create-room' && (
            <div style={{
              position: 'absolute',
              left: '60px',
              top: '50%',
              transform: 'translateY(-50%)',
              backgroundColor: '#18191c',
              color: 'white',
              padding: '8px 12px',
              borderRadius: '8px',
              fontSize: '0.875rem',
              fontWeight: '600',
              whiteSpace: 'nowrap',
              boxShadow: '0 8px 16px rgba(0, 0, 0, 0.4)',
              zIndex: 1000,
              pointerEvents: 'none'
            }}>
              创建房间
              <div style={{
                position: 'absolute',
                left: '-4px',
                top: '50%',
                transform: 'translateY(-50%)',
                width: 0,
                height: 0,
                borderTop: '4px solid transparent',
                borderBottom: '4px solid transparent',
                borderRight: '4px solid #18191c'
              }} />
            </div>
          )}
        </div>
      </div>

      {/* 创建房间模态框 */}
      {showCreateModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000
        }} onClick={() => !creating && setShowCreateModal(false)}>
          <div style={{
            backgroundColor: '#36393f',
            borderRadius: '8px',
            padding: '24px',
            width: '90%',
            maxWidth: '440px',
            boxShadow: '0 8px 16px rgba(0, 0, 0, 0.4)'
          }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{
              fontSize: '1.5rem',
              marginBottom: '8px',
              color: '#fff',
              fontWeight: '700'
            }}>
              创建房间
            </h2>
            <p style={{
              fontSize: '0.875rem',
              color: '#b9bbbe',
              marginBottom: '20px'
            }}>
              创建一个新的房间，邀请朋友一起观影或看直播
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '0.75rem',
                color: '#b9bbbe',
                fontWeight: '700',
                textTransform: 'uppercase'
              }}>
                房间名称 *
              </label>
              <input
                type="text"
                placeholder="我的观影房间"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                disabled={creating}
                autoFocus
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: '#202225',
                  border: '1px solid #202225',
                  borderRadius: '4px',
                  color: '#dcddde',
                  fontSize: '1rem',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = '#00aff4'}
                onBlur={(e) => e.currentTarget.style.borderColor = '#202225'}
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '0.75rem',
                color: '#b9bbbe',
                fontWeight: '700',
                textTransform: 'uppercase'
              }}>
                房间描述（可选）
              </label>
              <textarea
                placeholder="添加房间描述..."
                value={roomDesc}
                onChange={(e) => setRoomDesc(e.target.value)}
                disabled={creating}
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: '#202225',
                  border: '1px solid #202225',
                  borderRadius: '4px',
                  color: '#dcddde',
                  fontSize: '1rem',
                  outline: 'none',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = '#00aff4'}
                onBlur={(e) => e.currentTarget.style.borderColor = '#202225'}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setRoomName('');
                  setRoomDesc('');
                }}
                disabled={creating}
                style={{
                  padding: '10px 16px',
                  backgroundColor: 'transparent',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: creating ? 'not-allowed' : 'pointer',
                  opacity: creating ? 0.5 : 1,
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => !creating && (e.currentTarget.style.textDecoration = 'underline')}
                onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
              >
                取消
              </button>
              <button
                onClick={handleCreateRoom}
                disabled={creating || !roomName.trim()}
                style={{
                  padding: '10px 16px',
                  backgroundColor: creating || !roomName.trim() ? '#4752c4' : '#5865f2',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: creating || !roomName.trim() ? 'not-allowed' : 'pointer',
                  opacity: creating || !roomName.trim() ? 0.5 : 1,
                  transition: 'background-color 0.2s'
                }}
                onMouseOver={(e) => {
                  if (!creating && roomName.trim()) {
                    e.currentTarget.style.backgroundColor = '#4752c4';
                  }
                }}
                onMouseOut={(e) => {
                  if (!creating && roomName.trim()) {
                    e.currentTarget.style.backgroundColor = '#5865f2';
                  }
                }}
              >
                {creating ? '创建中...' : '创建房间'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
