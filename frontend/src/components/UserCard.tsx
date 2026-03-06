import type { RoomUser } from '../types';

interface UserCardProps {
  user: RoomUser;
  position: { x: number; y: number };
}

export default function UserCard({ user, position }: UserCardProps) {
  return (
    <div style={{
      position: 'fixed',
      left: `${position.x - 320}px`,
      top: `${position.y}px`,
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
        backgroundColor: user.is_host ? '#faa81a' : '#5865f2'
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
        backgroundColor: user.avatar ? 'transparent' : '#5865f2',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '2rem',
        fontWeight: '700',
        color: 'white',
        overflow: 'hidden'
      }}>
        {user.avatar ? (
          <img
            src={user.avatar}
            alt={user.username}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          user.username?.charAt(0).toUpperCase() || '?'
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
          {user.username || `用户${user.user_id}`}
          {user.is_host && <span style={{ fontSize: '1rem', color: '#faa81a' }}>👑</span>}
        </div>

        {/* 房主标签 */}
        {user.is_host && (
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
        {user.bio ? (
          <div style={{
            marginTop: '12px',
            padding: '12px',
            backgroundColor: '#1e1f22',
            borderRadius: '4px',
            fontSize: '0.875rem',
            color: '#b5bac1',
            lineHeight: '1.5'
          }}>
            {user.bio}
          </div>
        ) : (
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
  );
}
