package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"misty-isle/model"
	"misty-isle/utils"
	"misty-isle/websocket"

	"github.com/gin-gonic/gin"
)

// RoomCreate 创建房间
func (h *Handler) RoomCreate(c *gin.Context) {
	userID := c.GetUint64("userID")

	var req struct {
		Name string `json:"name" binding:"required"`
		Desc string `json:"description"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		h.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	// 创建房间
	room := h.RoomService.CreateRoom(model.RoomOptions{
		Name: req.Name,
		Desc: req.Desc,
	}, fmt.Sprintf("%d", userID))

	h.Success(c, gin.H{
		"room_id":       room.ID,
		"name":          room.Name,
		"desc":          room.Desc,
		"host_id":       room.HostID,
		"ws_url":        fmt.Sprintf("/ws/%s", room.ID),
		"stream_path":   room.StreamPath,  // 推流相对路径: /live?key=SECRET（前端拼接 RTMP base URL）
		"stream_key":    room.ID,          // Stream Key (OBS): ROOMID
		"live_hls_path": room.LiveHLSPath, // 直播播放相对路径（前端拼接 HTTP base URL）
	})
}

// RoomList 房间列表
func (h *Handler) RoomList(c *gin.Context) {
	rooms := h.RoomService.ListRoomWithUsers()

	h.Success(c, gin.H{
		"list": rooms,
	})
}

// RoomGet 获取房间信息
func (h *Handler) RoomGet(c *gin.Context) {
	roomID := c.Param("id")

	room, ok := h.RoomService.GetRoom(roomID)
	if !ok {
		h.Error(c, http.StatusNotFound, "Room not found")
		return
	}

	players := h.RoomService.GetRoomUsers(roomID)

	response := gin.H{
		"room_id":      room.ID,
		"name":         room.Name,
		"desc":         room.Desc,
		"status":       room.Status,
		"host_id":      room.HostID,
		"player_count": len(players),
		"players":      players,
	}

	// 状态和视频信息
	response["status"] = room.Status

	// 推流信息所有人可见
	response["stream_path"] = room.StreamPath // /live?key=SECRET
	response["stream_key"] = room.ID          // ROOMID

	// 如果正在播放视频或直播，返回统一的 current_video 结构
	if room.Status == model.RoomStatusPlayingVOD && room.VideoPath != "" {
		response["current_video"] = gin.H{
			"video_id":   room.VideoID,
			"title":      room.VideoName,
			"hls_path":   room.VideoPath,
			"status":     "ready", // VOD 正在播放说明已就绪
			"is_live":    false,
			"progress":   100,
			"duration":   0,
			"created_at": time.Now().Format(time.RFC3339),
		}
	} else if room.Status == model.RoomStatusPlayingLive {
		response["current_video"] = gin.H{
			"video_id":   "live",
			"title":      "直播中",
			"hls_path":   room.LiveHLSPath, // /live/ROOMID.flv
			"status":     "ready",
			"is_live":    true,
			"progress":   100,
			"created_at": time.Now().Format(time.RFC3339),
		}
	}

	h.Success(c, response)
}

// RoomPlayVideo 播放指定视频（房主调用）
func (h *Handler) RoomPlayVideo(hub *websocket.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		userIDUint := c.GetUint64("userID")
		userID := fmt.Sprintf("%d", userIDUint)
		roomID := c.Param("id")

		var req struct {
			VideoID string `json:"video_id" binding:"required"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			h.Error(c, http.StatusBadRequest, err.Error())
			return
		}

		// 任何人都可以选择视频播放（移除房主限制）

		// 从数据库获取真实视频信息，获取正确的 m3u8 路径
		videoIDUint, _ := strconv.ParseUint(req.VideoID, 10, 64)
		video, err := h.DB.GetVideoByID(videoIDUint)
		if err != nil {
			h.Error(c, http.StatusNotFound, "video not found in database")
			return
		}

		// 确保路径以 / 开头，符合前端 getPlayUrl 处理逻辑
		videoPath := video.HLSPath
		if videoPath != "" && videoPath[0] != '/' {
			videoPath = "/" + videoPath
		}

		// 更新房间状态
		hub.GetRoomService().PlayVideo(roomID, fmt.Sprintf("%d", video.ID), video.Title, videoPath)

		// 通过 WebSocket 广播 change_video 给房间所有人
		videoData := gin.H{
			"video_id": fmt.Sprintf("%d", video.ID),
			"title":    video.Title,
			"hls_path": videoPath,
			"status":   "playing", // 播放视频时，状态为 playing
			"is_live":  false,
		}
		data, _ := json.Marshal(gin.H{
			"video": videoData,
		})
		hub.BroadcastToRoom(roomID, "change_video", data, userID)

		h.Success(c, gin.H{
			"video": videoData,
		})
	}
}

// RoomDelete 删除房间（仅当房间无人时允许删除）
func (h *Handler) RoomDelete(hub *websocket.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		roomID := c.Param("id")

		// 检查房间是否存在
		_, ok := hub.GetRoomService().GetRoom(roomID)
		if !ok {
			h.Error(c, http.StatusNotFound, "room not found")
			return
		}

		// 检查房间是否为空（无在线用户）
		users := hub.GetRoomService().GetRoomUsers(roomID)
		if len(users) > 0 {
			h.Error(c, http.StatusForbidden, "cannot delete room with active users")
			return
		}

		// 删除房间
		hub.GetRoomService().DeleteRoom(roomID)
		log.Printf("[RoomDelete] Room %s deleted", roomID)

		h.Success(c, gin.H{
			"message": "room deleted successfully",
		})
	}
}

// RoomChatHistory 获取房间聊天历史
func (h *Handler) RoomChatHistory(c *gin.Context) {
	roomID := c.Param("id")

	limitStr := c.DefaultQuery("limit", "50")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 || limit > 100 {
		limit = 50
	}

	msgs, err := h.ChatDB.GetRecentChatMessages(roomID, limit)
	if err != nil {
		h.Error(c, http.StatusInternalServerError, "failed to get chat history")
		return
	}

	type replyTo struct {
		ID       string `json:"id"`
		Username string `json:"username"`
		Content  string `json:"content"`
		ImageURL string `json:"image_url,omitempty"`
	}
	type chatMsgResp struct {
		ID        string   `json:"id"`
		RoomID    string   `json:"room_id"`
		UserID    string   `json:"user_id"`
		Username  string   `json:"username"`
		Avatar    string   `json:"avatar,omitempty"`
		Content   string   `json:"content"`
		ImageURL  string   `json:"image_url,omitempty"`
		ReplyTo   *replyTo `json:"reply_to,omitempty"`
		Mentions  []string `json:"mentions"`
		CreatedAt string   `json:"created_at"`
	}

	result := make([]chatMsgResp, 0, len(msgs))
	for _, msg := range msgs {
		item := chatMsgResp{
			ID:        fmt.Sprintf("%d", msg.ID),
			RoomID:    msg.RoomID,
			UserID:    fmt.Sprintf("%d", msg.UserID),
			Username:  msg.Username,
			Avatar:    msg.Avatar,
			Content:   msg.Content,
			ImageURL:  msg.ImageURL,
			Mentions:  msg.Mentions,
			CreatedAt: msg.CreatedAt.Format(time.RFC3339),
		}
		if msg.ReplyToID != nil {
			item.ReplyTo = &replyTo{
				ID:       fmt.Sprintf("%d", *msg.ReplyToID),
				Username: msg.ReplyToUsername,
				Content:  msg.ReplyToContent,
				ImageURL: msg.ReplyToImageURL,
			}
		}
		result = append(result, item)
	}

	h.Success(c, gin.H{"messages": result})
}

// RoomChatUploadImage 上传聊天图片到 R2
func (h *Handler) RoomChatUploadImage(c *gin.Context) {
	roomID := c.Param("id")

	file, header, err := c.Request.FormFile("image")
	if err != nil {
		h.Error(c, http.StatusBadRequest, "missing image file")
		return
	}
	defer file.Close()

	// 限制文件大小 10MB
	if header.Size > 10*1024*1024 {
		h.Error(c, http.StatusBadRequest, "image too large (max 10MB)")
		return
	}

	// 检查文件类型
	contentType := header.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") {
		h.Error(c, http.StatusBadRequest, "file must be an image")
		return
	}

	data, err := io.ReadAll(file)
	if err != nil {
		h.Error(c, http.StatusInternalServerError, "failed to read file")
		return
	}

	// 生成 R2 key
	ext := ""
	if idx := strings.LastIndex(header.Filename, "."); idx >= 0 {
		ext = header.Filename[idx:]
	}
	key := fmt.Sprintf("chat/%s/%d%s", roomID, time.Now().UnixMilli(), ext)

	result, err := h.R2.Upload(c.Request.Context(), key, data, utils.UploadOptions{
		ContentType: contentType,
	})
	if err != nil {
		log.Printf("[RoomChatUploadImage] R2 upload failed: %v", err)
		h.Error(c, http.StatusInternalServerError, "upload failed")
		return
	}

	h.Success(c, gin.H{"url": result.URL})
}

// RoomTransferHost 移交房主权限
func (h *Handler) RoomTransferHost(hub *websocket.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		userIDUint := c.GetUint64("userID")
		userID := fmt.Sprintf("%d", userIDUint)
		roomID := c.Param("id")

		var req struct {
			NewHostID string `json:"new_host_id" binding:"required"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			h.Error(c, http.StatusBadRequest, err.Error())
			return
		}

		// 不能转让给自己
		if userID == req.NewHostID {
			h.Error(c, http.StatusBadRequest, "cannot transfer to yourself")
			return
		}

		// 执行移交
		if !hub.TransferHost(roomID, userID, req.NewHostID) {
			h.Error(c, http.StatusForbidden, "transfer failed, check if you are host and target user is in room")
			return
		}

		// 广播房主变更
		data, _ := json.Marshal(map[string]interface{}{
			"old_host_id": userID,
			"new_host_id": req.NewHostID,
		})
		hub.BroadcastToRoom(roomID, "host_changed", data, userID)

		h.Success(c, gin.H{
			"new_host_id": req.NewHostID,
		})
	}
}
