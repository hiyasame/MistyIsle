package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"

	"misty-isle/cfg"
	"misty-isle/db"
	"misty-isle/model"
	"misty-isle/utils"
)

// UserService 用户服务
type UserService struct {
	db    *db.DB
	r2    *utils.R2
	redis *utils.RedisClient
	email *utils.EmailClient
	cfg   *cfg.Config
}

// NewUserService 创建用户服务
func NewUserService(db *db.DB, r2 *utils.R2, redis *utils.RedisClient, email *utils.EmailClient, cfg *cfg.Config) *UserService {
	return &UserService{
		db:    db,
		r2:    r2,
		redis: redis,
		email: email,
		cfg:   cfg,
	}
}

// ============ 验证码相关 ============

// GenerateVerifyCode 生成6位数字验证码
func (s *UserService) GenerateVerifyCode() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(1000000))
	return fmt.Sprintf("%06d", n.Int64())
}

// SendVerifyCode 发送邮箱验证码
func (s *UserService) SendVerifyCode(email string) error {
	// 检查邮箱格式
	if !isValidEmail(email) {
		return fmt.Errorf("invalid email format")
	}

	// 检查是否已存在未过期的验证码
	exists, _ := s.redis.Exists(fmt.Sprintf("verify:%s", email))
	if exists {
		return fmt.Errorf("verification code already sent, please wait")
	}

	// 生成验证码
	code := s.GenerateVerifyCode()

	// 存储到 Redis，5分钟过期
	if err := s.redis.SetVerifyCode(email, code, 5); err != nil {
		return fmt.Errorf("failed to save verification code: %w", err)
	}

	// 发送邮件
	if err := s.email.SendVerificationCode(email, code, 5); err != nil {
		// 发送失败，删除已存储的验证码
		s.redis.DelVerifyCode(email)
		return fmt.Errorf("failed to send email: %w", err)
	}

	return nil
}

// VerifyCode 验证邮箱验证码
func (s *UserService) VerifyCode(email, code string) bool {
	storedCode, err := s.redis.GetVerifyCode(email)
	if err != nil {
		return false
	}
	return strings.EqualFold(storedCode, code)
}

// ============ 用户注册/登录 ============

// Register 用户注册
func (s *UserService) Register(req *model.RegisterRequest) (*model.User, error) {
	// 验证验证码
	if !s.VerifyCode(req.Email, req.Code) {
		return nil, fmt.Errorf("invalid or expired verification code")
	}

	// 检查用户名长度
	if len(req.Username) < 3 || len(req.Username) > 32 {
		return nil, fmt.Errorf("username length must be 3-32")
	}

	// 检查邮箱是否已注册
	exists, err := s.db.CheckEmailExists(req.Email)
	if err != nil {
		return nil, fmt.Errorf("database error: %w", err)
	}
	if exists {
		return nil, fmt.Errorf("email already registered")
	}

	// 检查用户名是否已存在
	exists, err = s.db.CheckUsernameExists(req.Username)
	if err != nil {
		return nil, fmt.Errorf("database error: %w", err)
	}
	if exists {
		return nil, fmt.Errorf("username already taken")
	}

	// 加密密码
	passwordHash, err := utils.HashPassword(req.Password)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	// 创建用户（注册时已验证邮箱）
	user := &model.User{
		Username:     req.Username,
		Email:        req.Email,
		PasswordHash: passwordHash,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	if err := s.db.CreateUser(user); err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	// 删除已使用的验证码
	s.redis.DelVerifyCode(req.Email)

	return user, nil
}

// Login 用户登录
func (s *UserService) Login(req *model.LoginRequest) (*model.User, error) {
	// 查找用户
	user, err := s.db.GetUserByEmail(req.Email)
	if err != nil {
		return nil, fmt.Errorf("invalid email or password")
	}

	// 验证密码
	if !utils.CheckPassword(req.Password, user.PasswordHash) {
		return nil, fmt.Errorf("invalid email or password")
	}

	return user, nil
}

// GetUserByID 根据ID获取用户
func (s *UserService) GetUserByID(userID uint64) (*model.User, error) {
	return s.db.GetUserByID(userID)
}

// UpdateUser 更新用户信息
func (s *UserService) UpdateUser(userID uint64, req *model.UserUpdateRequest) error {
	updates := make(map[string]interface{})

	if req.Username != nil {
		// 检查用户名长度
		if len(*req.Username) < 3 || len(*req.Username) > 32 {
			return fmt.Errorf("username length must be 3-32")
		}
		// 检查用户名是否已存在
		exists, err := s.db.CheckUsernameExists(*req.Username)
		if err != nil {
			return fmt.Errorf("database error: %w", err)
		}
		if exists {
			return fmt.Errorf("username already taken")
		}
		updates["username"] = *req.Username
	}

	if req.Bio != nil {
		if len(*req.Bio) > 500 {
			return fmt.Errorf("bio too long (max 500 chars)")
		}
		updates["bio"] = *req.Bio
	}

	if req.Avatar != nil {
		updates["avatar"] = *req.Avatar
	}

	if len(updates) == 0 {
		return fmt.Errorf("no fields to update")
	}

	updates["updated_at"] = time.Now()

	return s.db.UpdateUser(userID, updates)
}

// UpdateAvatar 更新用户头像
func (s *UserService) UpdateAvatar(userID uint64, avatarData []byte, contentType string) (string, error) {
	// 生成文件名
	filename := fmt.Sprintf("avatars/%d/%d.jpg", userID, time.Now().Unix())

	// 上传到 R2
	result, err := s.r2.Upload(context.Background(), filename, avatarData, utils.UploadOptions{
		ContentType: contentType,
	})
	if err != nil {
		return "", fmt.Errorf("failed to upload avatar: %w", err)
	}

	// 更新数据库
	if err := s.db.UpdateUser(userID, map[string]interface{}{
		"avatar":     result.URL,
		"updated_at": time.Now(),
	}); err != nil {
		return "", err
	}

	return result.URL, nil
}

// ============ 密码重置 ============

// ForgotPassword 忘记密码，发送重置邮件
func (s *UserService) ForgotPassword(email string) error {
	// 检查邮箱是否存在
	user, err := s.db.GetUserByEmail(email)
	if err != nil {
		// 为了安全，不告诉用户邮箱是否存在
		return nil
	}

	// 生成重置令牌
	token := generateRandomToken(32)

	// 存储到 Redis，24小时过期
	if err := s.redis.SetPasswordResetToken(token, email, 24); err != nil {
		return fmt.Errorf("failed to save reset token: %w", err)
	}

	// 构建重置链接
	resetURL := fmt.Sprintf("%s/reset-password?token=%s", s.cfg.FrontendURL, token)

	// 发送邮件
	if err := s.email.SendPasswordReset(user.Email, resetURL, 24); err != nil {
		err := s.redis.DelPasswordResetToken(token)
		if err != nil {
			return err
		}
		return fmt.Errorf("failed to send email: %w", err)
	}

	return nil
}

// ResetPassword 重置密码
func (s *UserService) ResetPassword(token, newPassword string) error {
	// 获取令牌对应的邮箱
	email, err := s.redis.GetPasswordResetToken(token)
	if err != nil {
		return fmt.Errorf("invalid or expired token")
	}

	// 查找用户
	user, err := s.db.GetUserByEmail(email)
	if err != nil {
		return fmt.Errorf("user not found")
	}

	// 加密新密码
	passwordHash, err := utils.HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	// 更新密码
	if err := s.db.UpdateUser(user.ID, map[string]interface{}{
		"password_hash": passwordHash,
		"updated_at":    time.Now(),
	}); err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	// 删除已使用的令牌
	err = s.redis.DelPasswordResetToken(token)
	if err != nil {
		return err
	}

	return nil
}

// ============ 辅助函数 ============

// isValidEmail 验证邮箱格式
func isValidEmail(email string) bool {
	pattern := `^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`
	matched, _ := regexp.MatchString(pattern, email)
	return matched
}

// generateRandomToken 生成随机令牌
func generateRandomToken(length int) string {
	bytes := make([]byte, length/2)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}
