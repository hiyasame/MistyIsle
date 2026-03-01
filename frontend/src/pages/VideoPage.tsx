import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { videoApi } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAuth } from '../contexts/AuthContext';
import { Video, VideoStatus } from '../types';
import { API_BASE_URL, VIDEO_STATUS_TEXT, VIDEO_STATUS_COLOR, getPlayUrl } from '../utils/config';
import VideoPlayer from '../components/VideoPlayer';

/**
 * 重新设计的视频管理与上传页面
 * 采用现代深色主题，支持实时 WebSocket 进度更新
 */
export default function VideoPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.user_id || '';

  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 上传相关状态
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStep, setUploadStep] = useState<'idle' | 'init' | 'uploading' | 'processing'>('idle');

  // 预览相关状态
  const [previewVideo, setPreviewVideo] = useState<Video | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 加载视频列表
  const fetchVideos = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const res = await videoApi.list();
      if (res.code === 0) {
        setVideos(res.data.list || []);
      } else {
        setError(res.error || '获取视频列表失败');
      }
    } catch (err) {
      setError('网络请求失败');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  // 处理 WebSocket 实时推送的状态更新
  const handleWSMessage = useCallback((data: any) => {
    console.log('[VideoPage] WS Received:', data);

    if (data.type === 'video_status' && data.data) {
      const update = data.data;
      setVideos(prev => prev.map(v => {
        if (String(v.video_id) === String(update.video_id)) {
          return {
            ...v,
            status: update.status as VideoStatus,
            progress: update.progress,
            hls_path: update.playlist_path || v.hls_path,
            error_msg: update.message || v.error_msg
          };
        }
        return v;
      }));

      // 如果正在预览的视频更新了
      if (previewVideo && String(previewVideo.video_id) === String(update.video_id)) {
        setPreviewVideo(prev => prev ? ({
          ...prev,
          status: update.status as VideoStatus,
          progress: update.progress,
          hls_path: update.playlist_path || prev.hls_path
        }) : null);
      }
    }
  }, [previewVideo]);

  // 连接个人通知 WebSocket
  const { isConnected } = useWebSocket(
    userId ? `user_${userId}` : '',
    handleWSMessage,
    { autoReconnect: true }
  );

  // 处理上传逻辑
  const handleUpload = async () => {
    if (!uploadFile) return;

    try {
      setIsUploading(true);
      setUploadStep('init');
      setUploadProgress(0);

      const ext = uploadFile.name.substring(uploadFile.name.lastIndexOf('.')).toLowerCase();

      // 1. 初始化
      const initRes = await videoApi.init({
        title: uploadTitle || uploadFile.name,
        file_size: uploadFile.size,
        file_ext: ext
      });

      if (initRes.code !== 0) throw new Error(initRes.error);
      const { video_id, presigned_url } = initRes.data;

      // 2. 上传到 R2
      setUploadStep('uploading');
      await videoApi.uploadToR2(presigned_url, uploadFile, (progress) => {
        setUploadProgress(progress);
      });

      // 3. 触发后端处理
      setUploadStep('processing');
      const procRes = await videoApi.process(video_id);
      if (procRes.code !== 0) throw new Error(procRes.error);

      // 上传成功，重置状态并刷新列表
      setUploadFile(null);
      setUploadTitle('');
      setUploadStep('idle');
      setIsUploading(false);
      fetchVideos();

    } catch (err) {
      console.error('Upload error:', err);
      alert('上传失败: ' + (err instanceof Error ? err.message : '未知错误'));
      setIsUploading(false);
      setUploadStep('idle');
    }
  };

  const getStatusDisplay = (status: VideoStatus) => {
    const text = VIDEO_STATUS_TEXT[status] || status;
    const color = VIDEO_STATUS_COLOR[status] || '#64748b';
    return { text, color };
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0f172a',
      color: '#f8fafc',
      padding: '2rem',
      fontFamily: 'Inter, system-ui, sans-serif'
    }}>
      {/* Header */}
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '3rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <button
            onClick={() => navigate(-1)}
            style={{
              padding: '0.6rem 1.2rem',
              backgroundColor: '#1e293b',
              color: 'white',
              border: '1px solid #334155',
              borderRadius: '10px',
              cursor: 'pointer',
              fontSize: '0.9rem',
              transition: 'all 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#334155'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = '#1e293b'}
          >
            ← 返回
          </button>
          <div>
            <h1 style={{ fontSize: '2rem', fontWeight: '800', margin: 0, background: 'linear-gradient(90deg, #60a5fa, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              云端视频管理
            </h1>
            <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.9rem' }}>
              WebSocket 状态: {isConnected ? <span style={{ color: '#22c55e' }}>● 已连接</span> : <span style={{ color: '#ef4444' }}>● 断开</span>}
            </p>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(300px, 350px) 1fr', gap: '3rem' }}>

        {/* Left Side: Upload Panel */}
        <div style={{
          backgroundColor: '#1e293b',
          borderRadius: '24px',
          padding: '2rem',
          height: 'fit-content',
          border: '1px solid #334155',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
          position: 'sticky',
          top: '2rem'
        }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', fontWeight: '700' }}>📤 上传新视频</h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: '#94a3b8' }}>视频标题</label>
              <input
                type="text"
                placeholder="起个好听的标题..."
                value={uploadTitle}
                onChange={e => setUploadTitle(e.target.value)}
                disabled={isUploading}
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '12px',
                  color: 'white',
                  outline: 'none focus:border-blue-500'
                }}
              />
            </div>

            <div
              onClick={() => !isUploading && fileInputRef.current?.click()}
              style={{
                border: '2px dashed #334155',
                borderRadius: '16px',
                padding: '2.5rem 1rem',
                textAlign: 'center',
                cursor: isUploading ? 'default' : 'pointer',
                transition: 'all 0.2s',
                backgroundColor: uploadFile ? '#1e293b' : 'transparent',
                borderColor: uploadFile ? '#3b82f6' : '#334155'
              }}
              onMouseEnter={e => !isUploading && (e.currentTarget.style.borderColor = '#3b82f6')}
              onMouseLeave={e => !isUploading && !uploadFile && (e.currentTarget.style.borderColor = '#334155')}
            >
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="video/*"
                onChange={e => setUploadFile(e.target.files?.[0] || null)}
                style={{ display: 'none' }}
              />
              {uploadFile ? (
                <div>
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📄</div>
                  <p style={{ fontSize: '0.9rem', color: '#f8fafc', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis' }}>{uploadFile.name}</p>
                  <p style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{(uploadFile.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🎥</div>
                  <p style={{ fontSize: '0.9rem', color: '#94a3b8' }}>点击或拖拽文件到这里</p>
                </div>
              )}
            </div>

            {isUploading && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
                  <span style={{ color: '#60a5fa' }}>{uploadStep === 'uploading' ? '正在上传到存储...' : '正在初始化...'}</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div style={{ height: '6px', backgroundColor: '#0f172a', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${uploadProgress}%`, height: '100%', backgroundColor: '#3b82f6', transition: 'width 0.3s' }} />
                </div>
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={!uploadFile || isUploading}
              style={{
                marginTop: '1rem',
                padding: '1rem',
                backgroundColor: !uploadFile || isUploading ? '#334155' : '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '14px',
                fontWeight: '700',
                cursor: !uploadFile || isUploading ? 'default' : 'pointer',
                transition: 'transform 0.1s active:scale-95'
              }}
            >
              {isUploading ? (uploadStep === 'processing' ? '正在排队处理...' : '上传中...') : '开始上传'}
            </button>
          </div>
        </div>

        {/* Right Side: Video List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '700' }}>🎬 我的视频库</h2>
            <button
              onClick={fetchVideos}
              style={{ padding: '0.5rem', borderRadius: '50%', backgroundColor: '#1e293b', border: '1px solid #334155', cursor: 'pointer' }}
            >
              🔄
            </button>
          </div>

          {loading && videos.length === 0 ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '5rem' }}>加载中...</div>
          ) : videos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '5rem', backgroundColor: '#1e293b', borderRadius: '24px', border: '1px dashed #334155' }}>
              <p style={{ color: '#94a3b8' }}>你还没有上传过视频，赶快尝试一下吧！</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
              {videos.map(video => {
                const { text, color } = getStatusDisplay(video.status);
                const canPlay = video.status === 'ready' || video.status === 'm3u8_prepared';

                return (
                  <div
                    key={video.video_id}
                    style={{
                      backgroundColor: '#1e293b',
                      borderRadius: '20px',
                      overflow: 'hidden',
                      border: '1px solid #334155',
                      transition: 'all 0.3s',
                      cursor: canPlay ? 'pointer' : 'default',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                    }}
                    onMouseEnter={e => {
                      if (canPlay) {
                        e.currentTarget.style.transform = 'translateY(-5px)';
                        e.currentTarget.style.borderColor = '#3b82f6';
                      }
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.borderColor = '#334155';
                    }}
                    onClick={() => canPlay && setPreviewVideo(video)}
                  >
                    {/* Thumbnail Placeholder */}
                    <div style={{ height: '160px', backgroundColor: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                      <span style={{ fontSize: '3rem' }}>{canPlay ? '▶️' : '⏳'}</span>
                      {video.progress < 100 && video.progress > 0 && (
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '4px', backgroundColor: '#334155' }}>
                          <div style={{ width: `${video.progress}%`, height: '100%', backgroundColor: '#3b82f6' }} />
                        </div>
                      )}
                    </div>

                    <div style={{ padding: '1.25rem' }}>
                      <h3 style={{ fontSize: '1rem', fontWeight: '700', margin: '0 0 0.5rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{video.title}</h3>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <span style={{
                          fontSize: '0.7rem',
                          padding: '0.2rem 0.6rem',
                          borderRadius: '6px',
                          backgroundColor: `${color}20`,
                          color: color,
                          fontWeight: '700',
                          textTransform: 'uppercase'
                        }}>
                          {text}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          {new Date(video.created_at).toLocaleDateString()}
                        </span>
                      </div>

                      {video.status === 'failed' && (
                        <p style={{ fontSize: '0.75rem', color: '#ef4444', margin: '0.5rem 0 0', fontStyle: 'italic' }}>
                          {video.error_msg}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Preview Modal */}
      {previewVideo && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '2rem'
        }} onClick={() => setPreviewVideo(null)}>
          <div style={{
            width: '100%',
            maxWidth: '1000px',
            backgroundColor: '#1e293b',
            borderRadius: '24px',
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
          }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '1.5rem', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '700', margin: 0 }}>{previewVideo.title}</h2>
              <button
                onClick={() => setPreviewVideo(null)}
                style={{ backgroundColor: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.5rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '2rem', backgroundColor: '#000' }}>
              <VideoPlayer
                hlsPath={getPlayUrl(previewVideo.hls_path) || ''}
                autoplay={true}
              />
            </div>

            <div style={{ padding: '1.5rem', color: '#94a3b8', fontSize: '0.9rem' }}>
              <p>{previewVideo.description || '暂无描述'}</p>
              <div style={{ display: 'flex', gap: '2rem', marginTop: '1rem' }}>
                <span>时常: {Math.floor(previewVideo.duration / 60)}:{(previewVideo.duration % 60).toString().padStart(2, '0')}</span>
                <span>创建时间: {new Date(previewVideo.created_at).toLocaleString()}</span>
                <span>过期时间: {previewVideo.expires_at ? new Date(previewVideo.expires_at).toLocaleDateString() : '永久'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
