package handler

import (
	"encoding/json"
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
			Action   string `json:"action"` // on_publish, on_unpublish
			ClientID string `json:"client_id"`
			IP       string `json:"ip"`
			Vhost    string `json:"vhost"`
			App      string `json:"app"`    // 应用名，如 live
			Stream   string `json:"stream"` // 流名，直接使用 roomID
			Param    string `json:"param"`  // URL 参数
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			h.Error(c, http.StatusBadRequest, err.Error())
			return
		}

		// stream 名即为 roomID
		roomID := req.Stream

		// 处理不同事件
		switch req.Action {
		case "on_publish":
			// 开始推流，验证推流密钥
			room, ok := hub.GetRoomService().GetRoom(roomID)
			if !ok {
				h.Error(c, http.StatusForbidden, "room not found")
				return
			}

			// 从 Param 解析推流密钥，格式: ?key=xxx
			streamKey := parseStreamKey(req.Param)
			if streamKey != room.StreamKey {
				h.Error(c, http.StatusForbidden, "invalid stream key")
				return
			}

			hub.GetRoomService().StartLive(roomID, req.Stream)
			// 广播直播开始
			data, _ := json.Marshal(map[string]interface{}{
				"stream": req.Stream,
				"url":    "/live/" + req.Stream + ".m3u8",
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
