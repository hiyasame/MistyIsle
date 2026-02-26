package service

import (
	"crypto/rand"
	"math/big"
	"misty-isle/utils"
	"sort"
	"sync"

	"misty-isle/model"
)

// RoomService 管理所有房间状态
type RoomService struct {
	rooms map[string]*model.Room
	// 房间ID -> 用户ID集合（用 map[string]struct{} 模拟 set，内存中不持久化）
	roomUsers map[string]utils.Set[string]
	mu        sync.RWMutex
}

func NewRoomService() *RoomService {
	return &RoomService{
		rooms:     make(map[string]*model.Room),
		roomUsers: make(map[string]utils.Set[string]),
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
	rm.roomUsers[roomID] = make(map[string]struct{})
	rm.roomUsers[roomID][hostID] = struct{}{}

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
		rm.roomUsers[roomID] = make(map[string]struct{})
		room.HostID = userID
	}

	if rm.roomUsers[roomID] == nil {
		rm.roomUsers[roomID] = make(map[string]struct{})
	}
	rm.roomUsers[roomID][userID] = struct{}{}
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

	if rm.roomUsers[roomID] != nil {
		delete(rm.roomUsers[roomID], userID)
	}

	// 房间空了，删除房间
	if len(rm.roomUsers[roomID]) == 0 {
		delete(rm.rooms, roomID)
		delete(rm.roomUsers, roomID)
		return true, ""
	}

	// 房主离开，自动转让
	if room.HostID == userID {
		for uid := range rm.roomUsers[roomID] {
			room.HostID = uid
			return false, uid
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

	// 检查 toUserID 是否在房间中
	if rm.roomUsers[roomID] == nil {
		return false
	}
	if _, ok := rm.roomUsers[roomID][toUserID]; !ok {
		return false
	}

	room.HostID = toUserID
	return true
}

// GetRoomUsers 获取房间用户列表
func (rm *RoomService) GetRoomUsers(roomID string) []string {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	users, ok := rm.roomUsers[roomID]
	if !ok {
		return nil
	}

	result := make([]string, 0, len(users))
	for uid := range users {
		result = append(result, uid)
	}
	return result
}

// IsUserInRoom 检查用户是否在房间中
func (rm *RoomService) IsUserInRoom(roomID, userID string) bool {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	users, ok := rm.roomUsers[roomID]
	if !ok {
		return false
	}
	_, exists := users[userID]
	return exists
}
