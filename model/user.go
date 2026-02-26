package model

import "time"

// User 用户模型
type User struct {
	ID           uint64    `json:"user_id" db:"id"`
	Username     string    `json:"username" db:"username"`
	Email        string    `json:"email" db:"email"`
	PasswordHash string    `json:"-" db:"password_hash"` // 不返回给前端
	Avatar       string    `json:"avatar" db:"avatar"`
	Bio          string    `json:"bio" db:"bio"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

// UserUpdateRequest 用户信息更新请求
type UserUpdateRequest struct {
	Username *string `json:"username,omitempty"`
	Bio      *string `json:"bio,omitempty"`
	Avatar   *string `json:"avatar,omitempty"`
}

// RegisterRequest 注册请求
type RegisterRequest struct {
	Username string `json:"username" binding:"required,min=3,max=32"`
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=6,max=64"`
	Code     string `json:"code" binding:"required,len=6"` // 邮箱验证码
}

// LoginRequest 登录请求（仅支持邮箱登录）
type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

// SendVerifyCodeRequest 发送验证码请求
type SendVerifyCodeRequest struct {
	Email string `json:"email" binding:"required,email"`
}

// ForgotPasswordRequest 忘记密码请求
type ForgotPasswordRequest struct {
	Email string `json:"email" binding:"required,email"`
}

// ResetPasswordRequest 重置密码请求
type ResetPasswordRequest struct {
	Token    string `json:"token" binding:"required"`
	Password string `json:"password" binding:"required,min=6,max=64"`
}
