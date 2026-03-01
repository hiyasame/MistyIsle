package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"misty-isle/model"
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

	// 创建房间，传入 SRS RTMP 地址
	srsRTMPURL := h.Cfg.SRSRTMPURL // 如: rtmp://localhost:1935
	room := h.RoomService.CreateRoom(model.RoomOptions{
		Name: req.Name,
		Desc: req.Desc,
	}, fmt.Sprintf("%d", userID), srsRTMPURL)

	h.Success(c, gin.H{
		"room_id":       room.ID,
		"name":          room.Name,
		"desc":          room.Desc,
		"host_id":       room.HostID,
		"ws_url":        fmt.Sprintf("/ws/%s", room.ID),
		"stream_url":    room.StreamURL, // Server URL: rtmp://.../live?key=SECRET
		"stream_key":    room.ID,        // Stream Key (OBS): ROOMID
		"live_hls_path": room.LiveHLSPath,
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

	// 获取当前请求的用户 ID
	currentUserIDUint, _ := c.Get("userID")
	currentUserID := fmt.Sprintf("%v", currentUserIDUint)

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

	// 只有房主才能看到推流信息
	if room.HostID == currentUserID {
		response["stream_url"] = room.StreamURL // rtmp://.../live?key=SECRET
		response["stream_key"] = room.ID        // ROOMID
	}

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

		// 验证用户是房主
		if !hub.IsHost(roomID, userID) {
			h.Error(c, http.StatusForbidden, "only host can play video")
			return
		}

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
