package websocket

import (
	"encoding/json"
	"misty-isle/service"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// 测试 NewHub
func TestNewHub(t *testing.T) {
	roomService := service.NewRoomService()
	hub := NewHub(roomService)

	assert.NotNil(t, hub)
	assert.NotNil(t, hub.rooms)
	assert.NotNil(t, hub.users)
	assert.NotNil(t, hub.broadcast)
	assert.NotNil(t, hub.userNotify)
	assert.NotNil(t, hub.register)
	assert.NotNil(t, hub.unregister)
}

// 测试 NotifyUser
func TestHub_NotifyUser(t *testing.T) {
	roomService := service.NewRoomService()
	hub := NewHub(roomService)

	// 启动 Hub
	go hub.Run()

	// 创建测试客户端
	client := &Client{
		userID: "user123",
		roomID: "room1",
		send:   make(chan []byte, 10),
	}

	// 注册客户端
	hub.register <- client
	time.Sleep(50 * time.Millisecond) // 等待注册完成

	// 发送用户通知
	testData := map[string]interface{}{
		"video_id": 123,
		"status":   "ready",
		"progress": 100,
	}

	hub.NotifyUser("user123", "video_status", testData)

	// 等待并接收通知
	select {
	case msg := <-client.send:
		var notification UserNotification
		err := json.Unmarshal(msg, &notification)
		assert.NoError(t, err)
		assert.Equal(t, "user123", notification.UserID)
		assert.Equal(t, "video_status", notification.Type)

		var data map[string]interface{}
		json.Unmarshal(notification.Data, &data)
		assert.Equal(t, float64(123), data["video_id"])
		assert.Equal(t, "ready", data["status"])

	case <-time.After(200 * time.Millisecond):
		t.Fatal("Did not receive notification")
	}
}

// 测试多个客户端接收通知
func TestHub_NotifyUser_MultipleClients(t *testing.T) {
	roomService := service.NewRoomService()
	hub := NewHub(roomService)

	go hub.Run()

	// 为同一用户创建多个客户端（多个设备/浏览器标签）
	client1 := &Client{
		userID: "user123",
		roomID: "room1",
		send:   make(chan []byte, 10),
	}

	client2 := &Client{
		userID: "user123",
		roomID: "room2",
		send:   make(chan []byte, 10),
	}

	// 注册两个客户端
	hub.register <- client1
	hub.register <- client2
	time.Sleep(50 * time.Millisecond)

	// 发送通知
	testData := map[string]interface{}{
		"message": "test",
	}
	hub.NotifyUser("user123", "test_notify", testData)

	// 两个客户端都应该收到通知
	receivedCount := 0

	select {
	case <-client1.send:
		receivedCount++
	case <-time.After(100 * time.Millisecond):
	}

	select {
	case <-client2.send:
		receivedCount++
	case <-time.After(100 * time.Millisecond):
	}

	assert.Equal(t, 2, receivedCount, "Both clients should receive notification")
}

// 测试 BroadcastToRoom（已有功能）
func TestHub_BroadcastToRoom(t *testing.T) {
	roomService := service.NewRoomService()
	hub := NewHub(roomService)

	go hub.Run()

	// 创建两个客户端在同一房间
	client1 := &Client{
		userID: "user1",
		roomID: "room1",
		send:   make(chan []byte, 10),
	}

	client2 := &Client{
		userID: "user2",
		roomID: "room1",
		send:   make(chan []byte, 10),
	}

	hub.register <- client1
	hub.register <- client2
	time.Sleep(50 * time.Millisecond)

	// 清空注册时产生的 join 消息
	for len(client1.send) > 0 {
		<-client1.send
	}
	for len(client2.send) > 0 {
		<-client2.send
	}

	// 广播房间消息
	testData, _ := json.Marshal(map[string]interface{}{
		"action": "play",
	})
	hub.BroadcastToRoom("room1", "play", testData, "user1")

	// client2 应该收到消息（但不发给发送者 client1）
	select {
	case msg := <-client2.send:
		var roomMsg RoomMessage
		json.Unmarshal(msg, &roomMsg)
		assert.Equal(t, "room1", roomMsg.RoomID)
		assert.Equal(t, "play", roomMsg.Action)
		assert.Equal(t, "user1", roomMsg.From)

	case <-time.After(100 * time.Millisecond):
		t.Fatal("Client2 did not receive broadcast")
	}

	// client1 不应该收到消息（是发送者）
	select {
	case <-client1.send:
		t.Fatal("Sender should not receive own message")
	case <-time.After(20 * time.Millisecond):
		// 正常，发送者不应该收到
	}
}

// 测试客户端注册和注销
func TestHub_RegisterUnregister(t *testing.T) {
	roomService := service.NewRoomService()
	hub := NewHub(roomService)

	go hub.Run()

	client := &Client{
		userID: "user1",
		roomID: "room1",
		send:   make(chan []byte, 10),
	}

	// 注册
	hub.register <- client
	time.Sleep(10 * time.Millisecond)

	hub.mu.RLock()
	assert.Contains(t, hub.rooms["room1"], client)
	assert.Contains(t, hub.users["user1"], client)
	hub.mu.RUnlock()

	// 注销
	hub.unregister <- client
	time.Sleep(10 * time.Millisecond)

	hub.mu.RLock()
	assert.NotContains(t, hub.rooms["room1"], client)
	assert.NotContains(t, hub.users["user1"], client)
	hub.mu.RUnlock()
}

// 测试用户级通知不干扰房间消息
func TestHub_UserNotifyAndRoomBroadcast_Isolated(t *testing.T) {
	roomService := service.NewRoomService()
	hub := NewHub(roomService)

	go hub.Run()

	// user1 在 room1
	client1 := &Client{
		userID: "user1",
		roomID: "room1",
		send:   make(chan []byte, 10),
	}

	// user2 在 room2
	client2 := &Client{
		userID: "user2",
		roomID: "room2",
		send:   make(chan []byte, 10),
	}

	hub.register <- client1
	hub.register <- client2
	time.Sleep(50 * time.Millisecond)

	// 向 user1 发送用户级通知
	hub.NotifyUser("user1", "video_status", map[string]interface{}{
		"video_id": 1,
	})

	// 向 room2 发送房间广播
	testData, _ := json.Marshal(map[string]string{"action": "play"})
	hub.BroadcastToRoom("room2", "play", testData, "user2")

	// client1 只应收到用户通知
	select {
	case msg := <-client1.send:
		var notification UserNotification
		json.Unmarshal(msg, &notification)
		assert.Equal(t, "video_status", notification.Type)
	case <-time.After(100 * time.Millisecond):
		t.Fatal("Client1 did not receive user notification")
	}

	// client1 不应收到 room2 的广播
	select {
	case <-client1.send:
		t.Fatal("Client1 should not receive room2 broadcast")
	case <-time.After(20 * time.Millisecond):
		// 正常
	}

	// client2 不应收到自己发送的房间消息
	select {
	case <-client2.send:
		t.Fatal("Client2 should not receive own broadcast")
	case <-time.After(20 * time.Millisecond):
		// 正常
	}
}

// Benchmark: 用户通知性能
func BenchmarkHub_NotifyUser(b *testing.B) {
	roomService := service.NewRoomService()
	hub := NewHub(roomService)

	go hub.Run()

	client := &Client{
		userID: "user1",
		roomID: "room1",
		send:   make(chan []byte, 10000),
	}

	hub.register <- client
	time.Sleep(10 * time.Millisecond)

	testData := map[string]interface{}{
		"video_id": 123,
		"status":   "ready",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		hub.NotifyUser("user1", "video_status", testData)
	}
}
