package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strings"

	"misty-isle/websocket"

	"github.com/gin-gonic/gin"
)

// SRSCallback 接收 SRS 事件回调
func (h *Handler) SRSCallback(hub *websocket.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Action   string `json:"action"` // on_publish, on_unpublish, on_hls
			ClientID string `json:"client_id"`
			IP       string `json:"ip"`
			Vhost    string `json:"vhost"`
			App      string `json:"app"`    // 应用名，如 live 或 live/ROOMID
			Stream   string `json:"stream"` // 流名
			Param    string `json:"param"`  // URL 参数
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			h.Error(c, http.StatusBadRequest, err.Error())
			return
		}

		log.Printf("[SRS Callback] action=%s app=%s stream=%s param=%s client_id=%s ip=%s",
			req.Action, req.App, req.Stream, req.Param, req.ClientID, req.IP)

		// 解析 roomID 和 streamKey，支持两种推流 URL 格式：
		//
		// 格式 1 (OBS): Server=rtmp://host/live/ROOMID, Key=streamkey
		//   → app="live/ROOMID", stream="streamkey", param=""
		//
		// 格式 2 (ffmpeg): rtmp://host/live/ROOMID?key=streamkey
		//   → app="live", stream="ROOMID", param="?key=streamkey"
		var roomID, streamKey string
		appParts := strings.Split(req.App, "/")
		if len(appParts) >= 2 && appParts[len(appParts)-1] != "" {
			// 格式 1: roomID 在 app 路径中，stream 就是推流密钥
			roomID = appParts[len(appParts)-1]
			streamKey = req.Stream
		} else {
			// 格式 2: roomID 是 stream，推流密钥在 param 中
			roomID = req.Stream
			streamKey = parseStreamKey(req.Param)
		}

		log.Printf("[SRS Callback] parsed roomID=%s streamKey=%s", roomID, streamKey)

		// 处理不同事件
		switch req.Action {
		case "on_publish":
			// 开始推流，验证推流密钥
			room, ok := hub.GetRoomService().GetRoom(roomID)
			if !ok {
				log.Printf("[SRS Callback] room not found: roomID=%s", roomID)
				h.Error(c, http.StatusForbidden, "room not found")
				return
			}

			if streamKey != room.StreamKey {
				log.Printf("[SRS Callback] invalid stream key: expected=%s, got=%s", room.StreamKey, streamKey)
				h.Error(c, http.StatusForbidden, "invalid stream key")
				return
			}

			// 使用 roomID 作为 SRS 流标识
			hub.GetRoomService().StartLive(roomID, roomID)
			// 广播直播开始
			data, _ := json.Marshal(map[string]interface{}{
				"stream": roomID,
				"url":    "/" + req.App + "/" + req.Stream + ".m3u8",
			})
			hub.BroadcastToRoom(roomID, "live_started", data, "system")

		case "on_unpublish":
			// 停止推流
			if roomID != "" {
				hub.GetRoomService().EndLive(roomID)
				// 广播直播结束
				hub.BroadcastToRoom(roomID, "live_ended", nil, "system")
			}
		}

		// SRS 要求返回 code 0 表示成功
		h.Success(c, gin.H{})
	}
}

// parseStreamKey 从 URL 参数中解析推流密钥
// Param 格式: "?key=xxx" 或 "key=xxx"
func parseStreamKey(param string) string {
	if param == "" {
		return ""
	}
	// 确保以 ? 开头
	if !strings.HasPrefix(param, "?") {
		param = "?" + param
	}
	values, err := url.ParseQuery(param[1:]) // 去掉 ?
	if err != nil {
		return ""
	}
	return values.Get("key")
}
