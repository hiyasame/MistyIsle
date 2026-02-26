package utils

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"misty-isle/cfg"
)

// RedisClient Redis 客户端包装
type RedisClient struct {
	client *redis.Client
	ctx    context.Context
}

// NewRedis 创建 Redis 客户端
func NewRedis(cfg *cfg.Config) (*RedisClient, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%d", cfg.RedisHost, cfg.RedisPort),
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})

	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis connect failed: %w", err)
	}

	return &RedisClient{
		client: client,
		ctx:    ctx,
	}, nil
}

// Close 关闭连接
func (r *RedisClient) Close() error {
	return r.client.Close()
}

// Set 设置键值
func (r *RedisClient) Set(key string, value interface{}, expiration time.Duration) error {
	return r.client.Set(r.ctx, key, value, expiration).Err()
}

// Get 获取值
func (r *RedisClient) Get(key string) (string, error) {
	return r.client.Get(r.ctx, key).Result()
}

// Del 删除键
func (r *RedisClient) Del(keys ...string) error {
	return r.client.Del(r.ctx, keys...).Err()
}

// Exists 检查键是否存在
func (r *RedisClient) Exists(key string) (bool, error) {
	n, err := r.client.Exists(r.ctx, key).Result()
	return n > 0, err
}

// SetNX 仅当键不存在时才设置（用于分布式锁等）
func (r *RedisClient) SetNX(key string, value interface{}, expiration time.Duration) (bool, error) {
	return r.client.SetNX(r.ctx, key, value, expiration).Result()
}

// TTL 获取键的剩余过期时间
func (r *RedisClient) TTL(key string) (time.Duration, error) {
	return r.client.TTL(r.ctx, key).Result()
}

// ============ 验证码相关方法 ============

// SetVerifyCode 存储验证码
func (r *RedisClient) SetVerifyCode(email, code string, expireMinutes int) error {
	key := fmt.Sprintf("verify:%s", email)
	return r.Set(key, code, time.Duration(expireMinutes)*time.Minute)
}

// GetVerifyCode 获取验证码
func (r *RedisClient) GetVerifyCode(email string) (string, error) {
	key := fmt.Sprintf("verify:%s", email)
	return r.Get(key)
}

// DelVerifyCode 删除验证码
func (r *RedisClient) DelVerifyCode(email string) error {
	key := fmt.Sprintf("verify:%s", email)
	return r.Del(key)
}

// SetPasswordResetToken 存储密码重置令牌
func (r *RedisClient) SetPasswordResetToken(token, email string, expireHours int) error {
	key := fmt.Sprintf("reset:%s", token)
	return r.Set(key, email, time.Duration(expireHours)*time.Hour)
}

// GetPasswordResetToken 获取密码重置令牌对应的邮箱
func (r *RedisClient) GetPasswordResetToken(token string) (string, error) {
	key := fmt.Sprintf("reset:%s", token)
	return r.Get(key)
}

// DelPasswordResetToken 删除密码重置令牌
func (r *RedisClient) DelPasswordResetToken(token string) error {
	key := fmt.Sprintf("reset:%s", token)
	return r.Del(key)
}
