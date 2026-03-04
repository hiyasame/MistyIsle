import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import MainLayout from './components/MainLayout';
import UserSettingsView from './components/UserSettingsView';
import RoomView from './components/RoomView';
import LoginPage from './pages/LoginPage';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* 登录页面（公开访问） */}
          <Route path="/login" element={<LoginPage />} />

          {/* 受保护的主布局路由 */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <MainLayout>
                  <UserSettingsView />
                </MainLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/room/:id"
            element={
              <ProtectedRoute>
                <MainLayout showRightSidebar={false}>
                  <RoomView />
                </MainLayout>
              </ProtectedRoute>
            }
          />

          {/* 404 重定向 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
