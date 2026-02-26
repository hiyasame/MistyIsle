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
	// 房间状态管理（包含 host、users 等）
	roomService *service.RoomService
	// 广播消息
	broadcast chan *RoomMessage
	// 注册客户端
	register chan *Client
	// 注销客户端
	unregister chan *Client
	mu         sync.RWMutex
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
	"play":         true,
	"pause":        true,
	"seek":         true,
	"change_video": true,
}

func NewHub(roomService *service.RoomService) *Hub {
	return &Hub{
		rooms:       make(map[string]utils.Set[*Client]),
		roomService: roomService,
		broadcast:   make(chan *RoomMessage),
		register:    make(chan *Client),
		unregister:  make(chan *Client),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			if h.rooms[client.roomID] == nil {
				h.rooms[client.roomID] = make(utils.Set[*Client])
			}
			h.rooms[client.roomID][client] = struct{}{}
			h.mu.Unlock()

			// 通过 RoomService 管理房间状态
			isHost := h.roomService.JoinRoom(client.roomID, client.userID)
			client.isHost = isHost
			log.Printf("Client %s joined room %s (host=%v)", client.userID, client.roomID, isHost)

			// 广播用户加入
			h.broadcast <- &RoomMessage{
				RoomID: client.roomID,
				Action: "join",
				Data:   mustJSON(map[string]interface{}{"user_id": client.userID, "is_host": client.isHost}),
				From:   client.userID,
			}

		case client := <-h.unregister:
			h.mu.Lock()
			if clients, ok := h.rooms[client.roomID]; ok {
				if _, ok := clients[client]; ok {
					delete(clients, client)
					close(client.send)

					// 房间空了，清理
					if len(clients) == 0 {
						delete(h.rooms, client.roomID)
					}
				}
			}
			h.mu.Unlock()
			log.Printf("Client %s left room %s", client.userID, client.roomID)

			// 通过 RoomService 处理离开逻辑（自动转让房主、删除空房间）
			isEmpty, newHostID := h.roomService.LeaveRoom(client.roomID, client.userID)
			if !isEmpty && newHostID != "" {
				// 房主变更，更新客户端状态
				h.mu.Lock()
				if clients, ok := h.rooms[client.roomID]; ok {
					for c := range clients {
						if c.userID == newHostID {
							c.isHost = true
							break
						}
					}
				}
				h.mu.Unlock()
				log.Printf("Room %s new host: %s", client.roomID, newHostID)
			}

			// 广播用户离开
			h.broadcast <- &RoomMessage{
				RoomID: client.roomID,
				Action: "leave",
				Data:   mustJSON(map[string]interface{}{"user_id": client.userID}),
				From:   client.userID,
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
								close(client.send)
								delete(clients, client)
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
				// 不发给发送者自己（除了错误消息）
				if client.userID == msg.From {
					continue
				}
				select {
				case client.send <- data:
				default:
					close(client.send)
					delete(clients, client)
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

func mustJSON(v interface{}) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
