package handler

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"misty-isle/model"

	"github.com/gin-gonic/gin"
)

// VideoUpload 上传视频（直接上传到服务器，然后异步处理）
func (h *Handler) VideoUpload(c *gin.Context) {
	userID := c.GetUint64("userID")

	// 获取表单数据
	title := c.PostForm("title")
	description := c.PostForm("description")
	if title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title is required"})
		return
	}

	// 获取上传的文件
	file, header, err := c.Request.FormFile("video")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no video file"})
		return
	}
	defer file.Close()

	// 检查文件大小（最大 10GB）
	if header.Size > 10*1024*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file too large (max 10GB)"})
		return
	}

	// 创建临时目录
	tempDir := filepath.Join(os.TempDir(), "misty-isle", "uploads", fmt.Sprintf("%d", userID))
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create temp dir"})
		return
	}

	// 保存原始文件
	tempFile := filepath.Join(tempDir, fmt.Sprintf("%d_%d%s", userID, time.Now().Unix(), filepath.Ext(header.Filename)))
	out, err := os.Create(tempFile)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create file"})
		return
	}

	if _, err := io.Copy(out, file); err != nil {
		out.Close()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
		return
	}
	out.Close()

	// 创建视频记录
	video := &model.Video{
		UserID:       userID,
		Title:        title,
		Description:  description,
		Status:       model.VideoStatusPending,
		OriginalURL:  tempFile,
		OriginalSize: header.Size,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	if err := h.DB.CreateVideo(video); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create video record"})
		return
	}

	// 提交到处理队列
	if err := h.VideoProcessor.Submit(video.ID, userID, tempFile); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to submit video task"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"video_id": video.ID,
			"status":   video.Status,
		},
	})
}

// VideoList 视频列表（仅当前用户）
func (h *Handler) VideoList(c *gin.Context) {
	userID := c.GetUint64("userID")

	videos, err := h.DB.GetVideosByUserID(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get videos"})
		return
	}

	list := make([]gin.H, len(videos))
	for i, v := range videos {
		list[i] = gin.H{
			"video_id":   v.ID,
			"title":      v.Title,
			"status":     v.Status,
			"progress":   v.Progress,
			"duration":   v.Duration,
			"hls_url":    v.HLSURL,
			"created_at": v.CreatedAt,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"list": list,
		},
	})
}

// VideoGet 获取视频详情（仅当前用户）
func (h *Handler) VideoGet(c *gin.Context) {
	userID := c.GetUint64("userID")
	videoID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video id"})
		return
	}

	video, err := h.DB.GetVideoByID(videoID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "video not found"})
		return
	}

	// 检查权限
	if video.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"video_id":    video.ID,
			"title":       video.Title,
			"description": video.Description,
			"status":      video.Status,
			"progress":    video.Progress,
			"duration":    video.Duration,
			"hls_url":     video.HLSURL,
			"error_msg":   video.ErrorMsg,
			"created_at":  video.CreatedAt,
		},
	})
}

// VideoStatus 查询处理状态（仅当前用户）
func (h *Handler) VideoStatus(c *gin.Context) {
	userID := c.GetUint64("userID")
	videoID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid video id"})
		return
	}

	video, err := h.DB.GetVideoByID(videoID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "video not found"})
		return
	}

	// 检查权限
	if video.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"video_id":  video.ID,
			"status":    video.Status,
			"progress":  video.Progress,
			"hls_url":   video.HLSURL,
			"error_msg": video.ErrorMsg,
		},
	})
}
