import { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { getPlayUrl } from '../utils/config';

/**
 * HLS 视频播放器
 */
export default function VideoPlayer({ hlsPath, poster, autoplay = false, controls = true }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);

  useEffect(() => {
    if (!hlsPath || !videoRef.current) return;

    const playUrl = getPlayUrl(hlsPath);
    const video = videoRef.current;

    // 检查浏览器是否支持 HLS.js
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90
      });

      hls.loadSource(playUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('HLS manifest loaded');
        if (autoplay) {
          video.play().catch(err => {
            console.warn('Autoplay failed:', err);
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
              console.error('Fatal error, cannot recover');
              hls.destroy();
              break;
          }
        }
      });

      hlsRef.current = hls;

      return () => {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari 原生支持 HLS
      video.src = playUrl;
      if (autoplay) {
        video.play().catch(err => {
          console.warn('Autoplay failed:', err);
        });
      }
    } else {
      console.error('HLS is not supported in this browser');
    }
  }, [hlsPath, autoplay]);

  if (!hlsPath) {
    return (
      <div className="video-placeholder">
        <p>视频尚未准备好</p>
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      controls={controls}
      poster={poster}
      style={{ width: '100%', maxHeight: '500px', backgroundColor: '#000' }}
    />
  );
}
