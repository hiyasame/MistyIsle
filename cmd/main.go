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
)

func main() {
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

	// 初始化视频处理器
	videoProcessor := service.NewVideoProcessor(database, r2, 2) // 2个并发 worker
	videoProcessor.Start()
	defer videoProcessor.Stop()

	// 初始化 Handler（依赖注入）
	h := handler.New(conf, database, r2, redis, email, videoProcessor)

	serve(conf, h)
}

func serve(conf *cfg.Config, h *handler.Handler) {
	r := gin.Default()
	// WebSocket Hub
	wsHub := websocket.NewHub(h.RoomService)
	go wsHub.Run()

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
		room.POST("/:id/play", h.RoomPlayVideo(wsHub))        // 播放指定视频（房主）
		room.POST("/:id/transfer", h.RoomTransferHost(wsHub)) // 移交房主权限
	}

	// 视频服务
	video := r.Group("/video")
	video.Use(middleware.Auth(*conf))
	{
		video.POST("/upload", h.VideoUpload)
		video.GET("/list", h.VideoList)
		video.GET("/:id", h.VideoGet)
		video.GET("/:id/status", h.VideoStatus)
	}

	// SRS 回调
	srs := r.Group("/srs")
	{
		srs.POST("/callback", h.SRSCallback(wsHub))
	}

	// WebSocket 信令服务
	r.GET("/ws/:roomId", func(c *gin.Context) {
		websocket.ServeWs(wsHub, c)
	})

	log.Println("Server starting on :8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatal(err)
	}
}
