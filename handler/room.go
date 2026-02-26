package handler

import (
	"encoding/json"
	"fmt"
	"net/http"

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
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 创建房间，传入 SRS RTMP 地址
	srsRTMPURL := h.Cfg.SRSRTMPURL // 如: rtmp://localhost:1935
	room := h.RoomService.CreateRoom(model.RoomOptions{
		Name: req.Name,
		Desc: req.Desc,
	}, fmt.Sprintf("%d", userID), srsRTMPURL)

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"room_id":      room.ID,
			"name":         room.Name,
			"desc":         room.Desc,
			"host_id":      room.HostID,
			"ws_url":       fmt.Sprintf("/ws/%s", room.ID),
			"stream_url":   room.StreamURL,  // 房主用来推流
			"stream_key":   room.StreamKey,  // 推流密钥
			"live_hls_url": room.LiveHLSURL, // 观众播放地址
		},
	})
}

// RoomList 房间列表
func (h *Handler) RoomList(c *gin.Context) {
	// 使用 h.db 查询房间列表
	rooms := h.RoomService.ListRoom()
	list := make([]gin.H, len(rooms))
	for i, room := range rooms {
		list[i] = gin.H{
			"room_id": room.ID,
			"name":    room.Name,
			"desc":    room.Desc,
			"host_id": room.HostID,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"list": list,
		},
	})
}

// RoomGet 获取房间信息
func (h *Handler) RoomGet(c *gin.Context) {
	roomID := c.Param("id")

	room, ok := h.RoomService.GetRoom(roomID)
	players := h.RoomService.GetRoomUsers(roomID)
	if !ok {
		c.JSON(http.StatusOK, gin.H{
			"code":  http.StatusNotFound,
			"error": "Room not found",
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"room_id":      room.ID,
			"name":         room.Name,
			"status":       room.Status,
			"video_url":    room.VideoURL,
			"live_hls_url": room.LiveHLSURL,
			"host_id":      room.HostID,
			"player_count": len(players),
			"players":      players,
		},
	})
}

// RoomPlayVideo 播放指定视频（房主调用）
func (h *Handler) RoomPlayVideo(hub *websocket.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("userID")
		roomID := c.Param("id")

		var req struct {
			VideoID   string `json:"video_id" binding:"required"`
			VideoName string `json:"video_name"` // 视频名称，可选
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// 验证用户是房主
		if !hub.IsHost(roomID, userID) {
			c.JSON(http.StatusForbidden, gin.H{"error": "only host can play video"})
			return
		}

		// TODO: 查询视频 hls_url
		videoURL := "https://cdn.example.com/hls/" + req.VideoID + "/index.m3u8"

		// 更新房间状态
		hub.GetRoomService().PlayVideo(roomID, req.VideoID, req.VideoName, videoURL)

		// 通过 WebSocket 广播 change_video 给房间所有人
		data, _ := json.Marshal(map[string]interface{}{
			"video_id":   req.VideoID,
			"video_name": req.VideoName,
			"video_url":  videoURL,
		})
		hub.BroadcastToRoom(roomID, "change_video", data, userID)

		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"data": gin.H{
				"video_id":   req.VideoID,
				"video_name": req.VideoName,
				"video_url":  videoURL,
			},
		})
	}
}

// RoomTransferHost 移交房主权限
func (h *Handler) RoomTransferHost(hub *websocket.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetString("userID")
		roomID := c.Param("id")

		var req struct {
			NewHostID string `json:"new_host_id" binding:"required"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// 不能转让给自己
		if userID == req.NewHostID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot transfer to yourself"})
			return
		}

		// 执行移交
		if !hub.TransferHost(roomID, userID, req.NewHostID) {
			c.JSON(http.StatusForbidden, gin.H{"error": "transfer failed, check if you are host and target user is in room"})
			return
		}

		// 广播房主变更
		data, _ := json.Marshal(map[string]interface{}{
			"old_host_id": userID,
			"new_host_id": req.NewHostID,
		})
		hub.BroadcastToRoom(roomID, "host_changed", data, userID)

		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"data": gin.H{
				"new_host_id": req.NewHostID,
			},
		})
	}
}
