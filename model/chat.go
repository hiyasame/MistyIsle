package model

import "time"

// ChatMessage 聊天消息
type ChatMessage struct {
	ID              uint64
	RoomID          string
	UserID          uint64
	Username        string
	Avatar          string
	Content         string
	ImageURL        string
	ReplyToID       *uint64
	ReplyToUsername string
	ReplyToContent  string
	ReplyToImageURL string
	Mentions        []string // JSON array of user IDs
	CreatedAt       time.Time
}
