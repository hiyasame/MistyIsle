package websocket

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	maxMessageSize = 512
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // 开发环境允许所有来源
	},
}

// Client 是 WebSocket 连接
type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan []byte
	roomID string
	userID string
	isHost bool // 是否是房主
}

func ServeWs(hub *Hub, c *gin.Context) {
	roomID := c.Param("roomID")
	userID := c.GetString("userID") // 从 JWT 获取
	if userID == "" {
		userID = "anonymous" // 未登录用户
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}

	client := &Client{
		hub:    hub,
		conn:   conn,
		send:   make(chan []byte, 256),
		roomID: roomID,
		userID: userID,
	}

	client.hub.register <- client

	go client.writePump()
	go client.readPump()
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			// 连接断开（包括用户关闭网页、断网、刷新）
			break
		}

		// 解析消息
		var msg RoomMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}

		msg.From = c.userID
		msg.RoomID = c.roomID
		c.hub.broadcast <- &msg
	}
}

func (c *Client) writePump() {
	defer c.conn.Close()

	for message := range c.send {
		c.conn.SetWriteDeadline(time.Now().Add(writeWait))
		if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
			return
		}
	}
}
