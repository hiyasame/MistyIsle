import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

/**
 * 同步播放器组件
 * 支持 HLS 视频和直播流，支持同步控制
 */
export default function SyncPlayer({
  hlsPath,
  isHost = false,
  onHostAction,
  onReady,
  autoplay = false,
  controls = true
}) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState(null);
  const actionFromRemoteRef = useRef(false); // 标记是否来自远程控制

  // 初始化 HLS
  useEffect(() => {
    if (!hlsPath || !videoRef.current) return;

    const video = videoRef.current;

    // 清理旧实例
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true, // 低延迟模式（适合直播）
        backBufferLength: 90
      });

      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('HLS manifest parsed');
        setIsReady(true);
        onReady?.();

        if (autoplay) {
          video.play().catch(err => {
            console.warn('Autoplay prevented:', err);
          });
        }
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS error:', data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('Network error, trying to recover...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('Media error, trying to recover...');
              hls.recoverMediaError();
              break;
            default:
              setError('Fatal error loading video');
              hls.destroy();
              break;
          }
        }
      });

      hls.loadSource(hlsPath);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari 原生支持 HLS
      video.src = hlsPath;
      video.addEventListener('loadedmetadata', () => {
        console.log('HLS loaded (native)');
        setIsReady(true);
        onReady?.();

        if (autoplay) {
          video.play().catch(err => {
            console.warn('Autoplay prevented:', err);
          });
        }
      });
    } else {
      setError('HLS is not supported in this browser');
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [hlsPath, autoplay, onReady]);

  // 房主控制：监听播放器事件并上报
  useEffect(() => {
    if (!isHost || !videoRef.current || !isReady) return;

    const video = videoRef.current;

    const handlePlay = () => {
      if (actionFromRemoteRef.current) {
        actionFromRemoteRef.current = false;
        return;
      }
      onHostAction?.('play', { time: video.currentTime });
    };

    const handlePause = () => {
      if (actionFromRemoteRef.current) {
        actionFromRemoteRef.current = false;
        return;
      }
      onHostAction?.('pause', { time: video.currentTime });
    };

    const handleSeeked = () => {
      if (actionFromRemoteRef.current) {
        actionFromRemoteRef.current = false;
        return;
      }
      onHostAction?.('seek', { time: video.currentTime });
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('seeked', handleSeeked);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('seeked', handleSeeked);
    };
  }, [isHost, isReady, onHostAction]);

  // 接收远程控制
  const handleRemoteAction = (action, data) => {
    if (!videoRef.current || !isReady) return;

    const video = videoRef.current;
    actionFromRemoteRef.current = true; // 标记为远程操作

    switch (action) {
      case 'play':
        if (data.time !== undefined && Math.abs(video.currentTime - data.time) > 1) {
          video.currentTime = data.time;
        }
        video.play().catch(err => console.warn('Play failed:', err));
        break;

      case 'pause':
        if (data.time !== undefined && Math.abs(video.currentTime - data.time) > 1) {
          video.currentTime = data.time;
        }
        video.pause();
        break;

      case 'seek':
        if (data.time !== undefined) {
          video.currentTime = data.time;
        }
        break;

      default:
        console.warn('Unknown action:', action);
    }
  };

  // 暴露控制方法
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.handleRemoteAction = handleRemoteAction;
    }
  }, [isReady]);

  if (error) {
    return (
      <div style={{
        width: '100%',
        aspectRatio: '16/9',
        backgroundColor: '#1f2937',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#ef4444',
        borderRadius: '8px'
      }}>
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
          display: 'block'
        }}
      />
      {!isReady && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: 'white',
          fontSize: '1rem'
        }}>
          加载中...
        </div>
      )}
    </div>
  );
}
