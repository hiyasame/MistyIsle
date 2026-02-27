import { VIDEO_STATUS_TEXT, VIDEO_STATUS_COLOR } from '../utils/config';

/**
 * 视频卡片组件
 */
export default function VideoCard({ video, onClick }) {
  const canPlay = ['m3u8_prepared', 'modal_upload', 'ready'].includes(video.status);
  const statusText = VIDEO_STATUS_TEXT[video.status] || video.status;
  const statusColor = VIDEO_STATUS_COLOR[video.status] || '#9ca3af';

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN');
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className="video-card"
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '1rem',
        marginBottom: '1rem',
        cursor: canPlay ? 'pointer' : 'default',
        transition: 'all 0.2s',
        ':hover': canPlay ? { boxShadow: '0 4px 6px rgba(0,0,0,0.1)' } : {}
      }}
      onClick={() => canPlay && onClick && onClick(video)}
    >
      <div className="video-header" style={{ marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: '600' }}>
          {video.title}
        </h3>
        {video.description && (
          <p style={{ margin: '0.5rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
            {video.description}
          </p>
        )}
      </div>

      <div className="video-meta" style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {video.duration > 0 && (
            <span>时长: {formatDuration(video.duration)}</span>
          )}
          <span>上传于: {formatDate(video.created_at)}</span>
          {video.expires_at && (
            <span>过期: {formatDate(video.expires_at)}</span>
          )}
        </div>
      </div>

      <div className="video-status" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '0.875rem', color: statusColor, fontWeight: '500' }}>
              {statusText}
            </span>
            <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
              {video.progress}%
            </span>
          </div>
          <div
            style={{
              width: '100%',
              height: '8px',
              backgroundColor: '#e5e7eb',
              borderRadius: '4px',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                width: `${video.progress}%`,
                height: '100%',
                backgroundColor: statusColor,
                transition: 'width 0.3s ease'
              }}
            />
          </div>
        </div>

        {canPlay && (
          <button
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: '500'
            }}
            onClick={(e) => {
              e.stopPropagation();
              onClick && onClick(video);
            }}
          >
            播放
          </button>
        )}

        {video.status === 'failed' && (
          <span style={{ color: '#ef4444', fontSize: '0.875rem' }}>
            {video.error_msg || '处理失败'}
          </span>
        )}
      </div>
    </div>
  );
}
