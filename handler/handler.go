package handler

import (
	"net/http"

	"misty-isle/cfg"
	"misty-isle/db"
	"misty-isle/model"
	"misty-isle/service"
	"misty-isle/utils"

	"github.com/gin-gonic/gin"
)

// VideoDBInterface 定义视频相关数据库操作接口
type VideoDBInterface interface {
	CreateVideo(video *model.Video) error
	GetVideoByID(videoID uint64) (*model.Video, error)
	GetVideosByUserID(userID uint64) ([]*model.Video, error)
	GetAllVideos() ([]*model.Video, error)
	UpdateVideo(videoID uint64, updates map[string]interface{}) error
	DeleteVideo(videoID uint64, userID uint64) error
}

// Handler 包含所有依赖
type Handler struct {
	Cfg         *cfg.Config
	DB          VideoDBInterface
	R2          *utils.R2
	RoomService *service.RoomService
	UserService *service.UserService
	WSHub       interface {
		NotifyUser(userID, notifyType string, data interface{})
	}
}

// New 创建 Handler
func New(cfg *cfg.Config, database *db.DB, r2 *utils.R2, redis *utils.RedisClient, email *utils.EmailClient, wsHub interface {
	NotifyUser(string, string, interface{})
}, roomService *service.RoomService) *Handler {
	return &Handler{
		Cfg:         cfg,
		DB:          database,
		R2:          r2,
		RoomService: roomService,
		UserService: service.NewUserService(database, r2, redis, email, cfg),
		WSHub:       wsHub,
	}
}

// 统一响应格式

// Success 成功响应
func (h *Handler) Success(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": data,
	})
}

// Error 错误响应
func (h *Handler) Error(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{
		"code":  status,
		"error": message,
	})
}
