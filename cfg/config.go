package cfg

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config 应用配置
type Config struct {
	// 服务器
	ServerPort string `env:"SERVER_PORT" default:"8080"`

	// 数据库 (PostgreSQL)
	DBHost     string `env:"DB_HOST" default:"localhost"`
	DBPort     int    `env:"DB_PORT" default:"5432"`
	DBUser     string `env:"DB_USER" default:"postgres"`
	DBPassword string `env:"DB_PASSWORD" default:"postgres"`
	DBName     string `env:"DB_NAME" default:"misty_isle"`
	DBDSN      string `env:"DB_DSN" default:""` // 完整 DSN，优先级最高

	// JWT
	JWTSecret string `env:"JWT_SECRET" default:"your-secret-key-change-in-production"`
	JWTExpire int    `env:"JWT_EXPIRE_HOURS" default:"72"` // 小时

	// R2 对象存储
	R2Endpoint  string `env:"R2_ENDPOINT" default:""`
	R2AccessKey string `env:"R2_ACCESS_KEY_ID" default:""`
	R2SecretKey string `env:"R2_SECRET_ACCESS_KEY" default:""`
	R2Bucket    string `env:"R2_BUCKET" default:"videos"`
	R2PublicURL string `env:"R2_PUBLIC_URL" default:""` // CDN 加速域名

	// SRS
	SRSHTTPURL string `env:"SRS_HTTP_URL" default:"http://localhost:8080"`
	SRSRTMPURL string `env:"SRS_RTMP_URL" default:"rtmp://localhost:1935"`

	// SMTP 邮件服务
	SMTPHost     string `env:"SMTP_HOST" default:"smtp.gmail.com"`
	SMTPPort     int    `env:"SMTP_PORT" default:"587"`
	SMTPUsername string `env:"SMTP_USERNAME" default:""`
	SMTPPassword string `env:"SMTP_PASSWORD" default:""` // 应用专用密码
	SMTPFrom     string `env:"SMTP_FROM" default:""`     // 发件人显示名称
	SMTPSSL      bool   `env:"SMTP_SSL" default:"false"` // 是否使用 SSL (465端口)

	// Redis
	RedisHost     string `env:"REDIS_HOST" default:"localhost"`
	RedisPort     int    `env:"REDIS_PORT" default:"6379"`
	RedisPassword string `env:"REDIS_PASSWORD" default:""`
	RedisDB       int    `env:"REDIS_DB" default:"0"`

	// 前端地址（用于邮件链接等）
	FrontendURL string `env:"FRONTEND_URL" default:"http://localhost:3000"`

	// 环境
	Env string `env:"APP_ENV" default:"development"` // development, production
}

// Load 从环境变量加载配置
func Load() *Config {
	cfg := &Config{}

	// 使用反射或手动读取环境变量
	cfg.ServerPort = getEnv("SERVER_PORT", "8080")

	cfg.DBHost = getEnv("DB_HOST", "localhost")
	cfg.DBPort = getEnvInt("DB_PORT", 5432)
	cfg.DBUser = getEnv("DB_USER", "postgres")
	cfg.DBPassword = getEnv("DB_PASSWORD", "postgres")
	cfg.DBName = getEnv("DB_NAME", "misty_isle")
	cfg.DBDSN = getEnv("DB_DSN", "")

	cfg.JWTSecret = getEnv("JWT_SECRET", "your-secret-key-change-in-production")
	cfg.JWTExpire = getEnvInt("JWT_EXPIRE_HOURS", 72)

	cfg.R2Endpoint = getEnv("R2_ENDPOINT", "")
	cfg.R2AccessKey = getEnv("R2_ACCESS_KEY_ID", "")
	cfg.R2SecretKey = getEnv("R2_SECRET_ACCESS_KEY", "")
	cfg.R2Bucket = getEnv("R2_BUCKET", "videos")
	cfg.R2PublicURL = getEnv("R2_PUBLIC_URL", "")

	cfg.SRSHTTPURL = getEnv("SRS_HTTP_URL", "http://localhost:8080")
	cfg.SRSRTMPURL = getEnv("SRS_RTMP_URL", "rtmp://localhost:1935")

	cfg.SMTPHost = getEnv("SMTP_HOST", "smtp.gmail.com")
	cfg.SMTPPort = getEnvInt("SMTP_PORT", 587)
	cfg.SMTPUsername = getEnv("SMTP_USERNAME", "")
	cfg.SMTPPassword = getEnv("SMTP_PASSWORD", "")
	cfg.SMTPFrom = getEnv("SMTP_FROM", "")
	cfg.SMTPSSL = getEnv("SMTP_SSL", "false") == "true"

	cfg.RedisHost = getEnv("REDIS_HOST", "localhost")
	cfg.RedisPort = getEnvInt("REDIS_PORT", 6379)
	cfg.RedisPassword = getEnv("REDIS_PASSWORD", "")
	cfg.RedisDB = getEnvInt("REDIS_DB", 0)

	cfg.FrontendURL = getEnv("FRONTEND_URL", "http://localhost:3000")

	cfg.Env = getEnv("APP_ENV", "development")

	return cfg
}

// GetDBDSN 获取数据库连接字符串
func (c *Config) GetDBDSN() string {
	// 如果配置了完整 DSN，直接返回
	if c.DBDSN != "" {
		return c.DBDSN
	}

	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable&charset=utf8&TimeZone=Asia/Shanghai",
		c.DBUser, c.DBPassword, c.DBHost, c.DBPort, c.DBName)
}

// IsDev 是否是开发环境
func (c *Config) IsDev() bool {
	return c.Env == "development" || c.Env == "dev"
}

// IsProd 是否是生产环境
func (c *Config) IsProd() bool {
	return c.Env == "production" || c.Env == "prod"
}

// Validate 验证配置
func (c *Config) Validate() error {
	if c.JWTSecret == "your-secret-key-change-in-production" && c.IsProd() {
		return fmt.Errorf("请修改生产环境 JWT_SECRET")
	}

	if c.R2Endpoint == "" && c.IsProd() {
		return fmt.Errorf("生产环境必须配置 R2_ENDPOINT")
	}

	if c.SMTPUsername == "" && c.IsProd() {
		return fmt.Errorf("生产环境必须配置 SMTP_USERNAME")
	}

	return nil
}

// Print 打印配置（开发调试用，隐藏敏感信息）
func (c *Config) Print() {
	fmt.Println("========== Config ==========")
	fmt.Printf("Env: %s\n", c.Env)
	fmt.Printf("ServerPort: %s\n", c.ServerPort)
	fmt.Printf("DBHost: %s:%d\n", c.DBHost, c.DBPort)
	fmt.Printf("DBName: %s\n", c.DBName)
	fmt.Printf("R2Bucket: %s\n", c.R2Bucket)
	fmt.Printf("R2PublicURL: %s\n", c.R2PublicURL)
	fmt.Println("============================")
}

// 辅助函数
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if i, err := strconv.Atoi(value); err == nil {
			return i
		}
	}
	return defaultValue
}

// LoadFromFile 从 .env 文件加载（开发用）
func LoadFromFile(filepath string) *Config {
	// 尝试读取 .env 文件
	if data, err := os.ReadFile(filepath); err == nil {
		lines := strings.Split(string(data), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}

			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				key := strings.TrimSpace(parts[0])
				value := strings.TrimSpace(parts[1])
				// 去除引号
				value = strings.Trim(value, `"'`)
				os.Setenv(key, value)
			}
		}
	}

	return Load()
}
