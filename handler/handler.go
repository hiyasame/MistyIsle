package handler

import (
	"misty-isle/cfg"
	"misty-isle/db"
	"misty-isle/service"
	"misty-isle/utils"
)

// Handler 包含所有依赖
type Handler struct {
	Cfg            *cfg.Config
	DB             *db.DB
	RoomService    *service.RoomService
	UserService    *service.UserService
	VideoProcessor *service.VideoProcessor
}

// New 创建 Handler
func New(cfg *cfg.Config, database *db.DB, r2 *utils.R2, redis *utils.RedisClient, email *utils.EmailClient, videoProcessor *service.VideoProcessor) *Handler {
	return &Handler{
		Cfg:            cfg,
		DB:             database,
		RoomService:    service.NewRoomService(),
		UserService:    service.NewUserService(database, r2, redis, email, cfg),
		VideoProcessor: videoProcessor,
	}
}
