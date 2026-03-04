import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Hls from 'hls.js';

/**
 * 同步播放器组件
 * 支持 HLS 视频和直播流，支持同步控制
 */
interface SyncPlayerProps {
  hlsPath: string;
  isHost?: boolean;
  onHostAction?: (action: string, data: any) => void;
  onReady?: () => void;
  autoplay?: boolean;
  controls?: boolean;
}

const SyncPlayer = forwardRef<any, SyncPlayerProps>(({
  hlsPath,
  isHost = false,
  onHostAction,
  onReady,
  autoplay = false,
  controls = true
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionFromRemoteRef = useRef(false); // 标记是否来自远程控制
  const localPausedRef = useRef(false); // 用户主动暂停锁，防止响应远程播放指令
  const isLoadingRef = useRef(false); // 标记视频是否正在加载（waiting/seeking状态）
  const lastSentActionRef = useRef<{ action: string; time: number; playing: boolean; timestamp: number } | null>(null);

  // 暴露 handleRemoteAction 给父组件
  useImperativeHandle(ref, () => ({
    handleRemoteAction: (_action: string, data: { time?: number; playing?: boolean }) => {
      if (!videoRef.current || !isReady) return;

      const video = videoRef.current;

      // 标记为远程操作，防止触发 handlePlay/Pause 导致回环
      actionFromRemoteRef.current = true;

      // 1. 同步播放/暂停状态
      if (data.playing !== undefined) {
        // 如果用户主动暂停，不响应远程播放指令
        if (data.playing && video.paused && !localPausedRef.current) {
          video.play().catch(() => { });
        } else if (!data.playing && !video.paused) {
          video.pause();
          // 远程暂停时清除本地暂停锁（允许之后的播放指令）
          localPausedRef.current = false;
        }
      }

      // 2. 同步进度 (误差检测)
      if (data.time !== undefined) {
        const drift = Math.abs(video.currentTime - data.time);
        // 如果误差大于 1.5 秒，强制对齐
        if (drift > 1.5) {
          video.currentTime = data.time;
          console.log(`[Sync] Drift of ${drift.toFixed(2)}s detected, corrected to ${data.time.toFixed(2)}s`);
        }
      }

      // 结束后重置标记可能存在竞争（play 是异步的），但在 handlePlay/Pause 里的 guards 能挡住
    }
  }), [isReady]);

  // 初始化 HLS
  useEffect(() => {
    if (!hlsPath || !videoRef.current) return;

    const video = videoRef.current;
    setIsReady(false);
    setError(null);

    // 清理旧实例
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false, // 点播 HLS 不需要低延迟模式，开启会导致 fragParsingError
        backBufferLength: 90,
        maxBufferLength: 60,          // 增加缓冲区长度（秒）
        maxMaxBufferLength: 120,      // 最大缓冲区上限
        startLevel: -1,               // 自动选择起始码率
        startFragPrefetch: true,       // 允许并行预加载下一个片段
        capLevelToPlayerSize: false,   // 不根据播放器大小限制等级
        maxFragLookUpTolerance: 0.25   // 提高片段查找容错
      });

      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('HLS manifest parsed');
        setIsReady(true);
        onReady?.();

        if (autoplay) {
          video.play().catch(() => { });
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
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
              setError('无法加载视频数据 (Fatal Network/Media Error)');
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
          video.play().catch(() => { });
        }
      });
    } else {
      setError('浏览器不支持 HLS 播放');
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

    const sendAction = (action: string) => {
      const now = Date.now();
      const time = video.currentTime;
      // 如果视频正在加载，强制发送暂停状态
      const playing = isLoadingRef.current ? false : !video.paused;
      const last = lastSentActionRef.current;

      // 关键动作处理：如果播放状态改变了 (play -> pause 或 pause -> play)，则立即发送，不进行限流
      const statusChanged = last ? last.playing !== playing : true;

      // 300ms 内不重复发送相同动作且进度相近的消息 (仅针对非状态变更的普通同步)
      if (!statusChanged && last && last.action === action && Math.abs(last.time - time) < 0.3 && now - last.timestamp < 300) {
        return;
      }

      lastSentActionRef.current = { action, time, playing, timestamp: now };
      onHostAction?.(action, { time, playing });
    };

    const handlePlay = () => {
      if (actionFromRemoteRef.current) {
        actionFromRemoteRef.current = false;
        return;
      }
      // 用户主动播放，清除暂停锁
      localPausedRef.current = false;
      sendAction('sync');
    };

    const handlePause = () => {
      if (actionFromRemoteRef.current) {
        actionFromRemoteRef.current = false;
        return;
      }
      // 用户主动暂停，设置暂停锁
      localPausedRef.current = true;
      sendAction('sync');
    };

    const handleSeeked = () => {
      if (actionFromRemoteRef.current) {
        actionFromRemoteRef.current = false;
        return;
      }
      sendAction('sync');
    };

    const handleWaiting = () => {
      // 视频正在缓冲，标记为加载中
      isLoadingRef.current = true;
      sendAction('sync'); // 立即发送暂停状态
    };

    const handleCanPlay = () => {
      // 视频可以播放了，清除加载标记
      isLoadingRef.current = false;
      sendAction('sync'); // 恢复正常状态
    };

    const handleSeeking = () => {
      // 拖动进度条时，标记为加载中
      isLoadingRef.current = true;
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('seeking', handleSeeking);

    // 每 2 秒自动同步一次状态（即使没有操作）
    const syncInterval = setInterval(() => {
      sendAction('sync');
    }, 2000);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('seeking', handleSeeking);
      clearInterval(syncInterval);
    };
  }, [isHost, isReady, onHostAction]);

  if (error) {
    return (
      <div style={{
        width: '100%',
        aspectRatio: '16/9',
        backgroundColor: '#111827',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#f87171',
        borderRadius: '12px'
      }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '1.125rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>播放器错误</p>
          <p style={{ fontSize: '0.875rem', opacity: 0.8 }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      backgroundColor: '#000',
      borderRadius: '12px',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <video
        ref={videoRef}
        controls={controls}
        playsInline
        style={{
          maxWidth: '100%',
          maxHeight: '75vh',
          display: 'block',
          margin: '0 auto'
        }}
      />
      {!isReady && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0,0,0,0.6)',
          color: 'white',
          zIndex: 5
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '32px', height: '32px', border: '3px solid #f3f3f3', borderTop: '3px solid #3498db',
              borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 10px'
            }} />
            <p>正在拉取视频流...</p>
          </div>
          <style>{`
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          `}</style>
        </div>
      )}
    </div>
  );
});

export default SyncPlayer;
