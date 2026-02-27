import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AuthModals } from './AuthModals';
import { ProfileModal } from './ProfileModal';

export function UserMenu() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDropdown]);

  if (!isAuthenticated) {
    return (
      <>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={() => setShowLogin(true)}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: 'transparent',
              color: 'white',
              border: '1px solid #475569',
              borderRadius: '6px',
              fontSize: '0.875rem',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#475569';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            登录
          </button>
          <button
            onClick={() => setShowRegister(true)}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '0.875rem',
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#2563eb';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#3b82f6';
            }}
          >
            注册
          </button>
        </div>

        <AuthModals
          showLogin={showLogin}
          showRegister={showRegister}
          onClose={() => {
            setShowLogin(false);
            setShowRegister(false);
          }}
        />
      </>
    );
  }

  return (
    <>
      <div style={{ position: 'relative' }} ref={dropdownRef}>
        <div
          onClick={() => setShowDropdown(!showDropdown)}
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            backgroundColor: '#3b82f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontSize: '1.125rem',
            fontWeight: '600',
            color: 'white',
            userSelect: 'none',
            transition: 'transform 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          {user?.avatar ? (
            <img
              src={user.avatar}
              alt={user.username}
              style={{
                width: '100%',
                height: '100%',
                borderRadius: '50%',
                objectFit: 'cover'
              }}
            />
          ) : (
            user?.username?.charAt(0).toUpperCase() || '?'
          )}
        </div>

        {showDropdown && (
          <div
            style={{
              position: 'absolute',
              top: '50px',
              right: 0,
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
              minWidth: '180px',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
              zIndex: 100,
              overflow: 'hidden'
            }}
          >
            {/* 用户信息 */}
            <div style={{
              padding: '0.75rem 1rem',
              borderBottom: '1px solid #334155',
              color: 'white'
            }}>
              <div style={{ fontWeight: '500', marginBottom: '0.25rem' }}>
                {user?.username}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                {user?.email}
              </div>
            </div>

            {/* 菜单项 */}
            <MenuItem
              label="视频列表"
              onClick={() => {
                navigate('/upload');
                setShowDropdown(false);
              }}
            />
            <MenuItem
              label="修改个人信息"
              onClick={() => {
                setShowProfile(true);
                setShowDropdown(false);
              }}
            />
            <MenuItem
              label="登出"
              onClick={() => {
                logout();
                setShowDropdown(false);
              }}
              danger
            />
          </div>
        )}
      </div>

      {showProfile && (
        <ProfileModal onClose={() => setShowProfile(false)} />
      )}
    </>
  );
}

function MenuItem({
  label,
  onClick,
  danger = false
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '0.75rem 1rem',
        cursor: 'pointer',
        color: danger ? '#ef4444' : 'white',
        fontSize: '0.875rem',
        transition: 'background-color 0.2s'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = '#334155';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      {label}
    </div>
  );
}
