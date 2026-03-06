package main

import (
	"log"
	"misty-isle/cfg"
	"misty-isle/db"
	"misty-isle/handler"
	"misty-isle/middleware"
	"misty-isle/service"
	"misty-isle/utils"
	"misty-isle/websocket"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	// 加载 .env 文件
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: .env file not found, using environment variables")
	}

	conf := cfg.Load()

	// 连接数据库
	database, err := db.Connect(conf)
	if err != nil {
		log.Fatal(err)
	}
	defer database.Close()

	// 自动建表
	if err := database.Migrate(); err != nil {
		log.Fatal("Database migration failed:", err)
	}

	// 初始化 R2
	r2, err := utils.NewR2(conf)
	if err != nil {
		log.Fatal(err)
	}

	// 初始化 Redis
	redis, err := utils.NewRedis(conf)
	if err != nil {
		log.Printf("Redis connection failed: %v", err)
		log.Println("Continuing without Redis...")
	} else {
		defer redis.Close()
	}

	// 初始化邮件客户端
	email := utils.NewEmailClient(conf)

	// 初始化共享的 RoomService（Hub 和 Handler 共用同一个实例）
	roomService := service.NewRoomService()

	// 初始化 WebSocket Hub
	wsHub := websocket.NewHub(roomService, database, redis)
	go wsHub.Run()

	// 初始化 Handler（依赖注入，传入同一个 roomService）
	h := handler.New(conf, database, r2, redis, email, wsHub, roomService)

	serve(conf, h, wsHub, database)
}

func serve(conf *cfg.Config, h *handler.Handler, wsHub *websocket.Hub, database *db.DB) {
	r := gin.Default()

	// 全局中间件
	r.Use(middleware.CORS())
	r.Use(middleware.Logger())

	// 用户服务
	user := r.Group("/user")
	{
		user.POST("/register", h.UserRegister)
		user.POST("/login", h.UserLogin)
		user.POST("/verify-code", h.SendVerifyCode) // 发送邮箱验证码
		user.POST("/forgot-password", h.ForgotPassword)
		user.POST("/reset-password", h.ResetPassword)
		user.GET("/profile", middleware.Auth(*conf), h.UserProfile)
		user.PUT("/profile", middleware.Auth(*conf), h.UserUpdate)
		user.POST("/avatar", middleware.Auth(*conf), h.UserAvatar)
	}

	// 房间服务
	room := r.Group("/room")
	room.Use(middleware.Auth(*conf))
	{
		room.POST("/create", h.RoomCreate)
		room.GET("/list", h.RoomList)
		room.GET("/:id", h.RoomGet)
		// join/leave 通过 WebSocket 连接/断开自动处理
		room.POST("/:id/play", h.RoomPlayVideo(wsHub))        // 播放指定视频
		room.POST("/:id/transfer", h.RoomTransferHost(wsHub)) // 移交房主权限
		room.DELETE("/:id", h.RoomDelete(wsHub))              // 删除房间（仅当房间无人时）
		room.GET("/:id/chat", h.RoomChatHistory)              // 获取聊天历史
		room.POST("/:id/chat/image", h.RoomChatUploadImage)   // 上传聊天图片
	}

	// 视频服务
	video := r.Group("/video")
	{
		// 需要认证的接口
		video.POST("/init", middleware.Auth(*conf), h.VideoInit)       // 初始化上传，获取预签名URL
		video.POST("/process", middleware.Auth(*conf), h.VideoProcess) // 前端上传完成后触发处理
		video.GET("/list", middleware.Auth(*conf), h.VideoList)
		video.GET("/:id", middleware.Auth(*conf), h.VideoGet)
		video.GET("/:id/status", middleware.Auth(*conf), h.VideoStatus)
		video.DELETE("/:id", middleware.Auth(*conf), h.VideoDelete) // 删除视频

		// Webhook（无需认证）
		video.POST("/webhook", h.VideoWebhook) // Modal 回调接口
	}

	// SRS 回调
	srs := r.Group("/srs")
	{
		srs.POST("/callback", h.SRSCallback(wsHub))
	}

	// WebSocket 信令服务（从 URL 参数获取 token）
	r.GET("/ws/:roomId", func(c *gin.Context) {
		websocket.ServeWs(wsHub, c, database, conf)
	})

	log.Println("Server starting on :8081")
	if err := r.Run(":8081"); err != nil {
		log.Fatal(err)
	}
}
