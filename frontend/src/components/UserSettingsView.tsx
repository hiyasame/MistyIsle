import { useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { userApi } from '../services/api';
import VideoManagementView from './VideoManagementView';

/**
 * 用户设置视图 - Discord 风格
 * 显示在主内容区，支持修改头像、用户名、bio
 */
export default function UserSettingsView() {
  const { user, updateUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'account' | 'videos'>('account');
  const [username, setUsername] = useState(user?.username || '');
  const [bio, setBio] = useState((user as any)?.bio || ''); // 从 user 获取 bio
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      const res = await userApi.uploadAvatar(file);
      if (res.code === 0) {
        // 重新获取用户信息
        const profileRes = await userApi.profile();
        if (profileRes.code === 0) {
          updateUser(profileRes.data);
        }
        alert('头像上传成功！');
      } else {
        throw new Error(res.error || '上传失败');
      }
    } catch (err) {
      console.error('Failed to upload avatar:', err);
      alert(`头像上传失败: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!username.trim()) {
      alert('用户名不能为空');
      return;
    }

    try {
      setSaving(true);
      const res = await userApi.updateProfile({
        username: username.trim(),
        bio: bio.trim()
      });
      if (res.code === 0) {
        updateUser(res.data);
        alert('个人信息保存成功！');
      } else {
        throw new Error(res.error || '保存失败');
      }
    } catch (err) {
      console.error('Failed to save profile:', err);
      alert(`保存失败: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      backgroundColor: '#36393f',
      overflow: 'hidden'
    }}>
      {/* 左侧导航栏 */}
      <div style={{
        width: '240px',
        backgroundColor: '#2f3136',
        padding: '60px 8px 60px 20px',
        overflowY: 'auto',
        flexShrink: 0
      }}>
        <nav>
          <div style={{
            marginBottom: '20px',
            fontSize: '0.75rem',
            fontWeight: '700',
            color: '#96989d',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            用户设置
          </div>

          <button
            onClick={() => setActiveTab('account')}
            style={{
              width: '100%',
              padding: '6px 10px',
              marginBottom: '2px',
              backgroundColor: activeTab === 'account' ? '#42454a' : 'transparent',
              color: activeTab === 'account' ? '#fff' : '#b9bbbe',
              border: 'none',
              borderRadius: '4px',
              fontSize: '1rem',
              fontWeight: '500',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.1s'
            }}
            onMouseOver={(e) => {
              if (activeTab !== 'account') {
                e.currentTarget.style.backgroundColor = '#393c43';
                e.currentTarget.style.color = '#dcddde';
              }
            }}
            onMouseOut={(e) => {
              if (activeTab !== 'account') {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#b9bbbe';
              }
            }}
          >
            我的账户
          </button>

          <button
            onClick={() => setActiveTab('videos')}
            style={{
              width: '100%',
              padding: '6px 10px',
              marginBottom: '2px',
              backgroundColor: activeTab === 'videos' ? '#42454a' : 'transparent',
              color: activeTab === 'videos' ? '#fff' : '#b9bbbe',
              border: 'none',
              borderRadius: '4px',
              fontSize: '1rem',
              fontWeight: '500',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.1s'
            }}
            onMouseOver={(e) => {
              if (activeTab !== 'videos') {
                e.currentTarget.style.backgroundColor = '#393c43';
                e.currentTarget.style.color = '#dcddde';
              }
            }}
            onMouseOut={(e) => {
              if (activeTab !== 'videos') {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#b9bbbe';
              }
            }}
          >
            📹 视频管理
          </button>

          <div style={{
            height: '1px',
            backgroundColor: '#42454a',
            margin: '20px 0'
          }} />

          <button
            onClick={() => {
              localStorage.removeItem('auth_token');
              window.location.href = '/';
            }}
            style={{
              width: '100%',
              padding: '6px 10px',
              backgroundColor: 'transparent',
              color: '#f23f43',
              border: 'none',
              borderRadius: '4px',
              fontSize: '1rem',
              fontWeight: '500',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'all 0.1s'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = '#393c43';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            登出
          </button>
        </nav>
      </div>

      {/* 主内容区 */}
      {activeTab === 'account' ? (
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '60px 40px'
        }}>
          <div style={{ maxWidth: '740px' }}>
            {/* 标题 */}
            <h1 style={{
              fontSize: '1.25rem',
              fontWeight: '700',
              color: '#fff',
              marginBottom: '20px'
            }}>
              我的账户
            </h1>

          {/* 账户信息卡片 */}
          <div style={{
            backgroundColor: '#2f3136',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '40px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              paddingBottom: '16px',
              borderBottom: '1px solid #42454a'
            }}>
              {/* 头像 */}
              <div style={{ position: 'relative' }}>
                <div style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: '50%',
                  backgroundColor: '#5865f2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '2rem',
                  fontWeight: 'bold',
                  color: 'white',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  position: 'relative'
                }}
                onClick={() => fileInputRef.current?.click()}>
                  {user?.avatar ? (
                    <img src={user.avatar} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    user?.username?.charAt(0).toUpperCase() || '?'
                  )}

                  {/* 悬浮遮罩 */}
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0,
                    transition: 'opacity 0.2s',
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    textAlign: 'center',
                    padding: '8px'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.opacity = '1'}
                  onMouseOut={(e) => e.currentTarget.style.opacity = '0'}>
                    {uploading ? '上传中...' : '修改\n头像'}
                  </div>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                  style={{ display: 'none' }}
                />
              </div>

              {/* 用户信息 */}
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: '1.25rem',
                  fontWeight: '700',
                  color: '#fff',
                  marginBottom: '4px'
                }}>
                  {user?.username || '未知用户'}
                </div>
                <div style={{
                  fontSize: '0.875rem',
                  color: '#b9bbbe'
                }}>
                  {user?.email || ''}
                </div>
              </div>

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#5865f2',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  cursor: uploading ? 'not-allowed' : 'pointer',
                  opacity: uploading ? 0.5 : 1,
                  transition: 'background-color 0.2s'
                }}
                onMouseOver={(e) => !uploading && (e.currentTarget.style.backgroundColor = '#4752c4')}
                onMouseOut={(e) => !uploading && (e.currentTarget.style.backgroundColor = '#5865f2')}
              >
                {uploading ? '上传中...' : '修改头像'}
              </button>
            </div>
          </div>

          {/* 用户名 */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              fontSize: '0.75rem',
              fontWeight: '700',
              color: '#b9bbbe',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              用户名
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="输入用户名"
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

          {/* Bio（暂时保留，未来可用） */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              fontSize: '0.75rem',
              fontWeight: '700',
              color: '#b9bbbe',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              个人简介
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="告诉大家你的故事..."
              rows={4}
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
            <div style={{
              fontSize: '0.75rem',
              color: '#96989d',
              marginTop: '4px'
            }}>
              最多可以输入 190 个字符
            </div>
          </div>

          {/* 保存按钮 */}
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '12px',
            paddingTop: '20px',
            borderTop: '1px solid #42454a'
          }}>
            <button
              onClick={() => {
                setUsername(user?.username || '');
                setBio((user as any)?.bio || '');
              }}
              disabled={saving}
              style={{
                padding: '10px 16px',
                backgroundColor: 'transparent',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                fontSize: '0.875rem',
                fontWeight: '600',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.5 : 1,
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => !saving && (e.currentTarget.style.textDecoration = 'underline')}
              onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
            >
              重置
            </button>
            <button
              onClick={handleSaveProfile}
              disabled={saving || !username.trim()}
              style={{
                padding: '10px 16px',
                backgroundColor: saving || !username.trim() ? '#3c845e' : '#23a55a',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '0.875rem',
                fontWeight: '600',
                cursor: saving || !username.trim() ? 'not-allowed' : 'pointer',
                opacity: saving || !username.trim() ? 0.5 : 1,
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => {
                if (!saving && username.trim()) {
                  e.currentTarget.style.backgroundColor = '#1e7e45';
                }
              }}
              onMouseOut={(e) => {
                if (!saving && username.trim()) {
                  e.currentTarget.style.backgroundColor = '#23a55a';
                }
              }}
            >
              {saving ? '保存中...' : '保存更改'}
            </button>
          </div>
        </div>
      </div>
      ) : (
        <VideoManagementView />
      )}

      {/* 右侧：ESC 提示 */}
      <div style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        padding: '8px 12px',
        backgroundColor: '#202225',
        borderRadius: '4px',
        fontSize: '0.875rem',
        color: '#b9bbbe',
        fontWeight: '600',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        <kbd style={{
          padding: '2px 6px',
          backgroundColor: '#36393f',
          borderRadius: '3px',
          fontSize: '0.75rem',
          fontWeight: '700'
        }}>
          ESC
        </kbd>
        返回
      </div>
    </div>
  );
}
