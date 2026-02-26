package service

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"misty-isle/db"
	"misty-isle/model"
	"misty-isle/utils"
)

// VideoProcessor 视频处理队列
type VideoProcessor struct {
	db      *db.DB
	r2      *utils.R2
	ffmpeg  *utils.FFmpeg
	queue   chan *VideoTask
	workers int
	wg      sync.WaitGroup
	stopCh  chan struct{}
}

// VideoTask 视频处理任务
type VideoTask struct {
	VideoID      uint64
	UserID       uint64
	OriginalPath string // 原始视频本地路径
	TempDir      string // 临时工作目录
	CreatedAt    time.Time
}

// NewVideoProcessor 创建视频处理器
func NewVideoProcessor(db *db.DB, r2 *utils.R2, workers int) *VideoProcessor {
	if workers <= 0 {
		workers = 2 // 默认2个并发 worker
	}

	return &VideoProcessor{
		db:      db,
		r2:      r2,
		ffmpeg:  utils.NewFFmpeg(),
		queue:   make(chan *VideoTask, 100), // 队列长度100
		workers: workers,
		stopCh:  make(chan struct{}),
	}
}

// Start 启动处理队列
func (vp *VideoProcessor) Start() {
	log.Printf("Starting video processor with %d workers", vp.workers)
	for i := 0; i < vp.workers; i++ {
		vp.wg.Add(1)
		go vp.worker(i)
	}
}

// Stop 停止处理队列
func (vp *VideoProcessor) Stop() {
	close(vp.stopCh)
	vp.wg.Wait()
	log.Println("Video processor stopped")
}

// Submit 提交视频处理任务
func (vp *VideoProcessor) Submit(videoID uint64, userID uint64, originalPath string) error {
	// 创建临时工作目录
	tempDir := filepath.Join(os.TempDir(), "misty-isle", "videos", fmt.Sprintf("%d", videoID))
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		return fmt.Errorf("create temp dir: %w", err)
	}

	task := &VideoTask{
		VideoID:      videoID,
		UserID:       userID,
		OriginalPath: originalPath,
		TempDir:      tempDir,
		CreatedAt:    time.Now(),
	}

	select {
	case vp.queue <- task:
		log.Printf("Video task submitted: videoID=%d", videoID)
		return nil
	default:
		return fmt.Errorf("video processor queue is full")
	}
}

// worker 处理任务的工作协程
func (vp *VideoProcessor) worker(id int) {
	defer vp.wg.Done()
	log.Printf("Video worker %d started", id)

	for {
		select {
		case task := <-vp.queue:
			if task == nil {
				return
			}
			vp.processTask(task)
		case <-vp.stopCh:
			return
		}
	}
}

// processTask 处理单个视频任务
func (vp *VideoProcessor) processTask(task *VideoTask) {
	log.Printf("Processing video: videoID=%d", task.VideoID)

	// 更新状态为处理中
	vp.updateVideoStatus(task.VideoID, model.VideoStatusProcessing, 0, "")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	// 1. 获取视频信息
	info, err := vp.ffmpeg.GetVideoInfo(ctx, task.OriginalPath)
	if err != nil {
		log.Printf("Failed to get video info: %v", err)
		vp.updateVideoStatus(task.VideoID, model.VideoStatusFailed, 0, "failed to get video info")
		vp.cleanup(task)
		return
	}
	_ = info

	// 2. 转换为 HLS
	opts := utils.HLSOptions{
		SegmentDuration: 10,
		OutputDir:       task.TempDir,
		VideoID:         fmt.Sprintf("%d", task.VideoID),
	}

	result, err := vp.ffmpeg.ConvertToHLS(ctx, task.OriginalPath, opts)
	if err != nil {
		log.Printf("Failed to convert to HLS: %v", err)
		vp.updateVideoStatus(task.VideoID, model.VideoStatusFailed, 0, "failed to convert to HLS")
		vp.cleanup(task)
		return
	}

	// 3. 上传切片到 R2
	hlsURL, err := vp.uploadToR2(ctx, task, result)
	if err != nil {
		log.Printf("Failed to upload to R2: %v", err)
		vp.updateVideoStatus(task.VideoID, model.VideoStatusFailed, 0, "failed to upload")
		vp.cleanup(task)
		return
	}

	// 4. 更新数据库为完成状态
	vp.updateVideoStatus(task.VideoID, model.VideoStatusReady, 100, hlsURL)
	log.Printf("Video processed successfully: videoID=%d, hlsURL=%s", task.VideoID, hlsURL)

	// 5. 清理临时文件
	vp.cleanup(task)
}

// uploadToR2 上传 HLS 文件到 R2
func (vp *VideoProcessor) uploadToR2(ctx context.Context, task *VideoTask, result *utils.HLSResult) (string, error) {
	basePath := fmt.Sprintf("videos/%d", task.VideoID)

	// 上传所有文件
	for _, filePath := range result.Files {
		data, err := os.ReadFile(filePath)
		if err != nil {
			return "", fmt.Errorf("read file %s: %w", filePath, err)
		}

		filename := filepath.Base(filePath)
		key := fmt.Sprintf("%s/%s", basePath, filename)

		contentType := "video/MP2T" // .ts 文件
		if filepath.Ext(filename) == ".m3u8" {
			contentType = "application/vnd.apple.mpegurl"
		}

		_, err = vp.r2.Upload(ctx, key, data, utils.UploadOptions{
			ContentType: contentType,
			PublicRead:  true,
		})
		if err != nil {
			return "", fmt.Errorf("upload %s: %w", key, err)
		}
	}

	// 返回 HLS 播放地址
	return fmt.Sprintf("%s/%s/index.m3u8", vp.r2.GetPublicURL(), basePath), nil
}

// updateVideoStatus 更新视频状态
func (vp *VideoProcessor) updateVideoStatus(videoID uint64, status model.VideoStatus, progress int, hlsURL string) {
	updates := map[string]interface{}{
		"status":   status,
		"progress": progress,
		"hls_url":  hlsURL,
	}

	if err := vp.db.UpdateVideo(videoID, updates); err != nil {
		log.Printf("Failed to update video status: %v", err)
	}
}

// cleanup 清理临时文件
func (vp *VideoProcessor) cleanup(task *VideoTask) {
	// 删除原始文件
	if err := os.Remove(task.OriginalPath); err != nil {
		log.Printf("Failed to remove original file: %v", err)
	}

	// 删除临时目录
	if err := vp.ffmpeg.Cleanup(task.TempDir); err != nil {
		log.Printf("Failed to cleanup temp dir: %v", err)
	}
}
