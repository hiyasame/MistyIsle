package handler

import (
	"io"
	"net/http"
	"strconv"
	"time"

	"misty-isle/model"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// UserRegister 用户注册
func (h *Handler) UserRegister(c *gin.Context) {
	var req model.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 调用 service 注册
	user, err := h.UserService.Register(&req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 生成 JWT token
	token, err := generateJWT(user.ID, h.Cfg.JWTSecret, h.Cfg.JWTExpire)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"token": token,
			"user": gin.H{
				"user_id":  user.ID,
				"username": user.Username,
				"email":    user.Email,
				"avatar":   user.Avatar,
			},
		},
	})
}

// UserLogin 用户登录
func (h *Handler) UserLogin(c *gin.Context) {
	var req model.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 调用 service 登录
	user, err := h.UserService.Login(&req)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	// 生成 JWT token
	token, err := generateJWT(user.ID, h.Cfg.JWTSecret, h.Cfg.JWTExpire)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"token": token,
			"user": gin.H{
				"user_id":  user.ID,
				"username": user.Username,
				"email":    user.Email,
				"avatar":   user.Avatar,
			},
		},
	})
}

// SendVerifyCode 发送邮箱验证码
func (h *Handler) SendVerifyCode(c *gin.Context) {
	var req model.SendVerifyCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.UserService.SendVerifyCode(req.Email); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "verification code sent",
	})
}

// ForgotPassword 忘记密码
func (h *Handler) ForgotPassword(c *gin.Context) {
	var req model.ForgotPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.UserService.ForgotPassword(req.Email); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 无论邮箱是否存在，都返回成功（安全考虑）
	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "if email exists, reset link will be sent",
	})
}

// ResetPassword 重置密码
func (h *Handler) ResetPassword(c *gin.Context) {
	var req model.ResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.UserService.ResetPassword(req.Token, req.Password); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    0,
		"message": "password reset successfully",
	})
}

// UserProfile 获取用户信息
func (h *Handler) UserProfile(c *gin.Context) {
	userID := c.GetUint64("userID")

	user, err := h.UserService.GetUserByID(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"user_id":    user.ID,
			"username":   user.Username,
			"email":      user.Email,
			"avatar":     user.Avatar,
			"bio":        user.Bio,
			"created_at": user.CreatedAt,
		},
	})
}

// UserUpdate 更新用户信息
func (h *Handler) UserUpdate(c *gin.Context) {
	userID := c.GetUint64("userID")

	var req model.UserUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.UserService.UpdateUser(userID, &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0})
}

// UserAvatar 上传头像
func (h *Handler) UserAvatar(c *gin.Context) {
	userID := c.GetUint64("userID")

	file, header, err := c.Request.FormFile("avatar")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no file uploaded"})
		return
	}
	defer file.Close()

	// 检查文件大小（最大 5MB）
	if header.Size > 5*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file too large (max 5MB)"})
		return
	}

	// 读取文件内容
	data, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
		return
	}

	// 上传并更新头像
	url, err := h.UserService.UpdateAvatar(userID, data, header.Header.Get("Content-Type"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"url": url,
		},
	})
}

// generateJWT 生成 JWT token
func generateJWT(userID uint64, secret string, expireHours int) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": strconv.FormatUint(userID, 10),
		"exp":     time.Now().Add(time.Duration(expireHours) * time.Hour).Unix(),
	})
	return token.SignedString([]byte(secret))
}
