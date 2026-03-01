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

		// 按照用户要求的 Format:
		// Server URL: rtmp://host/live?key=SECRET
		// Stream Key (OBS): ROOMID
		// 结果: app="live", stream="ROOMID", param="?key=SECRET" (可能重复)
		roomID := req.Stream
		streamKey := parseStreamKey(req.Param)

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
			// 广播直播开始（使用 HTTP-FLV 相对路径）
			data, _ := json.Marshal(map[string]interface{}{
				"stream": roomID,
				"path":   "/live/" + roomID + ".flv",
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
func parseStreamKey(param string) string {
	if param == "" {
		return ""
	}
	// 针对 SRS 可能会重复拼接参数的情况（如 ?key=A?key=A），进行规范化
	normalized := param
	if strings.HasPrefix(normalized, "?") {
		normalized = normalized[1:]
	}
	// 将后续的 ? 替换为 & 以便 url.ParseQuery 解析
	normalized = strings.ReplaceAll(normalized, "?", "&")

	values, err := url.ParseQuery(normalized)
	if err != nil {
		return ""
	}
	return values.Get("key")
}
