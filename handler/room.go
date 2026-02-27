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
		"room_id":      room.ID,
		"name":         room.Name,
		"desc":         room.Desc,
		"host_id":      room.HostID,
		"ws_url":       fmt.Sprintf("/ws/%s", room.ID),
		"stream_url":   room.StreamURL,  // 房主用来推流
		"stream_key":   room.StreamKey,  // 推流密钥
		"live_hls_url": room.LiveHLSURL, // 观众播放地址
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

	h.Success(c, gin.H{
		"room_id":      room.ID,
		"name":         room.Name,
		"status":       room.Status,
		"video_url":    room.VideoURL,
		"live_hls_url": room.LiveHLSURL,
		"host_id":      room.HostID,
		"player_count": len(players),
		"players":      players,
		"stream_url":   room.StreamURL,
		"stream_key":   room.StreamKey,
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
			h.Error(c, http.StatusBadRequest, err.Error())
			return
		}

		// 验证用户是房主
		if !hub.IsHost(roomID, userID) {
			h.Error(c, http.StatusForbidden, "only host can play video")
			return
		}

		// 查询视频 hls_url
		videoURL := h.Cfg.R2PublicURL + "/videos/" + req.VideoID + "/index.m3u8"

		// 更新房间状态
		hub.GetRoomService().PlayVideo(roomID, req.VideoID, req.VideoName, videoURL)

		// 通过 WebSocket 广播 change_video 给房间所有人
		data, _ := json.Marshal(map[string]interface{}{
			"video_id":   req.VideoID,
			"video_name": req.VideoName,
			"video_path": videoURL,
		})
		hub.BroadcastToRoom(roomID, "change_video", data, userID)

		h.Success(c, gin.H{
			"video_id":   req.VideoID,
			"video_name": req.VideoName,
			"video_url":  videoURL,
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
