import { useState, useRef } from 'react';
import { videoApi } from '../services/api';

interface VideoUploaderProps {
  onUploadComplete?: (video: any) => void;
}

/**
 * 视频上传组件
 */
export default function VideoUploader({ onUploadComplete }: VideoUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState({
    title: '',
    description: ''
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    const validTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/x-flv', 'video/webm'];
    if (!validTypes.includes(file.type)) {
      setError('不支持的视频格式，请上传 MP4/MOV/AVI/MKV/FLV/WEBM 格式');
      return;
    }

    // 验证文件大小（最大10GB）
    if (file.size > 10 * 1024 * 1024 * 1024) {
      setError('文件过大，最大支持 10GB');
      return;
    }

    setUploading(true);
    setError(null);
    setUploadProgress(0);

    try {
      // 1. 初始化上传
      console.log('Initializing upload...');
      const initRes = await videoApi.init({
        title: formData.title || file.name,
        size: file.size,
        mime_type: file.type
      });

      if (initRes.code !== 0) {
        throw new Error(initRes.error || 'Failed to initialize upload');
      }

      const { video_id, presigned_url } = initRes.data;
      console.log('Upload initialized, video_id:', video_id);

      // 2. 上传到 R2
      console.log('Uploading to R2...');
      await videoApi.uploadToR2(presigned_url, file, (progress) => {
        setUploadProgress(progress);
      });

      console.log('Upload to R2 completed');

      // 3. 触发处理
      console.log('Triggering processing...');
      const processRes = await videoApi.process(video_id);

      if (processRes.code !== 0) {
        throw new Error(processRes.error || 'Failed to trigger processing');
      }

      console.log('Processing triggered successfully');

      // 重置表单
      setFormData({ title: '', description: '' });
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // 通知父组件
      onUploadComplete && onUploadComplete({
        video_id,
        title: formData.title || file.name,
        status: 'user_upload',
        progress: 5
      });

    } catch (err) {
      console.error('Upload failed:', err);
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="video-uploader">
      <h2>上传视频</h2>

      {error && (
        <div className="error-message" style={{ color: '#ef4444', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      <div className="form-group">
        <label>标题</label>
        <input
          type="text"
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          placeholder="视频标题（可选）"
          disabled={uploading}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '1rem' }}
        />
      </div>

      <div className="form-group">
        <label>描述</label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="视频描述（可选）"
          disabled={uploading}
          rows={3}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '1rem' }}
        />
      </div>

      <div className="form-group">
        <label>选择视频文件</label>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/x-flv,video/webm"
          onChange={handleFileSelect}
          disabled={uploading}
          style={{ marginTop: '0.5rem' }}
        />
        <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '0.5rem' }}>
          支持格式: MP4, MOV, AVI, MKV, FLV, WEBM (最大 10GB)
        </p>
      </div>

      {uploading && (
        <div className="upload-progress" style={{ marginTop: '1rem' }}>
          <div style={{ marginBottom: '0.5rem' }}>
            上传中: {uploadProgress}%
          </div>
          <div style={{ width: '100%', height: '20px', backgroundColor: '#e5e7eb', borderRadius: '10px', overflow: 'hidden' }}>
            <div
              style={{
                width: `${uploadProgress}%`,
                height: '100%',
                backgroundColor: '#3b82f6',
                transition: 'width 0.3s ease'
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
