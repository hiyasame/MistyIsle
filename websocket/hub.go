package websocket

import (
	"encoding/json"
	"log"
	"misty-isle/service"
	"misty-isle/utils"
	"sync"
)

// Hub 管理所有 WebSocket 连接
// 房间状态（host、users）由 RoomService 管理
type Hub struct {
	// 房间ID -> 客户端集合
	rooms map[string]utils.Set[*Client]
	// 用户ID -> 客户端集合（支持用户级通知）
	users map[string]utils.Set[*Client]
	// 房间状态管理（包含 host、users 等）
	roomService *service.RoomService
	// 广播消息
	broadcast chan *RoomMessage
	// 用户级通知
	userNotify chan *UserNotification
	// 注册客户端
	register chan *Client
	// 注销客户端
	unregister chan *Client
	mu         sync.RWMutex
}

// UserNotification 用户级通知（不依赖房间）
type UserNotification struct {
	UserID string          `json:"user_id"`
	Type   string          `json:"type"` // video_status, etc.
	Data   json.RawMessage `json:"data"`
}

type RoomMessage struct {
	RoomID string          `json:"room_id"`
	Action string          `json:"action"` // play, pause, seek, sync, join, leave, change_video, video_end, live_started, live_ended
	Data   json.RawMessage `json:"data"`
	From   string          `json:"from"`    // 发送者用户ID
	IsHost bool            `json:"is_host"` // 发送者是否是房主
}

// 需要房主权限的操作
var hostOnlyActions = map[string]bool{
	"sync":         true,
	"change_video": true,
}

func NewHub(roomService *service.RoomService) *Hub {
	return &Hub{
		rooms:       make(map[string]utils.Set[*Client]),
		users:       make(map[string]utils.Set[*Client]),
		roomService: roomService,
		broadcast:   make(chan *RoomMessage, 100),
		userNotify:  make(chan *UserNotification, 100),
		register:    make(chan *Client, 100),
		unregister:  make(chan *Client, 100),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			// 通过 RoomService 验证房间是否存在
			isUserConn := len(client.roomID) > 5 && client.roomID[:5] == "user_"
			isHost := false
			exists := true

			if !isUserConn {
				isHost, exists = h.roomService.JoinRoom(client.roomID, client.userID)
			}

			if !exists {
				// 房间不存在，拒绝连接
				log.Printf("Client %s tried to join non-existent room %s", client.userID, client.roomID)
				client.conn.Close()
				continue
			}

			h.mu.Lock()
			// 只有非用户级连接才注册到房间广播系统
			if !isUserConn {
				if h.rooms[client.roomID] == nil {
					h.rooms[client.roomID] = make(utils.Set[*Client])
				}
				h.rooms[client.roomID][client] = struct{}{}
			}

			// 注册到用户连接池（无论哪种连接都要注册，以便 NotifyUser 找到）
			if h.users[client.userID] == nil {
				h.users[client.userID] = make(utils.Set[*Client])
			}
			h.users[client.userID][client] = struct{}{}
			h.mu.Unlock()

			client.isHost = isHost

			if isUserConn {
				log.Printf("[Hub] Client %s connected for user-level notifications", client.userID)
				continue
			}

			log.Printf("[Hub] Client %s registration successful in room %s (host=%v). Current connections in room: %d",
				client.userID, client.roomID, isHost, len(h.rooms[client.roomID]))

			// 广播房间人员变动（包含全量列表）
			h.broadcastPeopleChange(client.roomID)

			// 如果不是房主加入，向房主请求一次同步状态
			if !isHost {
				hostID := h.roomService.GetHost(client.roomID)
				if hostID != "" {
					h.userNotify <- &UserNotification{
						UserID: hostID,
						Type:   "request_sync",
						Data:   json.RawMessage(`{}`),
					}
					log.Printf("[Hub] Sent request_sync to host %s", hostID)
				}
			}

		case client := <-h.unregister:
			h.mu.Lock()
			roomID := client.roomID
			// 从房间移除
			if clients, ok := h.rooms[roomID]; ok {
				delete(clients, client)
				if len(clients) == 0 {
					delete(h.rooms, roomID)
				}
			}

			// 从用户连接池移除
			if clients, ok := h.users[client.userID]; ok {
				delete(clients, client)
				if len(clients) == 0 {
					delete(h.users, client.userID)
				}
			}
			h.mu.Unlock()
			close(client.send)
			log.Printf("Client %s left room %s", client.userID, roomID)

			// 通过 RoomService 处理离开逻辑（自动转让房主、删除空房间）
			isEmpty, newHostID := h.roomService.LeaveRoom(roomID, client.userID)

			// 广播房间人员变动
			if !isEmpty {
				h.broadcastPeopleChange(roomID)

				if newHostID != "" {
					// 房主变更，广播给所有人
					h.broadcast <- &RoomMessage{
						RoomID: roomID,
						Action: "host_transfer",
						Data:   mustJSON(map[string]string{"new_host_id": newHostID}),
					}
				}
			}

		case notify := <-h.userNotify:
			if notify == nil {
				continue
			}

			h.mu.RLock()
			clients := h.users[notify.UserID]
			h.mu.RUnlock()

			if clients != nil {
				data, _ := json.Marshal(notify)
				for client := range clients {
					select {
					case client.send <- data:
					default:
						// 发送失败，注销连接
						go func(c *Client) { h.unregister <- c }(client)
					}
				}
			}

		case msg := <-h.broadcast:
			h.mu.RLock()
			clients := h.rooms[msg.RoomID]
			h.mu.RUnlock()

			// 检查权限
			if hostOnlyActions[msg.Action] {
				hostID := h.roomService.GetHost(msg.RoomID)

				if msg.From != hostID {
					// 非房主尝试控制，发送错误给发送者
					for client := range clients {
						if client.userID == msg.From {
							select {
							case client.send <- mustJSON(map[string]interface{}{
								"error":  "permission denied: host only",
								"action": msg.Action,
							}):
							default:
								go func(c *Client) { h.unregister <- c }(client)
							}
							break
						}
					}
					continue
				}
				msg.IsHost = true
			}

			data, _ := json.Marshal(msg)
			for client := range clients {
				// 对于 people_change 和 host_transfer，必须发给所有人（包括发送者自己）
				// 对于普通的播放控制同步消息（play, pause, seek, sync），不发给发送者自己以免引起回环状态冲突
				isSyncAction := msg.Action == "people_change" || msg.Action == "host_transfer"
				if !isSyncAction && client.userID == msg.From {
					continue
				}
				select {
				case client.send <- data:
				default:
					go func(c *Client) { h.unregister <- c }(client)
				}
			}
		}
	}
}

// IsHost 检查用户是否是房主（委托给 RoomService）
func (h *Hub) IsHost(roomID, userID string) bool {
	return h.roomService.IsHost(roomID, userID)
}

// GetHost 获取房间房主ID（委托给 RoomService）
func (h *Hub) GetHost(roomID string) string {
	return h.roomService.GetHost(roomID)
}

// TransferHost 移交房主权限
func (h *Hub) TransferHost(roomID, fromUserID, toUserID string) bool {
	// 通过 RoomService 更新房间状态
	if !h.roomService.TransferHost(roomID, fromUserID, toUserID) {
		return false
	}

	// 更新 WebSocket 客户端的 isHost 状态
	h.mu.Lock()
	defer h.mu.Unlock()

	if clients, ok := h.rooms[roomID]; ok {
		for c := range clients {
			if c.userID == fromUserID {
				c.isHost = false
			}
			if c.userID == toUserID {
				c.isHost = true
			}
		}
	}

	log.Printf("Room %s host transferred: %s -> %s", roomID, fromUserID, toUserID)
	return true
}

// GetRoomUsers 获取房间用户列表（委托给 RoomService）
func (h *Hub) GetRoomUsers(roomID string) []string {
	return h.roomService.GetRoomUsers(roomID)
}

// GetRoomService 获取房间管理器
func (h *Hub) GetRoomService() *service.RoomService {
	return h.roomService
}

// BroadcastToRoom 向房间广播消息（供外部调用）
func (h *Hub) BroadcastToRoom(roomID, action string, data []byte, from string) {
	h.broadcast <- &RoomMessage{
		RoomID: roomID,
		Action: action,
		Data:   data,
		From:   from,
	}
}

// NotifyUser 向指定用户发送通知（供外部调用）
func (h *Hub) NotifyUser(userID, notifyType string, data interface{}) {
	jsonData, _ := json.Marshal(data)
	h.userNotify <- &UserNotification{
		UserID: userID,
		Type:   notifyType,
		Data:   jsonData,
	}
}

// broadcastPeopleChange 广播当前房间的所有在线用户列表
func (h *Hub) broadcastPeopleChange(roomID string) {
	h.mu.RLock()
	clients, ok := h.rooms[roomID]
	if !ok {
		h.mu.RUnlock()
		log.Printf("[Hub] Room %s not found in h.rooms map", roomID)
		return
	}

	// 收集房间内所有唯一用户的信息
	// 同一用户可能有多个连接，但列表里只显示一次
	userMap := make(map[string]map[string]interface{})
	for client := range clients {
		if _, exists := userMap[client.userID]; !exists {
			userMap[client.userID] = map[string]interface{}{
				"user_id":  client.userID,
				"username": client.username,
				"avatar":   client.avatar,
				"is_host":  h.roomService.GetHost(roomID) == client.userID,
			}
		}
	}
	h.mu.RUnlock()

	userList := make([]map[string]interface{}, 0, len(userMap))
	for _, userData := range userMap {
		userList = append(userList, userData)
	}

	log.Printf("[Hub] Broadcasting people_change for room %s, total users: %d", roomID, len(userList))

	h.broadcast <- &RoomMessage{
		RoomID: roomID,
		Action: "people_change",
		Data:   mustJSON(map[string]interface{}{"users": userList}),
	}
}

func mustJSON(v interface{}) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
