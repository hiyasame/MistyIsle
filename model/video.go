package model

import "time"

// VideoStatus 视频处理状态
type VideoStatus string

const (
	VideoStatusPending     VideoStatus = "pending"        // 等待用户上传
	VideoStatusUploaded    VideoStatus = "user_upload"    // 用户已上传到R2
	VideoStatusDownloading VideoStatus = "modal_download" // Modal 正在下载
	VideoStatusSlicing     VideoStatus = "modal_slice"    // Modal 正在切片
	VideoStatusM3U8Ready   VideoStatus = "m3u8_prepared"  // M3U8 已准备好
	VideoStatusUploading   VideoStatus = "modal_upload"   // Modal 正在上传切片
	VideoStatusReady       VideoStatus = "ready"          // 处理完成
	VideoStatusFailed      VideoStatus = "failed"         // 处理失败
)

// Video 视频模型
type Video struct {
	ID          uint64      `json:"video_id" db:"id"`
	UserID      uint64      `json:"user_id" db:"user_id"`
	Title       string      `json:"title" db:"title"`
	Description string      `json:"description" db:"description"`
	Status      VideoStatus `json:"status" db:"status"`
	Progress    int         `json:"progress" db:"progress"` // 0-100

	// 原始文件信息
	R2RawKey     string `json:"r2_raw_key" db:"r2_raw_key"`       // R2 原始文件路径 (uploads/raw/{video_id}.mp4)
	OriginalSize int64  `json:"original_size" db:"original_size"` // 原始文件大小
	Duration     int    `json:"duration" db:"duration"`           // 视频时长（秒）

	// HLS 信息
	HLSPath string `json:"hls_path" db:"hls_path"` // HLS 相对路径 (videos/{id}/index.m3u8)

	// 错误信息
	ErrorMsg string `json:"error_msg,omitempty" db:"error_msg"`

	// 过期时间
	ExpiresAt time.Time `json:"expires_at" db:"expires_at"` // 3天后过期

	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// IsExpired 判断视频是否过期
func (v *Video) IsExpired() bool {
	return !v.ExpiresAt.IsZero() && time.Now().After(v.ExpiresAt)
}

// VideoUploadRequest 视频上传请求
type VideoUploadRequest struct {
	Title       string `json:"title" binding:"required,max=200"`
	Description string `json:"description" binding:"max=1000"`
}
