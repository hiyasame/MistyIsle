import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { userApi } from '../services/api';

interface ProfileModalProps {
  onClose: () => void;
}

export function ProfileModal({ onClose }: ProfileModalProps) {
  const { user, updateUser } = useAuth();
  const [username, setUsername] = useState(user?.username || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim()) {
      setError('用户名不能为空');
      return;
    }

    try {
      setLoading(true);
      const res = await userApi.updateProfile({ username });
      if (res.code === 0) {
        updateUser(res.data);
        onClose();
      } else {
        setError(res.error || '更新失败');
      }
    } catch (err: any) {
      setError(err.message || '更新失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 检查文件类型
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件');
      return;
    }

    // 检查文件大小（限制 2MB）
    if (file.size > 2 * 1024 * 1024) {
      setError('图片大小不能超过 2MB');
      return;
    }

    try {
      setUploadingAvatar(true);
      setError('');
      const res = await userApi.uploadAvatar(file);
      if (res.code === 0) {
        updateUser({ avatar: res.data.avatar_url });
      } else {
        setError(res.error || '上传头像失败');
      }
    } catch (err: any) {
      setError(err.message || '上传头像失败');
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#1e293b',
          padding: '2rem',
          borderRadius: '12px',
          width: '90%',
          maxWidth: '400px'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontSize: '1.5rem', marginBottom: '1.5rem', color: 'white' }}>修改个人信息</h3>

        <form onSubmit={handleSubmit}>
          {/* 头像上传 */}
          <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
            <div style={{
              width: '80px',
              height: '80px',
              margin: '0 auto 1rem',
              borderRadius: '50%',
              backgroundColor: '#3b82f6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2rem',
              fontWeight: '600',
              color: 'white',
              position: 'relative',
              overflow: 'hidden'
            }}>
              {user?.avatar ? (
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
                user?.username?.charAt(0).toUpperCase() || '?'
              )}
              {uploadingAvatar && (
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontSize: '0.75rem'
                }}>
                  上传中...
                </div>
              )}
            </div>
            <label
              htmlFor="avatar-upload"
              style={{
                display: 'inline-block',
                padding: '0.5rem 1rem',
                backgroundColor: '#475569',
                color: 'white',
                borderRadius: '6px',
                fontSize: '0.875rem',
                cursor: uploadingAvatar ? 'not-allowed' : 'pointer',
                opacity: uploadingAvatar ? 0.5 : 1
              }}
            >
              {uploadingAvatar ? '上传中...' : '更换头像'}
            </label>
            <input
              id="avatar-upload"
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              disabled={uploadingAvatar}
              style={{ display: 'none' }}
            />
          </div>

          {/* 用户名 */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem' }}>
              用户名
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
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

          {/* 邮箱（不可修改） */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.875rem' }}>
              邮箱
            </label>
            <input
              type="email"
              value={user?.email || ''}
              disabled
              style={{
                width: '100%',
                padding: '0.75rem',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#64748b',
                fontSize: '1rem',
                cursor: 'not-allowed'
              }}
            />
          </div>

          {error && (
            <div style={{
              padding: '0.75rem',
              marginBottom: '1rem',
              backgroundColor: '#7f1d1d',
              borderRadius: '6px',
              color: '#fca5a5',
              fontSize: '0.875rem'
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                flex: 1,
                padding: '0.75rem',
                backgroundColor: '#475569',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '1rem',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1
              }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                flex: 1,
                padding: '0.75rem',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '1rem',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1
              }}
            >
              {loading ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
