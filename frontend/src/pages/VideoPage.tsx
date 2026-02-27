import { useState, useEffect, useCallback } from 'react';
import { videoApi } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import VideoUploader from '../components/VideoUploader';
import VideoCard from '../components/VideoCard';
import VideoPlayer from '../components/VideoPlayer';

/**
 * 视频页面
 */
export default function VideoPage() {
  const [videos, setVideos] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 假设用户ID为1（实际项目中从认证状态获取）
  const userId = '1';

  // 加载视频列表
  const loadVideos = useCallback(async () => {
    try {
      setLoading(true);
      const res = await videoApi.list();
      if (res.code === 0) {
        setVideos(res.data.list || []);
      } else {
        throw new Error(res.error || 'Failed to load videos');
      }
    } catch (err) {
      console.error('Failed to load videos:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  // 处理 WebSocket 消息
  const handleWebSocketMessage = useCallback((data) => {
    console.log('WebSocket message:', data);

    // 视频状态更新
    if (data.type === 'video_status') {
      const videoData = data.data;

      setVideos((prevVideos) => {
        const index = prevVideos.findIndex(v => v.video_id === videoData.video_id);

        if (index >= 0) {
          // 更新现有视频
          const updated = [...prevVideos];
          updated[index] = {
            ...updated[index],
            status: videoData.status,
            progress: videoData.progress,
            hls_path: videoData.playlist_path || updated[index].hls_path,
            duration: videoData.duration || updated[index].duration,
            error_msg: videoData.error || updated[index].error_msg
          };
          return updated;
        }

        return prevVideos;
      });

      // 如果正在播放的视频更新了，也更新选中的视频
      if (selectedVideo && selectedVideo.video_id === videoData.video_id) {
        setSelectedVideo(prev => ({
          ...prev,
          status: videoData.status,
          progress: videoData.progress,
          hls_path: videoData.playlist_path || prev.hls_path
        }));
      }
    }
  }, [selectedVideo]);

  // 连接 WebSocket（使用用户级通知）
  const { isConnected } = useWebSocket(
    `user_${userId}`,
    handleWebSocketMessage,
    { autoReconnect: true }
  );

  // 处理上传完成
  const handleUploadComplete = useCallback((videoData) => {
    console.log('Upload completed:', videoData);

    // 添加到列表顶部
    setVideos((prev) => [{
      video_id: videoData.video_id,
      title: videoData.title,
      description: '',
      status: videoData.status,
      progress: videoData.progress,
      hls_path: '',
      duration: 0,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    }, ...prev]);
  }, []);

  // 选择视频播放
  const handleVideoClick = useCallback((video) => {
    if (['m3u8_prepared', 'modal_upload', 'ready'].includes(video.status)) {
      setSelectedVideo(video);
    }
  }, []);

  return (
    <div className="video-page" style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
      <h1 style={{ marginBottom: '2rem' }}>Misty Isle 视频管理</h1>

      {/* WebSocket 连接状态 */}
      <div style={{ marginBottom: '1rem', fontSize: '0.875rem', color: isConnected ? '#10b981' : '#ef4444' }}>
        WebSocket: {isConnected ? '已连接 ✓' : '未连接 ✗'}
      </div>

      {/* 上传区域 */}
      <div style={{ marginBottom: '2rem', padding: '1.5rem', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
        <VideoUploader onUploadComplete={handleUploadComplete} />
      </div>

      {/* 播放器 */}
      {selectedVideo && selectedVideo.hls_path && (
        <div style={{ marginBottom: '2rem', padding: '1.5rem', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0 }}>{selectedVideo.title}</h2>
            <button
              onClick={() => setSelectedVideo(null)}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              关闭
            </button>
          </div>
          <VideoPlayer hlsPath={selectedVideo.hls_path} controls autoplay />
        </div>
      )}

      {/* 视频列表 */}
      <div>
        <h2 style={{ marginBottom: '1rem' }}>我的视频</h2>

        {loading && <p>加载中...</p>}
        {error && <p style={{ color: '#ef4444' }}>加载失败: {error}</p>}

        {!loading && !error && videos.length === 0 && (
          <p style={{ color: '#6b7280' }}>暂无视频，上传你的第一个视频吧！</p>
        )}

        {!loading && !error && videos.length > 0 && (
          <div className="video-list">
            {videos.map((video) => (
              <VideoCard
                key={video.video_id}
                video={video}
                onClick={handleVideoClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
