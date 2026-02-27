package service

import (
	"crypto/rand"
	"log"
	"math/big"
	"sort"
	"sync"

	"misty-isle/model"
)

// RoomService 管理所有房间状态
type RoomService struct {
	rooms map[string]*model.Room
	// 房间ID -> 用户ID -> 连接数（支持同一用户多个连接）
	roomUsers map[string]map[string]int
	mu        sync.RWMutex
}

func NewRoomService() *RoomService {
	return &RoomService{
		rooms:     make(map[string]*model.Room),
		roomUsers: make(map[string]map[string]int),
	}
}

// CreateRoom 创建房间，自动生成房间ID和推流密钥
func (rm *RoomService) CreateRoom(opts model.RoomOptions, hostID string, srsBaseURL string) *model.Room {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	// 生成唯一的房间ID（8位，字母数字，排除易混淆字符）
	roomID := rm.generateUniqueRoomID()

	// 生成推流密钥（16位随机字符串）
	streamKey := rm.generateStreamKey()

	room := &model.Room{
		ID:         roomID,
		Name:       opts.Name,
		Desc:       opts.Desc,
		HostID:     hostID,
		Status:     model.RoomStatusIdle,
		StreamKey:  streamKey,
		StreamURL:  srsBaseURL + "/live/" + roomID + "?key=" + streamKey,
		LiveHLSURL: "/live/" + roomID + ".m3u8",
	}

	rm.rooms[roomID] = room
	rm.roomUsers[roomID] = make(map[string]int)
	// 不要自动加入房主，等 WebSocket 连接时再加入
	// 这样如果房主从未连接，房间会在无人时自动清理

	return room
}

// generateStreamKey 生成推流密钥
func (rm *RoomService) generateStreamKey() string {
	const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	const keyLength = 16

	key := make([]byte, keyLength)
	for i := range key {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		key[i] = charset[n.Int64()]
	}
	return string(key)
}

// generateUniqueRoomID 生成唯一的房间ID
// 8位，字母数字，排除易混淆字符（0, O, 1, I, l）
func (rm *RoomService) generateUniqueRoomID() string {
	const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // 32个字符
	const idLength = 8

	for {
		id := make([]byte, idLength)
		for i := range id {
			n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
			id[i] = charset[n.Int64()]
		}

		roomID := string(id)
		// 检查是否已存在（极小的概率）
		if _, exists := rm.rooms[roomID]; !exists {
			return roomID
		}
		// 如果存在（碰撞），重新生成
	}
}

// GetRoom 获取房间
func (rm *RoomService) GetRoom(id string) (*model.Room, bool) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	room, ok := rm.rooms[id]
	return room, ok
}

// ListRoom 获取房间列表，按人数降序排序
func (rm *RoomService) ListRoom() []*model.Room {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	// 将所有房间放入切片
	rooms := make([]*model.Room, 0, len(rm.rooms))
	for _, room := range rm.rooms {
		rooms = append(rooms, room)
	}

	// 按房间人数降序排序
	sort.Slice(rooms, func(i, j int) bool {
		iCount := len(rm.roomUsers[rooms[i].ID])
		jCount := len(rm.roomUsers[rooms[j].ID])
		return iCount > jCount
	})

	return rooms
}

// RoomInfo 房间信息（包含用户数等）
type RoomInfo struct {
	RoomID       string                 `json:"room_id"`
	Name         string                 `json:"name"`
	Desc         string                 `json:"desc"`
	HostID       string                 `json:"host_id"`
	UserCount    int                    `json:"user_count"`
	IsLive       bool                   `json:"is_live"`
	CurrentVideo map[string]interface{} `json:"current_video,omitempty"`
}

// ListRoomWithUsers 获取房间列表（包含用户数），按人数降序排序
// 在一个锁内完成，避免竞态条件
func (rm *RoomService) ListRoomWithUsers() []RoomInfo {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	log.Printf("[ListRoomWithUsers] Total rooms in map: %d", len(rm.rooms))

	// 将所有房间放入切片
	rooms := make([]RoomInfo, 0, len(rm.rooms))
	for roomID, room := range rm.rooms {
		// 统计用户数（在同一个锁内）
		userCount := 0
		if users, ok := rm.roomUsers[room.ID]; ok {
			for _, count := range users {
				if count > 0 {
					userCount++
				}
			}
		}

		info := RoomInfo{
			RoomID:    room.ID,
			Name:      room.Name,
			Desc:      room.Desc,
			HostID:    room.HostID,
			UserCount: userCount,
			IsLive:    room.Status == model.RoomStatusPlayingLive,
		}

		// 如果正在播放视频，返回视频信息
		if room.Status == model.RoomStatusPlayingVOD && room.VideoID != "" {
			info.CurrentVideo = map[string]interface{}{
				"video_id": room.VideoID,
				"title":    room.VideoName,
			}
		}

		log.Printf("[ListRoomWithUsers] Room %s: userCount=%d", roomID, userCount)
		rooms = append(rooms, info)
	}

	// 按房间人数降序排序
	sort.Slice(rooms, func(i, j int) bool {
		return rooms[i].UserCount > rooms[j].UserCount
	})

	return rooms
}

// PlayVideo 播放视频（vod模式）
func (rm *RoomService) PlayVideo(roomID, videoID, videoName, videoURL string) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, ok := rm.rooms[roomID]
	if !ok {
		return false
	}

	room.Status = model.RoomStatusPlayingVOD
	room.VideoID = videoID
	room.VideoName = videoName
	room.VideoURL = videoURL
	return true
}

// StartLive 开始直播
func (rm *RoomService) StartLive(roomID, streamKey string) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, ok := rm.rooms[roomID]
	if !ok {
		return false
	}

	room.Status = model.RoomStatusPlayingLive
	room.VideoID = streamKey
	return true
}

// EndLive 结束直播
func (rm *RoomService) EndLive(roomID string) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, ok := rm.rooms[roomID]
	if !ok {
		return false
	}

	// 直播结束，回到idle状态
	room.Status = model.RoomStatusIdle
	room.VideoID = ""
	room.VideoName = ""
	room.VideoURL = ""
	return true
}

// VideoEnded 视频播放结束
func (rm *RoomService) VideoEnded(roomID string) (nextVideoID string, hasNext bool) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, ok := rm.rooms[roomID]
	if !ok {
		return "", false
	}

	// 回到idle
	room.Status = model.RoomStatusIdle
	room.VideoID = ""
	room.VideoName = ""
	room.VideoURL = ""
	return "", false
}

// DeleteRoom 删除房间
func (rm *RoomService) DeleteRoom(id string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	delete(rm.rooms, id)
	delete(rm.roomUsers, id)
}

// JoinRoom 用户加入房间
func (rm *RoomService) JoinRoom(roomID, userID string) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, ok := rm.rooms[roomID]
	if !ok {
		// 房间不存在，创建新房间（第一个加入的是房主）
		room = &model.Room{
			ID:     roomID,
			Status: model.RoomStatusIdle,
		}
		rm.rooms[roomID] = room
		rm.roomUsers[roomID] = make(map[string]int)
		room.HostID = userID
	}

	if rm.roomUsers[roomID] == nil {
		rm.roomUsers[roomID] = make(map[string]int)
	}

	// 如果房间存在但还没有人连接（创建后还没人加入），第一个加入的是房主
	if len(rm.roomUsers[roomID]) == 0 && room.HostID != "" {
		log.Printf("Room %s exists but empty, setting %s as host", roomID, userID)
		room.HostID = userID
	}

	// 增加连接计数（支持同一用户多个连接）
	rm.roomUsers[roomID][userID]++
	totalConnections := 0
	for _, count := range rm.roomUsers[roomID] {
		totalConnections += count
	}
	log.Printf("User %s joined room %s (connection #%d), total connections: %d, unique users: %d, is_host: %v",
		userID, roomID, rm.roomUsers[roomID][userID], totalConnections, len(rm.roomUsers[roomID]), room.HostID == userID)
	return room.HostID == userID
}

// LeaveRoom 用户离开房间
func (rm *RoomService) LeaveRoom(roomID, userID string) (isEmpty bool, newHostID string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, ok := rm.rooms[roomID]
	if !ok {
		return true, ""
	}

	// 减少连接计数
	if rm.roomUsers[roomID] != nil {
		if count, exists := rm.roomUsers[roomID][userID]; exists {
			if count > 1 {
				rm.roomUsers[roomID][userID]--
				log.Printf("User %s left room %s (still has %d connections)", userID, roomID, rm.roomUsers[roomID][userID])
			} else {
				delete(rm.roomUsers[roomID], userID)
				log.Printf("User %s completely left room %s (no more connections)", userID, roomID)
			}
		}
	}

	// 房间空了，删除房间
	if len(rm.roomUsers[roomID]) == 0 {
		log.Printf("Room %s is empty, deleting room", roomID)
		delete(rm.rooms, roomID)
		delete(rm.roomUsers, roomID)
		return true, ""
	}
	log.Printf("Room %s still has %d unique users", roomID, len(rm.roomUsers[roomID]))

	// 房主完全离开（所有连接都断开），自动转让
	if room.HostID == userID && rm.roomUsers[roomID][userID] == 0 {
		for uid := range rm.roomUsers[roomID] {
			if rm.roomUsers[roomID][uid] > 0 {
				room.HostID = uid
				log.Printf("Room %s host transferred to %s", roomID, uid)
				return false, uid
			}
		}
	}

	return false, ""
}

// IsHost 检查用户是否是房主
func (rm *RoomService) IsHost(roomID, userID string) bool {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	room, ok := rm.rooms[roomID]
	if !ok {
		return false
	}
	return room.HostID == userID
}

// GetHost 获取房间房主ID
func (rm *RoomService) GetHost(roomID string) string {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	room, ok := rm.rooms[roomID]
	if !ok {
		return ""
	}
	return room.HostID
}

// TransferHost 移交房主权限
func (rm *RoomService) TransferHost(roomID, fromUserID, toUserID string) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	room, ok := rm.rooms[roomID]
	if !ok {
		return false
	}

	// 检查 fromUserID 是否是当前房主
	if room.HostID != fromUserID {
		return false
	}

	// 检查 toUserID 是否在房间中（至少有一个连接）
	if rm.roomUsers[roomID] == nil {
		return false
	}
	if count, ok := rm.roomUsers[roomID][toUserID]; !ok || count == 0 {
		return false
	}

	room.HostID = toUserID
	return true
}

// GetRoomUsers 获取房间用户列表（去重，只要有连接就算在房间内）
func (rm *RoomService) GetRoomUsers(roomID string) []string {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	users, ok := rm.roomUsers[roomID]
	if !ok {
		return nil
	}

	result := make([]string, 0, len(users))
	for uid, count := range users {
		if count > 0 {
			result = append(result, uid)
		}
	}
	return result
}

// IsUserInRoom 检查用户是否在房间中（至少有一个连接）
func (rm *RoomService) IsUserInRoom(roomID, userID string) bool {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	users, ok := rm.roomUsers[roomID]
	if !ok {
		return false
	}
	count, exists := users[userID]
	return exists && count > 0
}
