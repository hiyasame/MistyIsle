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

    // 清理旧实例
    if (flvPlayerRef.current) {
      flvPlayerRef.current.destroy();
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

      flvPlayer.on(flvjs.Events.LOADING_COMPLETE, () => {
        console.log('FLV loading complete');
      });

      flvPlayer.on('metadata_arrived', () => {
        console.log('FLV metadata loaded');
        setIsReady(true);
        if (autoplay) {
          video.play().catch((err: Error) => {
            console.warn('Autoplay prevented:', err);
          });
        }
      });

      flvPlayer.on('error', (errorType: string, errorDetail: string, errorInfo: any) => {
        console.error('FLV error:', errorType, errorDetail, errorInfo);
        if (errorType === 'NetworkError') {
          setError('网络错误，正在尝试重连...');
          // 尝试重新加载
          setTimeout(() => {
            if (flvPlayerRef.current) {
              flvPlayerRef.current.unload();
              flvPlayerRef.current.load();
            }
          }, 2000);
        } else if (errorType === 'MediaError') {
          setError('媒体错误');
        } else {
          setError('播放器错误');
        }
      });

      flvPlayer.load();
    } else {
      setError('浏览器不支持 FLV 播放');
    }

    return () => {
      if (flvPlayerRef.current) {
        flvPlayerRef.current.pause();
        flvPlayerRef.current.unload();
        flvPlayerRef.current.detachMediaElement();
        flvPlayerRef.current.destroy();
        flvPlayerRef.current = null;
      }
    };
  }, [flvPath, autoplay]);

  if (error) {
    return (
      <div
        style={{
          width: '100%',
          aspectRatio: '16/9',
          backgroundColor: '#1f2937',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ef4444',
          borderRadius: '8px',
        }}
      >
        <div>
          <p style={{ fontSize: '1.125rem', marginBottom: '0.5rem' }}>播放器错误</p>
          <p style={{ fontSize: '0.875rem', opacity: 0.8 }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', backgroundColor: '#000', borderRadius: '8px', overflow: 'hidden' }}>
      <video
        ref={videoRef}
        controls={controls}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
      {!isReady && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: 'white',
            fontSize: '1rem',
          }}
        >
          连接直播流中...
        </div>
      )}
    </div>
  );
};

export default FlvPlayer;
