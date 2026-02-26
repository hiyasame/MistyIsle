package utils

import (
	"fmt"

	"golang.org/x/crypto/bcrypt"
)

// HashPassword 使用 bcrypt 加密密码
// cost 参数可选，默认使用 bcrypt.DefaultCost (10)
func HashPassword(password string, cost ...int) (string, error) {
	c := bcrypt.DefaultCost
	if len(cost) > 0 && cost[0] >= bcrypt.MinCost && cost[0] <= bcrypt.MaxCost {
		c = cost[0]
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), c)
	if err != nil {
		return "", fmt.Errorf("failed to hash password: %w", err)
	}
	return string(hash), nil
}

// CheckPassword 验证密码是否匹配
func CheckPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}
