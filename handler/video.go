package handler

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"misty-isle/cfg"
	"misty-isle/model"
	"misty-isle/utils"

	"github.com/gin-gonic/gin"
)

// VideoInit 初始化视频上传（返回预签名 URL）
func (h *Handler) VideoInit(c *gin.Context) {
	userID := c.GetUint64("userID")

	// 获取请求参数
	var req struct {
		Title       string `json:"title" binding:"required,max=200"`
		Description string `json:"description" binding:"max=1000"`
		FileSize    int64  `json:"file_size" binding:"required,gt=0"`
		FileExt     string `json:"file_ext" binding:"required,oneof=.mp4 .mov .avi .mkv .flv .webm"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		h.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	// 检查文件大小（最大 10GB）
	if req.FileSize > 10*1024*1024*1024 {
		h.Error(c, http.StatusBadRequest, "file too large (max 10GB)")
		return
	}

	// 创建视频记录（设置3天后过期）
	now := time.Now()
	video := &model.Video{
		UserID:       userID,
		Title:        req.Title,
		Description:  req.Description,
		Status:       model.VideoStatusPending,
		OriginalSize: req.FileSize,
		ExpiresAt:    now.Add(3 * 24 * time.Hour), // 3天后过期
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	if err := h.DB.CreateVideo(video); err != nil {
		h.Error(c, http.StatusInternalServerError, "failed to create video record")
		return
	}

	// 生成 R2 存储路径
	r2Key := fmt.Sprintf("uploads/raw/%d%s", video.ID, req.FileExt)
	video.R2RawKey = r2Key

	// 更新 r2_raw_key
	if err := h.DB.UpdateVideo(video.ID, map[string]interface{}{
		"r2_raw_key": r2Key,
	}); err != nil {
		h.Error(c, http.StatusInternalServerError, "failed to update video")
		return
	}

	// 生成预签名上传 URL（15分钟有效期）
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	presignedURL, err := h.R2.PresignUpload(ctx, r2Key, 15*time.Minute, utils.UploadOptions{
		ContentType: getContentType(req.FileExt),
		PublicRead:  false,              // 原始文件不公开
		ExpireAfter: 3 * 24 * time.Hour, // 3天后过期
	})

	if err != nil {
		h.Error(c, http.StatusInternalServerError, "failed to generate presigned URL")
		return
	}

	h.Success(c, gin.H{
		"video_id":      video.ID,
		"presigned_url": presignedURL,
		"r2_key":        r2Key,
		"expires_in":    900, // 15分钟 = 900秒
	})
}

// getContentType 根据文件扩展名返回 Content-Type
func getContentType(ext string) string {
	contentTypes := map[string]string{
		".mp4":  "video/mp4",
		".mov":  "video/quicktime",
		".avi":  "video/x-msvideo",
		".mkv":  "video/x-matroska",
		".flv":  "video/x-flv",
		".webm": "video/webm",
	}
	if ct, ok := contentTypes[ext]; ok {
		return ct
	}
	return "video/mp4"
}

// VideoList 视频列表（返回所有未过期视频）
func (h *Handler) VideoList(c *gin.Context) {
	videos, err := h.DB.GetAllVideos()
	if err != nil {
		h.Error(c, http.StatusInternalServerError, "failed to get videos")
		return
	}

	list := make([]gin.H, len(videos))
	for i, v := range videos {
		list[i] = gin.H{
			"video_id":    v.ID,
			"title":       v.Title,
			"description": v.Description,
			"status":      v.Status,
			"progress":    v.Progress,
			"duration":    v.Duration,
			"hls_path":    v.HLSPath,
			"expires_at":  v.ExpiresAt,
			"created_at":  v.CreatedAt,
		}
	}

	h.Success(c, gin.H{
		"list": list,
	})
}

// VideoGet 获取视频详情（仅当前用户）
func (h *Handler) VideoGet(c *gin.Context) {
	userID := c.GetUint64("userID")
	videoID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		h.Error(c, http.StatusBadRequest, "invalid video id")
		return
	}

	video, err := h.DB.GetVideoByID(videoID)
	if err != nil {
		h.Error(c, http.StatusNotFound, "video not found")
		return
	}

	// 检查权限
	if video.UserID != userID {
		h.Error(c, http.StatusForbidden, "access denied")
		return
	}

	h.Success(c, gin.H{
		"video_id":    video.ID,
		"title":       video.Title,
		"description": video.Description,
		"status":      video.Status,
		"progress":    video.Progress,
		"duration":    video.Duration,
		"hls_path":    video.HLSPath,
		"r2_raw_key":  video.R2RawKey,
		"expires_at":  video.ExpiresAt,
		"error_msg":   video.ErrorMsg,
		"created_at":  video.CreatedAt,
	})
}

// VideoProcess 触发视频处理（前端上传完成后调用）
func (h *Handler) VideoProcess(c *gin.Context) {
	userID := c.GetUint64("userID")

	// 获取请求参数
	var req struct {
		VideoID uint64 `json:"video_id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		h.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	// 查询视频记录
	video, err := h.DB.GetVideoByID(req.VideoID)
	if err != nil {
		h.Error(c, http.StatusNotFound, "video not found")
		return
	}

	// 检查权限
	if video.UserID != userID {
		h.Error(c, http.StatusForbidden, "access denied")
		return
	}

	// 检查状态
	if video.Status != model.VideoStatusPending {
		h.Error(c, http.StatusBadRequest, fmt.Sprintf("video status is %s, cannot process", video.Status))
		return
	}

	// 检查是否已设置 R2 路径
	if video.R2RawKey == "" {
		h.Error(c, http.StatusBadRequest, "video not uploaded to R2 yet")
		return
	}

	// 创建 Modal 客户端
	modalClient := utils.NewModalClient(h.Cfg.ModalEndpoint, h.Cfg.ModalToken)

	// 构建 webhook URL（用于接收 Modal 回调）
	webhookURL := fmt.Sprintf("%s/api/v1/video/webhook", getBaseURL(c, h.Cfg))

	// 触发 Modal 处理
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	modalResp, err := modalClient.TriggerVideoProcess(ctx, utils.ProcessVideoRequest{
		VideoID:    fmt.Sprintf("%d", video.ID),
		WebhookURL: webhookURL,
	})

	if err != nil {
		h.Error(c, http.StatusInternalServerError, fmt.Sprintf("failed to trigger modal: %v", err))
		return
	}

	// 更新视频状态为用户已上传
	if err := h.DB.UpdateVideo(video.ID, map[string]interface{}{
		"status": model.VideoStatusUploaded,
	}); err != nil {
		h.Error(c, http.StatusInternalServerError, "failed to update video status")
		return
	}

	h.Success(c, gin.H{
		"video_id":      video.ID,
		"status":        model.VideoStatusUploaded,
		"modal_status":  modalResp.Status,
		"modal_message": modalResp.Message,
	})
}

// getBaseURL 获取基础 URL
func getBaseURL(c *gin.Context, cfg *cfg.Config) string {
	// 优先使用配置的前端地址
	if cfg.FrontendURL != "" {
		return cfg.FrontendURL
	}

	// 否则从请求中推断
	scheme := "http"
	if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s", scheme, c.Request.Host)
}

// VideoWebhook Modal 处理进度/完成回调（无需认证）
func (h *Handler) VideoWebhook(c *gin.Context) {
	var req struct {
		VideoID          string  `json:"video_id" binding:"required"`
		Status           string  `json:"status" binding:"required"` // modal_download, modal_slice, m3u8_prepared, modal_upload, ready, failed
		Progress         int     `json:"progress"`                  // 0-100
		PlaylistPath     string  `json:"playlist_path"`             // HLS 相对路径 (videos/{id}/index.m3u8)
		SegmentsCount    int     `json:"segments_count"`
		SegmentsUploaded int     `json:"segments_uploaded"` // modal_upload 阶段使用
		SegmentsTotal    int     `json:"segments_total"`    // modal_upload 阶段使用
		ProcessingTime   float64 `json:"processing_time"`
		Error            string  `json:"error"`
		Message          string  `json:"message"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		h.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	// 解析视频 ID
	videoID, err := strconv.ParseUint(req.VideoID, 10, 64)
	if err != nil {
		h.Error(c, http.StatusBadRequest, "invalid video_id")
		return
	}

	// 查询视频记录
	video, err := h.DB.GetVideoByID(videoID)
	if err != nil {
		h.Error(c, http.StatusNotFound, "video not found")
		return
	}

	// 构建更新字段
	updates := make(map[string]interface{})

	// 根据状态更新
	switch req.Status {
	case "modal_download":
		updates["status"] = model.VideoStatusDownloading
		if req.Progress > 0 {
			updates["progress"] = req.Progress
		}

	case "modal_slice":
		updates["status"] = model.VideoStatusSlicing
		if req.Progress > 0 {
			updates["progress"] = req.Progress
		}

	case "m3u8_prepared":
		updates["status"] = model.VideoStatusM3U8Ready
		if req.Progress > 0 {
			updates["progress"] = req.Progress
		}
		if req.PlaylistPath != "" {
			updates["hls_path"] = req.PlaylistPath
		}

	case "modal_upload":
		updates["status"] = model.VideoStatusUploading
		if req.Progress > 0 {
			updates["progress"] = req.Progress
		}

	case "ready":
		updates["status"] = model.VideoStatusReady
		updates["progress"] = 100
		if req.PlaylistPath != "" {
			updates["hls_path"] = req.PlaylistPath
		}

	case "failed":
		updates["status"] = model.VideoStatusFailed
		updates["progress"] = 0
		if req.Error != "" {
			updates["error_msg"] = req.Error
		}

	default:
		h.Error(c, http.StatusBadRequest, fmt.Sprintf("invalid status: %s", req.Status))
		return
	}

	// 更新数据库
	if err := h.DB.UpdateVideo(videoID, updates); err != nil {
		h.Error(c, http.StatusInternalServerError, "failed to update video")
		return
	}

	// 通过 WebSocket 通知用户
	if h.WSHub != nil {
		h.WSHub.NotifyUser(fmt.Sprintf("%d", video.UserID), "video_status", gin.H{
			"video_id":          video.ID,
			"status":            req.Status,
			"progress":          req.Progress,
			"playlist_path":     req.PlaylistPath,
			"segments_uploaded": req.SegmentsUploaded,
			"segments_total":    req.SegmentsTotal,
			"message":           req.Message,
		})
	}

	h.Success(c, gin.H{
		"message":  "webhook received",
		"video_id": video.ID,
		"status":   req.Status,
		"progress": req.Progress,
	})
}

// VideoStatus 查询处理状态（仅当前用户）
func (h *Handler) VideoStatus(c *gin.Context) {
	userID := c.GetUint64("userID")
	videoID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		h.Error(c, http.StatusBadRequest, "invalid video id")
		return
	}

	video, err := h.DB.GetVideoByID(videoID)
	if err != nil {
		h.Error(c, http.StatusNotFound, "video not found")
		return
	}

	// 检查权限
	if video.UserID != userID {
		h.Error(c, http.StatusForbidden, "access denied")
		return
	}

	h.Success(c, gin.H{
		"video_id":   video.ID,
		"status":     video.Status,
		"progress":   video.Progress,
		"hls_path":   video.HLSPath,
		"expires_at": video.ExpiresAt,
		"error_msg":  video.ErrorMsg,
	})
}
