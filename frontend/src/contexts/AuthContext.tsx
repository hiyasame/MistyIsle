import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { userApi, setAuthToken, clearAuthToken } from '../services/api';
import type { User, LoginResponse } from '../types';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, code: string) => Promise<void>;
  logout: () => void;
  updateUser: (data: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 初始化：检查本地是否有 token，自动登录
  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('auth_token');
      if (token) {
        try {
          const res = await userApi.profile();
          if (res.code === 0) {
            setUser(res.data);
          } else {
            clearAuthToken();
          }
        } catch (err) {
          console.error('Auto login failed:', err);
          clearAuthToken();
        }
      }
      setIsLoading(false);
    };

    initAuth();
  }, []);

  // 登录
  const login = async (email: string, password: string) => {
    const res = await userApi.login({ email, password });
    if (res.code === 0) {
      const { token, user: userData } = res.data;
      setAuthToken(token);
      setUser(userData);
    } else {
      throw new Error(res.error || 'Login failed');
    }
  };

  // 注册
  const register = async (username: string, email: string, password: string, code: string) => {
    const res = await userApi.register({ username, email, password, code });
    if (res.code === 0) {
      const { token, user: userData } = res.data;
      setAuthToken(token);
      setUser(userData);
    } else {
      throw new Error(res.error || 'Registration failed');
    }
  };

  // 登出
  const logout = () => {
    clearAuthToken();
    setUser(null);
  };

  // 更新用户信息
  const updateUser = (data: Partial<User>) => {
    if (user) {
      setUser({ ...user, ...data });
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        logout,
        updateUser
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
