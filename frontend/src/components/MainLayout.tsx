import { ReactNode } from 'react';
import Sidebar from './Sidebar';

interface MainLayoutProps {
  children: ReactNode;
  rightSidebar?: ReactNode;
  showRightSidebar?: boolean;
}

/**
 * 主布局组件 - Discord 风格
 * 左侧：房间列表边栏（60px）
 * 中间：主内容区域
 * 右侧：可选的侧边栏（如用户列表）
 */
export default function MainLayout({ children, rightSidebar, showRightSidebar = false }: MainLayoutProps) {
  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      backgroundColor: '#36393f',
      overflow: 'hidden'
    }}>
      {/* 左侧边栏：房间列表 */}
      <Sidebar />

      {/* 中间内容区域 */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        backgroundColor: '#36393f'
      }}>
        {children}
      </div>

      {/* 右侧边栏：用户列表等（可选） */}
      {showRightSidebar && rightSidebar && (
        <div style={{
          width: '280px',
          backgroundColor: '#2f3136',
          borderLeft: '1px solid #202225',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0
        }}>
          {rightSidebar}
        </div>
      )}
    </div>
  );
}
