import { useEffect, useRef, useState } from 'react';
import flvjs from 'flv.js';

/**
 * FLV 直播播放器组件
 * 专门用于播放 HTTP-FLV 直播流
 */
interface FlvPlayerProps {
  flvPath: string;
  autoplay?: boolean;
  controls?: boolean;
}

const FlvPlayer = ({ flvPath, autoplay = true, controls = true }: FlvPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const flvPlayerRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!flvPath || !videoRef.current) return;

    const video = videoRef.current;
    setIsReady(false);
    setError(null);

    // 清理旧实例
    if (flvPlayerRef.current) {
      try {
        flvPlayerRef.current.destroy();
      } catch (e) {
        console.error('Error destroying flv player:', e);
      }
      flvPlayerRef.current = null;
    }

    if (flvjs.isSupported()) {
      const flvPlayer = flvjs.createPlayer(
        {
          type: 'flv',
          url: flvPath,
          isLive: true,
          hasAudio: true,
          hasVideo: true,
        },
        {
          enableWorker: false,
          enableStashBuffer: false,
          stashInitialSize: 128,
          isLive: true,
          lazyLoad: false,
          autoCleanupSourceBuffer: true,
        }
      );

      flvPlayerRef.current = flvPlayer;
      flvPlayer.attachMediaElement(video);
      flvPlayer.load();

      flvPlayer.on(flvjs.Events.METADATA_ARRIVED, () => {
        console.log('FLV metadata arrived');
        setIsReady(true);
        if (autoplay) {
          video.play().catch((err: Error) => {
            console.warn('Autoplay prevented:', err);
          });
        }
      });

      flvPlayer.on(flvjs.Events.ERROR, (errorType: string, errorDetail: string, errorInfo: any) => {
        console.error('FLV error:', errorType, errorDetail, errorInfo);
        if (errorType === flvjs.ErrorTypes.NETWORK_ERROR) {
          setError('网络错误，请确保直播已开始且 SRS 服务正常');
        } else {
          setError(`播放错误: ${errorDetail}`);
        }
      });

      // 兜底：如果 metadata_arrived 没触发但已经可以播放了
      video.oncanplay = () => {
        if (!isReady) setIsReady(true);
      };

    } else {
      setError('浏览器不支持 FLV 播放');
    }

    return () => {
      if (flvPlayerRef.current) {
        try {
          flvPlayerRef.current.destroy();
        } catch (e) {
          // ignore
        }
        flvPlayerRef.current = null;
      }
    };
  }, [flvPath, autoplay]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16/9',
        backgroundColor: '#000',
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
      }}
    >
      <video
        ref={videoRef}
        controls={controls}
        muted={autoplay}
        playsInline
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain', // 保持比例并居中
        }}
      />

      {!isReady && !error && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(17, 24, 39, 0.8)',
            color: '#fff',
            zIndex: 10,
            backdropFilter: 'blur(4px)',
          }}
        >
          <div style={{
            width: '48px',
            height: '48px',
            border: '3px solid rgba(255,255,255,0.1)',
            borderTop: '3px solid #3b82f6',
            borderRadius: '50%',
            animation: 'flv-spin 0.8s linear infinite',
            marginBottom: '1rem'
          }} />
          <p style={{ fontSize: '0.875rem', fontWeight: 500, letterSpacing: '0.025em' }}>正在连接直播源...</p>
          <style>{`
            @keyframes flv-spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}

      {error && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#111827',
            color: '#f87171',
            zIndex: 20,
            padding: '2rem',
            textAlign: 'center'
          }}
        >
          <div>
            <div style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>无法播放</div>
            <p style={{ fontSize: '0.875rem', color: '#9ca3af' }}>{error}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default FlvPlayer;
