import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { userApi } from '../services/api';
import backgroundImage from '../../assets/camillia_misty_isle.png';

/**
 * 独立登录/注册页面 - Discord 风格 + 毛玻璃效果
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const { login, register } = useAuth();

  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState('');

  // 发送验证码
  const handleSendCode = async () => {
    if (!email.trim()) {
      setError('请输入邮箱地址');
      return;
    }

    try {
      setSendingCode(true);
      setError('');
      const res = await userApi.sendVerifyCode(email);
      if (res.code === 0) {
        // 开始倒计时
        setCountdown(60);
        const timer = setInterval(() => {
          setCountdown(prev => {
            if (prev <= 1) {
              clearInterval(timer);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
        alert('验证码已发送到您的邮箱！');
      } else {
        setError(res.error || '发送失败');
      }
    } catch (err) {
      console.error('Send code error:', err);
      setError(err instanceof Error ? err.message : '发送验证码失败');
    } finally {
      setSendingCode(false);
    }
  };

  // 登录
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('请填写完整信息');
      return;
    }

    try {
      setLoading(true);
      setError('');
      await login(email, password);
      navigate('/');
    } catch (err) {
      console.error('Login error:', err);
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  // 注册
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !email.trim() || !password.trim() || !verifyCode.trim()) {
      setError('请填写完整信息');
      return;
    }

    try {
      setLoading(true);
      setError('');
      await register(username, email, password, verifyCode);
      navigate('/');
    } catch (err) {
      console.error('Register error:', err);
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden',
      padding: '20px'
    }}>
      {/* 背景壁纸 */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `url(${backgroundImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        filter: 'brightness(0.5)',
        zIndex: 0
      }} />

      {/* Discord 暗色遮罩层 */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: 'rgba(32, 34, 37, 0.75)',
        zIndex: 1
      }} />

      {/* 登录/注册卡片 - 毛玻璃效果 */}
      <div style={{
        position: 'relative',
        background: 'rgba(47, 49, 54, 0.85)',
        backdropFilter: 'blur(40px) saturate(150%)',
        WebkitBackdropFilter: 'blur(40px) saturate(150%)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        width: '100%',
        maxWidth: '480px',
        padding: '40px',
        zIndex: 2
      }}>
        {/* Logo 和标题 */}
        <div style={{
          textAlign: 'center',
          marginBottom: '32px'
        }}>
          <div style={{
            fontSize: '3rem',
            marginBottom: '12px'
          }}>
            🌸
          </div>
          <h1 style={{
            fontSize: '1.75rem',
            fontWeight: '700',
            color: '#fff',
            marginBottom: '8px'
          }}>
            雾屿花间
          </h1>
          <p style={{
            fontSize: '0.875rem',
            color: '#b9bbbe'
          }}>
            {isLogin ? '欢迎回来！' : '创建你的账户'}
          </p>
        </div>

        {/* 错误提示 */}
        {error && (
          <div style={{
            padding: '12px',
            backgroundColor: 'rgba(242, 63, 67, 0.1)',
            border: '1px solid #f23f43',
            borderRadius: '8px',
            color: '#f23f43',
            fontSize: '0.875rem',
            marginBottom: '20px',
            textAlign: 'center'
          }}>
            {error}
          </div>
        )}

        {/* 表单 */}
        <form onSubmit={isLogin ? handleLogin : handleRegister}>
          {/* 用户名（仅注册时显示） */}
          {!isLogin && (
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
                用户名 *
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="输入用户名"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: '#202225',
                  border: '1px solid #202225',
                  borderRadius: '4px',
                  color: '#dcddde',
                  fontSize: '1rem',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = '#5865f2'}
                onBlur={(e) => e.currentTarget.style.borderColor = '#202225'}
              />
            </div>
          )}

          {/* 邮箱 */}
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
              邮箱地址 *
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#202225',
                border: '1px solid #202225',
                borderRadius: '4px',
                color: '#dcddde',
                fontSize: '1rem',
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = '#5865f2'}
              onBlur={(e) => e.currentTarget.style.borderColor = '#202225'}
            />
          </div>

          {/* 密码 */}
          <div style={{ marginBottom: !isLogin ? '20px' : '24px' }}>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              fontSize: '0.75rem',
              fontWeight: '700',
              color: '#b9bbbe',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              密码 *
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#202225',
                border: '1px solid #202225',
                borderRadius: '4px',
                color: '#dcddde',
                fontSize: '1rem',
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = '#5865f2'}
              onBlur={(e) => e.currentTarget.style.borderColor = '#202225'}
            />
          </div>

          {/* 验证码（仅注册时显示） */}
          {!isLogin && (
            <div style={{ marginBottom: '24px' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '0.75rem',
                fontWeight: '700',
                color: '#b9bbbe',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                邮箱验证码 *
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  placeholder="6位验证码"
                  disabled={loading}
                  maxLength={6}
                  style={{
                    flex: 1,
                    padding: '12px',
                    backgroundColor: '#202225',
                    border: '1px solid #202225',
                    borderRadius: '4px',
                    color: '#dcddde',
                    fontSize: '1rem',
                    outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = '#5865f2'}
                  onBlur={(e) => e.currentTarget.style.borderColor = '#202225'}
                />
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={sendingCode || countdown > 0 || loading}
                  style={{
                    padding: '12px 20px',
                    backgroundColor: sendingCode || countdown > 0 || loading ? '#4e5058' : '#4752c4',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    cursor: sendingCode || countdown > 0 || loading ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseOver={(e) => {
                    if (!sendingCode && countdown === 0 && !loading) {
                      e.currentTarget.style.backgroundColor = '#3c45a3';
                    }
                  }}
                  onMouseOut={(e) => {
                    if (!sendingCode && countdown === 0 && !loading) {
                      e.currentTarget.style.backgroundColor = '#4752c4';
                    }
                  }}
                >
                  {sendingCode ? '发送中...' : countdown > 0 ? `${countdown}s` : '发送验证码'}
                </button>
              </div>
            </div>
          )}

          {/* 提交按钮 */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px',
              backgroundColor: loading ? '#4752c4' : '#5865f2',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '1rem',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              transition: 'background-color 0.2s',
              marginBottom: '8px'
            }}
            onMouseOver={(e) => {
              if (!loading) {
                e.currentTarget.style.backgroundColor = '#4752c4';
              }
            }}
            onMouseOut={(e) => {
              if (!loading) {
                e.currentTarget.style.backgroundColor = '#5865f2';
              }
            }}
          >
            {loading ? (isLogin ? '登录中...' : '注册中...') : (isLogin ? '登录' : '注册')}
          </button>
        </form>

        {/* 切换登录/注册 */}
        <div style={{
          marginTop: '20px',
          textAlign: 'center',
          fontSize: '0.875rem',
          color: '#b9bbbe'
        }}>
          {isLogin ? '还没有账户？' : '已有账户？'}
          {' '}
          <button
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
              setUsername('');
              setVerifyCode('');
            }}
            disabled={loading}
            style={{
              background: 'none',
              border: 'none',
              color: '#00aff4',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: '600',
              fontSize: '0.875rem',
              padding: 0
            }}
            onMouseOver={(e) => !loading && (e.currentTarget.style.textDecoration = 'underline')}
            onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
          >
            {isLogin ? '立即注册' : '返回登录'}
          </button>
        </div>
      </div>
    </div>
  );
}
