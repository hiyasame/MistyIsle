import { useState, useEffect, useCallback, useRef } from 'react';
import { videoApi } from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAuth } from '../contexts/AuthContext';
import { Video, VideoStatus } from '../types';
import { VIDEO_STATUS_TEXT, VIDEO_STATUS_COLOR, getPlayUrl } from '../utils/config';
import VideoPlayer from '../components/VideoPlayer';

/**
 * 视频管理视图组件 - Discord 风格
 * 显示在主内容区，包含视频上传和管理功能
 */
export default function VideoManagementView() {
  const { user } = useAuth();
  const userId = user?.user_id || '';

  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 上传相关状态
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);     // 0-100
  const [uploadedBytes, setUploadedBytes] = useState(0);       // 已上传字节
  const [totalBytes, setTotalBytes] = useState(0);             // 总字节
  const [uploadStep, setUploadStep] = useState<'idle' | 'init' | 'uploading' | 'processing'>('idle');

  // 离开页面拦截
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isUploading) {
        e.preventDefault();
        e.returnValue = '视频正在上传中，离开页面将中断上传。确定要离开吗？';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isUploading]);

  // 格式化字节数
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

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
    console.log('[VideoManagementView] WS Received:', data);

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
      setUploadedBytes(0);
      setTotalBytes(uploadFile.size);

      // 1. 初始化上传
      const title = uploadTitle.trim() || uploadFile.name;
      const initRes = await videoApi.init({
        title,
        description: '',
        file_size: uploadFile.size,
        file_ext: '.' + (uploadFile.name.split('.').pop() || 'mp4')
      });

      if (initRes.code !== 0) {
        throw new Error(initRes.error || 'Init failed');
      }

      const { video_id, presigned_url } = initRes.data;

      // 2. 使用 XHR 上传到 R2（支持进度追踪）
      setUploadStep('uploading');
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            setUploadedBytes(event.loaded);
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload to R2 failed (HTTP ${xhr.status})`));
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
        xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

        xhr.open('PUT', presigned_url);
        xhr.setRequestHeader('Content-Type', uploadFile.type || 'video/mp4');
        xhr.send(uploadFile);
      });

      setUploadProgress(100);
      setUploadedBytes(uploadFile.size);

      // 3. 触发处理
      setUploadStep('processing');
      const processRes = await videoApi.process(video_id);

      if (processRes.code !== 0) {
        throw new Error(processRes.error || 'Process failed');
      }

      // 刷新列表
      await fetchVideos();

      // 重置状态
      setUploadFile(null);
      setUploadTitle('');
      setUploadStep('idle');
      setUploadProgress(0);
      setUploadedBytes(0);
      setTotalBytes(0);

      alert('视频已开始处理，请稍后查看进度');
    } catch (err: any) {
      console.error('Upload error:', err);
      alert(`上传失败: ${err.message}`);
      setUploadStep('idle');
    } finally {
      setIsUploading(false);
    }
  };

  // 删除视频
  const handleDelete = async (videoId: string) => {
    if (!confirm('确定要删除这个视频吗？')) return;

    try {
      const res = await videoApi.delete(videoId);
      if (res.code === 0) {
        setVideos(prev => prev.filter(v => v.video_id !== videoId));
        if (previewVideo?.video_id === videoId) {
          setPreviewVideo(null);
        }
        alert('删除成功');
      } else {
        throw new Error(res.error || '删除失败');
      }
    } catch (err: any) {
      alert(`删除失败: ${err.message}`);
    }
  };

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: '60px 40px',
      backgroundColor: '#36393f'
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* 标题和连接状态 */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px'
        }}>
          <h1 style={{
            fontSize: '1.5rem',
            fontWeight: '700',
            color: '#fff'
          }}>
            📹 视频管理
          </h1>

          <div style={{
            fontSize: '0.75rem',
            color: isConnected ? '#23a55a' : '#f23f43',
            fontWeight: '600'
          }}>
            {isConnected ? '● 实时同步已连接' : '● 同步断开'}
          </div>
        </div>

        {/* 上传区域 */}
        <div style={{
          backgroundColor: '#2f3136',
          borderRadius: '8px',
          padding: '24px',
          marginBottom: '24px'
        }}>
          <h2 style={{
            fontSize: '1.125rem',
            fontWeight: '700',
            color: '#fff',
            marginBottom: '16px'
          }}>
            上传新视频
          </h2>

          <div style={{ marginBottom: '16px' }}>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              fontSize: '0.75rem',
              color: '#b9bbbe',
              fontWeight: '700',
              textTransform: 'uppercase'
            }}>
              视频标题（可选）
            </label>
            <input
              type="text"
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              placeholder="不填写则使用文件名"
              disabled={isUploading}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: '#202225',
                border: '1px solid #202225',
                borderRadius: '4px',
                color: '#dcddde',
                fontSize: '1rem',
                outline: 'none'
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              disabled={isUploading}
              style={{ display: 'none' }}
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              style={{
                width: '100%',
                padding: '40px',
                backgroundColor: '#202225',
                border: '2px dashed #42454a',
                borderRadius: '8px',
                color: '#b9bbbe',
                fontSize: '1rem',
                cursor: isUploading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                textAlign: 'center'
              }}
              onMouseOver={(e) => !isUploading && (e.currentTarget.style.borderColor = '#5865f2')}
              onMouseOut={(e) => !isUploading && (e.currentTarget.style.borderColor = '#42454a')}
            >
              {uploadFile ? `📁 ${uploadFile.name}` : '📤 点击选择视频文件'}
            </button>
          </div>

          {uploadFile && (
            <>
              <button
                onClick={handleUpload}
                disabled={isUploading}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: isUploading ? '#3c845e' : '#23a55a',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '1rem',
                  fontWeight: '600',
                  cursor: isUploading ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.2s'
                }}
                onMouseOver={(e) => !isUploading && (e.currentTarget.style.backgroundColor = '#1e7e45')}
                onMouseOut={(e) => !isUploading && (e.currentTarget.style.backgroundColor = '#23a55a')}
              >
                {isUploading ? (
                  uploadStep === 'init' ? '⏳ 初始化中...' :
                    uploadStep === 'uploading' ? `⬆️ 上传中 ${uploadProgress}%  ${formatBytes(uploadedBytes)} / ${formatBytes(totalBytes)}` :
                      '⚙️ 云端处理中，请勿关闭页面...'
                ) : '开始上传'}
              </button>

              {/* 上传进度条 */}
              {isUploading && uploadStep === 'uploading' && (
                <div style={{ marginTop: '12px' }}>
                  {/* 警告提示 */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginBottom: '8px',
                    padding: '8px 12px',
                    backgroundColor: 'rgba(250, 173, 20, 0.15)',
                    borderRadius: '4px',
                    border: '1px solid rgba(250, 173, 20, 0.3)',
                  }}>
                    <span style={{ fontSize: '0.85rem' }}>⚠️</span>
                    <span style={{ fontSize: '0.8rem', color: '#faad14', fontWeight: '600' }}>
                      上传中，请不要刷新或关闭页面
                    </span>
                  </div>

                  {/* 进度条背景 */}
                  <div style={{
                    width: '100%',
                    height: '6px',
                    backgroundColor: '#202225',
                    borderRadius: '3px',
                    overflow: 'hidden',
                  }}>
                    {/* 进度条填充 */}
                    <div style={{
                      height: '100%',
                      width: `${uploadProgress}%`,
                      background: 'linear-gradient(90deg, #5865f2, #3ba55d)',
                      borderRadius: '3px',
                      transition: 'width 0.3s ease',
                    }} />
                  </div>

                  {/* 数字进度 */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: '6px',
                    fontSize: '0.75rem',
                    color: '#72767d',
                  }}>
                    <span>{formatBytes(uploadedBytes)} / {formatBytes(totalBytes)}</span>
                    <span>{uploadProgress}%</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* 视频列表 */}
        <div style={{
          backgroundColor: '#2f3136',
          borderRadius: '8px',
          padding: '24px'
        }}>
          <h2 style={{
            fontSize: '1.125rem',
            fontWeight: '700',
            color: '#fff',
            marginBottom: '16px'
          }}>
            我的视频
          </h2>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#b9bbbe' }}>
              加载中...
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#f23f43' }}>
              {error}
            </div>
          ) : videos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#72767d' }}>
              还没有上传任何视频
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
              {videos.map((video) => (
                <div
                  key={video.video_id}
                  style={{
                    backgroundColor: '#36393f',
                    borderRadius: '8px',
                    padding: '16px',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#42454a'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#36393f'}
                >
                  <div style={{
                    fontSize: '1rem',
                    fontWeight: '600',
                    color: '#fff',
                    marginBottom: '8px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {video.title}
                  </div>

                  <div style={{
                    fontSize: '0.75rem',
                    color: VIDEO_STATUS_COLOR[video.status] || '#b9bbbe',
                    marginBottom: '8px'
                  }}>
                    {VIDEO_STATUS_TEXT[video.status] || video.status}
                    {video.status !== 'ready' && video.status !== 'failed' && ` (${video.progress}%)`}
                  </div>

                  {video.error_msg && (
                    <div style={{
                      fontSize: '0.75rem',
                      color: '#f23f43',
                      marginBottom: '8px'
                    }}>
                      {video.error_msg}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    {(video.status === 'ready' || video.status === 'm3u8_prepared') && (
                      <button
                        onClick={() => setPreviewVideo(video)}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          backgroundColor: '#5865f2',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          fontSize: '0.875rem',
                          fontWeight: '600',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        预览
                      </button>
                    )}

                    <button
                      onClick={() => handleDelete(video.video_id)}
                      style={{
                        flex: video.status === 'ready' || video.status === 'm3u8_prepared' ? '0 0 70px' : 1,
                        padding: '8px 12px',
                        backgroundColor: '#f23f43',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        fontSize: '0.875rem',
                        fontWeight: '600',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        minWidth: '70px'
                      }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 视频预览模态框 */}
        {previewVideo && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10000,
              padding: '40px'
            }}
            onClick={() => setPreviewVideo(null)}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '1200px',
                backgroundColor: '#2f3136',
                borderRadius: '8px',
                overflow: 'hidden'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{
                padding: '20px',
                borderBottom: '1px solid #42454a',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <h3 style={{ fontSize: '1.25rem', color: '#fff', fontWeight: '700' }}>
                  {previewVideo.title}
                </h3>
                <button
                  onClick={() => setPreviewVideo(null)}
                  style={{
                    padding: '8px',
                    backgroundColor: 'transparent',
                    color: '#b9bbbe',
                    border: 'none',
                    fontSize: '1.5rem',
                    cursor: 'pointer'
                  }}
                >
                  ✕
                </button>
              </div>

              <div style={{ backgroundColor: '#000' }}>
                <VideoPlayer
                  hlsPath={getPlayUrl(previewVideo.hls_path) || ''}
                  autoplay={false}
                  controls={true}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
