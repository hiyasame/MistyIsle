package websocket

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"misty-isle/model"
	"misty-isle/service"
	"misty-isle/utils"
	"strconv"
	"sync"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// ChatDB 聊天消息数据库接口
type ChatDB interface {
	SaveChatMessage(msg *model.ChatMessage) error
	GetRecentChatMessages(roomID string, limit int) ([]*model.ChatMessage, error)
	GetChatMessageByID(id uint64) (*model.ChatMessage, error)
}

// Hub 管理所有 WebSocket 连接
// 房间状态（host、users）由 RoomService 管理
type Hub struct {
	// 房间ID -> 客户端集合
	rooms map[string]utils.Set[*Client]
	// 用户ID -> 客户端集合（支持用户级通知）
	users map[string]utils.Set[*Client]
	// 房间状态管理（包含 host、users 等）
	roomService *service.RoomService
	// 聊天消息数据库
	db ChatDB
	// Redis 客户端（可为 nil）
	redis *utils.RedisClient
	// 房间 Redis 订阅（roomID -> PubSub）
	roomSubs map[string]*goredis.PubSub
	// 广播消息
	broadcast chan *RoomMessage
	// 用户级通知
	userNotify chan *UserNotification
	// 注册客户端
	register chan *Client
	// 注销客户端
	unregister chan *Client
	// 延迟清理任务（用户ID_房间ID -> 取消函数）
	pendingCleanups map[string]context.CancelFunc
	mu              sync.RWMutex
}

// UserNotification 用户级通知（不依赖房间）
type UserNotification struct {
	UserID string          `json:"user_id"`
	Type   string          `json:"type"` // video_status, etc.
	Data   json.RawMessage `json:"data"`
}

type RoomMessage struct {
	RoomID string          `json:"room_id"`
	Action string          `json:"action"` // play, pause, seek, sync, join, leave, change_video, video_end, live_started, live_ended, chat
	Data   json.RawMessage `json:"data"`
	From   string          `json:"from"`    // 发送者用户ID
	IsHost bool            `json:"is_host"` // 发送者是否是房主
}

// 需要房主权限的操作
var hostOnlyActions = map[string]bool{
	"sync":         true,
	"change_video": true,
}

func NewHub(roomService *service.RoomService, db ChatDB, redis *utils.RedisClient) *Hub {
	return &Hub{
		rooms:           make(map[string]utils.Set[*Client]),
		users:           make(map[string]utils.Set[*Client]),
		roomService:     roomService,
		db:              db,
		redis:           redis,
		roomSubs:        make(map[string]*goredis.PubSub),
		broadcast:       make(chan *RoomMessage, 100),
		userNotify:      make(chan *UserNotification, 100),
		register:        make(chan *Client, 100),
		unregister:      make(chan *Client, 100),
		pendingCleanups: make(map[string]context.CancelFunc),
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
				if client.conn != nil {
					client.conn.Close()
				}
				continue
			}

			h.mu.Lock()
			// 只有非用户级连接才注册到房间广播系统
			if !isUserConn {
				if h.rooms[client.roomID] == nil {
					h.rooms[client.roomID] = make(utils.Set[*Client])
				}
				h.rooms[client.roomID][client] = struct{}{}

				// 如果这是房间的第一个连接，启动 Redis 订阅
				if h.redis != nil && len(h.rooms[client.roomID]) == 1 {
					h.startRoomSubscription(client.roomID)
				}
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
			cleanupKey := client.userID + "_" + roomID

			// 取消该用户在该房间的任何待执行清理任务（如果用户重连了）
			if cancelFunc, exists := h.pendingCleanups[cleanupKey]; exists {
				cancelFunc()
				delete(h.pendingCleanups, cleanupKey)
				log.Printf("[Hub] Cancelled pending cleanup for %s in room %s (reconnected)", client.userID, roomID)
			}

			// 立即从 WebSocket 连接池移除
			if clients, ok := h.rooms[roomID]; ok {
				delete(clients, client)
				if len(clients) == 0 {
					delete(h.rooms, roomID)
					// 房间空了，取消 Redis 订阅
					if h.redis != nil {
						h.stopRoomSubscription(roomID)
					}
				}
			}

			if clients, ok := h.users[client.userID]; ok {
				delete(clients, client)
				if len(clients) == 0 {
					delete(h.users, client.userID)
				}
			}
			close(client.send)
			log.Printf("[Hub] Client %s disconnected from room %s, waiting 5s before cleanup...", client.userID, roomID)
			h.mu.Unlock()

			// 启动5秒延迟清理任务
			ctx, cancel := context.WithCancel(context.Background())
			h.mu.Lock()
			h.pendingCleanups[cleanupKey] = cancel
			h.mu.Unlock()

			go func(userID, roomID string) {
				select {
				case <-time.After(5 * time.Second):
					// 5秒后，执行真正的离开房间逻辑
					log.Printf("[Hub] Timeout reached, processing leave for %s in room %s", userID, roomID)

					h.mu.Lock()
					delete(h.pendingCleanups, cleanupKey)
					h.mu.Unlock()

					// 检查用户是否已经重连（只检查该房间内是否有该用户的连接，不包括 user_ 前缀的通知连接）
					h.mu.RLock()
					reconnected := false
					if roomClients, ok := h.rooms[roomID]; ok {
						for c := range roomClients {
							if c.userID == userID {
								reconnected = true
								break
							}
						}
					}
					h.mu.RUnlock()
					if reconnected {
						log.Printf("[Hub] User %s reconnected to room %s, skipping cleanup", userID, roomID)
						return
					}

					// 通过 RoomService 处理离开逻辑（自动转让房主、删除空房间）
					isEmpty, newHostID := h.roomService.LeaveRoom(roomID, userID)

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
							log.Printf("[Hub] Host transferred to %s in room %s", newHostID, roomID)
						}
					}

				case <-ctx.Done():
					// 用户重连，取消清理
					log.Printf("[Hub] Cleanup cancelled for %s in room %s (user reconnected)", userID, roomID)
				}
			}(client.userID, roomID)

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
			// 处理聊天消息
			if msg.Action == "chat" {
				h.handleChatMessage(msg)
				continue
			}

			h.mu.RLock()
			clients := h.rooms[msg.RoomID]
			h.mu.RUnlock()

			// 处理停止播放（任何人都可以操作）
			if msg.Action == "stop_playback" {
				h.roomService.StopPlayback(msg.RoomID)
				log.Printf("[Hub] User %s stopped playback in room %s", msg.From, msg.RoomID)
			}

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
				// 对于 people_change、host_transfer 和 stop_playback，必须发给所有人（包括发送者自己）
				// 对于普通的播放控制同步消息（play, pause, seek, sync），不发给发送者自己以免引起回环状态冲突
				isSyncAction := msg.Action == "people_change" || msg.Action == "host_transfer" || msg.Action == "stop_playback"
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

// handleChatMessage 处理聊天消息：保存到DB，通过Redis广播或直接广播
func (h *Hub) handleChatMessage(msg *RoomMessage) {
	// 解析客户端发来的聊天数据
	var chatReq struct {
		Content   string   `json:"content"`
		ImageURL  string   `json:"image_url"`
		ReplyToID *uint64  `json:"reply_to_id"`
		Mentions  []string `json:"mentions"`
	}
	if err := json.Unmarshal(msg.Data, &chatReq); err != nil {
		log.Printf("[Hub] Failed to parse chat message from %s: %v", msg.From, err)
		return
	}

	// 内容验证：文字和图片不能都为空，文字不超过1000字符
	if chatReq.Content == "" && chatReq.ImageURL == "" {
		return
	}
	if len([]rune(chatReq.Content)) > 1000 {
		return
	}

	userIDUint, err := strconv.ParseUint(msg.From, 10, 64)
	if err != nil {
		log.Printf("[Hub] Invalid userID in chat: %s", msg.From)
		return
	}

	// 获取发送者信息（从房间内客户端查找）
	var senderUsername, senderAvatar string
	h.mu.RLock()
	if clients, ok := h.rooms[msg.RoomID]; ok {
		for c := range clients {
			if c.userID == msg.From {
				senderUsername = c.username
				senderAvatar = c.avatar
				break
			}
		}
	}
	h.mu.RUnlock()

	// 构建消息对象
	chatMsg := &model.ChatMessage{
		RoomID:    msg.RoomID,
		UserID:    userIDUint,
		Username:  senderUsername,
		Avatar:    senderAvatar,
		Content:   chatReq.Content,
		ImageURL:  chatReq.ImageURL,
		Mentions:  chatReq.Mentions,
		ReplyToID: chatReq.ReplyToID,
		CreatedAt: time.Now(),
	}
	if chatMsg.Mentions == nil {
		chatMsg.Mentions = []string{}
	}

	// 如果有回复，查询被回复的消息
	if chatReq.ReplyToID != nil {
		replied, err := h.db.GetChatMessageByID(*chatReq.ReplyToID)
		if err == nil {
			chatMsg.ReplyToUsername = replied.Username
			chatMsg.ReplyToContent = replied.Content
			chatMsg.ReplyToImageURL = replied.ImageURL
		}
	}

	// 保存到数据库
	if err := h.db.SaveChatMessage(chatMsg); err != nil {
		log.Printf("[Hub] Failed to save chat message: %v", err)
		return
	}

	// 构建广播用的完整消息
	broadcastData := h.buildChatBroadcastData(chatMsg)
	broadcastMsg := &RoomMessage{
		RoomID: msg.RoomID,
		Action: "chat",
		Data:   broadcastData,
		From:   msg.From,
	}

	if h.redis != nil {
		// 通过 Redis Pub/Sub 广播（多实例场景）
		payload, _ := json.Marshal(broadcastMsg)
		if err := h.redis.PublishChat(msg.RoomID, payload); err != nil {
			log.Printf("[Hub] Redis publish failed, falling back to direct broadcast: %v", err)
			h.broadcastChatDirect(broadcastMsg)
		}
	} else {
		// 直接内存广播
		h.broadcastChatDirect(broadcastMsg)
	}
}

// buildChatBroadcastData 构建聊天广播的 data 字段
func (h *Hub) buildChatBroadcastData(msg *model.ChatMessage) json.RawMessage {
	data := map[string]interface{}{
		"id":         fmt.Sprintf("%d", msg.ID),
		"room_id":    msg.RoomID,
		"user_id":    fmt.Sprintf("%d", msg.UserID),
		"username":   msg.Username,
		"avatar":     msg.Avatar,
		"content":    msg.Content,
		"image_url":  msg.ImageURL,
		"mentions":   msg.Mentions,
		"created_at": msg.CreatedAt.Format(time.RFC3339),
	}
	if msg.ReplyToID != nil {
		data["reply_to"] = map[string]interface{}{
			"id":        fmt.Sprintf("%d", *msg.ReplyToID),
			"username":  msg.ReplyToUsername,
			"content":   msg.ReplyToContent,
			"image_url": msg.ReplyToImageURL,
		}
	}
	return mustJSON(data)
}

// broadcastChatDirect 直接向房间内所有客户端广播聊天消息
func (h *Hub) broadcastChatDirect(msg *RoomMessage) {
	data, _ := json.Marshal(msg)
	h.mu.RLock()
	clients := h.rooms[msg.RoomID]
	h.mu.RUnlock()
	for client := range clients {
		select {
		case client.send <- data:
		default:
			go func(c *Client) { h.unregister <- c }(client)
		}
	}
}

// startRoomSubscription 启动房间的 Redis 订阅 goroutine（必须在持有 mu.Lock 时调用）
func (h *Hub) startRoomSubscription(roomID string) {
	if _, exists := h.roomSubs[roomID]; exists {
		return
	}
	pubsub := h.redis.SubscribeChat(roomID)
	h.roomSubs[roomID] = pubsub
	log.Printf("[Hub] Started Redis subscription for room %s", roomID)

	go func() {
		ch := pubsub.Channel()
		for redisMsg := range ch {
			var msg RoomMessage
			if err := json.Unmarshal([]byte(redisMsg.Payload), &msg); err != nil {
				log.Printf("[Hub] Failed to parse Redis chat message: %v", err)
				continue
			}
			h.broadcastChatDirect(&msg)
		}
		log.Printf("[Hub] Redis subscription goroutine ended for room %s", roomID)
	}()
}

// stopRoomSubscription 取消房间的 Redis 订阅（必须在持有 mu.Lock 时调用）
func (h *Hub) stopRoomSubscription(roomID string) {
	if pubsub, exists := h.roomSubs[roomID]; exists {
		pubsub.Close()
		delete(h.roomSubs, roomID)
		log.Printf("[Hub] Stopped Redis subscription for room %s", roomID)
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
				"bio":      client.bio,
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
