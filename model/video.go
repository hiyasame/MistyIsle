package model

import "time"

// VideoStatus 视频处理状态
type VideoStatus string

const (
	VideoStatusPending    VideoStatus = "pending"    // 等待处理
	VideoStatusProcessing VideoStatus = "processing" // 处理中
	VideoStatusReady      VideoStatus = "ready"      // 处理完成
	VideoStatusFailed     VideoStatus = "failed"     // 处理失败
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
	OriginalURL  string `json:"original_url" db:"original_url"`   // 原始文件路径（本地临时）
	OriginalSize int64  `json:"original_size" db:"original_size"` // 原始文件大小
	Duration     int    `json:"duration" db:"duration"`           // 视频时长（秒）

	// HLS 信息
	HLSURL string `json:"hls_url" db:"hls_url"` // HLS 播放地址

	// 错误信息
	ErrorMsg string `json:"error_msg,omitempty" db:"error_msg"`

	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// VideoUploadRequest 视频上传请求
type VideoUploadRequest struct {
	Title       string `json:"title" binding:"required,max=200"`
	Description string `json:"description" binding:"max=1000"`
}
